pub mod deepseek;
pub mod gemini;
pub mod metaai;

use std::collections::HashMap;
use std::pin::Pin;
use std::sync::Arc;

use async_trait::async_trait;
use futures::Stream;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use thiserror::Error;

use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ModelList, ModelObject};
use crate::session::ImageAttachment;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderCredentials {
    pub profile_id: Option<String>,
    pub token: Option<String>,
    pub cookie: Option<String>,
}

#[derive(Debug, Clone)]
pub enum StreamEvent {
    Content(String),
    Reasoning(String),
    SessionMeta(Map<String, Value>),
}

pub type ProviderStream = Pin<Box<dyn Stream<Item = Result<StreamEvent, ProviderError>> + Send>>;

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("missing credentials for provider `{0}`")]
    MissingCredentials(&'static str),
    #[error("http client error: {0}")]
    Http(#[from] wreq::Error),
    #[error("unexpected upstream response ({status}): {body}")]
    Upstream { status: u16, body: String },
    #[error("provider error: {0}")]
    Other(String),
    #[error("not yet implemented for provider `{0}`")]
    NotImplemented(&'static str),
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ProviderErrorPolicy {
    /// Temporary throttling/rate-limit/spam errors: trigger cooldown + immediate failover without disabling the profile.
    pub cooldown_keywords: &'static [&'static str],
    /// Permanent auth/credential errors: deactivate the profile and failover.
    pub auth_failure_keywords: &'static [&'static str],
    /// Errors that must NOT trigger profile cooldown or deactivation.
    pub non_retryable_keywords: &'static [&'static str],
}

#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;

    fn models(&self) -> Vec<ModelObject>;

    fn error_policy(&self) -> ProviderErrorPolicy {
        ProviderErrorPolicy::default()
    }

    async fn chat_completions(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &mut Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ChatCompletionResponse, ProviderError>;

    async fn chat_completions_stream(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
        session_data: &Map<String, Value>,
        attachments: &[ImageAttachment],
    ) -> Result<ProviderStream, ProviderError>;

    async fn invalidate_profile(&self, _profile_id: &str) {}
}

pub struct ProviderRegistry {
    providers: HashMap<&'static str, Arc<dyn Provider>>,
}

impl ProviderRegistry {
    pub fn with_defaults() -> Result<Self, ProviderError> {
        let ds = Arc::new(deepseek::DeepSeekProvider::new()?);
        Ok(Self::with_providers(vec![ds]))
    }

    pub fn with_providers(list: Vec<Arc<dyn Provider>>) -> Self {
        let mut providers: HashMap<&'static str, Arc<dyn Provider>> = HashMap::new();
        for p in list {
            providers.insert(p.id(), p);
        }
        Self { providers }
    }

    pub fn get(&self, id: &str) -> Option<Arc<dyn Provider>> {
        self.providers.get(id).cloned()
    }

    pub fn list_models(&self, provider_id: Option<&str>) -> ModelList {
        let data = match provider_id {
            Some(id) => self
                .providers
                .get(id)
                .map(|p| p.models())
                .unwrap_or_default(),
            None => self
                .providers
                .values()
                .flat_map(|p| p.models())
                .collect(),
        };
        ModelList::new(data)
    }

    /// Lists all registered providers' models in deterministic `provider:model` format.
    pub fn list_unified_models(&self) -> ModelList {
        let mut entries: Vec<_> = self.providers.iter().collect();
        entries.sort_by_key(|(id, _)| *id);

        let mut data = Vec::new();
        for (provider_id, provider) in entries {
            for mut m in provider.models() {
                m.id = format!("{provider_id}:{}", m.id);
                m.owned_by = (*provider_id).to_string();
                data.push(m);
            }
        }
        ModelList::new(data)
    }

    /// Resolves a model string (`provider:model` or an exact registered model ID) to `(provider_id, model_id)`.
    pub fn resolve_model(&self, raw_model: &str) -> Result<(String, String), String> {
        let trimmed = raw_model.trim();
        if let Some((raw_provider, raw_model_id)) = trimmed.split_once(':') {
            let provider = raw_provider.trim().to_lowercase();
            let model = raw_model_id.trim().to_string();
            if provider.is_empty() || model.is_empty() {
                return Err(
                    "Invalid model format. Expected 'provider:model' (e.g. 'deepseek:deepseek-chat')."
                        .to_string(),
                );
            }
            if !self.providers.contains_key(provider.as_str()) {
                let mut supported: Vec<_> = self.providers.keys().copied().collect();
                supported.sort_unstable();
                return Err(format!(
                    "Unknown provider '{provider}'. Supported providers: {}.",
                    supported.join(", ")
                ));
            }
            return Ok((provider, model));
        }

        let mut entries: Vec<_> = self.providers.iter().collect();
        entries.sort_by_key(|(id, _)| *id);
        for (provider_id, provider) in entries {
            if provider.models().iter().any(|m| m.id == trimmed) {
                return Ok(((*provider_id).to_string(), trimmed.to_string()));
            }
        }

        Err(
            "Model must use 'provider:model' format (e.g. 'deepseek:deepseek-chat')."
                .to_string(),
        )
    }
}

pub mod deepseek;
pub mod gemini;
pub mod metaai;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ModelList, ModelObject};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ProviderCredentials {
    pub token: Option<String>,
    pub cookie: Option<String>,
}

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

#[async_trait]
pub trait Provider: Send + Sync {
    fn id(&self) -> &'static str;

    fn models(&self) -> Vec<ModelObject>;

    async fn chat_completions(
        &self,
        credentials: &ProviderCredentials,
        request: &ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, ProviderError>;
}

pub struct ProviderRegistry {
    providers: HashMap<&'static str, Arc<dyn Provider>>,
}

impl ProviderRegistry {
    pub fn with_defaults() -> Result<Self, ProviderError> {
        let mut providers: HashMap<&'static str, Arc<dyn Provider>> = HashMap::new();

        let ds = Arc::new(deepseek::DeepSeekProvider::new()?);
        let gm = Arc::new(gemini::GeminiProvider::new()?);
        let ma = Arc::new(metaai::MetaAIProvider::new()?);

        providers.insert(ds.id(), ds);
        providers.insert(gm.id(), gm);
        providers.insert(ma.id(), ma);

        Ok(Self { providers })
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
}

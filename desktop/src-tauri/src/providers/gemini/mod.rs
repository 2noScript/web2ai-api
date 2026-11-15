use async_trait::async_trait;
use wreq::Client;

use crate::http_client::build_browser_client;
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ModelObject};
use crate::providers::{Provider, ProviderCredentials, ProviderError};

pub struct GeminiProvider {
    client: Client,
}

impl GeminiProvider {
    pub fn new() -> Result<Self, ProviderError> {
        Ok(Self {
            client: build_browser_client()?,
        })
    }

    pub fn client(&self) -> &Client {
        &self.client
    }
}

#[async_trait]
impl Provider for GeminiProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    fn models(&self) -> Vec<ModelObject> {
        vec![
            ModelObject::new(
                "gemini-3-flash",
                "gemini",
                "Gemini Flash model via unofficial web API",
            ),
            ModelObject::new(
                "gemini-3-pro",
                "gemini",
                "Gemini Pro model via unofficial web API",
            ),
        ]
    }

    async fn chat_completions(
        &self,
        credentials: &ProviderCredentials,
        _request: &ChatCompletionRequest,
    ) -> Result<ChatCompletionResponse, ProviderError> {
        let _cookie = credentials
            .cookie
            .as_deref()
            .filter(|c| !c.trim().is_empty())
            .ok_or(ProviderError::MissingCredentials("gemini"))?;

        // TODO: Port Gemini web RPC calls using `self.client` (wreq)
        // and map output into `ChatCompletionResponse`.
        Err(ProviderError::NotImplemented("gemini"))
    }
}

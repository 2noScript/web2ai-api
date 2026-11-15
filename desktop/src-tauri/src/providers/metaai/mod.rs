use async_trait::async_trait;
use wreq::Client;

use crate::http_client::build_browser_client;
use crate::openai::{ChatCompletionRequest, ChatCompletionResponse, ModelObject};
use crate::providers::{Provider, ProviderCredentials, ProviderError};

pub struct MetaAIProvider {
    client: Client,
}

impl MetaAIProvider {
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
impl Provider for MetaAIProvider {
    fn id(&self) -> &'static str {
        "metaai"
    }

    fn models(&self) -> Vec<ModelObject> {
        vec![ModelObject::new(
            "meta-llama",
            "metaai",
            "Meta AI model via unofficial web API",
        )]
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
            .ok_or(ProviderError::MissingCredentials("metaai"))?;

        // TODO: Port Meta AI GraphQL/web calls using `self.client` (wreq)
        // and map output into `ChatCompletionResponse`.
        Err(ProviderError::NotImplemented("metaai"))
    }
}

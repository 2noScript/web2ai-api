use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JsonSchemaConfig {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub schema: Value,
    #[serde(default)]
    pub strict: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseFormat {
    Text,
    JsonObject,
    JsonSchema { json_schema: JsonSchemaConfig },
}

impl ResponseFormat {
    pub fn is_json_mode(&self) -> bool {
        matches!(self, Self::JsonObject | Self::JsonSchema { .. })
    }

    pub fn validate(&self) -> Result<(), String> {
        if let Self::JsonSchema { json_schema } = self {
            let name = json_schema.name.trim();
            if name.is_empty() {
                return Err("response_format.json_schema.name must be a non-empty string.".into());
            }
            if !json_schema.schema.is_object() && !json_schema.schema.is_boolean() {
                return Err("response_format.json_schema.schema must be a JSON Schema object.".into());
            }
            jsonschema::validator_for(&json_schema.schema)
                .map_err(|e| format!("Invalid response_format.json_schema.schema: {e}"))?;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub response_format: Option<Value>,
}

impl ChatCompletionRequest {
    pub fn parse_response_format(&self) -> Result<Option<ResponseFormat>, String> {
        let Some(ref raw) = self.response_format else {
            return Ok(None);
        };
        if raw.is_null() {
            return Ok(None);
        }
        let obj = raw
            .as_object()
            .ok_or_else(|| "response_format must be a JSON object.".to_string())?;
        let fmt_type = obj
            .get("type")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "response_format.type must be 'text', 'json_object', or 'json_schema'.".to_string())?;

        let parsed = match fmt_type {
            "text" => ResponseFormat::Text,
            "json_object" => ResponseFormat::JsonObject,
            "json_schema" => {
                let raw_schema = obj
                    .get("json_schema")
                    .ok_or_else(|| "response_format.json_schema is required when type is 'json_schema'.".to_string())?;
                let cfg: JsonSchemaConfig = serde_json::from_value(raw_schema.clone())
                    .map_err(|e| format!("Invalid response_format.json_schema: {e}"))?;
                ResponseFormat::JsonSchema { json_schema: cfg }
            }
            other => {
                return Err(format!(
                    "Unsupported response_format.type '{other}'. Expected 'text', 'json_object', or 'json_schema'."
                ));
            }
        };
        parsed.validate()?;
        Ok(Some(parsed))
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResponseMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Choice {
    pub index: u32,
    pub message: ResponseMessage,
    pub finish_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatCompletionResponse {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_fingerprint: Option<String>,
    pub choices: Vec<Choice>,
    pub usage: Usage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

impl ChatCompletionResponse {
    pub fn simple(
        model: impl Into<String>,
        content: impl Into<String>,
        reasoning_content: Option<String>,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Self {
            id: format!("chatcmpl-{}", uuid::Uuid::new_v4().simple()),
            object: "chat.completion".to_string(),
            created: now,
            model: model.into(),
            system_fingerprint: None,
            choices: vec![Choice {
                index: 0,
                message: ResponseMessage {
                    role: "assistant".to_string(),
                    content: content.into(),
                    reasoning_content,
                },
                finish_reason: "stop".to_string(),
            }],
            usage: Usage::default(),
            citation: None,
            title: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelObject {
    pub id: String,
    pub object: String,
    pub created: u64,
    pub owned_by: String,
    pub description: String,
}

impl ModelObject {
    pub fn new(
        id: impl Into<String>,
        owned_by: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            object: "model".to_string(),
            created: 1704067200,
            owned_by: owned_by.into(),
            description: description.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelList {
    pub object: String,
    pub data: Vec<ModelObject>,
}

impl ModelList {
    pub fn new(data: Vec<ModelObject>) -> Self {
        Self {
            object: "list".to_string(),
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_valid_openai_response_formats() {
        let req_none: ChatCompletionRequest = serde_json::from_value(json!({
            "model": "deepseek:deepseek-chat",
            "messages": [{"role": "user", "content": "hi"}]
        }))
        .unwrap();
        assert_eq!(req_none.parse_response_format().unwrap(), None);

        let req_text: ChatCompletionRequest = serde_json::from_value(json!({
            "model": "deepseek:deepseek-chat",
            "messages": [{"role": "user", "content": "hi"}],
            "response_format": { "type": "text" }
        }))
        .unwrap();
        assert_eq!(
            req_text.parse_response_format().unwrap(),
            Some(ResponseFormat::Text)
        );

        let req_obj: ChatCompletionRequest = serde_json::from_value(json!({
            "model": "deepseek:deepseek-chat",
            "messages": [{"role": "user", "content": "hi"}],
            "response_format": { "type": "json_object" }
        }))
        .unwrap();
        assert_eq!(
            req_obj.parse_response_format().unwrap(),
            Some(ResponseFormat::JsonObject)
        );

        let req_schema: ChatCompletionRequest = serde_json::from_value(json!({
            "model": "deepseek:deepseek-chat",
            "messages": [{"role": "user", "content": "hi"}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "person",
                    "strict": true,
                    "schema": {
                        "type": "object",
                        "properties": { "name": { "type": "string" } },
                        "required": ["name"]
                    }
                }
            }
        }))
        .unwrap();
        assert!(matches!(
            req_schema.parse_response_format().unwrap(),
            Some(ResponseFormat::JsonSchema { .. })
        ));
    }

    #[test]
    fn rejects_invalid_openai_response_formats() {
        for bad in [
            json!("json_object"),
            json!({}),
            json!({ "type": "xml" }),
            json!({ "type": "json_schema" }),
            json!({ "type": "json_schema", "json_schema": { "name": "", "schema": {} } }),
            json!({ "type": "json_schema", "json_schema": { "name": "x", "schema": { "type": 123 } } }),
        ] {
            let req: ChatCompletionRequest = serde_json::from_value(json!({
                "model": "deepseek:deepseek-chat",
                "messages": [{"role": "user", "content": "hi"}],
                "response_format": bad
            }))
            .unwrap();
            assert!(req.parse_response_format().is_err());
        }
    }
}

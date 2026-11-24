use serde_json::Value;

use crate::openai::{JsonSchemaConfig, ResponseFormat};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StructuredOutputError {
    pub message: String,
    pub code: &'static str,
}

impl StructuredOutputError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

impl std::fmt::Display for StructuredOutputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for StructuredOutputError {}

/// Wraps a user/history prompt with strict instructions enforcing raw JSON output
/// when OpenAI `response_format` is `json_object` or `json_schema`.
/// This wrapper is only sent upstream to the provider and is never saved to session history.
pub fn build_json_prompt(user_prompt: &str, format: &ResponseFormat) -> String {
    match format {
        ResponseFormat::Text => user_prompt.to_string(),
        ResponseFormat::JsonObject => format!(
            "[STRICT OUTPUT CONTRACT — JSON OBJECT ONLY]\n\
You must respond with a single valid JSON object (starting with `{{` and ending with `}}`).\n\
Rules:\n\
1. Output ONLY raw JSON. Do NOT wrap in ```json code fences, markdown, or any text before/after the JSON.\n\
2. All keys and string values must use double quotes `\"...\"`, with valid JSON escaping.\n\
3. No trailing commas, no comments (`//` or `/* */`), no `undefined`/`NaN`/`True`/`False`.\n\
4. Ignore any earlier conversational formatting style if it conflicts with returning raw JSON.\n\n\
[USER REQUEST]\n\
{user_prompt}"
        ),
        ResponseFormat::JsonSchema { json_schema } => {
            let schema_pretty = serde_json::to_string_pretty(&json_schema.schema)
                .unwrap_or_else(|_| json_schema.schema.to_string());
            let desc_line = json_schema
                .description
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|d| format!("Description: {d}\n"))
                .unwrap_or_default();
            let strict_note = if json_schema.strict.unwrap_or(false) {
                "Strict mode is ENABLED: every object property, type, enum, and `required` constraint MUST match exactly.\n"
            } else {
                ""
            };
            format!(
                "[STRICT OUTPUT CONTRACT — JSON SCHEMA]\n\
You must respond with ONLY a single valid JSON value conforming strictly to the JSON Schema below.\n\
Schema Name: {name}\n\
{desc_line}{strict_note}\n\
Target JSON Schema:\n\
{schema_pretty}\n\n\
Rules:\n\
1. Output ONLY raw JSON (no ```json fences, no explanations, no prose before or after).\n\
2. Include every field listed in `required` with the exact property names and JSON types defined in the schema.\n\
3. Do NOT add extra properties if `additionalProperties` is `false`.\n\
4. Use valid JSON syntax only (double quotes, no trailing commas, no comments).\n\n\
[USER REQUEST]\n\
{user_prompt}",
                name = json_schema.name.trim(),
            )
        }
    }
}

/// Builds a compact self-correction prompt used on an internal retry if the model's
/// first output could not be repaired into valid JSON or failed JSON Schema validation.
pub fn build_json_retry_prompt(
    format: &ResponseFormat,
    invalid_output: &str,
    error_reason: &str,
) -> String {
    let preview: String = invalid_output.chars().take(600).collect();
    let target = match format {
        ResponseFormat::Text => "valid text".to_string(),
        ResponseFormat::JsonObject => "a single valid JSON object ({...})".to_string(),
        ResponseFormat::JsonSchema { json_schema } => {
            let schema_str = serde_json::to_string(&json_schema.schema)
                .unwrap_or_else(|_| json_schema.schema.to_string());
            format!(
                "valid JSON matching schema `{}` ({schema_str})",
                json_schema.name.trim()
            )
        }
    };
    format!(
        "[JSON OUTPUT CORRECTION]\n\
Your previous response failed validation: {error_reason}\n\
Previous output snippet:\n\
{preview}\n\n\
Respond again now with ONLY {target}. Do NOT include markdown fences or any explanatory text."
    )
}

/// Extracts candidate payloads from markdown fenced blocks (` ```json ... ``` ` or ` ``` ... ``` `),
/// including unclosed fences if the upstream response was truncated.
fn extract_markdown_code_blocks(raw: &str) -> Vec<&str> {
    let mut json_fences = Vec::new();
    let mut other_fences = Vec::new();
    let mut cursor = raw;

    while let Some(open_idx) = cursor.find("```") {
        let after_open = &cursor[open_idx + 3..];
        let (lang, body_start) = match after_open.find('\n') {
            Some(nl) => (
                after_open[..nl].trim().to_ascii_lowercase(),
                &after_open[nl + 1..],
            ),
            None => break,
        };

        let (block, rest) = match body_start.find("```") {
            Some(close_idx) => (body_start[..close_idx].trim(), &body_start[close_idx + 3..]),
            None => (body_start.trim(), ""),
        };

        if !block.is_empty() {
            if lang == "json" || lang == "jsonc" || lang == "json5" {
                json_fences.push(block);
            } else {
                other_fences.push(block);
            }
        }
        if rest.is_empty() {
            break;
        }
        cursor = rest;
    }

    json_fences.extend(other_fences);
    json_fences
}

/// Finds the first `{` or `[` outside of markdown prose as a fallback candidate
/// when leading conversational text contains punctuation or colons.
fn slice_from_first_json_delimiter(raw: &str) -> Option<&str> {
    raw.find(['{', '[']).map(|idx| raw[idx..].trim())
}

/// Extracts the first balanced `{...}` or `[...]` span from `raw`,
/// ignoring braces inside JSON/single-quoted strings and `//` or `/* */` comments.
fn extract_balanced_json_span(raw: &str) -> Option<&str> {
    let start = raw.find(['{', '['])?;
    let bytes = raw.as_bytes();
    let mut i = start;
    let mut depth = 0usize;
    let mut in_string: Option<u8> = None;
    let mut escaped = false;

    while i < bytes.len() {
        let b = bytes[i];
        if let Some(quote) = in_string {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == quote {
                in_string = None;
            }
            i += 1;
            continue;
        }

        if b == b'/' && i + 1 < bytes.len() {
            if bytes[i + 1] == b'/' {
                i += 2;
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            if bytes[i + 1] == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
        }

        match b {
            b'"' | b'\'' => in_string = Some(b),
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return Some(&raw[start..=i]);
                }
            }
            _ => {}
        }
        i += 1;
    }

    None
}

fn try_parse_or_repair(candidate: &str) -> Option<Value> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
        return Some(val);
    }
    if let Ok(repaired) = jsonrepair_rs::jsonrepair(trimmed) {
        if let Ok(val) = serde_json::from_str::<Value>(&repaired) {
            return Some(val);
        }
    }
    None
}

fn validate_against_format(
    value: &Value,
    format: &ResponseFormat,
) -> Result<(), StructuredOutputError> {
    match format {
        ResponseFormat::Text => Ok(()),
        ResponseFormat::JsonObject => {
            if value.is_object() {
                Ok(())
            } else {
                Err(StructuredOutputError::new(
                    "invalid_json_output",
                    "Expected a JSON object (`{...}`) for response_format.type='json_object'.",
                ))
            }
        }
        ResponseFormat::JsonSchema { json_schema } => validate_json_schema(value, json_schema),
    }
}

fn validate_json_schema(
    value: &Value,
    cfg: &JsonSchemaConfig,
) -> Result<(), StructuredOutputError> {
    let validator = jsonschema::validator_for(&cfg.schema).map_err(|e| {
        StructuredOutputError::new(
            "invalid_response_format",
            format!("Invalid JSON Schema '{}': {e}", cfg.name),
        )
    })?;

    let errors: Vec<String> = validator
        .iter_errors(value)
        .take(5)
        .map(|err| {
            let path = err.instance_path().to_string();
            if path.is_empty() {
                err.to_string()
            } else {
                format!("{path}: {err}")
            }
        })
        .collect();

    if errors.is_empty() {
        Ok(())
    } else {
        Err(StructuredOutputError::new(
            "schema_validation_failed",
            format!(
                "Output does not match JSON Schema '{}': {}",
                cfg.name.trim(),
                errors.join("; ")
            ),
        ))
    }
}

fn push_json_candidates<'a>(candidates: &mut Vec<&'a str>, chunk: &'a str) {
    if let Some(span) = extract_balanced_json_span(chunk) {
        candidates.push(span);
    }
    if let Some(sliced) = slice_from_first_json_delimiter(chunk) {
        candidates.push(sliced);
    }
    candidates.push(chunk);
}

/// Extracts, repairs (via `jsonrepair-rs`), and validates JSON output from LLM text
/// according to the OpenAI `response_format` contract.
pub fn repair_and_validate_json(
    raw: &str,
    format: &ResponseFormat,
) -> Result<String, StructuredOutputError> {
    if matches!(format, ResponseFormat::Text) {
        return Ok(raw.to_string());
    }

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(StructuredOutputError::new(
            "empty_json_output",
            "Model returned an empty response when JSON output was required.",
        ));
    }

    let mut candidates: Vec<&str> = Vec::new();
    for block in extract_markdown_code_blocks(trimmed) {
        push_json_candidates(&mut candidates, block);
    }
    push_json_candidates(&mut candidates, trimmed);

    let mut last_validation_err: Option<StructuredOutputError> = None;

    for candidate in candidates {
        let Some(value) = try_parse_or_repair(candidate) else {
            continue;
        };
        // Avoid treating plain conversational refusals/prose (repaired into a bare JSON string)
        // as valid structured output unless the candidate actually looked like a JSON string literal.
        if value.is_string() && !candidate.trim_start().starts_with('"') {
            continue;
        }
        match validate_against_format(&value, format) {
            Ok(()) => {
                return serde_json::to_string(&value).map_err(|e| {
                    StructuredOutputError::new(
                        "json_serialize_error",
                        format!("Failed to serialize repaired JSON: {e}"),
                    )
                });
            }
            Err(err) => {
                last_validation_err = Some(err);
            }
        }
    }

    Err(last_validation_err.unwrap_or_else(|| {
        StructuredOutputError::new(
            "invalid_json_output",
            "Model output could not be repaired into valid JSON matching response_format.",
        )
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn repairs_markdown_wrapped_json_with_surrounding_prose() {
        let raw = "Chắc chắn rồi! Đây là dữ liệu của bạn:\n```json\n{\n  name: 'Nguyễn Văn A',\n  age: 28,\n  active: True,\n  tags: ['rust', 'ai',],\n}\n```\nHy vọng giúp ích cho bạn!";
        let out = repair_and_validate_json(raw, &ResponseFormat::JsonObject).unwrap();
        let val: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(val["name"], "Nguyễn Văn A");
        assert_eq!(val["age"], 28);
        assert_eq!(val["active"], true);
        assert_eq!(val["tags"], json!(["rust", "ai"]));
    }

    #[test]
    fn repairs_truncated_unclosed_markdown_json() {
        let raw = "```json\n{\"items\": [{\"id\": 1, \"title\": \"Item A\"}, {\"id\": 2, \"title\": \"Item B\"";
        let out = repair_and_validate_json(raw, &ResponseFormat::JsonObject).unwrap();
        let val: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(val["items"][0]["id"], 1);
        assert_eq!(val["items"][1]["title"], "Item B");
    }

    #[test]
    fn strips_comments_and_leading_text_with_colons() {
        let raw = "Here is the output: please check below:\n{\n  // user id\n  \"id\": 42,\n  \"ok\": true, /* trailing */\n}\nDone.";
        let out = repair_and_validate_json(raw, &ResponseFormat::JsonObject).unwrap();
        let val: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(val, json!({ "id": 42, "ok": true }));
    }

    #[test]
    fn rejects_array_or_plain_prose_in_json_object_mode() {
        let arr = "```json\n[1, 2, 3]\n```";
        let err_arr = repair_and_validate_json(arr, &ResponseFormat::JsonObject).unwrap_err();
        assert_eq!(err_arr.code, "invalid_json_output");

        let prose = "Xin lỗi, tôi không thể hỗ trợ yêu cầu này.";
        let err_prose = repair_and_validate_json(prose, &ResponseFormat::JsonObject).unwrap_err();
        assert_eq!(err_prose.code, "invalid_json_output");
    }

    #[test]
    fn validates_json_schema_strictly() {
        let fmt = ResponseFormat::JsonSchema {
            json_schema: JsonSchemaConfig {
                name: "order_summary".to_string(),
                description: Some("Structured order summary".to_string()),
                schema: json!({
                    "type": "object",
                    "properties": {
                        "order_id": { "type": "string" },
                        "total": { "type": "number", "minimum": 0 },
                        "status": { "type": "string", "enum": ["paid", "pending"] }
                    },
                    "required": ["order_id", "total", "status"],
                    "additionalProperties": false
                }),
                strict: Some(true),
            },
        };

        let valid_dirty = "```json\n{order_id: 'ORD-01', total: 199.5, status: 'paid',}\n```";
        let out = repair_and_validate_json(valid_dirty, &fmt).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(
            parsed,
            json!({ "order_id": "ORD-01", "total": 199.5, "status": "paid" })
        );

        let missing_required = r#"{"order_id": "ORD-01", "total": 10}"#;
        let err = repair_and_validate_json(missing_required, &fmt).unwrap_err();
        assert_eq!(err.code, "schema_validation_failed");

        let extra_prop = r#"{"order_id": "ORD-01", "total": 10, "status": "paid", "extra": 1}"#;
        let err_extra = repair_and_validate_json(extra_prop, &fmt).unwrap_err();
        assert_eq!(err_extra.code, "schema_validation_failed");
    }

    #[test]
    fn builds_virtual_prompts_with_schema_and_rules() {
        let fmt_obj = ResponseFormat::JsonObject;
        let p1 = build_json_prompt("Extract user info", &fmt_obj);
        assert!(p1.contains("[STRICT OUTPUT CONTRACT — JSON OBJECT ONLY]"));
        assert!(p1.contains("Extract user info"));

        let fmt_schema = ResponseFormat::JsonSchema {
            json_schema: JsonSchemaConfig {
                name: "person".to_string(),
                description: Some("Person record".to_string()),
                schema: json!({"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}),
                strict: Some(true),
            },
        };
        let p2 = build_json_prompt("Alice is 30", &fmt_schema);
        assert!(p2.contains("Schema Name: person"));
        assert!(p2.contains("Strict mode is ENABLED"));
        assert!(p2.contains("\"name\""));
        assert!(p2.contains("Alice is 30"));
    }

    #[test]
    fn handles_nested_escaped_braces_in_strings_and_untagged_fences() {
        let raw = "Output:\n```\n{\n  \"message\": \"He said \\\"{hello}\\\"\",\n  \"nested\": {\"arr\": [1, 2,],},\n}\n```\nEnd note: {ignored}";
        let out = repair_and_validate_json(raw, &ResponseFormat::JsonObject).unwrap();
        let val: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(val["message"], "He said \"{hello}\"");
        assert_eq!(val["nested"]["arr"], json!([1, 2]));
    }

    #[test]
    fn validates_nested_json_schema_arrays_and_rejects_bad_item_types() {
        let fmt = ResponseFormat::JsonSchema {
            json_schema: JsonSchemaConfig {
                name: "invoice".to_string(),
                description: None,
                schema: json!({
                    "type": "object",
                    "properties": {
                        "items": {
                            "type": "array",
                            "minItems": 1,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "sku": { "type": "string" },
                                    "qty": { "type": "integer", "minimum": 1 }
                                },
                                "required": ["sku", "qty"],
                                "additionalProperties": false
                            }
                        }
                    },
                    "required": ["items"],
                    "additionalProperties": false
                }),
                strict: Some(true),
            },
        };

        let ok_raw = "```json\n{\"items\": [{\"sku\": \"A1\", \"qty\": 2,},],}\n```";
        let out = repair_and_validate_json(ok_raw, &fmt).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["items"][0]["qty"], 2);

        let bad_qty = r#"{"items": [{"sku": "A1", "qty": "two"}]}"#;
        let err = repair_and_validate_json(bad_qty, &fmt).unwrap_err();
        assert_eq!(err.code, "schema_validation_failed");
    }

    #[test]
    fn validates_deeply_nested_4_level_deployment_plan_from_dirty_llm_output() {
        let fmt = ResponseFormat::JsonSchema {
            json_schema: JsonSchemaConfig {
                name: "deployment_plan".to_string(),
                description: Some("Multi-environment Kubernetes deployment plan".to_string()),
                schema: json!({
                    "type": "object",
                    "properties": {
                        "service": {
                            "type": "object",
                            "properties": {
                                "name": { "type": "string", "minLength": 1 },
                                "tier": { "type": "string", "enum": ["edge", "core", "worker"] },
                                "owner": {
                                    "type": "object",
                                    "properties": {
                                        "team": { "type": "string" },
                                        "oncall_email": { "type": "string" }
                                    },
                                    "required": ["team", "oncall_email"],
                                    "additionalProperties": false
                                }
                            },
                            "required": ["name", "tier", "owner"],
                            "additionalProperties": false
                        },
                        "environments": {
                            "type": "array",
                            "minItems": 2,
                            "items": {
                                "type": "object",
                                "properties": {
                                    "env": { "type": "string", "enum": ["staging", "production"] },
                                    "replicas": { "type": "integer", "minimum": 1, "maximum": 50 },
                                    "resources": {
                                        "type": "object",
                                        "properties": {
                                            "cpu_millicores": { "type": "integer", "minimum": 100 },
                                            "memory_mb": { "type": "integer", "minimum": 128 }
                                        },
                                        "required": ["cpu_millicores", "memory_mb"],
                                        "additionalProperties": false
                                    },
                                    "ports": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "port": { "type": "integer", "minimum": 1, "maximum": 65535 },
                                                "protocol": { "type": "string", "enum": ["tcp", "udp"] },
                                                "public": { "type": "boolean" }
                                            },
                                            "required": ["port", "protocol", "public"],
                                            "additionalProperties": false
                                        }
                                    }
                                },
                                "required": ["env", "replicas", "resources", "ports"],
                                "additionalProperties": false
                            }
                        },
                        "tags": {
                            "type": "array",
                            "items": { "type": "string" }
                        }
                    },
                    "required": ["service", "environments", "tags"],
                    "additionalProperties": false
                }),
                strict: Some(true),
            },
        };

        let dirty = r#"Dưới đây là cấu hình triển khai của bạn:
```json
{
  // metadata dịch vụ
  service: {
    name: 'web2ai-gateway',
    tier: 'core',
    owner: { team: 'Platform Team', oncall_email: 'oncall@web2ai.dev', },
  },
  environments: [
    {
      env: 'staging',
      replicas: 2,
      resources: { cpu_millicores: 500, memory_mb: 512, },
      ports: [{ port: 8088, protocol: 'tcp', public: False, },],
    },
    {
      env: 'production',
      replicas: 6,
      resources: { cpu_millicores: 2000, memory_mb: 4096 },
      ports: [{ port: 443, protocol: 'tcp', public: True }],
    },
  ],
  tags: ['rust', 'gateway', 'tiếng-việt',],
}
```
Lưu ý kiểm tra kỹ trước khi apply!"#;

        let out = repair_and_validate_json(dirty, &fmt).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["service"]["owner"]["team"], "Platform Team");
        assert_eq!(parsed["environments"][1]["replicas"], 6);
        assert_eq!(parsed["environments"][0]["ports"][0]["public"], false);
        assert_eq!(parsed["tags"][2], "tiếng-việt");
    }
}

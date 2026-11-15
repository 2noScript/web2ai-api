use std::collections::HashMap;
use std::sync::Mutex;

use regex::Regex;
use serde_json::{Map, Value};

use crate::db::{Database, Profile};

#[derive(Debug, thiserror::Error)]
pub enum LoadBalancerError {
    #[error("No active profile found for provider '{0}'.")]
    NoActiveProfile(String),
    #[error("Database error: {0}")]
    Db(#[from] crate::db::DbError),
}

pub struct ProfileLoadBalancer {
    indices: Mutex<HashMap<String, usize>>,
}

impl Default for ProfileLoadBalancer {
    fn default() -> Self {
        Self::new()
    }
}

impl ProfileLoadBalancer {
    pub fn new() -> Self {
        let mut map = HashMap::new();
        map.insert("deepseek".to_string(), 0);
        map.insert("gemini".to_string(), 0);
        map.insert("metaai".to_string(), 0);
        Self {
            indices: Mutex::new(map),
        }
    }

    pub fn get_active_profiles(
        &self,
        db: &Database,
        provider_type: &str,
    ) -> Result<Vec<Profile>, LoadBalancerError> {
        let all = db.list_profiles_by_type(provider_type)?;
        let active = all
            .into_iter()
            .filter(|p| {
                if !p.is_active {
                    return false;
                }
                match provider_type {
                    "deepseek" => p.token.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false),
                    "gemini" | "metaai" => {
                        p.cookie.as_deref().map(|s| !s.trim().is_empty()).unwrap_or(false)
                    }
                    _ => true,
                }
            })
            .collect();
        Ok(active)
    }

    /// Select an active profile using sticky session affinity or Round-Robin.
    /// Returns `(profile, is_sticky_reused)`.
    pub fn select_profile(
        &self,
        db: &Database,
        provider_type: &str,
        session_data: Option<&mut Map<String, Value>>,
    ) -> Result<(Profile, bool), LoadBalancerError> {
        let active_profiles = self.get_active_profiles(db, provider_type)?;
        if active_profiles.is_empty() {
            return Err(LoadBalancerError::NoActiveProfile(provider_type.to_string()));
        }

        if let Some(ref sdata) = session_data {
            if let Some(sticky_pid) = sdata.get("profile_id").and_then(|v| v.as_str()) {
                if let Some(found) = active_profiles.iter().find(|p| p.id == sticky_pid) {
                    return Ok((found.clone(), true));
                }
            }
        }

        let mut indices = self.indices.lock().unwrap_or_else(|e| e.into_inner());
        let current = *indices.get(provider_type).unwrap_or(&0);
        let idx = current % active_profiles.len();
        let selected = active_profiles[idx].clone();
        indices.insert(provider_type.to_string(), (idx + 1) % active_profiles.len());

        if let Some(sdata) = session_data {
            sdata.insert("profile_id".to_string(), Value::String(selected.id.clone()));
        }

        Ok((selected, false))
    }

    pub fn handle_profile_failure(
        &self,
        db: &Database,
        profile_id: &str,
        session_data: Option<&mut Map<String, Value>>,
        is_permanent: bool,
    ) {
        if is_permanent {
            let _ = db.deactivate_profile(profile_id);
        }
        if let Some(sdata) = session_data {
            if sdata.get("profile_id").and_then(|v| v.as_str()) == Some(profile_id) {
                sdata.remove("profile_id");
            }
        }
    }

    pub fn is_auth_failure(err: &str) -> bool {
        let msg = err.to_lowercase();
        let non_auth_keywords = [
            "session is not authenticated",
            "40300",
            "missing_header",
            "being generated",
            "please try again later",
            "too frequent",
            "rate limit",
            "too many requests",
            "challenge",
            "pow",
        ];
        if non_auth_keywords.iter().any(|kw| msg.contains(kw)) {
            return false;
        }

        let auth_keywords = [
            "unauthorized",
            "unauthenticated",
            "invalid token",
            "expired token",
            "token expired",
            "invalid cookie",
        ];
        if auth_keywords.iter().any(|kw| msg.contains(kw)) {
            return true;
        }

        Regex::new(r"\b401\b").map(|re| re.is_match(&msg)).unwrap_or(false)
    }

    pub fn is_retryable_error(err: &str) -> bool {
        let msg = err.to_lowercase();
        if msg.contains("session is not authenticated") {
            return false;
        }
        let keywords = [
            "unauthorized",
            "unauthenticated",
            "invalid token",
            "token expired",
            "expired token",
            "invalid cookie",
            "rate limit",
            "too many requests",
            "too frequent",
            "being generated",
            "please try again later",
            "40300",
        ];
        if keywords.iter().any(|kw| msg.contains(kw)) {
            return true;
        }
        Regex::new(r"\b(401|403|429)\b")
            .map(|re| re.is_match(&msg))
            .unwrap_or(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_failure_classification_matches_python() {
        assert!(ProfileLoadBalancer::is_auth_failure("HTTP 401 Unauthorized"));
        assert!(ProfileLoadBalancer::is_auth_failure("invalid cookie"));
        assert!(!ProfileLoadBalancer::is_auth_failure("429 Too Many Requests"));
        assert!(!ProfileLoadBalancer::is_auth_failure(
            "Session is not authenticated"
        ));
        assert!(!ProfileLoadBalancer::is_auth_failure("40300 missing_header"));
    }
}

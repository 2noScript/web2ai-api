use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use regex::Regex;
use serde_json::{Map, Value};

use crate::db::{Database, Profile};
use crate::providers::ProviderErrorPolicy;

const RATE_LIMIT_COOLDOWN: Duration = Duration::from_secs(30);

fn auth_401_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b401\b").expect("valid 401 regex"))
}

fn retryable_status_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b(401|403|429)\b").expect("valid status regex"))
}

#[derive(Debug, thiserror::Error)]
pub enum LoadBalancerError {
    #[error("No active profile found for provider '{0}'.")]
    NoActiveProfile(String),
    #[error("Database error: {0}")]
    Db(#[from] crate::db::DbError),
}

pub struct ProfileLoadBalancer {
    indices: Mutex<HashMap<String, usize>>,
    cooldowns: Mutex<HashMap<String, Instant>>,
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
            cooldowns: Mutex::new(HashMap::new()),
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

    /// Select an active profile using sticky session affinity or Round-Robin,
    /// skipping cooled-down profiles when healthy ones exist.
    pub fn select_profile(
        &self,
        db: &Database,
        provider_type: &str,
        session_data: Option<&mut Map<String, Value>>,
    ) -> Result<(Profile, bool), LoadBalancerError> {
        self.select_profile_excluding(db, provider_type, session_data, &[])
    }

    /// Select an active profile while skipping `excluded_ids` (already failed in this request)
    /// and respecting temporary cooldowns when non-cooled-down profiles are available.
    pub fn select_profile_excluding(
        &self,
        db: &Database,
        provider_type: &str,
        session_data: Option<&mut Map<String, Value>>,
        excluded_ids: &[String],
    ) -> Result<(Profile, bool), LoadBalancerError> {
        let active_profiles = self.get_active_profiles(db, provider_type)?;
        let candidates: Vec<Profile> = active_profiles
            .into_iter()
            .filter(|p| !excluded_ids.iter().any(|id| id == &p.id))
            .collect();
        if candidates.is_empty() {
            return Err(LoadBalancerError::NoActiveProfile(provider_type.to_string()));
        }

        let now = Instant::now();
        let mut cooldowns = self.cooldowns.lock().unwrap_or_else(|e| e.into_inner());
        cooldowns.retain(|_, until| *until > now);

        let healthy: Vec<Profile> = candidates
            .iter()
            .filter(|p| !cooldowns.contains_key(&p.id))
            .cloned()
            .collect();

        // Prefer non-cooled-down profiles; if all are in cooldown, pick the one expiring soonest.
        let pool: Vec<Profile> = if !healthy.is_empty() {
            healthy
        } else {
            let mut by_expiry = candidates;
            by_expiry.sort_by_key(|p| cooldowns.get(&p.id).copied().unwrap_or(now));
            vec![by_expiry.remove(0)]
        };

        if let Some(ref sdata) = session_data {
            if let Some(sticky_pid) = sdata.get("profile_id").and_then(|v| v.as_str()) {
                if let Some(found) = pool.iter().find(|p| p.id == sticky_pid) {
                    return Ok((found.clone(), true));
                }
            }
        }

        let mut indices = self.indices.lock().unwrap_or_else(|e| e.into_inner());
        let current = *indices.get(provider_type).unwrap_or(&0);
        let idx = current % pool.len();
        let selected = pool[idx].clone();
        indices.insert(provider_type.to_string(), (idx + 1) % pool.len());

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
            let mut cooldowns = self.cooldowns.lock().unwrap_or_else(|e| e.into_inner());
            cooldowns.remove(profile_id);
        } else {
            let mut cooldowns = self.cooldowns.lock().unwrap_or_else(|e| e.into_inner());
            cooldowns.insert(profile_id.to_string(), Instant::now() + RATE_LIMIT_COOLDOWN);
        }
        if let Some(sdata) = session_data {
            if sdata.get("profile_id").and_then(|v| v.as_str()) == Some(profile_id) {
                sdata.remove("profile_id");
            }
        }
    }

    pub fn is_auth_failure(err: &str) -> bool {
        Self::is_auth_failure_for(ProviderErrorPolicy::default(), err)
    }

    pub fn is_auth_failure_for(policy: ProviderErrorPolicy, err: &str) -> bool {
        let msg = err.to_lowercase();
        let generic_non_auth = [
            "rate limit",
            "rate_limit",
            "too many requests",
            "too_many_requests",
            "challenge",
            "pow",
        ];
        if generic_non_auth.iter().any(|kw| msg.contains(kw))
            || policy.cooldown_keywords.iter().any(|kw| msg.contains(kw))
            || policy.non_retryable_keywords.iter().any(|kw| msg.contains(kw))
        {
            return false;
        }

        let generic_auth = ["unauthorized", "unauthenticated"];
        if generic_auth.iter().any(|kw| msg.contains(kw))
            || policy.auth_failure_keywords.iter().any(|kw| msg.contains(kw))
        {
            return true;
        }

        auth_401_regex().is_match(&msg)
    }

    pub fn is_retryable_error(err: &str) -> bool {
        Self::is_retryable_error_for(ProviderErrorPolicy::default(), err)
    }

    pub fn is_retryable_error_for(policy: ProviderErrorPolicy, err: &str) -> bool {
        let msg = err.to_lowercase();
        if policy.non_retryable_keywords.iter().any(|kw| msg.contains(kw)) {
            return false;
        }
        let generic_retryable = [
            "unauthorized",
            "unauthenticated",
            "rate limit",
            "rate_limit",
            "too many requests",
            "too_many_requests",
        ];
        if generic_retryable.iter().any(|kw| msg.contains(kw))
            || policy.cooldown_keywords.iter().any(|kw| msg.contains(kw))
            || policy.auth_failure_keywords.iter().any(|kw| msg.contains(kw))
        {
            return true;
        }
        retryable_status_regex().is_match(&msg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_failure_classification_matches_python() {
        let ds_policy = crate::providers::ProviderErrorPolicy {
            cooldown_keywords: &["\"code\":40003", "invalid_token", "too frequent"],
            auth_failure_keywords: &["invalid token"],
            non_retryable_keywords: &[],
        };
        let gm_policy = crate::providers::ProviderErrorPolicy {
            cooldown_keywords: &["40300", "missing_header"],
            auth_failure_keywords: &["invalid cookie"],
            non_retryable_keywords: &["session is not authenticated"],
        };

        assert!(ProfileLoadBalancer::is_auth_failure("HTTP 401 Unauthorized"));
        assert!(ProfileLoadBalancer::is_auth_failure_for(gm_policy, "invalid cookie"));
        assert!(!ProfileLoadBalancer::is_auth_failure_for(
            ds_policy,
            r#"create_chat_session error: {"code":40003,"data":null,"msg":"INVALID_TOKEN"}"#
        ));
        assert!(ProfileLoadBalancer::is_retryable_error_for(
            ds_policy,
            r#"provider error: create_chat_session error: {"code":40003,"data":null,"msg":"INVALID_TOKEN"}"#
        ));
        assert!(!ProfileLoadBalancer::is_auth_failure("429 Too Many Requests"));
        assert!(!ProfileLoadBalancer::is_auth_failure_for(
            gm_policy,
            "Session is not authenticated"
        ));
        assert!(!ProfileLoadBalancer::is_retryable_error_for(
            gm_policy,
            "Session is not authenticated"
        ));
        assert!(!ProfileLoadBalancer::is_auth_failure_for(gm_policy, "40300 missing_header"));
        assert!(ProfileLoadBalancer::is_retryable_error_for(gm_policy, "40300 missing_header"));
    }

    fn open_temp_db(name: &str) -> Database {
        let mut path = std::env::temp_dir();
        path.push(format!("web2ai_lb_{name}_{}.db", uuid::Uuid::new_v4()));
        Database::open(&path).expect("open temp db")
    }

    fn add_deepseek_profile(db: &Database, name: &str, token: &str) -> Profile {
        db.create_profile(crate::db::CreateProfileInput {
            provider_type: "deepseek".to_string(),
            name: name.to_string(),
            token: Some(token.to_string()),
            cookie: None,
            is_active: Some(true),
        })
        .unwrap()
    }

    #[test]
    fn cooldown_skips_rate_limited_profile_when_healthy_exists() {
        let db = open_temp_db("cooldown");
        let p1 = add_deepseek_profile(&db, "p1", "tok1");
        let p2 = add_deepseek_profile(&db, "p2", "tok2");

        let lb = ProfileLoadBalancer::new();
        lb.handle_profile_failure(&db, &p1.id, None, false);

        for _ in 0..3 {
            let (chosen, _) = lb.select_profile(&db, "deepseek", None).unwrap();
            assert_eq!(chosen.id, p2.id);
        }
    }

    #[test]
    fn single_profile_falls_back_even_when_in_cooldown() {
        let db = open_temp_db("single");
        let p1 = add_deepseek_profile(&db, "only", "tok1");

        let lb = ProfileLoadBalancer::new();
        lb.handle_profile_failure(&db, &p1.id, None, false);

        let (chosen, _) = lb.select_profile(&db, "deepseek", None).unwrap();
        assert_eq!(chosen.id, p1.id);
    }

    #[test]
    fn select_profile_excluding_avoids_attempted_profiles() {
        let db = open_temp_db("exclude");
        let p1 = add_deepseek_profile(&db, "p1", "tok1");
        let p2 = add_deepseek_profile(&db, "p2", "tok2");

        let lb = ProfileLoadBalancer::new();
        let (chosen, _) = lb
            .select_profile_excluding(&db, "deepseek", None, &[p1.id.clone()])
            .unwrap();
        assert_eq!(chosen.id, p2.id);

        let err = lb
            .select_profile_excluding(&db, "deepseek", None, &[p1.id, p2.id])
            .unwrap_err();
        assert!(matches!(err, LoadBalancerError::NoActiveProfile(_)));
    }
}

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use chrono::Utc;
use diesel::connection::SimpleConnection;
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

type HmacSha256 = Hmac<Sha256>;

diesel::table! {
    sessions (session_id) {
        session_id -> Text,
        data -> Text,
        last_used -> Double,
        api_key_hash -> Nullable<Text>,
        created_at -> Double,
    }
}

diesel::table! {
    assistant_cache (hash_key) {
        hash_key -> Text,
        session_id -> Text,
        last_used -> Double,
    }
}

diesel::table! {
    profiles (id) {
        id -> Text,
        #[sql_name = "type"]
        provider_type -> Text,
        name -> Text,
        token -> Nullable<Text>,
        cookie -> Nullable<Text>,
        is_active -> Integer,
        total_requests -> Integer,
        request_counts -> Text,
        created_at -> Text,
        updated_at -> Text,
    }
}

diesel::table! {
    api_keys (key) {
        key -> Text,
        name -> Text,
        is_active -> Integer,
        created_at -> Text,
        last_used -> Text,
    }
}

diesel::table! {
    system_settings (key) {
        key -> Text,
        value -> Text,
    }
}

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlite connection error: {0}")]
    Connection(#[from] diesel::ConnectionError),
    #[error("sqlite query error: {0}")]
    Query(#[from] diesel::result::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("database lock poisoned")]
    Lock,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = profiles, check_for_backend(diesel::sqlite::Sqlite))]
struct ProfileRow {
    id: String,
    provider_type: String,
    name: String,
    token: Option<String>,
    cookie: Option<String>,
    is_active: i32,
    total_requests: i32,
    request_counts: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = profiles, check_for_backend(diesel::sqlite::Sqlite))]
struct NewProfileRow<'a> {
    id: &'a str,
    provider_type: &'a str,
    name: &'a str,
    token: Option<&'a str>,
    cookie: Option<&'a str>,
    is_active: i32,
    total_requests: i32,
    request_counts: &'a str,
    created_at: &'a str,
    updated_at: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub token: Option<String>,
    pub cookie: Option<String>,
    pub is_active: bool,
    pub total_requests: i32,
    pub request_counts: HashMap<String, HashMap<String, i64>>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ProfileRow> for Profile {
    fn from(row: ProfileRow) -> Self {
        let request_counts = serde_json::from_str(&row.request_counts).unwrap_or_default();
        Self {
            id: row.id,
            provider_type: row.provider_type,
            name: row.name,
            token: row.token,
            cookie: row.cookie,
            is_active: row.is_active != 0,
            total_requests: row.total_requests,
            request_counts,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProfileInput {
    #[serde(rename = "type")]
    pub provider_type: String,
    pub name: String,
    pub token: Option<String>,
    pub cookie: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProfileInput {
    pub name: Option<String>,
    pub token: Option<String>,
    pub cookie: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = api_keys, check_for_backend(diesel::sqlite::Sqlite))]
struct ApiKeyRow {
    key: String,
    name: String,
    is_active: i32,
    created_at: String,
    last_used: String,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = api_keys, check_for_backend(diesel::sqlite::Sqlite))]
struct NewApiKeyRow<'a> {
    key: &'a str,
    name: &'a str,
    is_active: i32,
    created_at: &'a str,
    last_used: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub key: String,
    pub name: String,
    pub is_active: bool,
    pub created_at: String,
    pub last_used: String,
}

impl From<ApiKeyRow> for ApiKey {
    fn from(row: ApiKeyRow) -> Self {
        Self {
            key: row.key,
            name: row.name,
            is_active: row.is_active != 0,
            created_at: row.created_at,
            last_used: row.last_used,
        }
    }
}

pub struct Database {
    conn: Mutex<SqliteConnection>,
}

impl Database {
    pub fn open(db_path: &Path) -> Result<Self, DbError> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let url = db_path.to_string_lossy().to_string();
        let mut conn = SqliteConnection::establish(&url)?;

        conn.batch_execute(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA busy_timeout = 5000;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                data TEXT NOT NULL DEFAULT '{}',
                last_used REAL NOT NULL,
                api_key_hash TEXT,
                created_at REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_last_used ON sessions(last_used);
            CREATE INDEX IF NOT EXISTS idx_sessions_api_key_hash ON sessions(api_key_hash);

            CREATE TABLE IF NOT EXISTS assistant_cache (
                hash_key TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                last_used REAL NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_assistant_cache_last_used ON assistant_cache(last_used);

            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                token TEXT,
                cookie TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                total_requests INTEGER NOT NULL DEFAULT 0,
                request_counts TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_profiles_type ON profiles(type);

            CREATE TABLE IF NOT EXISTS api_keys (
                key TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                last_used TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn list_profiles(&self) -> Result<Vec<Profile>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let rows = profiles::table
            .order(profiles::created_at.desc())
            .select(ProfileRow::as_select())
            .load(&mut *conn)?;
        Ok(rows.into_iter().map(Profile::from).collect())
    }

    pub fn list_profiles_by_type(&self, provider_type: &str) -> Result<Vec<Profile>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let rows = profiles::table
            .filter(profiles::provider_type.eq(provider_type))
            .order(profiles::created_at.desc())
            .select(ProfileRow::as_select())
            .load(&mut *conn)?;
        Ok(rows.into_iter().map(Profile::from).collect())
    }

    pub fn get_profile(&self, id: &str) -> Result<Option<Profile>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let row = profiles::table
            .find(id)
            .select(ProfileRow::as_select())
            .first(&mut *conn)
            .optional()?;
        Ok(row.map(Profile::from))
    }

    pub fn deactivate_profile(&self, id: &str) -> Result<(), DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = Utc::now().to_rfc3339();
        diesel::update(profiles::table.find(id))
            .set((profiles::is_active.eq(0), profiles::updated_at.eq(&now)))
            .execute(&mut *conn)?;
        Ok(())
    }

    pub fn record_profile_request(&self, id: &str) -> Result<(), DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let row = profiles::table
            .find(id)
            .select(ProfileRow::as_select())
            .first(&mut *conn)
            .optional()?;
        let Some(existing) = row else {
            return Ok(());
        };
        let mut counts: HashMap<String, HashMap<String, i64>> =
            serde_json::from_str(&existing.request_counts).unwrap_or_default();
        let now = Utc::now();
        let date_str = now.format("%Y-%m-%d").to_string();
        let hour_str = now.format("%H").to_string();
        let day_map = counts.entry(date_str).or_default();
        *day_map.entry(hour_str).or_insert(0) += 1;
        let counts_json = serde_json::to_string(&counts).unwrap_or_else(|_| "{}".to_string());
        let now_str = now.to_rfc3339();

        diesel::update(profiles::table.find(id))
            .set((
                profiles::total_requests.eq(existing.total_requests + 1),
                profiles::request_counts.eq(&counts_json),
                profiles::updated_at.eq(&now_str),
            ))
            .execute(&mut *conn)?;
        Ok(())
    }

    pub fn create_profile(&self, input: CreateProfileInput) -> Result<Profile, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = Utc::now().to_rfc3339();
        let id = uuid::Uuid::new_v4().to_string();
        let is_active = if input.is_active.unwrap_or(true) { 1 } else { 0 };

        let row = NewProfileRow {
            id: &id,
            provider_type: &input.provider_type,
            name: &input.name,
            token: input.token.as_deref(),
            cookie: input.cookie.as_deref(),
            is_active,
            total_requests: 0,
            request_counts: "{}",
            created_at: &now,
            updated_at: &now,
        };

        diesel::insert_into(profiles::table)
            .values(&row)
            .execute(&mut *conn)?;

        let inserted = profiles::table
            .find(&id)
            .select(ProfileRow::as_select())
            .first(&mut *conn)?;
        Ok(Profile::from(inserted))
    }

    pub fn update_profile(&self, id: &str, input: UpdateProfileInput) -> Result<Profile, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let existing = profiles::table
            .find(id)
            .select(ProfileRow::as_select())
            .first(&mut *conn)?;

        let now = Utc::now().to_rfc3339();
        let name = input.name.unwrap_or(existing.name);
        let token = input.token.or(existing.token);
        let cookie = input.cookie.or(existing.cookie);
        let is_active = input
            .is_active
            .map(|v| if v { 1 } else { 0 })
            .unwrap_or(existing.is_active);

        diesel::update(profiles::table.find(id))
            .set((
                profiles::name.eq(&name),
                profiles::token.eq(&token),
                profiles::cookie.eq(&cookie),
                profiles::is_active.eq(is_active),
                profiles::updated_at.eq(&now),
            ))
            .execute(&mut *conn)?;

        let updated = profiles::table
            .find(id)
            .select(ProfileRow::as_select())
            .first(&mut *conn)?;
        Ok(Profile::from(updated))
    }

    pub fn delete_profile(&self, id: &str) -> Result<usize, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        Ok(diesel::delete(profiles::table.find(id)).execute(&mut *conn)?)
    }

    pub fn list_api_keys(&self) -> Result<Vec<ApiKey>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let rows = api_keys::table
            .order(api_keys::created_at.desc())
            .select(ApiKeyRow::as_select())
            .load(&mut *conn)?;
        Ok(rows.into_iter().map(ApiKey::from).collect())
    }

    pub fn create_api_key(&self, name: &str) -> Result<ApiKey, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let machine_id = Self::get_or_create_machine_id_locked(&mut conn)?;
        let key_id = &uuid::Uuid::new_v4().simple().to_string()[..6];
        let mid_prefix = &machine_id[..machine_id.len().min(8)];
        let crc = Self::compute_key_crc(mid_prefix, key_id);
        let key = format!("sk-{mid_prefix}-{key_id}-{crc}");

        let resolved_name = if name.trim().is_empty() {
            let count: i64 = api_keys::table.count().get_result(&mut *conn)?;
            format!("Key {}", count + 1)
        } else {
            name.trim().to_string()
        };

        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let row = NewApiKeyRow {
            key: &key,
            name: &resolved_name,
            is_active: 1,
            created_at: &now,
            last_used: "",
        };

        diesel::replace_into(api_keys::table)
            .values(&row)
            .execute(&mut *conn)?;

        let inserted = api_keys::table
            .find(&key)
            .select(ApiKeyRow::as_select())
            .first(&mut *conn)?;
        Ok(ApiKey::from(inserted))
    }

    pub fn validate_api_key(&self, key: &str) -> Result<bool, DbError> {
        let parts: Vec<&str> = key.split('-').collect();
        if parts.len() < 2 || parts[0] != "sk" {
            return Ok(false);
        }

        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let row = api_keys::table
            .find(key)
            .select(ApiKeyRow::as_select())
            .first(&mut *conn)
            .optional()?;
        let Some(row) = row else {
            return Ok(false);
        };
        if row.is_active == 0 {
            return Ok(false);
        }

        if parts.len() == 4 {
            let machine_id = Self::get_or_create_machine_id_locked(&mut conn)?;
            let mid_prefix = &machine_id[..machine_id.len().min(8)];
            let expected_crc = Self::compute_key_crc(mid_prefix, parts[2]);
            if parts[3] != expected_crc {
                return Ok(false);
            }
        }

        let now = Utc::now().format("%Y-%m-%dT%H:%M:%S").to_string();
        let _ = diesel::update(api_keys::table.find(key))
            .set(api_keys::last_used.eq(&now))
            .execute(&mut *conn);
        Ok(true)
    }

    pub fn revoke_api_key(&self, key: &str) -> Result<bool, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let affected = diesel::update(api_keys::table.find(key))
            .set(api_keys::is_active.eq(0))
            .execute(&mut *conn)?;
        Ok(affected > 0)
    }

    pub fn delete_api_key(&self, key: &str) -> Result<usize, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        Ok(diesel::delete(api_keys::table.find(key)).execute(&mut *conn)?)
    }

    pub fn get_api_key_hash(api_key: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(api_key.as_bytes());
        let res = hex::encode(hasher.finalize());
        res[..16].to_string()
    }

    fn compute_key_crc(mid_prefix: &str, key_id: &str) -> String {
        let secret = std::env::var("API_KEY_SECRET")
            .unwrap_or_else(|_| "unofficial-api-key-secret".to_string());
        let mut mac =
            HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
        mac.update(format!("{mid_prefix}{key_id}").as_bytes());
        let result = hex::encode(mac.finalize().into_bytes());
        result[..8].to_string()
    }

    fn get_or_create_machine_id_locked(conn: &mut SqliteConnection) -> Result<String, DbError> {
        if let Some(existing) = system_settings::table
            .find("machine_id")
            .select(system_settings::value)
            .first::<String>(conn)
            .optional()?
        {
            if !existing.is_empty() {
                return Ok(existing);
            }
        }

        let mut hasher = Sha256::new();
        hasher.update(uuid::Uuid::new_v4().as_bytes());
        hasher.update(Utc::now().timestamp_nanos_opt().unwrap_or(0).to_le_bytes());
        let machine_id = hex::encode(hasher.finalize())[..16].to_string();
        diesel::replace_into(system_settings::table)
            .values((
                system_settings::key.eq("machine_id"),
                system_settings::value.eq(&machine_id),
            ))
            .execute(conn)?;
        Ok(machine_id)
    }

    pub fn get_session_data(
        &self,
        session_id: &str,
    ) -> Result<Option<serde_json::Map<String, serde_json::Value>>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let raw = sessions::table
            .find(session_id)
            .select(sessions::data)
            .first::<String>(&mut *conn)
            .optional()?;
        Ok(raw.and_then(|s| serde_json::from_str(&s).ok()))
    }

    pub fn save_session_data(
        &self,
        session_id: &str,
        data: &serde_json::Map<String, serde_json::Value>,
        api_key_hash: Option<&str>,
    ) -> Result<(), DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = Utc::now().timestamp_millis() as f64 / 1000.0;
        let data_str = serde_json::to_string(data).unwrap_or_else(|_| "{}".to_string());
        let existing_created = sessions::table
            .find(session_id)
            .select(sessions::created_at)
            .first::<f64>(&mut *conn)
            .optional()?;
        let created_at = existing_created.unwrap_or(now);

        diesel::replace_into(sessions::table)
            .values((
                sessions::session_id.eq(session_id),
                sessions::data.eq(&data_str),
                sessions::last_used.eq(now),
                sessions::api_key_hash.eq(api_key_hash),
                sessions::created_at.eq(created_at),
            ))
            .execute(&mut *conn)?;
        Ok(())
    }

    pub fn cleanup_expired_sessions(&self, ttl_days: i64) -> Result<usize, DbError> {
        if ttl_days <= 0 {
            return Ok(0);
        }
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let cutoff = (Utc::now().timestamp_millis() as f64 / 1000.0) - (ttl_days as f64 * 86400.0);
        let deleted = diesel::delete(sessions::table.filter(sessions::last_used.lt(cutoff)))
            .execute(&mut *conn)?;
        Ok(deleted)
    }

    pub fn lookup_assistant_hash(&self, hash_key: &str) -> Result<Option<String>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let sid = assistant_cache::table
            .find(hash_key)
            .select(assistant_cache::session_id)
            .first::<String>(&mut *conn)
            .optional()?;
        Ok(sid)
    }

    pub fn save_assistant_hash(&self, hash_key: &str, session_id: &str) -> Result<(), DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let now = Utc::now().timestamp_millis() as f64 / 1000.0;
        diesel::replace_into(assistant_cache::table)
            .values((
                assistant_cache::hash_key.eq(hash_key),
                assistant_cache::session_id.eq(session_id),
                assistant_cache::last_used.eq(now),
            ))
            .execute(&mut *conn)?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        let val = system_settings::table
            .find(key)
            .select(system_settings::value)
            .first::<String>(&mut *conn)
            .optional()?;
        Ok(val)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        let mut conn = self.conn.lock().map_err(|_| DbError::Lock)?;
        diesel::replace_into(system_settings::table)
            .values((
                system_settings::key.eq(key),
                system_settings::value.eq(value),
            ))
            .execute(&mut *conn)?;
        Ok(())
    }
}

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::watch;
use web2ai_desktop_lib::db::Database;
use web2ai_desktop_lib::load_balancer::ProfileLoadBalancer;
use web2ai_desktop_lib::providers::ProviderRegistry;
use web2ai_desktop_lib::server::{run_http_server, AppState};
use web2ai_desktop_lib::session::VirtualSessionManager;

fn default_data_dir() -> PathBuf {
    if let Ok(custom) = std::env::var("WEB2AI_DATA_DIR")
        .or_else(|_| std::env::var("UNOFFICIAL_API_DATA_DIR"))
    {
        return PathBuf::from(custom);
    }

    #[cfg(target_os = "macos")]
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("com.web2ai.desktop");
    }

    #[cfg(target_os = "windows")]
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("com.web2ai.desktop");
    }

    if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
        return PathBuf::from(xdg).join("com.web2ai.desktop");
    }
    if let Ok(home) = std::env::var("HOME") {
        return PathBuf::from(home)
            .join(".local")
            .join("share")
            .join("com.web2ai.desktop");
    }

    PathBuf::from(".")
}

#[tokio::main]
async fn main() {
    let db_path = default_data_dir().join("web2ai.db");

    let db = Arc::new(Database::open(&db_path).expect("failed to open SQLite database"));
    let state = AppState {
        db,
        registry: Arc::new(ProviderRegistry::with_defaults().expect("failed to init providers")),
        load_balancer: Arc::new(ProfileLoadBalancer::new()),
        session_manager: Arc::new(VirtualSessionManager::new()),
        app_handle: None,
    };

    let addr: SocketAddr = "127.0.0.1:8088".parse().unwrap();
    let (_tx, rx) = watch::channel(false);
    println!("Rust API server listening on http://{addr}");
    run_http_server(addr, state, rx)
        .await
        .expect("server failed");
}

pub mod chat_service;
pub mod db;
pub mod http_client;
pub mod load_balancer;
pub mod openai;
pub mod providers;
pub mod server;
pub mod session;

use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use db::{ApiKey, CreateProfileInput, Database, Profile, UpdateProfileInput};
use load_balancer::ProfileLoadBalancer;
use openai::{ChatCompletionRequest, ChatCompletionResponse, ModelList};
use providers::{ProviderCredentials, ProviderRegistry};
use serde::Serialize;
use serde_json::Map;
use tauri::Emitter;
use server::{run_http_server, AppState};
use session::VirtualSessionManager;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent,
};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::watch;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8088;
const BACKEND_URL: &str = "http://127.0.0.1:8088";

struct ServerManager {
    shutdown_tx: Mutex<Option<watch::Sender<bool>>>,
    app_state: AppState,
    data_dir: PathBuf,
}

#[derive(Serialize)]
struct BackendStatus {
    running: bool,
    managed: bool,
    url: String,
    project_dir: Option<String>,
}

fn is_backend_reachable() -> bool {
    let addr: SocketAddr = format!("{BACKEND_HOST}:{BACKEND_PORT}")
        .parse()
        .expect("valid socket addr");
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn resolve_db_path(app: &tauri::App) -> PathBuf {
    let data_dir = std::env::var("WEB2AI_DATA_DIR")
        .or_else(|_| std::env::var("UNOFFICIAL_API_DATA_DIR"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            app.path()
                .app_data_dir()
                .expect("failed to resolve app data dir")
        });

    let target_db = data_dir.join("web2ai.db");
    if !target_db.is_file() {
        let legacy_db = data_dir.join("unofficial_api.db");
        if legacy_db.is_file() {
            let _ = std::fs::create_dir_all(&data_dir);
            let _ = std::fs::copy(&legacy_db, &target_db);
        }
    }

    target_db
}

fn start_embedded_server(manager: &ServerManager) {
    let mut guard = manager.shutdown_tx.lock().unwrap_or_else(|e| e.into_inner());
    if guard.is_some() {
        return;
    }

    let (tx, rx) = watch::channel(false);
    *guard = Some(tx);

    let addr: SocketAddr = format!("{BACKEND_HOST}:{BACKEND_PORT}")
        .parse()
        .expect("valid socket addr");
    let state = manager.app_state.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(err) = run_http_server(addr, state, rx).await {
            eprintln!("[web2ai] Embedded Rust HTTP server error: {err}");
        }
    });
}

fn stop_embedded_server(manager: &ServerManager) {
    let mut guard = manager.shutdown_tx.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(tx) = guard.take() {
        let _ = tx.send(true);
    }
}

#[tauri::command]
fn get_backend_status(manager: tauri::State<'_, ServerManager>) -> BackendStatus {
    let managed = manager
        .shutdown_tx
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false);

    BackendStatus {
        running: is_backend_reachable(),
        managed,
        url: BACKEND_URL.to_string(),
        project_dir: Some(manager.data_dir.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn restart_backend(manager: tauri::State<'_, ServerManager>) -> Result<BackendStatus, String> {
    stop_embedded_server(&manager);
    std::thread::sleep(Duration::from_millis(150));
    start_embedded_server(&manager);
    Ok(get_backend_status(manager))
}

#[tauri::command]
fn list_provider_models(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    provider_id: Option<String>,
) -> ModelList {
    registry.list_models(provider_id.as_deref())
}

#[tauri::command]
async fn provider_chat_completions(
    registry: tauri::State<'_, Arc<ProviderRegistry>>,
    provider_id: String,
    credentials: ProviderCredentials,
    request: ChatCompletionRequest,
) -> Result<ChatCompletionResponse, String> {
    let provider = registry
        .get(&provider_id)
        .ok_or_else(|| format!("unknown provider `{provider_id}`"))?;
    let mut session_data = Map::new();
    provider
        .chat_completions(&credentials, &request, &mut session_data, &[])
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_profiles(db: tauri::State<'_, Arc<Database>>) -> Result<Vec<Profile>, String> {
    db.list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_create_profile(
    db: tauri::State<'_, Arc<Database>>,
    input: CreateProfileInput,
) -> Result<Profile, String> {
    db.create_profile(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_profile(
    db: tauri::State<'_, Arc<Database>>,
    id: String,
    input: UpdateProfileInput,
) -> Result<Profile, String> {
    db.update_profile(&id, input).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_profile(db: tauri::State<'_, Arc<Database>>, id: String) -> Result<usize, String> {
    db.delete_profile(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_api_keys(db: tauri::State<'_, Arc<Database>>) -> Result<Vec<ApiKey>, String> {
    db.list_api_keys().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_create_api_key(db: tauri::State<'_, Arc<Database>>, name: String) -> Result<ApiKey, String> {
    db.create_api_key(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_api_key(db: tauri::State<'_, Arc<Database>>, key: String) -> Result<usize, String> {
    db.delete_api_key(&key).map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_pet_window(app: tauri::AppHandle) -> bool {
    if let Some(win) = app.get_webview_window("pet") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
            return false;
        }
        let _ = win.show();
        let _ = win.set_focus();
        return true;
    }
    false
}

#[tauri::command]
fn open_main_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn summon_pet_window(app: tauri::AppHandle) -> bool {
    let Some(pet) = app.get_webview_window("pet") else {
        return false;
    };
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(size), Ok(pet_size)) = (
            main.outer_position(),
            main.outer_size(),
            pet.outer_size(),
        ) {
            let target_x = pos.x + size.width as i32 - pet_size.width as i32 - 24;
            let target_y = pos.y + size.height as i32 - pet_size.height as i32 - 24;
            let _ = pet.set_position(tauri::PhysicalPosition::new(
                target_x.max(0),
                target_y.max(0),
            ));
        }
    }
    let _ = pet.show();
    let _ = pet.set_focus();
    let _ = app.emit("pet:status", serde_json::json!({ "status": "done" }));
    true
}

#[cfg(target_os = "macos")]
fn set_macos_dock_icon() {
    use objc2::AnyThread;
    use objc2_app_kit::{NSApplication, NSImage};
    use objc2_foundation::{MainThreadMarker, NSData};

    if let Some(mtm) = MainThreadMarker::new() {
        let icon_bytes = include_bytes!("../icons/128x128@2x.png");
        let data = NSData::with_bytes(icon_bytes);
        if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
            let ns_app = NSApplication::sharedApplication(mtm);
            unsafe {
                ns_app.setApplicationIconImage(Some(&image));
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let provider_registry = Arc::new(
        ProviderRegistry::with_defaults().expect("failed to initialize Rust provider registry"),
    );

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(provider_registry.clone())
        .setup(move |app| {
            let db_path = resolve_db_path(app);
            let data_dir = db_path
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| PathBuf::from("."));

            let database =
                Arc::new(Database::open(&db_path).expect("failed to initialize SQLite database"));
            let load_balancer = Arc::new(ProfileLoadBalancer::new());
            let session_manager = Arc::new(VirtualSessionManager::new());

            let app_state = AppState {
                db: database.clone(),
                registry: provider_registry.clone(),
                load_balancer,
                session_manager,
                app_handle: Some(app.handle().clone()),
            };

            let server_manager = ServerManager {
                shutdown_tx: Mutex::new(None),
                app_state,
                data_dir,
            };

            start_embedded_server(&server_manager);

            app.manage(database);
            app.manage(server_manager);

            #[tauri::command]
fn toggle_pet_window(app: tauri::AppHandle) -> bool {
    if let Some(win) = app.get_webview_window("pet") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            let _ = win.hide();
            return false;
        }
        let _ = win.show();
        let _ = win.set_focus();
        return true;
    }
    false
}

#[tauri::command]
fn open_main_window(app: tauri::AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn summon_pet_window(app: tauri::AppHandle) -> bool {
    let Some(pet) = app.get_webview_window("pet") else {
        return false;
    };
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(size), Ok(pet_size)) = (
            main.outer_position(),
            main.outer_size(),
            pet.outer_size(),
        ) {
            let target_x = pos.x + size.width as i32 - pet_size.width as i32 - 24;
            let target_y = pos.y + size.height as i32 - pet_size.height as i32 - 24;
            let _ = pet.set_position(tauri::PhysicalPosition::new(
                target_x.max(0),
                target_y.max(0),
            ));
        }
    }
    let _ = pet.show();
    let _ = pet.set_focus();
    let _ = app.emit("pet:status", serde_json::json!({ "status": "done" }));
    true
}

#[cfg(target_os = "macos")]
            set_macos_dock_icon();

            let show_item =
                MenuItem::with_id(app, "show", "Open Web2AI API", true, None::<&str>)?;
            let pet_item =
                MenuItem::with_id(app, "toggle_pet", "Show/Hide Pet", true, None::<&str>)?;
            let docs_item =
                MenuItem::with_id(app, "docs", "Open API Docs", true, None::<&str>)?;
            let restart_item =
                MenuItem::with_id(app, "restart", "Restart Backend", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&show_item, &pet_item, &docs_item, &restart_item, &quit_item],
            )?;

            let mut tray_builder = TrayIconBuilder::new().menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        open_main_window(app.clone());
                    }
                    "toggle_pet" => {
                        toggle_pet_window(app.clone());
                    }
                    "docs" => {
                        let _ = app
                            .opener()
                            .open_url(format!("{BACKEND_URL}/docs"), None::<&str>);
                    }
                    "restart" => {
                        let manager = app.state::<ServerManager>();
                        stop_embedded_server(&manager);
                        std::thread::sleep(Duration::from_millis(150));
                        start_embedded_server(&manager);
                    }
                    "quit" => {
                        let manager = app.state::<ServerManager>();
                        stop_embedded_server(&manager);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            restart_backend,
            list_provider_models,
            provider_chat_completions,
            db_list_profiles,
            db_create_profile,
            db_update_profile,
            db_delete_profile,
            db_list_api_keys,
            db_create_api_key,
            db_delete_api_key,
            toggle_pet_window,
            open_main_window,
            summon_pet_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building Web2AI API desktop application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let manager = app_handle.state::<ServerManager>();
            stop_embedded_server(&manager);
        }
    });
}

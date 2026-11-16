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
    std::thread::sleep(Duration::from_millis(150));
    Ok(get_backend_status(manager))
}

#[tauri::command]
fn start_backend(manager: tauri::State<'_, ServerManager>) -> Result<BackendStatus, String> {
    start_embedded_server(&manager);
    std::thread::sleep(Duration::from_millis(150));
    Ok(get_backend_status(manager))
}

#[tauri::command]
fn stop_backend(manager: tauri::State<'_, ServerManager>) -> Result<BackendStatus, String> {
    stop_embedded_server(&manager);
    std::thread::sleep(Duration::from_millis(150));
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
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("main_window_visibility", true);
    }
}

#[tauri::command]
fn toggle_main_window(app: tauri::AppHandle) -> bool {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        let minimized = win.is_minimized().unwrap_or(false);
        if visible && !minimized {
            let _ = win.hide();
            let _ = app.emit("main_window_visibility", false);
            undock_pet_if_needed(&app);
            return false;
        }
        if minimized {
            let _ = win.unminimize();
        }
        let _ = win.show();
        let _ = win.set_focus();
        let _ = app.emit("main_window_visibility", true);
        return true;
    }
    false
}

#[tauri::command]
fn is_main_window_visible(app: tauri::AppHandle) -> bool {
    if let Some(win) = app.get_webview_window("main") {
        let visible = win.is_visible().unwrap_or(false);
        let minimized = win.is_minimized().unwrap_or(false);
        visible && !minimized
    } else {
        false
    }
}

#[tauri::command]
fn enter_pet_only_mode(app: tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
        let _ = app.emit("main_window_visibility", false);
        undock_pet_if_needed(&app);
    }
    if let Some(pet) = app.get_webview_window("pet") {
        let _ = pet.show();
        let _ = pet.set_focus();
    }
}

static SUMMON_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static SAVE_STATE_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
static PET_HOME_RECT: Mutex<Option<(f64, f64, f64, f64)>> = Mutex::new(None);
static PET_DOCKED_STATE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static IS_SUMMONING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static IS_ADJUSTING_PET: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[cfg(target_os = "macos")]
fn attach_pet_to_main(app: &tauri::AppHandle) {
    if let (Some(main), Some(pet)) = (app.get_webview_window("main"), app.get_webview_window("pet")) {
        if let (Ok(main_ptr), Ok(pet_ptr)) = (main.ns_window(), pet.ns_window()) {
            unsafe {
                let main_ns = main_ptr as *mut objc2::runtime::AnyObject;
                let pet_ns = pet_ptr as *mut objc2::runtime::AnyObject;
                let _: () = objc2::msg_send![main_ns, addChildWindow: pet_ns, ordered: 1isize];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn attach_pet_to_main(_app: &tauri::AppHandle) {}

#[cfg(target_os = "macos")]
fn detach_pet_from_main(app: &tauri::AppHandle) {
    if let (Some(main), Some(pet)) = (app.get_webview_window("main"), app.get_webview_window("pet")) {
        if let (Ok(main_ptr), Ok(pet_ptr)) = (main.ns_window(), pet.ns_window()) {
            unsafe {
                let main_ns = main_ptr as *mut objc2::runtime::AnyObject;
                let pet_ns = pet_ptr as *mut objc2::runtime::AnyObject;
                let _: () = objc2::msg_send![main_ns, removeChildWindow: pet_ns];
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn detach_pet_from_main(_app: &tauri::AppHandle) {}

fn sync_docked_pet_position(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    if !PET_DOCKED_STATE.load(Ordering::SeqCst) || IS_SUMMONING.load(Ordering::SeqCst) {
        return;
    }
    let Some((ox, oy, _, _)) = PET_HOME_RECT.lock().ok().and_then(|g| *g) else {
        return;
    };
    let (Some(main), Some(pet)) = (app.get_webview_window("main"), app.get_webview_window("pet")) else {
        return;
    };
    if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(false) {
        return;
    }
    let main_scale = main.scale_factor().unwrap_or(1.0);
    let pet_scale = pet.scale_factor().unwrap_or(1.0);
    let (Ok(mp_p), Ok(ps_p)) = (main.outer_position(), pet.outer_size()) else {
        return;
    };
    let main_pos = mp_p.to_logical::<f64>(main_scale);
    let pet_size = ps_p.to_logical::<f64>(pet_scale);
    let target_x = main_pos.x + ox - pet_size.width / 2.0;
    let target_y = main_pos.y + oy - 44.0;
    IS_ADJUSTING_PET.store(true, Ordering::SeqCst);
    let _ = pet.set_position(tauri::LogicalPosition::new(target_x, target_y));
    attach_pet_to_main(app);
    IS_ADJUSTING_PET.store(false, Ordering::SeqCst);
}

fn save_pet_window_state(app: &tauri::AppHandle, docked: bool) {
    use std::sync::atomic::Ordering;
    let Some(pet) = app.get_webview_window("pet") else {
        return;
    };
    let scale = pet.scale_factor().unwrap_or(1.0);
    let coords = pet
        .outer_position()
        .ok()
        .map(|p| p.to_logical::<f64>(scale))
        .map(|pos| (pos.x, pos.y));

    let seq = SAVE_STATE_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(350));
        if SAVE_STATE_SEQ.load(Ordering::SeqCst) != seq {
            return;
        }
        let Some(manager) = app_clone.try_state::<ServerManager>() else {
            return;
        };
        let _ = manager
            .app_state
            .db
            .set_setting("pet_docked", if docked { "true" } else { "false" });
        if let Some((x, y)) = coords {
            let _ = manager
                .app_state
                .db
                .set_setting("pet_pos_x", &format!("{:.1}", x));
            let _ = manager
                .app_state
                .db
                .set_setting("pet_pos_y", &format!("{:.1}", y));
        }
    });
}

fn undock_pet_if_needed(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    if PET_DOCKED_STATE.swap(false, Ordering::SeqCst) {
        detach_pet_from_main(app);
        if let Some(pet) = app.get_webview_window("pet") {
            let _ = pet.set_size(tauri::LogicalSize::new(280.0, 200.0));
        }
        save_pet_window_state(app, false);
        let _ = app.emit("pet:docked", false);
    }
}

#[tauri::command]
fn set_pet_home_offset(
    app: tauri::AppHandle,
    offset_x: f64,
    offset_y: f64,
    width: Option<f64>,
    height: Option<f64>,
) {
    if let Ok(mut guard) = PET_HOME_RECT.lock() {
        let prev_w = guard.map(|g| g.2).unwrap_or(196.0);
        let prev_h = guard.map(|g| g.3).unwrap_or(96.0);
        *guard = Some((offset_x, offset_y, width.unwrap_or(prev_w), height.unwrap_or(prev_h)));
    }
    sync_docked_pet_position(&app);
}

#[tauri::command]
fn read_clipboard_context() -> String {
    #[cfg(target_os = "macos")]
    let output = std::process::Command::new("pbpaste").output();
    #[cfg(target_os = "linux")]
    let output = std::process::Command::new("xclip")
        .args(["-o", "-selection", "clipboard"])
        .output();
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-Clipboard"])
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if text.chars().count() > 12000 {
                text.chars().take(12000).collect()
            } else {
                text
            }
        }
        _ => String::new(),
    }
}

#[tauri::command]
async fn capture_screen_snip() -> Option<String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            use base64::Engine;
            let path = std::env::temp_dir().join(format!("web2ai_snip_{}.png", uuid::Uuid::new_v4()));
            let status = std::process::Command::new("screencapture")
                .args(["-i", "-x"])
                .arg(&path)
                .status()
                .ok()?;
            if !status.success() || !path.exists() {
                let _ = std::fs::remove_file(&path);
                return None;
            }
            let bytes = std::fs::read(&path).ok()?;
            let _ = std::fs::remove_file(&path);
            if bytes.is_empty() {
                return None;
            }
            let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
            Some(format!("data:image/png;base64,{b64}"))
        }
        #[cfg(not(target_os = "macos"))]
        {
            None
        }
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
fn summon_pet_window(
    app: tauri::AppHandle,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> bool {
    use std::sync::atomic::Ordering;

    let Some(pet) = app.get_webview_window("pet") else {
        return false;
    };

    let docked_to_home = offset_x.is_some() && offset_y.is_some();
    if let (Some(ox), Some(oy)) = (offset_x, offset_y) {
        if let Ok(mut guard) = PET_HOME_RECT.lock() {
            let prev_w = guard.map(|g| g.2).unwrap_or(196.0);
            let prev_h = guard.map(|g| g.3).unwrap_or(96.0);
            *guard = Some((ox, oy, prev_w, prev_h));
        }
    }
    PET_DOCKED_STATE.store(docked_to_home, Ordering::SeqCst);
    IS_SUMMONING.store(true, Ordering::SeqCst);
    detach_pet_from_main(&app);
    let _ = app.emit("pet:docked", docked_to_home);
    if docked_to_home {
        let _ = pet.set_size(tauri::LogicalSize::new(116.0, 104.0));
    }

    let mut target_pos: Option<(f64, f64)> = None;
    if let Some(main) = app.get_webview_window("main") {
        let main_scale = main.scale_factor().unwrap_or(1.0);
        let pet_scale = pet.scale_factor().unwrap_or(1.0);

        if let (Ok(pos_p), Ok(size_p), Ok(pet_size_p)) = (
            main.outer_position(),
            main.outer_size(),
            pet.outer_size(),
        ) {
            let pos = pos_p.to_logical::<f64>(main_scale);
            let size = size_p.to_logical::<f64>(main_scale);
            let pet_size = if docked_to_home {
                tauri::LogicalSize::new(116.0, 104.0)
            } else {
                pet_size_p.to_logical::<f64>(pet_scale)
            };

            let (mon_x, mon_y, mon_w, mon_h) = main
                .current_monitor()
                .ok()
                .flatten()
                .map(|m| {
                    let ms = m.scale_factor();
                    let mp = m.position().to_logical::<f64>(ms);
                    let msz = m.size().to_logical::<f64>(ms);
                    (mp.x, mp.y, msz.width, msz.height)
                })
                .unwrap_or((pos.x - 2000.0, pos.y - 2000.0, 10000.0, 10000.0));

            let mon_right = mon_x + mon_w;
            let mon_bottom = mon_y + mon_h;

            let (tx, ty) = if let (Some(ox), Some(oy)) = (offset_x, offset_y) {
                // Align the pet sprite (centered horizontally, ~44px from top) onto (ox, oy)
                let raw_x = pos.x + ox - pet_size.width / 2.0;
                let raw_y = pos.y + oy - 44.0;
                (
                    raw_x.clamp(mon_x, (mon_right - pet_size.width).max(mon_x)),
                    raw_y.clamp(mon_y, (mon_bottom - pet_size.height).max(mon_y)),
                )
            } else {
                // Place right beside the main app window; fallback to left side, then bottom-right inside.
                let right_x = pos.x + size.width + 12.0;
                let left_x = pos.x - pet_size.width - 12.0;
                let x = if right_x + pet_size.width <= mon_right {
                    right_x
                } else if left_x >= mon_x {
                    left_x
                } else {
                    (pos.x + size.width - pet_size.width - 24.0)
                        .clamp(mon_x, (mon_right - pet_size.width).max(mon_x))
                };
                let y = (pos.y + size.height - pet_size.height - 24.0)
                    .clamp(mon_y, (mon_bottom - pet_size.height).max(mon_y));
                (x, y)
            };

            target_pos = Some((tx, ty));
        }
    }

    let _ = pet.show();
    let _ = pet.set_focus();
    let _ = app.emit("pet:status", serde_json::json!({ "status": "happy" }));

    if let Some((tx, ty)) = target_pos {
        let pet_scale = pet.scale_factor().unwrap_or(1.0);
        let start = pet
            .outer_position()
            .ok()
            .map(|p| p.to_logical::<f64>(pet_scale));
        let seq = SUMMON_SEQ.fetch_add(1, Ordering::SeqCst) + 1;

        if let Some(sp) = start {
            let sx = sp.x;
            let sy = sp.y;
            if (sx - tx).abs() > 4.0 || (sy - ty).abs() > 4.0 {
                let app_clone = app.clone();
                std::thread::spawn(move || {
                    let steps = 18;
                    for i in 1..=steps {
                        if SUMMON_SEQ.load(Ordering::SeqCst) != seq {
                            return;
                        }
                        let t = i as f64 / steps as f64;
                        let ease = 1.0 - (1.0 - t).powi(3);
                        let nx = sx + (tx - sx) * ease;
                        let ny = sy + (ty - sy) * ease;
                        let pet_move = pet.clone();
                        let _ = app_clone.run_on_main_thread(move || {
                            let _ = pet_move.set_position(tauri::LogicalPosition::new(nx, ny));
                        });
                        std::thread::sleep(Duration::from_millis(14));
                    }
                    if SUMMON_SEQ.load(Ordering::SeqCst) == seq {
                        let pet_final = pet.clone();
                        let app_done = app_clone.clone();
                        let _ = app_clone.run_on_main_thread(move || {
                            let _ = pet_final.set_position(tauri::LogicalPosition::new(tx, ty));
                            if docked_to_home {
                                attach_pet_to_main(&app_done);
                            }
                            let _ = pet_final.set_focus();
                            IS_SUMMONING.store(false, Ordering::SeqCst);
                            save_pet_window_state(&app_done, docked_to_home);
                            let _ = app_done.emit("pet:status", serde_json::json!({ "status": "done" }));
                        });
                    }
                });
                return true;
            }
        }
        let _ = pet.set_position(tauri::LogicalPosition::new(tx, ty));
        if docked_to_home {
            attach_pet_to_main(&app);
        }
    }

    IS_SUMMONING.store(false, Ordering::SeqCst);
    save_pet_window_state(&app, docked_to_home);
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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

            // Restore persisted pet settings & window state from SQLite
            if let Ok(Some(react_val)) = database.get_setting("pet_react_traffic") {
                server::set_pet_react_to_traffic(react_val != "false");
            }
            let saved_docked = database
                .get_setting("pet_docked")
                .ok()
                .flatten()
                .as_deref()
                == Some("true");
            let saved_x = database
                .get_setting("pet_pos_x")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<f64>().ok());
            let saved_y = database
                .get_setting("pet_pos_y")
                .ok()
                .flatten()
                .and_then(|s| s.parse::<f64>().ok());

            app.manage(database);
            app.manage(server_manager);

            if let Some(pet) = app.get_webview_window("pet") {
                IS_ADJUSTING_PET.store(true, std::sync::atomic::Ordering::SeqCst);
                if saved_docked {
                    PET_DOCKED_STATE.store(true, std::sync::atomic::Ordering::SeqCst);
                    let _ = pet.set_size(tauri::LogicalSize::new(116.0, 104.0));
                }
                if let (Some(px), Some(py)) = (saved_x, saved_y) {
                    let _ = pet.set_position(tauri::LogicalPosition::new(px, py));
                }
                IS_ADJUSTING_PET.store(false, std::sync::atomic::Ordering::SeqCst);
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

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                let quick_chat_sc = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);
                let summon_pet_sc = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyP);
                let _ = app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }
                            if shortcut == &quick_chat_sc {
                                if let Some(pet) = app.get_webview_window("pet") {
                                    let _ = pet.show();
                                    let _ = pet.set_focus();
                                }
                                let _ = app.emit("pet:toggle-quick-bar", true);
                            } else if shortcut == &summon_pet_sc {
                                let _ = summon_pet_window(app.clone(), None, None);
                            }
                        })
                        .build(),
                );
                let _ = app.global_shortcut().register(quick_chat_sc);
                let _ = app.global_shortcut().register(summon_pet_sc);
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window.hide();
                        let _ = window.app_handle().emit("main_window_visibility", false);
                        undock_pet_if_needed(window.app_handle());
                        if let Some(pet) = window.app_handle().get_webview_window("pet") {
                            let _ = pet.show();
                        }
                    }
                    #[cfg(not(target_os = "macos"))]
                    tauri::WindowEvent::Moved(_) => {
                        sync_docked_pet_position(window.app_handle());
                    }
                    tauri::WindowEvent::Resized(_) => {
                        sync_docked_pet_position(window.app_handle());
                    }
                    _ => {}
                }
            } else if window.label() == "pet" {
                if let tauri::WindowEvent::Moved(_) = event {
                    use std::sync::atomic::Ordering;
                    if IS_SUMMONING.load(Ordering::SeqCst) || IS_ADJUSTING_PET.load(Ordering::SeqCst) {
                        return;
                    }
                    let rect = PET_HOME_RECT.lock().ok().and_then(|g| *g);
                    let Some((ox, oy, hw, hh)) = rect else {
                        return;
                    };
                    let app = window.app_handle();
                    let Some(main) = app.get_webview_window("main") else {
                        return;
                    };
                    if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(false) {
                        return;
                    }
                    let main_scale = main.scale_factor().unwrap_or(1.0);
                    let pet_scale = window.scale_factor().unwrap_or(1.0);
                    let (Ok(mp_p), Ok(pp_p), Ok(ps_p)) = (
                        main.outer_position(),
                        window.outer_position(),
                        window.outer_size(),
                    ) else {
                        return;
                    };
                    let main_pos = mp_p.to_logical::<f64>(main_scale);
                    let pet_pos = pp_p.to_logical::<f64>(pet_scale);
                    let pet_size = ps_p.to_logical::<f64>(pet_scale);
                    if pet_size.height > 260.0 {
                        // Expanded chat window is open; don't auto-dock
                        return;
                    }
                    let home_cx = main_pos.x + ox;
                    let home_cy = main_pos.y + oy;
                    let half_w = hw / 2.0;
                    let half_h = hh / 2.0;
                    let pet_cx = pet_pos.x + pet_size.width / 2.0;
                    let pet_cy = pet_pos.y + 44.0;

                    let inside_home = (pet_cx - home_cx).abs() <= half_w + 8.0
                        && (pet_cy - home_cy).abs() <= half_h + 8.0;
                    let outside_home = (pet_cx - home_cx).abs() > half_w + 26.0
                        || (pet_cy - home_cy).abs() > half_h + 26.0;

                    if inside_home {
                        if !PET_DOCKED_STATE.swap(true, Ordering::SeqCst) {
                            IS_ADJUSTING_PET.store(true, Ordering::SeqCst);
                            let new_x = pet_cx - 116.0 / 2.0;
                            let _ = window.set_size(tauri::LogicalSize::new(116.0, 104.0));
                            let _ = window.set_position(tauri::LogicalPosition::new(new_x, pet_pos.y));
                            attach_pet_to_main(app);
                            IS_ADJUSTING_PET.store(false, Ordering::SeqCst);
                            let _ = app.emit("pet:docked", true);
                        }
                    } else if outside_home {
                        if PET_DOCKED_STATE.swap(false, Ordering::SeqCst) {
                            IS_ADJUSTING_PET.store(true, Ordering::SeqCst);
                            detach_pet_from_main(app);
                            let new_x = pet_cx - 280.0 / 2.0;
                            let _ = window.set_size(tauri::LogicalSize::new(280.0, 200.0));
                            let _ = window.set_position(tauri::LogicalPosition::new(new_x, pet_pos.y));
                            IS_ADJUSTING_PET.store(false, Ordering::SeqCst);
                            let _ = app.emit("pet:docked", false);
                        }
                    }
                    save_pet_window_state(app, PET_DOCKED_STATE.load(Ordering::SeqCst));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_status,
            restart_backend,
            start_backend,
            stop_backend,
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
            toggle_main_window,
            is_main_window_visible,
            enter_pet_only_mode,
            summon_pet_window,
            set_pet_home_offset,
            read_clipboard_context,
            capture_screen_snip
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

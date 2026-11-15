pub mod db;
pub mod http_client;
pub mod openai;
pub mod providers;

use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use db::{ApiKey, CreateProfileInput, Database, Profile, UpdateProfileInput};
use openai::{ChatCompletionRequest, ChatCompletionResponse, ModelList};
use providers::{ProviderCredentials, ProviderRegistry};
use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager, RunEvent,
};
use tauri_plugin_opener::OpenerExt;

const BACKEND_HOST: &str = "127.0.0.1";
const BACKEND_PORT: u16 = 8088;
const BACKEND_URL: &str = "http://127.0.0.1:8088";

struct BackendState {
    child: Mutex<Option<Child>>,
    project_dir: Option<PathBuf>,
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

fn has_server_py(dir: &Path) -> bool {
    dir.join("core").join("server.py").is_file()
}

fn resolve_project_dir() -> Option<PathBuf> {
    if let Ok(env_dir) = std::env::var("UNOFFICIAL_API_DIR") {
        let p = PathBuf::from(env_dir);
        if has_server_py(&p) {
            return Some(p);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [Some(cwd.as_path()), cwd.parent(), cwd.parent().and_then(|p| p.parent())]
        {
            if let Some(dir) = candidate {
                if has_server_py(dir) {
                    return Some(dir.to_path_buf());
                }
            }
        }
    }

    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest_dir.parent().and_then(|p| p.parent()) {
        if has_server_py(root) {
            return Some(root.to_path_buf());
        }
    }

    None
}

fn find_uv_binary() -> Option<PathBuf> {
    let mut candidates = vec![
        PathBuf::from("uv"),
        PathBuf::from("/opt/homebrew/bin/uv"),
        PathBuf::from("/usr/local/bin/uv"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        candidates.push(PathBuf::from(&home).join(".local/bin/uv"));
        candidates.push(PathBuf::from(&home).join(".cargo/bin/uv"));
    }

    for candidate in candidates {
        if candidate.is_absolute() {
            if candidate.is_file() {
                return Some(candidate);
            }
        } else if Command::new(&candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return Some(candidate);
        }
    }
    None
}

fn spawn_backend(project_dir: &Path) -> Result<Child, String> {
    let venv_uvicorn = project_dir.join(".venv").join("bin").join("uvicorn");
    let mut cmd = if venv_uvicorn.is_file() {
        let mut c = Command::new(venv_uvicorn);
        c.args([
            "core.server:app",
            "--host",
            BACKEND_HOST,
            "--port",
            &BACKEND_PORT.to_string(),
        ]);
        c
    } else if let Some(uv) = find_uv_binary() {
        let mut c = Command::new(uv);
        c.args([
            "run",
            "uvicorn",
            "core.server:app",
            "--host",
            BACKEND_HOST,
            "--port",
            &BACKEND_PORT.to_string(),
        ]);
        c
    } else {
        return Err("Neither .venv/bin/uvicorn nor uv was found".to_string());
    };

    cmd.current_dir(project_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    cmd.spawn()
        .map_err(|e| format!("Failed to spawn backend server: {e}"))
}

fn ensure_backend_started(state: &BackendState) -> Result<(), String> {
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(());
        }
        *guard = None;
    }

    if is_backend_reachable() {
        return Ok(());
    }

    let Some(project_dir) = state.project_dir.as_ref() else {
        return Err("Could not locate project root containing core/server.py".to_string());
    };

    let child = spawn_backend(project_dir)?;
    *guard = Some(child);
    Ok(())
}

fn stop_managed_backend(state: &BackendState) {
    if let Ok(mut guard) = state.child.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

#[tauri::command]
fn get_backend_status(state: tauri::State<'_, BackendState>) -> BackendStatus {
    let managed = state
        .child
        .lock()
        .ok()
        .and_then(|mut g| g.as_mut().and_then(|c| c.try_wait().ok().flatten().map(|_| false)).or_else(|| g.as_ref().map(|_| true)))
        .unwrap_or(false);

    BackendStatus {
        running: is_backend_reachable(),
        managed,
        url: BACKEND_URL.to_string(),
        project_dir: state
            .project_dir
            .as_ref()
            .map(|p| p.to_string_lossy().to_string()),
    }
}

#[tauri::command]
fn restart_backend(state: tauri::State<'_, BackendState>) -> Result<BackendStatus, String> {
    stop_managed_backend(&state);
    ensure_backend_started(&state)?;
    Ok(get_backend_status(state))
}

#[tauri::command]
fn list_provider_models(
    registry: tauri::State<'_, ProviderRegistry>,
    provider_id: Option<String>,
) -> ModelList {
    registry.list_models(provider_id.as_deref())
}

#[tauri::command]
async fn provider_chat_completions(
    registry: tauri::State<'_, ProviderRegistry>,
    provider_id: String,
    credentials: ProviderCredentials,
    request: ChatCompletionRequest,
) -> Result<ChatCompletionResponse, String> {
    let provider = registry
        .get(&provider_id)
        .ok_or_else(|| format!("unknown provider `{provider_id}`"))?;
    provider
        .chat_completions(&credentials, &request)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_profiles(db: tauri::State<'_, Database>) -> Result<Vec<Profile>, String> {
    db.list_profiles().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_create_profile(
    db: tauri::State<'_, Database>,
    input: CreateProfileInput,
) -> Result<Profile, String> {
    db.create_profile(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_update_profile(
    db: tauri::State<'_, Database>,
    id: String,
    input: UpdateProfileInput,
) -> Result<Profile, String> {
    db.update_profile(&id, input).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_profile(db: tauri::State<'_, Database>, id: String) -> Result<usize, String> {
    db.delete_profile(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_list_api_keys(db: tauri::State<'_, Database>) -> Result<Vec<ApiKey>, String> {
    db.list_api_keys().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_create_api_key(db: tauri::State<'_, Database>, name: String) -> Result<ApiKey, String> {
    db.create_api_key(&name).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_delete_api_key(db: tauri::State<'_, Database>, key: String) -> Result<usize, String> {
    db.delete_api_key(&key).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let project_dir = resolve_project_dir();
    let backend_state = BackendState {
        child: Mutex::new(None),
        project_dir,
    };
    let provider_registry =
        ProviderRegistry::with_defaults().expect("failed to initialize Rust provider registry");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(backend_state)
        .manage(provider_registry)
        .setup(|app| {
            let state = app.state::<BackendState>();
            let db_path = if let Ok(custom_dir) = std::env::var("UNOFFICIAL_API_DATA_DIR") {
                PathBuf::from(custom_dir).join("unofficial_api.db")
            } else if let Some(project_dir) = state.project_dir.as_ref() {
                project_dir.join("data").join("unofficial_api.db")
            } else {
                app.path()
                    .app_data_dir()
                    .expect("failed to resolve app data dir")
                    .join("unofficial_api.db")
            };
            let database = Database::open(&db_path).expect("failed to initialize SQLite database");
            app.manage(database);

            if let Err(err) = ensure_backend_started(&state) {
                eprintln!("[unofficial-api-desktop] Backend auto-start skipped: {err}");
            }

            let show_item =
                MenuItem::with_id(app, "show", "Open Unofficial API", true, None::<&str>)?;
            let docs_item =
                MenuItem::with_id(app, "docs", "Open API Docs", true, None::<&str>)?;
            let restart_item =
                MenuItem::with_id(app, "restart", "Restart Backend", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu =
                Menu::with_items(app, &[&show_item, &docs_item, &restart_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new().menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "docs" => {
                        let _ = app.opener().open_url(format!("{BACKEND_URL}/docs"), None::<&str>);
                    }
                    "restart" => {
                        let state = app.state::<BackendState>();
                        stop_managed_backend(&state);
                        if let Err(err) = ensure_backend_started(&state) {
                            eprintln!("[unofficial-api-desktop] Restart failed: {err}");
                        }
                    }
                    "quit" => {
                        let state = app.state::<BackendState>();
                        stop_managed_backend(&state);
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
            db_delete_api_key
        ])
        .build(tauri::generate_context!())
        .expect("error while building Unofficial API desktop application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            let state = app_handle.state::<BackendState>();
            stop_managed_backend(&state);
        }
    });
}

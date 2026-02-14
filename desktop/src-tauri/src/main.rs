#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::{self, OpenOptions};
use std::io;
use std::net::TcpStream;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::Manager;

const BILLING_PORT: u16 = 3199;
const KEYGEN_PORT: u16 = 3299;
const RUNTIME_HOST: &str = "127.0.0.1";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct RuntimeState {
    child: Mutex<Option<Child>>,
}

fn keygen_app(app: &tauri::AppHandle) -> bool {
    app.config()
        .identifier
        .to_ascii_lowercase()
        .contains("keygen")
}

fn runtime_mode(app: &tauri::AppHandle) -> &'static str {
    if keygen_app(app) {
        "keygen"
    } else {
        "billing"
    }
}

fn runtime_port(app: &tauri::AppHandle) -> u16 {
    if let Ok(raw) = std::env::var("AXEIN_RUNTIME_PORT") {
        if let Ok(parsed) = raw.parse::<u16>() {
            if parsed > 0 {
                return parsed;
            }
        }
    }
    if keygen_app(app) {
        KEYGEN_PORT
    } else {
        BILLING_PORT
    }
}

fn runtime_healthy(port: u16) -> bool {
    TcpStream::connect((RUNTIME_HOST, port)).is_ok()
}

fn wait_for_runtime_ready(child: &mut Child, host: &str, port: u16, timeout: Duration) -> Result<(), String> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "Local runtime exited early with status {status}. Port {port} may already be in use."
                ))
            }
            Ok(None) => {}
            Err(err) => return Err(format!("Failed while polling local runtime process: {err}")),
        }

        if TcpStream::connect((host, port)).is_ok() {
            std::thread::sleep(Duration::from_millis(250));
            match child.try_wait() {
                Ok(Some(status)) => {
                    return Err(format!(
                        "Local runtime exited after startup probe with status {status}."
                    ))
                }
                Ok(None) => return Ok(()),
                Err(err) => return Err(format!("Failed while polling local runtime process: {err}")),
            }
        }

        std::thread::sleep(Duration::from_millis(250));
    }

    Err(format!(
        "Local runtime did not become ready on {host}:{port} within {}s",
        timeout.as_secs()
    ))
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|existing| existing == &candidate) {
        paths.push(candidate);
    }
}

fn runtime_search_roots(app: &tauri::AppHandle, resource_dir: &Path) -> Vec<PathBuf> {
    let mut roots = Vec::<PathBuf>::new();
    push_unique_path(&mut roots, resource_dir.to_path_buf());
    push_unique_path(&mut roots, resource_dir.join("_up_"));

    if let Ok(path) = std::env::var("AXEIN_RUNTIME_ROOT") {
        let custom = PathBuf::from(path);
        if custom.exists() {
            push_unique_path(&mut roots, custom);
        }
    }

    if let Ok(executable_dir) = app.path().executable_dir() {
        push_unique_path(&mut roots, executable_dir.clone());
        push_unique_path(&mut roots, executable_dir.join("_up_"));
        push_unique_path(&mut roots, executable_dir.join("resources"));
        push_unique_path(&mut roots, executable_dir.join("_up_").join("resources"));
        if let Some(parent) = executable_dir.parent() {
            push_unique_path(&mut roots, parent.join("resources"));
            push_unique_path(&mut roots, parent.join("_up_"));
            push_unique_path(&mut roots, parent.join("_up_").join("resources"));
        }
    }

    roots
}

fn resolve_node_binary(search_roots: &[PathBuf]) -> PathBuf {
    if let Ok(path) = std::env::var("AXEIN_NODE_BIN") {
        let custom = PathBuf::from(path);
        if custom.exists() {
            return custom;
        }
    }

    #[cfg(target_os = "windows")]
    {
        for root in search_roots {
            let bundled_candidates = [
                root.join("runtime").join("node").join("node.exe"),
                root.join("node").join("node.exe"),
                root.join("node.exe"),
            ];
            for bundled in bundled_candidates {
                if bundled.exists() {
                    return bundled;
                }
            }
        }
        return PathBuf::from("node.exe");
    }

    #[cfg(not(target_os = "windows"))]
    {
        for root in search_roots {
            let bundled_candidates = [
                root.join("runtime").join("node").join("node"),
                root.join("node").join("node"),
                root.join("node"),
            ];
            for bundled in bundled_candidates {
                if bundled.exists() {
                    return bundled;
                }
            }
        }
        PathBuf::from("node")
    }
}

fn resolve_runtime_root(search_roots: &[PathBuf]) -> Result<PathBuf, String> {
    let mut tried = Vec::<String>::new();

    for root in search_roots {
        let candidates = [
            root.join("runtime").join("app").join("standalone"),
            root.join("app").join("standalone"),
            root.join("standalone"),
        ];

        for candidate in candidates {
            let server_js = candidate.join("server.js");
            tried.push(server_js.to_string_lossy().to_string());
            if server_js.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!(
        "Desktop runtime missing server.js. Looked at: {}",
        tried.join("; ")
    ))
}

fn resolve_license_public_key_base64(runtime_root: &Path) -> Option<String> {
    let candidate = runtime_root.join("vendor").join("keygen").join("info.json");
    if let Ok(raw) = fs::read_to_string(&candidate) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            let k = v
                .get("publicKeyBase64")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if !k.is_empty() {
                return Some(k);
            }
        }
    }

    // Fallback: compile-time embedded public key (not secret).
    // This protects against partial installs missing vendor/keygen/info.json.
    let embedded = include_str!("../../../tools/license-keygen/info.json");
    if let Ok(v) = serde_json::from_str::<Value>(embedded) {
        let k = v
            .get("publicKeyBase64")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if !k.is_empty() {
            return Some(k);
        }
    }

    None
}

fn stop_runtime(app: &tauri::AppHandle) {
    let state = app.state::<RuntimeState>();
    let mut guard = state.child.lock().expect("runtime lock poisoned");
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn child_needs_restart(app: &tauri::AppHandle, port: u16) -> bool {
    let state = app.state::<RuntimeState>();
    let mut guard = state.child.lock().expect("runtime lock poisoned");

    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                true
            }
            Ok(None) => !runtime_healthy(port),
            Err(_) => {
                *guard = None;
                true
            }
        },
        None => true,
    }
}

fn spawn_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to resolve resource dir: {e}"))?;

    let search_roots = runtime_search_roots(app, &resource_dir);
    let runtime_root = resolve_runtime_root(&search_roots)?;
    let server_js = runtime_root.join("server.js");
    let migrations_dir = runtime_root.join("db").join("migrations");
    let keygen_private_key = runtime_root
        .join("vendor")
        .join("keygen")
        .join("ed25519-private.pem");
    let keygen_runtime_detected = runtime_root.join(".axein-keygen-runtime").exists()
        || runtime_root.join("AXEIN_KEYGEN_RUNTIME.flag").exists()
        || keygen_private_key.exists();
    let mode = runtime_mode(app);
    let port = runtime_port(app);

    if mode == "keygen" && !keygen_runtime_detected {
        return Err(
            "Keygen runtime assets are missing in this install. Reinstall the AxEin License Keygen package."
                .to_string(),
        );
    }

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {e}"))?;

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    fs::create_dir_all(&app_data_dir).map_err(|e| format!("Failed to create app data dir: {e}"))?;
    let db_data_dir = app_data_dir.join("db");
    fs::create_dir_all(&db_data_dir).map_err(|e| format!("Failed to create db data dir: {e}"))?;

    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("runtime.stdout.log"))
        .map_err(|e| format!("Failed to open runtime stdout log: {e}"))?;
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("runtime.stderr.log"))
        .map_err(|e| format!("Failed to open runtime stderr log: {e}"))?;

    let node_bin = resolve_node_binary(&search_roots);
    let node_bin_for_err = node_bin.clone();

    let mut command = Command::new(node_bin);
    command
        .arg(server_js)
        .current_dir(&runtime_root)
        .env("NODE_ENV", "production")
        .env("PORT", port.to_string())
        .env("HOSTNAME", RUNTIME_HOST)
        .env("AXEIN_DESKTOP", "1")
        .env("AXEIN_APP_MODE", mode)
        .env("AXEIN_RUNTIME_PORT", port.to_string())
        .env("AXEIN_INCLUDE_KEYGEN_UI", if mode == "keygen" { "1" } else { "0" })
        .env("APP_REQUIRE_BUSINESS_SETUP", "true")
        .env("AXEIN_FORCE_EMBEDDED_DB", "1")
        .env("AXEIN_DB_DATA_DIR", &db_data_dir)
        .env("AXEIN_MIGRATIONS_DIR", &migrations_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

    if std::env::var("LICENSE_PUBLIC_KEY").ok().as_deref().unwrap_or("").trim().is_empty() {
        if let Some(pubkey) = resolve_license_public_key_base64(&runtime_root) {
            command.env("LICENSE_PUBLIC_KEY", pubkey);
        }
    }

    if keygen_private_key.exists() {
        command.env("AXEIN_KEYGEN_PRIVATE_KEY_PATH", &keygen_private_key);
    }

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }

    for key in [
        "DATABASE_URL",
        "PGHOST",
        "PGPORT",
        "PGUSER",
        "PGPASSWORD",
        "PGDATABASE",
        "LICENSE_PUBLIC_KEY",
    ] {
        if let Ok(value) = std::env::var(key) {
            command.env(key, value);
        }
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start local runtime with {:?}: {e}", node_bin_for_err))?;

    if let Err(err) = wait_for_runtime_ready(&mut child, RUNTIME_HOST, port, Duration::from_secs(45)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(err);
    }

    {
        let state = app.state::<RuntimeState>();
        let mut guard = state.child.lock().expect("runtime lock poisoned");
        *guard = Some(child);
    }

    Ok(())
}

fn ensure_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    let port = runtime_port(app);
    if child_needs_restart(app, port) {
        stop_runtime(app);
        spawn_runtime(app)?;
    }
    Ok(())
}

fn start_runtime_watchdog(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut failures: u8 = 0;
        loop {
            std::thread::sleep(Duration::from_secs(8));
            match ensure_runtime(&app) {
                Ok(_) => failures = 0,
                Err(err) => {
                    failures = failures.saturating_add(1);
                    eprintln!("runtime watchdog recovery failed: {err}");
                    if failures >= 5 {
                        eprintln!("runtime watchdog reached failure threshold; keeping app alive for diagnostics");
                        failures = 0;
                    }
                }
            }
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(RuntimeState::default())
        .setup(|app| {
            #[cfg(not(debug_assertions))]
            {
                ensure_runtime(&app.handle())
                    .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
                start_runtime_watchdog(app.handle().clone());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(not(debug_assertions))]
            {
                if let tauri::WindowEvent::Focused(true) = event {
                    let _ = ensure_runtime(&window.app_handle());
                }
            }

            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
                stop_runtime(&window.app_handle());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running AxEin desktop app");
}

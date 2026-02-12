use std::fs::{self, OpenOptions};
use std::io;
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Manager;

const DESKTOP_PORT: u16 = 3199;
const RUNTIME_HOST: &str = "127.0.0.1";

#[derive(Default)]
struct RuntimeState {
    child: Mutex<Option<Child>>,
}

fn wait_for_port(host: &str, port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if TcpStream::connect((host, port)).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

fn runtime_healthy() -> bool {
    TcpStream::connect((RUNTIME_HOST, DESKTOP_PORT)).is_ok()
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

fn stop_runtime(app: &tauri::AppHandle) {
    let state = app.state::<RuntimeState>();
    let mut guard = state.child.lock().expect("runtime lock poisoned");
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn child_needs_restart(app: &tauri::AppHandle) -> bool {
    let state = app.state::<RuntimeState>();
    let mut guard = state.child.lock().expect("runtime lock poisoned");

    match guard.as_mut() {
        Some(child) => match child.try_wait() {
            Ok(Some(_)) => {
                *guard = None;
                true
            }
            Ok(None) => !runtime_healthy(),
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

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|e| format!("Failed to resolve log dir: {e}"))?;
    fs::create_dir_all(&log_dir).map_err(|e| format!("Failed to create log dir: {e}"))?;

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
        .current_dir(runtime_root)
        .env("NODE_ENV", "production")
        .env("PORT", DESKTOP_PORT.to_string())
        .env("HOSTNAME", RUNTIME_HOST)
        .env("AXEIN_DESKTOP", "1")
        .env("APP_REQUIRE_BUSINESS_SETUP", "true")
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log));

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

    let child = command
        .spawn()
        .map_err(|e| format!("Failed to start local runtime with {:?}: {e}", node_bin_for_err))?;

    {
        let state = app.state::<RuntimeState>();
        let mut guard = state.child.lock().expect("runtime lock poisoned");
        *guard = Some(child);
    }

    if !wait_for_port(RUNTIME_HOST, DESKTOP_PORT, Duration::from_secs(45)) {
        stop_runtime(app);
        return Err("Local runtime did not become ready on time".to_string());
    }

    Ok(())
}

fn ensure_runtime(app: &tauri::AppHandle) -> Result<(), String> {
    if child_needs_restart(app) {
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

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::Manager;

static LOG_FILE: OnceLock<Mutex<PathBuf>> = OnceLock::new();

pub(crate) fn init(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_log_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let path = directory.join("sillage.log");
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let _ = LOG_FILE.set(Mutex::new(path.clone()));
    write("INFO", "Companion log initialized");
    Ok(path)
}

pub(crate) fn write(level: &str, message: &str) {
    let Some(file) = LOG_FILE.get() else { return };
    let Ok(path) = file.lock() else { return };
    let Ok(mut handle) = OpenOptions::new().create(true).append(true).open(&*path) else {
        return;
    };
    let timestamp = chrono::Utc::now().to_rfc3339();
    let _ = writeln!(handle, "{timestamp} [{level}] [watcher] {message}");
}

pub(crate) fn export(destination: &str) -> Result<(), String> {
    let Some(file) = LOG_FILE.get() else {
        return Err("Log file is not initialized".into());
    };
    let path = file.lock().map_err(|error| error.to_string())?;
    fs::copy(&*path, destination)
        .map(|_| ())
        .map_err(|error| format!("Unable to export companion log: {error}"))
}

pub(crate) fn path() -> Option<String> {
    LOG_FILE
        .get()
        .and_then(|file| file.lock().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#![recursion_limit = "256"]

mod claude_bridge;
mod logging;
mod local_web;
mod vault;
mod watcher;

use vault::{list_vault_notes, read_vault_note};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tiny_http::{Header, Response, Server, StatusCode};
use url::Url;

struct WatcherControl {
    command_tx: std::sync::mpsc::Sender<WatcherCommand>,
}

pub(crate) struct WatcherRestart {
    token: Option<String>,
    clear_session: bool,
    force_reindex: bool,
}

pub(crate) enum WatcherCommand {
    Start(WatcherRestart),
    Pause { clear_session: bool },
}

pub(crate) struct WatcherStatus(std::sync::Mutex<String>);

#[cfg(debug_assertions)]
const KEYRING_SERVICE: &str = "cloud.jb-holdings.sillage.desktop.development";
#[cfg(not(debug_assertions))]
const KEYRING_SERVICE: &str = "cloud.jb-holdings.sillage.desktop.production.v1";
const KEYRING_ACCOUNT: &str = "desktop-session";
const DESKTOP_AUTH_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const DESKTOP_AUTH_POLL_INTERVAL: Duration = Duration::from_millis(250);

#[derive(Default)]
struct DesktopAuthControl(std::sync::Mutex<Option<Arc<AtomicBool>>>);

impl DesktopAuthControl {
    fn begin(&self) -> Result<Arc<AtomicBool>, String> {
        let cancelled = Arc::new(AtomicBool::new(false));
        let mut active = self.0.lock().map_err(|error| error.to_string())?;
        if let Some(previous) = active.replace(cancelled.clone()) {
            previous.store(true, Ordering::Release);
        }
        Ok(cancelled)
    }

    fn finish(&self, cancelled: &Arc<AtomicBool>) {
        if let Ok(mut active) = self.0.lock() {
            if active
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, cancelled))
            {
                active.take();
            }
        }
    }

    fn cancel(&self) {
        if let Ok(mut active) = self.0.lock() {
            if let Some(cancelled) = active.take() {
                cancelled.store(true, Ordering::Release);
            }
        }
    }
}

#[derive(Default)]
struct SessionCache {
    loaded: bool,
    token: Option<String>,
}

#[derive(Default)]
struct SessionStore(std::sync::Mutex<SessionCache>);

impl SessionStore {
    fn load(&self) -> Result<Option<String>, String> {
        let mut cache = self.0.lock().map_err(|error| error.to_string())?;
        if cache.loaded {
            return Ok(cache.token.clone());
        }

        let token = match keyring_entry()?.get_password() {
            Ok(token) => Some(token),
            Err(keyring::Error::NoEntry) => None,
            Err(error) => {
                cache.loaded = true;
                return Err(error.to_string());
            }
        };
        cache.loaded = true;
        cache.token = token.clone();
        Ok(token)
    }

    fn current(&self) -> Option<String> {
        self.0.lock().ok().and_then(|cache| cache.token.clone())
    }

    fn store(&self, token: String) -> Result<(), String> {
        keyring_entry()?
            .set_password(&token)
            .map_err(|error| error.to_string())?;
        let mut cache = self.0.lock().map_err(|error| error.to_string())?;
        cache.loaded = true;
        cache.token = Some(token);
        Ok(())
    }

    fn forget(&self) {
        if let Ok(mut cache) = self.0.lock() {
            cache.loaded = true;
            cache.token = None;
        }
    }

    fn clear(&self) -> Result<(), String> {
        self.forget();
        match keyring_entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopAuthorizationRequest {
    redirect_uri: String,
    state: String,
    code_challenge: String,
    device_name: String,
}

#[derive(Deserialize)]
struct DesktopAuthorizationResponse {
    #[serde(rename = "authorizationURL")]
    authorization_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopExchangeRequest {
    code: String,
    code_verifier: String,
}

#[derive(Deserialize)]
struct DesktopExchangeResponse {
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct OpenRouterExchangeRequest {
    code: String,
    code_verifier: String,
    code_challenge_method: String,
}

#[derive(Deserialize)]
struct OpenRouterExchangeResponse {
    key: String,
}

fn random_base64url() -> String {
    URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>())
}

fn tunnel_request(
    builder: reqwest::blocking::RequestBuilder,
    url: &str,
) -> reqwest::blocking::RequestBuilder {
    let mut next = builder;
    if url.contains(".zrok.io") || url.contains("shares.zrok") {
        next = next.header("skip_zrok_interstitial", "true");
    }
    next
}

fn api_error(response: reqwest::blocking::Response, fallback: &str) -> String {
    let status = response.status();
    let body = response.text().unwrap_or_default();
    serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("error")?.as_str().map(str::to_owned))
        .unwrap_or_else(|| format!("{fallback} ({status})"))
}

fn callback_page(title: &str, message: &str, success: bool) -> String {
    let accent = if success { "#7797ff" } else { "#ff8f81" };
    format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>{title}</title><style>html{{color-scheme:dark}}body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0d0d;color:#f4f4f2;font:16px/1.6 system-ui,sans-serif}}main{{width:min(520px,calc(100% - 48px));padding:44px;border:1px solid #303030;border-radius:24px;background:#171717;box-sizing:border-box}}span{{display:block;margin-bottom:24px;color:{accent};font:600 12px/1 system-ui;letter-spacing:.18em}}h1{{margin:0 0 12px;font-size:32px;line-height:1.1}}p{{margin:0;color:#aaa}}</style></head><body><main><span>SILLAGE</span><h1>{title}</h1><p>{message}</p></main></body></html>"#
    )
}

fn respond_html(request: tiny_http::Request, status: u16, body: String) {
    let mut response = Response::from_string(body).with_status_code(StatusCode(status));
    if let Ok(header) = Header::from_bytes("Content-Type", "text/html; charset=utf-8") {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn run_desktop_authorization(
    app: tauri::AppHandle,
    api_url: String,
    device_name: String,
    cancelled: Arc<AtomicBool>,
) -> Result<String, String> {
    let server = Server::http(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or_else(|| "Unable to open a local sign-in callback".to_string())?;
    let redirect_uri = format!("http://127.0.0.1:{port}/auth/callback");
    let state = random_base64url();
    let code_verifier = random_base64url();
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let start_url = format!(
        "{}/v1/desktop-authorizations",
        api_url.trim_end_matches('/')
    );
    let start_response = tunnel_request(client.post(&start_url), &start_url)
        .json(&DesktopAuthorizationRequest {
            redirect_uri,
            state: state.clone(),
            code_challenge,
            device_name,
        })
        .send()
        .map_err(|error| format!("Unable to reach Sillage: {error}"))?;
    if !start_response.status().is_success() {
        return Err(api_error(start_response, "Unable to start sign-in"));
    }
    let authorization_url = start_response
        .json::<DesktopAuthorizationResponse>()
        .map_err(|_| "Sillage returned an invalid sign-in response".to_string())?
        .authorization_url;
    app.opener()
        .open_url(&authorization_url, None::<&str>)
        .map_err(|error| format!("Unable to open your browser: {error}"))?;

    let deadline = Instant::now() + DESKTOP_AUTH_TIMEOUT;
    let (request, code) = loop {
        if cancelled.load(Ordering::Acquire) {
            return Err("Sign-in cancelled.".into());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Sign-in expired. Please try again.".into());
        }
        let Some(request) = server
            .recv_timeout(remaining.min(DESKTOP_AUTH_POLL_INTERVAL))
            .map_err(|error| error.to_string())?
        else {
            continue;
        };
        let callback = Url::parse(&format!("http://127.0.0.1{}", request.url()));
        let Ok(callback) = callback else {
            respond_html(
                request,
                400,
                callback_page("Sign-in failed", "The callback URL was invalid.", false),
            );
            continue;
        };
        if callback.path() != "/auth/callback" {
            respond_html(
                request,
                404,
                callback_page(
                    "Not found",
                    "This local page is only used to finish Sillage sign-in.",
                    false,
                ),
            );
            continue;
        }
        let parameters = callback
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();
        if parameters.get("state") != Some(&state) {
            respond_html(
                request,
                400,
                callback_page(
                    "Sign-in failed",
                    "The security state did not match. Please return to Sillage and try again.",
                    false,
                ),
            );
            return Err("Sign-in security check failed. Please try again.".into());
        }
        if let Some(error) = parameters.get("error") {
            respond_html(
                request,
                400,
                callback_page(
                    "Sign-in cancelled",
                    "Return to Sillage when you are ready to try again.",
                    false,
                ),
            );
            return Err(format!("Sign-in was not completed: {error}"));
        }
        let Some(code) = parameters
            .get("code")
            .filter(|code| !code.is_empty())
            .cloned()
        else {
            respond_html(
                request,
                400,
                callback_page(
                    "Sign-in failed",
                    "No authorization code was returned.",
                    false,
                ),
            );
            return Err("No authorization code was returned".into());
        };
        break (request, code);
    };

    let exchange_url = format!(
        "{}/v1/desktop-authorizations/exchange",
        api_url.trim_end_matches('/')
    );
    let exchange_response = match tunnel_request(client.post(&exchange_url), &exchange_url)
        .json(&DesktopExchangeRequest {
            code,
            code_verifier,
        })
        .send()
    {
        Ok(response) => response,
        Err(error) => {
            respond_html(request, 400, callback_page("Sign-in failed", "Sillage could not finish the connection. Return to the desktop app and try again.", false));
            return Err(format!("Unable to finish Sillage sign-in: {error}"));
        }
    };
    if !exchange_response.status().is_success() {
        let error = api_error(exchange_response, "Unable to finish sign-in");
        respond_html(
            request,
            400,
            callback_page("Sign-in failed", "Return to Sillage and try again.", false),
        );
        return Err(error);
    }
    let token = match exchange_response.json::<DesktopExchangeResponse>() {
        Ok(response) => response.token,
        Err(_) => {
            respond_html(
                request,
                400,
                callback_page(
                    "Sign-in failed",
                    "Sillage returned an invalid session. Return to the desktop app and try again.",
                    false,
                ),
            );
            return Err("Sillage returned an invalid session response".into());
        }
    };
    if let Err(error) = app.state::<SessionStore>().store(token.clone()) {
        respond_html(
            request,
            500,
            callback_page(
                "Sign-in failed",
                "The session could not be saved in the system keychain.",
                false,
            ),
        );
        return Err(error);
    }
    respond_html(
        request,
        200,
        callback_page(
            "Sillage is connected",
            "You can close this tab and return to the desktop app.",
            true,
        ),
    );
    Ok(token)
}

fn run_openrouter_authorization(app: tauri::AppHandle) -> Result<String, String> {
    let server = Server::http(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let port = server
        .server_addr()
        .to_ip()
        .map(|address| address.port())
        .ok_or_else(|| "Unable to open the OpenRouter callback".to_string())?;
    let callback_nonce = random_base64url();
    let callback_path = format!("/openrouter/callback/{callback_nonce}");
    let callback_url = format!("http://127.0.0.1:{port}{callback_path}");
    let code_verifier = random_base64url();
    let code_challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let mut authorization_url =
        Url::parse("https://openrouter.ai/auth").map_err(|error| error.to_string())?;
    authorization_url
        .query_pairs_mut()
        .append_pair("callback_url", &callback_url)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256");
    app.opener()
        .open_url(authorization_url.as_str(), None::<&str>)
        .map_err(|error| format!("Unable to open OpenRouter: {error}"))?;

    let deadline = Instant::now() + DESKTOP_AUTH_TIMEOUT;
    let (request, code) = loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("OpenRouter connection expired. Please try again.".into());
        }
        let Some(request) = server
            .recv_timeout(remaining)
            .map_err(|error| error.to_string())?
        else {
            return Err("OpenRouter connection expired. Please try again.".into());
        };
        let callback = Url::parse(&format!("http://127.0.0.1{}", request.url()));
        let Ok(callback) = callback else {
            respond_html(
                request,
                400,
                callback_page(
                    "OpenRouter connection failed",
                    "The callback URL was invalid.",
                    false,
                ),
            );
            continue;
        };
        if callback.path() != callback_path {
            respond_html(
                request,
                404,
                callback_page(
                    "Not found",
                    "This local page only connects OpenRouter to Sillage.",
                    false,
                ),
            );
            continue;
        }
        let parameters = callback
            .query_pairs()
            .into_owned()
            .collect::<std::collections::HashMap<_, _>>();
        if let Some(error) = parameters.get("error") {
            respond_html(
                request,
                400,
                callback_page(
                    "OpenRouter connection cancelled",
                    "Return to Sillage when you are ready to try again.",
                    false,
                ),
            );
            return Err(format!("OpenRouter connection was not completed: {error}"));
        }
        let Some(code) = parameters
            .get("code")
            .filter(|code| !code.is_empty())
            .cloned()
        else {
            respond_html(
                request,
                400,
                callback_page(
                    "OpenRouter connection failed",
                    "No authorization code was returned.",
                    false,
                ),
            );
            return Err("OpenRouter returned no authorization code".into());
        };
        break (request, code);
    };

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .post("https://openrouter.ai/api/v1/auth/keys")
        .json(&OpenRouterExchangeRequest {
            code,
            code_verifier,
            code_challenge_method: "S256".into(),
        })
        .send()
        .map_err(|error| format!("Unable to finish the OpenRouter connection: {error}"))?;
    if !response.status().is_success() {
        let error = api_error(response, "OpenRouter rejected the authorization code");
        respond_html(
            request,
            400,
            callback_page(
                "OpenRouter connection failed",
                "Return to Sillage and try again.",
                false,
            ),
        );
        return Err(error);
    }
    let key = response
        .json::<OpenRouterExchangeResponse>()
        .map_err(|_| "OpenRouter returned an invalid API key response".to_string())?
        .key;
    if !key.starts_with("sk-or-") {
        respond_html(
            request,
            400,
            callback_page(
                "OpenRouter connection failed",
                "OpenRouter returned an invalid key.",
                false,
            ),
        );
        return Err("OpenRouter returned an invalid API key".into());
    }
    respond_html(
        request,
        200,
        callback_page(
            "OpenRouter is connected",
            "Sillage created its dedicated key. You can close this tab and return to the app.",
            true,
        ),
    );
    Ok(key)
}

#[tauri::command]
fn get_access_token(session: State<'_, SessionStore>) -> Option<String> {
    session.load().ok().flatten()
}

#[tauri::command]
fn forget_access_token(session: State<'_, SessionStore>) {
    session.forget();
}

#[tauri::command]
fn clear_access_token(session: State<'_, SessionStore>) -> Result<(), String> {
    session.clear()
}

#[tauri::command]
async fn connect_account(
    app: tauri::AppHandle,
    api_url: String,
    device_name: String,
    control: State<'_, DesktopAuthControl>,
) -> Result<String, String> {
    let cancelled = control.begin()?;
    let task_cancelled = cancelled.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        run_desktop_authorization(app, api_url, device_name, task_cancelled)
    })
    .await;
    control.finish(&cancelled);
    result.map_err(|error| format!("Sign-in task failed: {error}"))?
}

#[tauri::command]
fn cancel_account_connection(control: State<'_, DesktopAuthControl>) {
    control.cancel();
}

#[tauri::command]
async fn connect_openrouter(app: tauri::AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_openrouter_authorization(app))
        .await
        .map_err(|error| format!("OpenRouter connection task failed: {error}"))?
}

#[tauri::command]
async fn get_claude_auth_status() -> Result<claude_bridge::ClaudeAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(claude_bridge::auth_status)
        .await
        .map_err(|error| format!("Claude status task failed: {error}"))?
}

#[tauri::command]
async fn connect_claude() -> Result<claude_bridge::ClaudeAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(claude_bridge::connect)
        .await
        .map_err(|error| format!("Claude connection task failed: {error}"))?
}

#[tauri::command]
async fn execute_local_model_task(
    kind: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        claude_bridge::execute_local_model_task(&kind, payload)
    })
    .await
    .map_err(|error| format!("Local model execution task failed: {error}"))?
}

#[tauri::command]
async fn analyze_vault(vault_path: String) -> Result<watcher::VaultAnalysis, String> {
    tauri::async_runtime::spawn_blocking(move || {
        watcher::analyze_vault(std::path::Path::new(&vault_path))
    })
    .await
    .map_err(|error| format!("Vault analysis task failed: {error}"))?
}

#[tauri::command]
fn get_log_file_path() -> Option<String> {
    logging::path()
}

#[tauri::command]
fn export_logs(destination: String) -> Result<(), String> {
    logging::export(&destination)
}

#[tauri::command]
fn restart_watcher(
    state: State<'_, WatcherControl>,
    token: Option<String>,
    clear_session: Option<bool>,
    force_reindex: Option<bool>,
) -> Result<(), String> {
    state
        .command_tx
        .send(WatcherCommand::Start(WatcherRestart {
            token,
            clear_session: clear_session.unwrap_or(false),
            force_reindex: force_reindex.unwrap_or(false),
        }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn pause_watcher(
    state: State<'_, WatcherControl>,
    clear_session: Option<bool>,
) -> Result<(), String> {
    state
        .command_tx
        .send(WatcherCommand::Pause {
            clear_session: clear_session.unwrap_or(false),
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_watcher_status(state: State<'_, WatcherStatus>) -> String {
    state
        .0
        .lock()
        .map(|status| status.clone())
        .unwrap_or_else(|_| "Status unavailable".into())
}

#[tauri::command]
fn open_obsidian_url(app: tauri::AppHandle, href: String) -> Result<(), String> {
    app.opener()
        .open_url(href, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_local_web_status(state: State<'_, local_web::LocalWebControl>) -> local_web::LocalWebStatus {
    state.status()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (watcher_command_tx, watcher_command_rx) = std::sync::mpsc::channel();
    tauri::Builder::default()
        .manage(DesktopAuthControl::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            restart_watcher,
            pause_watcher,
            get_watcher_status,
            open_obsidian_url,
            get_local_web_status,
            get_access_token,
            forget_access_token,
            clear_access_token,
            connect_account,
            cancel_account_connection,
            connect_openrouter,
            get_claude_auth_status,
            connect_claude,
            execute_local_model_task,
            analyze_vault,
            get_log_file_path,
            export_logs,
            list_vault_notes,
            read_vault_note
        ])
        .menu(|app| {
            let check_for_updates = MenuItem::with_id(
                app,
                "check-for-updates",
                "Check for Updates…",
                true,
                None::<&str>,
            )?;
            let settings =
                MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
            let export_logs = MenuItem::with_id(
                app,
                "export-companion-log",
                "Export Companion Log…",
                true,
                None::<&str>,
            )?;
            let logs_menu = SubmenuBuilder::new(app, "Log").item(&export_logs).build()?;
            let app_menu = SubmenuBuilder::new(app, "Sillage")
                .about(None)
                .separator()
                .item(&check_for_updates)
                .item(&logs_menu)
                .separator()
                .item(&settings)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;
            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;
            let window_menu = SubmenuBuilder::new(app, "Window")
                .minimize()
                .fullscreen()
                .build()?;

            Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "check-for-updates" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("check-for-updates", ());
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("open-settings", ());
            }
            "export-companion-log" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("export-companion-log", ());
            }
            _ => {}
        })
        .setup(move |app| {
            logging::init(app.handle()).map_err(std::io::Error::other)?;
            app.manage(SessionStore::default());
            let local_web = local_web::LocalWebControl::default();
            let local_web_status = local_web.start(app.path().resource_dir().ok());
            logging::write(
                "INFO",
                &format!(
                    "local web sidecar: {}",
                    serde_json::to_string(&local_web_status).unwrap_or_else(|_| "{}".into())
                ),
            );
            app.manage(local_web);
            app.manage(WatcherControl {
                command_tx: watcher_command_tx.clone(),
            });
            // macOS sizes a tray menu from its initial labels and does not
            // reliably grow it after `set_text`. Start with a representative
            // long status so progress such as "144/144 notes" stays visible.
            const INITIAL_COMPANION_STATUS: &str = "Companion · Starting note synchronization…";
            app.manage(WatcherStatus(std::sync::Mutex::new(
                INITIAL_COMPANION_STATUS.into(),
            )));
            // Status line (disabled = display only), updated live by the watcher.
            let status =
                MenuItem::with_id(app, "status", INITIAL_COMPANION_STATUS, false, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let pause_sync =
                MenuItem::with_id(app, "pause-sync", "Pause sync", true, None::<&str>)?;
            let restart_sync = MenuItem::with_id(
                app,
                "restart-sync",
                "Resume / restart sync",
                true,
                None::<&str>,
            )?;
            let sync_sep = PredefinedMenuItem::separator(app)?;
            let show = MenuItem::with_id(app, "show", "Open", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &status,
                    &sep,
                    &pause_sync,
                    &restart_sync,
                    &sync_sep,
                    &show,
                    &quit,
                ],
            )?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Sillage")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "pause-sync" => {
                        let _ =
                            app.state::<WatcherControl>()
                                .command_tx
                                .send(WatcherCommand::Pause {
                                    clear_session: false,
                                });
                    }
                    "restart-sync" => {
                        let _ =
                            app.state::<WatcherControl>()
                                .command_tx
                                .send(WatcherCommand::Start(WatcherRestart {
                                    token: app.state::<SessionStore>().current(),
                                    clear_session: false,
                                    force_reindex: false,
                                }));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            // Companion sync agent reports progress into the status item.
            watcher::start(app.handle().clone(), status, watcher_command_rx);
            Ok(())
        })
        // Closing the window hides it instead of quitting — the tray agent lives on.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                app.state::<local_web::LocalWebControl>().stop();
            }
        });
}

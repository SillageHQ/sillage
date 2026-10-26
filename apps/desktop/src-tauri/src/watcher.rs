//! Companion sync agent: watches the Obsidian vault and pushes changed notes
//! to the cloud API. Reports progress into a tray menu status item.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, UNIX_EPOCH};

use notify_debouncer_full::new_debouncer;
use notify_debouncer_full::notify::{EventKind, RecursiveMode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::{WatcherCommand, WatcherStatus};

const API_BASE_URL: &str = env!("SILLAGE_API_URL");
const SYNC_WORKERS: usize = 5;
const RECONCILE_INTERVAL: Duration = Duration::from_secs(20 * 60);
const MANIFEST_RETRY_DELAY: Duration = Duration::from_secs(30);
const MANIFEST_FETCH_ATTEMPTS: usize = 3;
const INGESTION_JOB_POLL_INTERVAL: Duration = Duration::from_millis(500);
const NOTE_IDLE_DELAY: Duration = Duration::from_secs(5 * 60);
const OPENROUTER_CREDITS_PAUSED_STATUS: &str = "⏸ Sync paused · Add OpenRouter credits";
const CONNECTION_PAUSED_STATUS: &str = "⏸ Sync paused · Connection unavailable";
const MANUAL_PAUSED_STATUS: &str = "⏸ Sync paused · Resume when ready";

macro_rules! log_info {
    ($($arg:tt)*) => {{
        let message = format!($($arg)*);
        crate::logging::write("INFO", &message);
        std::println!("{message}");
    }};
}

macro_rules! log_error {
    ($($arg:tt)*) => {{
        let message = format!($($arg)*);
        crate::logging::write("ERROR", &message);
        std::eprintln!("{message}");
    }};
}

fn api_url(path: &str) -> String {
    format!("{}{}", API_BASE_URL, path)
}

#[derive(Deserialize)]
struct Settings {
    #[serde(rename = "vaultPath")]
    vault_path: Option<String>,
    #[serde(rename = "vaultRootPath")]
    vault_root_path: Option<String>,
    #[serde(rename = "vaultSourceType")]
    vault_source_type: Option<String>,
    #[serde(rename = "vaultSourceLabel")]
    vault_source_label: Option<String>,
    #[serde(rename = "syncStatus")]
    sync_status: Option<String>,
    #[serde(rename = "lastSyncCheckAt")]
    last_sync_check_at: Option<String>,
    #[serde(rename = "ingestionProvider")]
    ingestion_provider: Option<String>,
    #[serde(rename = "claudeIngestionModel")]
    claude_ingestion_model: Option<String>,
    #[serde(rename = "claudeEmbeddingModel")]
    claude_embedding_model: Option<String>,
}

struct VaultSource {
    root: PathBuf,
    source_type: String,
    label: String,
    ingestion_provider: String,
    claude_ingestion_model: String,
    claude_embedding_model: String,
}

#[derive(Clone)]
struct LocalManifestEntry {
    abs_path: PathBuf,
    rel_path: String,
    content_hash: String,
    size: u64,
    mtime_secs: i64,
}

#[derive(Deserialize)]
struct RemoteManifest {
    items: Vec<RemoteManifestItem>,
}

#[derive(Deserialize)]
struct RemoteManifestItem {
    path: String,
    content_hash: String,
}

#[derive(Serialize)]
struct SyncStatusPatch<'a> {
    #[serde(rename = "syncStatus")]
    sync_status: &'a str,
    #[serde(rename = "lastSyncCheckAt")]
    last_sync_check_at: String,
}

#[derive(Clone, Copy)]
enum SyncPauseReason {
    ProviderBilling,
    ConnectionUnavailable,
    ClaudeUnavailable,
}

enum NoteSyncResult {
    Synced,
    Failed,
    Paused(SyncPauseReason),
    Cancelled,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoteIngestionJob {
    job_id: String,
    status: String,
    error: Option<serde_json::Value>,
}

#[derive(Clone, Copy)]
enum ReconcileResult {
    Complete(bool),
    Retry,
    Paused,
}

#[derive(Clone, Copy)]
enum PendingChangeKind {
    Upsert,
    Delete,
}

struct PendingChange {
    kind: PendingChangeKind,
    sync_after: Instant,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultAnalysis {
    note_count: usize,
    indexable_note_count: usize,
    total_bytes: u64,
    total_characters: u64,
    estimated_source_tokens: u64,
    unreadable_notes: usize,
}

/// Cheap filter: a real note we should sync (skip the .obsidian config dir).
fn is_candidate(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()) == Some("md")
        && !path.components().any(|c| c.as_os_str() == ".obsidian")
}

/// Update the tray status item from any thread (menu mutation must hit main).
fn set_status(app: &AppHandle, status: &MenuItem<Wry>, text: String) {
    if let Ok(mut current) = app.state::<WatcherStatus>().0.lock() {
        *current = text.clone();
    }
    let _ = app.emit("watcher-status", &text);
    let item = status.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = item.set_text(text);
    });
}

/// Vault-relative path incl. filename (e.g. "Idées/Note.md") — the stable
/// identity the API keys episodes on, so a rename of a parent folder or a title
/// collision across folders no longer confuses memory.
fn rel_path(path: &Path, vault: &Path) -> String {
    path.strip_prefix(vault)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn content_hash(body: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(body.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn mtime_secs(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// Read a changed note and POST it to the API. Skips empty files.
fn is_provider_billing_error(status: reqwest::StatusCode, body: &str) -> bool {
    if status == reqwest::StatusCode::PAYMENT_REQUIRED {
        return true;
    }
    let Ok(payload) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    let code = payload
        .get("code")
        .or_else(|| payload.get("detail").and_then(|detail| detail.get("code")))
        .and_then(serde_json::Value::as_str);
    code == Some("provider_billing_required")
}

fn is_claude_unavailable_error(error: &str) -> bool {
    let lowered = error.to_ascii_lowercase();
    lowered.contains("authentication")
        || lowered.contains("usage")
        || lowered.contains("quota")
        || lowered.contains("claude code is not installed")
        || lowered.contains("connect a claude subscription")
}

fn job_pause_reason(error: Option<&serde_json::Value>) -> Option<SyncPauseReason> {
    let error = error?;
    let serialized = error.to_string();
    if is_provider_billing_error(reqwest::StatusCode::OK, &serialized) {
        return Some(SyncPauseReason::ProviderBilling);
    }
    if is_claude_unavailable_error(&serialized) {
        return Some(SyncPauseReason::ClaudeUnavailable);
    }
    let code = error.get("code").and_then(serde_json::Value::as_str);
    let upstream_server_error = error
        .get("status")
        .and_then(serde_json::Value::as_u64)
        .is_some_and(|status| status >= 500);
    (code == Some("memory_unavailable") || upstream_server_error)
        .then_some(SyncPauseReason::ConnectionUnavailable)
}

fn push_note(
    path: &Path,
    vault: &Path,
    client: &reqwest::blocking::Client,
    cancelled: &AtomicBool,
    _ingestion: (&str, &str, &str),
    _access_token: &str,
) -> NoteSyncResult {
    if cancelled.load(Ordering::Acquire) {
        return NoteSyncResult::Cancelled;
    }
    let body = match std::fs::read_to_string(path) {
        Ok(b) if !b.trim().is_empty() => b,
        _ => return NoteSyncResult::Synced,
    };
    let title = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("note")
        .to_string();
    let folder = path
        .parent()
        .and_then(|p| p.strip_prefix(vault).ok())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let timestamp = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339());

    let payload = serde_json::json!({
        "title": title, "body": body, "folder": folder,
        "path": rel_path(path, vault), "timestamp": timestamp,
    });
    let mut job = match client.post(api_url("/ingest/note")).json(&payload).send() {
        Ok(response) if response.status().is_success() => match response.json::<NoteIngestionJob>()
        {
            Ok(job) => job,
            Err(error) => {
                log_error!("[watcher] invalid ingestion job for {title}: {error}");
                return NoteSyncResult::Failed;
            }
        },
        Ok(response) => {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            if is_provider_billing_error(status, &body) {
                log_error!("[watcher] sync paused for {title}: OpenRouter credits required");
                return NoteSyncResult::Paused(SyncPauseReason::ProviderBilling);
            } else if status.is_server_error() {
                log_error!("[watcher] sync paused for {title}: server returned {status}");
                return NoteSyncResult::Paused(SyncPauseReason::ConnectionUnavailable);
            } else {
                log_error!("[watcher] sync rejected for {title}: {status}");
                return NoteSyncResult::Failed;
            }
        }
        Err(error) => {
            log_error!("[watcher] sync transport error for {title}: {error:?}");
            return NoteSyncResult::Paused(SyncPauseReason::ConnectionUnavailable);
        }
    };

    loop {
        match job.status.as_str() {
            "done" => {
                log_info!("[watcher] synced: {title}");
                return NoteSyncResult::Synced;
            }
            "failed" => {
                if let Some(reason) = job_pause_reason(job.error.as_ref()) {
                    log_error!("[watcher] sync paused for {title}: ingestion job failed");
                    return NoteSyncResult::Paused(reason);
                }
                log_error!("[watcher] sync failed for {title}: {:?}", job.error);
                return NoteSyncResult::Failed;
            }
            "queued" | "processing" => {}
            status => {
                log_error!("[watcher] unknown ingestion status for {title}: {status}");
                return NoteSyncResult::Failed;
            }
        }

        if cancelled.load(Ordering::Acquire) {
            return NoteSyncResult::Cancelled;
        }
        std::thread::sleep(INGESTION_JOB_POLL_INTERVAL);
        let response = match client
            .get(api_url(&format!("/ingest/jobs/{}", job.job_id)))
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                log_error!("[watcher] ingestion status unavailable for {title}: {error:?}");
                return NoteSyncResult::Paused(SyncPauseReason::ConnectionUnavailable);
            }
        };
        if !response.status().is_success() {
            let status = response.status();
            log_error!("[watcher] ingestion status rejected for {title}: {status}");
            return if status.is_server_error() {
                NoteSyncResult::Paused(SyncPauseReason::ConnectionUnavailable)
            } else {
                NoteSyncResult::Failed
            };
        }
        job = match response.json::<NoteIngestionJob>() {
            Ok(next) => next,
            Err(error) => {
                log_error!("[watcher] invalid ingestion status for {title}: {error}");
                return NoteSyncResult::Failed;
            }
        };
    }
}

/// Note deleted in the vault: tell the API to drop it from memory. Sends both
/// path (primary identity) and title (legacy fallback for un-migrated episodes).
fn delete_note(path: &Path, vault: &Path, client: &reqwest::blocking::Client) -> bool {
    let title = path.file_stem().and_then(|s| s.to_str()).unwrap_or("note");
    let rel = rel_path(path, vault);
    match client
        .delete(api_url("/note"))
        .query(&[("path", rel.as_str()), ("title", title)])
        .send()
    {
        Ok(response) if response.status().is_success() => {
            log_info!("[watcher] deleted: {rel}");
            true
        }
        Ok(response) => {
            log_error!("[watcher] delete rejected for {rel}: {}", response.status());
            false
        }
        Err(e) => {
            log_error!("[watcher] delete failed for {rel}: {e}");
            false
        }
    }
}

fn load_vault_source(client: &reqwest::blocking::Client) -> VaultSource {
    let settings = client
        .get(api_url("/settings"))
        .send()
        .ok()
        .and_then(|r| r.json::<Settings>().ok())
        .unwrap_or(Settings {
            vault_path: None,
            vault_root_path: None,
            vault_source_type: None,
            vault_source_label: None,
            sync_status: None,
            last_sync_check_at: None,
            ingestion_provider: None,
            claude_ingestion_model: None,
            claude_embedding_model: None,
        });
    let root = settings
        .vault_root_path
        .or(settings.vault_path)
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_default();
    let source_type = settings
        .vault_source_type
        .unwrap_or_else(|| "manual".into());
    let label = settings
        .vault_source_label
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| source_type.clone());
    let ingestion_provider = settings
        .ingestion_provider
        .filter(|provider| provider == "claude-code")
        .unwrap_or_else(|| "openrouter".into());
    let claude_ingestion_model = settings
        .claude_ingestion_model
        .filter(|model| matches!(model.as_str(), "default" | "sonnet" | "opus" | "fable"))
        .unwrap_or_else(|| "default".into());
    let claude_embedding_model = settings
        .claude_embedding_model
        .filter(|model| {
            matches!(
                model.as_str(),
                "multilingual-e5-small" | "multilingual-e5-base"
            )
        })
        .unwrap_or_else(|| "multilingual-e5-small".into());
    VaultSource {
        root,
        source_type,
        label,
        ingestion_provider,
        claude_ingestion_model,
        claude_embedding_model,
    }
}

fn external_companion_status(client: &reqwest::blocking::Client) -> Option<String> {
    let settings = client
        .get(api_url("/settings"))
        .send()
        .ok()?
        .json::<Settings>()
        .ok()?;
    let text = settings.sync_status?;
    let is_reindex_status = text.starts_with("⟳ Reindexing")
        || text.starts_with("✓ Watching ·")
        || text.starts_with("⚠️ Reindex");
    if !is_reindex_status {
        return None;
    }
    let updated_at =
        chrono::DateTime::parse_from_rfc3339(settings.last_sync_check_at?.as_str()).ok()?;
    let age = chrono::Utc::now().signed_duration_since(updated_at.with_timezone(&chrono::Utc));
    (age.num_seconds() <= 60).then_some(text)
}

fn vault_exists(vault: &Path) -> bool {
    vault.is_dir()
}

/// True when the backend graph has no episodes yet (fresh install).
/// All candidate notes currently in the vault.
fn collect_notes(vault: &Path) -> Vec<PathBuf> {
    walkdir::WalkDir::new(vault)
        .into_iter()
        .filter_map(Result::ok)
        .map(walkdir::DirEntry::into_path)
        .filter(|p| is_candidate(p))
        .collect()
}

fn should_run_full_index(force_reindex: bool, remote_is_empty: bool) -> bool {
    force_reindex || remote_is_empty
}

fn queue_pending_change(
    pending: &mut HashMap<PathBuf, PendingChange>,
    path: PathBuf,
    kind: PendingChangeKind,
    changed_at: Instant,
) {
    pending.insert(
        path,
        PendingChange {
            kind,
            sync_after: changed_at + NOTE_IDLE_DELAY,
        },
    );
}

fn take_due_changes(
    pending: &mut HashMap<PathBuf, PendingChange>,
    now: Instant,
) -> (Vec<PathBuf>, Vec<PathBuf>) {
    let due = pending
        .iter()
        .filter(|(_, change)| change.sync_after <= now)
        .map(|(path, _)| path.clone())
        .collect::<Vec<_>>();
    let mut changed = Vec::new();
    let mut removed = Vec::new();
    for path in due {
        let Some(change) = pending.remove(&path) else {
            continue;
        };
        match change.kind {
            PendingChangeKind::Upsert => changed.push(path),
            PendingChangeKind::Delete => removed.push(path),
        }
    }
    (changed, removed)
}

pub fn analyze_vault(vault: &Path) -> Result<VaultAnalysis, String> {
    if !vault.is_dir() {
        return Err("The selected vault folder is unavailable".into());
    }
    let notes = collect_notes(vault);
    let mut analysis = VaultAnalysis {
        note_count: notes.len(),
        indexable_note_count: 0,
        total_bytes: 0,
        total_characters: 0,
        estimated_source_tokens: 0,
        unreadable_notes: 0,
    };
    for path in notes {
        match std::fs::read_to_string(&path) {
            Ok(raw) => {
                if raw.trim().is_empty() {
                    continue;
                }
                analysis.indexable_note_count += 1;
                analysis.total_bytes = analysis.total_bytes.saturating_add(raw.len() as u64);
                analysis.total_characters = analysis
                    .total_characters
                    .saturating_add(raw.chars().count() as u64);
            }
            Err(_) => analysis.unreadable_notes += 1,
        }
    }
    analysis.estimated_source_tokens = analysis
        .total_characters
        .max(analysis.total_bytes)
        .saturating_add(3)
        / 4;
    Ok(analysis)
}

fn collect_local_manifest(vault: &Path) -> (Vec<LocalManifestEntry>, Vec<PathBuf>) {
    let mut entries = Vec::new();
    let mut unreadable = Vec::new();
    for path in collect_notes(vault) {
        let raw = match std::fs::read_to_string(&path) {
            Ok(raw) => raw,
            Err(_) => {
                unreadable.push(path);
                continue;
            }
        };
        if raw.trim().is_empty() {
            continue;
        }
        let size = std::fs::metadata(&path)
            .map(|m| m.len())
            .unwrap_or_default();
        entries.push(LocalManifestEntry {
            rel_path: rel_path(&path, vault),
            content_hash: content_hash(&raw),
            size,
            mtime_secs: mtime_secs(&path),
            abs_path: path,
        });
    }
    (entries, unreadable)
}

fn fetch_remote_manifest(client: &reqwest::blocking::Client) -> Option<HashMap<String, String>> {
    let response = match client.get(api_url("/vault/manifest")).send() {
        Ok(response) if response.status().is_success() => response,
        Ok(response) => {
            log_error!("remote manifest request rejected: {}", response.status());
            return None;
        }
        Err(error) => {
            log_error!("remote manifest transport error: {error}");
            return None;
        }
    };
    let manifest = match response.json::<RemoteManifest>() {
        Ok(manifest) => manifest,
        Err(error) => {
            log_error!("remote manifest response is invalid: {error}");
            return None;
        }
    };
    Some(
        manifest
            .items
            .into_iter()
            .filter(|item| !item.path.trim().is_empty())
            .map(|item| (item.path, item.content_hash))
            .collect(),
    )
}

fn fetch_remote_manifest_with_retry(
    client: &reqwest::blocking::Client,
) -> Option<HashMap<String, String>> {
    for attempt in 0..MANIFEST_FETCH_ATTEMPTS {
        if let Some(manifest) = fetch_remote_manifest(client) {
            return Some(manifest);
        }
        if attempt + 1 < MANIFEST_FETCH_ATTEMPTS {
            std::thread::sleep(Duration::from_secs((attempt + 1) as u64));
        }
    }
    None
}

fn patch_sync_status(client: &reqwest::blocking::Client, status: &str) {
    let now = chrono::Utc::now().to_rfc3339();
    let payload = SyncStatusPatch {
        sync_status: status,
        last_sync_check_at: now,
    };
    let _ = client.patch(api_url("/settings")).json(&payload).send();
}

fn pause_sync(
    app: &AppHandle,
    status: &MenuItem<Wry>,
    client: &reqwest::blocking::Client,
    reason: SyncPauseReason,
) {
    let (stored_status, display_status) = match reason {
        SyncPauseReason::ProviderBilling => (
            "paused_openrouter_credits",
            OPENROUTER_CREDITS_PAUSED_STATUS,
        ),
        SyncPauseReason::ConnectionUnavailable => {
            ("paused_connection_unavailable", CONNECTION_PAUSED_STATUS)
        }
        SyncPauseReason::ClaudeUnavailable => (
            "paused_claude_unavailable",
            "⏸ Sync paused · Check Claude Code",
        ),
    };
    patch_sync_status(client, stored_status);
    set_status(app, status, display_status.into());
}

/// First-run indexing of the whole vault, with live tray progress. Parallel so
/// it's minutes, not hours (each note triggers a slow extraction server-side).
fn initial_sync(
    app: &AppHandle,
    status: &MenuItem<Wry>,
    vault: &Path,
    client: &reqwest::blocking::Client,
    cancelled: &Arc<AtomicBool>,
    ingestion: (&str, &str, &str),
    access_token: &str,
) -> bool {
    let notes = collect_notes(vault);
    let total = notes.len();
    if total == 0 {
        return false;
    }
    set_status(app, status, format!("⟳ Initial indexing 0/{total}…"));

    let queue = Arc::new(Mutex::new(VecDeque::from(notes)));
    let done = Arc::new(AtomicUsize::new(0));
    let pause_reason = Arc::new(Mutex::new(None));
    let mut workers = Vec::new();
    for _ in 0..SYNC_WORKERS {
        let (queue, done, pause_reason, cancelled, client) = (
            queue.clone(),
            done.clone(),
            pause_reason.clone(),
            cancelled.clone(),
            client.clone(),
        );
        let vault = vault.to_path_buf();
        let ingestion_provider = ingestion.0.to_string();
        let claude_ingestion_model = ingestion.1.to_string();
        let claude_embedding_model = ingestion.2.to_string();
        let access_token = access_token.to_string();
        let (app, status) = (app.clone(), status.clone());
        workers.push(std::thread::spawn(move || loop {
            if cancelled.load(Ordering::Acquire) || pause_reason.lock().unwrap().is_some() {
                break;
            }
            let next = queue.lock().unwrap().pop_front();
            let Some(path) = next else { break };
            match push_note(
                &path,
                &vault,
                &client,
                &cancelled,
                (
                    &ingestion_provider,
                    &claude_ingestion_model,
                    &claude_embedding_model,
                ),
                &access_token,
            ) {
                NoteSyncResult::Paused(reason) => {
                    *pause_reason.lock().unwrap() = Some(reason);
                    break;
                }
                NoteSyncResult::Cancelled => break,
                NoteSyncResult::Synced | NoteSyncResult::Failed => {}
            }
            if cancelled.load(Ordering::Acquire) {
                break;
            }
            let n = done.fetch_add(1, Ordering::SeqCst) + 1;
            set_status(&app, &status, format!("⟳ Initial indexing {n}/{total}…"));
        }));
    }
    for w in workers {
        let _ = w.join();
    }
    if cancelled.load(Ordering::Acquire) {
        return true;
    }
    let reason = *pause_reason.lock().unwrap();
    if let Some(reason) = reason {
        pause_sync(app, status, client, reason);
        true
    } else {
        log_info!("[watcher] initial sync done: {total} notes");
        false
    }
}

fn reconcile_vault(
    app: &AppHandle,
    status: &MenuItem<Wry>,
    vault: &Path,
    client: &reqwest::blocking::Client,
    cancelled: &Arc<AtomicBool>,
    ingestion: (&str, &str, &str),
    access_token: &str,
) -> ReconcileResult {
    if cancelled.load(Ordering::Acquire) {
        return ReconcileResult::Paused;
    }
    set_status(app, status, "⟳ Checking vault…".into());
    let Some(remote) = fetch_remote_manifest_with_retry(client) else {
        set_status(app, status, "⚠️ Error syncing vault".into());
        patch_sync_status(client, "manifest_unavailable");
        log_error!(
            "[watcher] cannot fetch remote vault manifest after {MANIFEST_FETCH_ATTEMPTS} attempts"
        );
        return ReconcileResult::Retry;
    };

    let (local_entries, unreadable) = collect_local_manifest(vault);
    let local_by_path: HashMap<String, LocalManifestEntry> = local_entries
        .into_iter()
        .map(|entry| (entry.rel_path.clone(), entry))
        .collect();

    let mut upserts = Vec::new();
    for (path, entry) in &local_by_path {
        match remote.get(path) {
            Some(remote_hash) if remote_hash == &entry.content_hash => {}
            _ => upserts.push(entry.clone()),
        }
    }

    let mut deletes = Vec::new();
    if unreadable.is_empty() {
        for path in remote.keys() {
            if !local_by_path.contains_key(path) {
                deletes.push(path.clone());
            }
        }
    } else {
        log_error!(
            "[watcher] {} files unreadable during reconcile; remote deletes skipped",
            unreadable.len()
        );
    }

    let total = upserts.len() + deletes.len();
    if total == 0 {
        let now = chrono::Local::now().format("%H:%M");
        let status_text = if unreadable.is_empty() {
            "synced"
        } else {
            "partial"
        };
        patch_sync_status(client, status_text);
        set_status(app, status, format!("✓ Up to date · {now}"));
        return ReconcileResult::Complete(unreadable.is_empty());
    }

    let queue = Arc::new(Mutex::new(VecDeque::from(upserts.clone())));
    let processed = Arc::new(AtomicUsize::new(0));
    let failed = Arc::new(AtomicUsize::new(0));
    let pause_reason = Arc::new(Mutex::new(None));
    let mut workers = Vec::new();
    for _ in 0..SYNC_WORKERS.min(upserts.len()) {
        let (queue, processed, failed, pause_reason, cancelled, client) = (
            queue.clone(),
            processed.clone(),
            failed.clone(),
            pause_reason.clone(),
            cancelled.clone(),
            client.clone(),
        );
        let vault = vault.to_path_buf();
        let ingestion_provider = ingestion.0.to_string();
        let claude_ingestion_model = ingestion.1.to_string();
        let claude_embedding_model = ingestion.2.to_string();
        let access_token = access_token.to_string();
        let (app, status) = (app.clone(), status.clone());
        workers.push(std::thread::spawn(move || loop {
            if cancelled.load(Ordering::Acquire) || pause_reason.lock().unwrap().is_some() {
                break;
            }
            let next = queue.lock().unwrap().pop_front();
            let Some(entry) = next else { break };
            log_info!(
                "[watcher] reconcile upsert {} ({} bytes, mtime {})",
                entry.rel_path,
                entry.size,
                entry.mtime_secs
            );
            match push_note(
                &entry.abs_path,
                &vault,
                &client,
                &cancelled,
                (
                    &ingestion_provider,
                    &claude_ingestion_model,
                    &claude_embedding_model,
                ),
                &access_token,
            ) {
                NoteSyncResult::Synced => {}
                NoteSyncResult::Failed => {
                    failed.fetch_add(1, Ordering::SeqCst);
                }
                NoteSyncResult::Paused(reason) => {
                    *pause_reason.lock().unwrap() = Some(reason);
                    break;
                }
                NoteSyncResult::Cancelled => break,
            }
            if cancelled.load(Ordering::Acquire) {
                break;
            }
            let position = processed.fetch_add(1, Ordering::SeqCst) + 1;
            set_status(&app, &status, format!("⟳ Checking {position}/{total}…"));
        }));
    }
    for worker in workers {
        let _ = worker.join();
    }
    if cancelled.load(Ordering::Acquire) {
        return ReconcileResult::Paused;
    }
    let reason = *pause_reason.lock().unwrap();
    if let Some(reason) = reason {
        pause_sync(app, status, client, reason);
        return ReconcileResult::Paused;
    }
    let mut failed = failed.load(Ordering::SeqCst);
    for (i, path) in deletes.iter().enumerate() {
        if cancelled.load(Ordering::Acquire) {
            return ReconcileResult::Paused;
        }
        set_status(
            app,
            status,
            format!("⟳ Checking {}/{}…", upserts.len() + i + 1, total),
        );
        if !delete_note(&vault.join(path), vault, client) {
            failed += 1;
        }
        if cancelled.load(Ordering::Acquire) {
            return ReconcileResult::Paused;
        }
    }

    let now = chrono::Local::now().format("%H:%M");
    let status_text = if unreadable.is_empty() && failed == 0 {
        "synced"
    } else {
        "partial"
    };
    patch_sync_status(client, status_text);
    if failed == 0 && unreadable.is_empty() {
        set_status(app, status, format!("✓ Up to date · {now}"));
    } else {
        set_status(app, status, format!("⚠️ {failed} note(s) failed"));
    }
    log_info!(
        "[watcher] reconcile done: {} upsert(s), {} delete(s), {} unreadable",
        upserts.len(),
        deletes.len(),
        unreadable.len()
    );
    ReconcileResult::Complete(failed == 0 && unreadable.is_empty())
}

fn run_worker(
    app: AppHandle,
    status: MenuItem<Wry>,
    cancelled: Arc<AtomicBool>,
    session_token: Option<String>,
    force_reindex: bool,
) {
    let token = match session_token {
        Some(token) => token,
        None => {
            set_status(&app, &status, "⚠️ Connect your account".into());
            return;
        }
    };
    let mut headers = reqwest::header::HeaderMap::new();
    let authorization = match reqwest::header::HeaderValue::from_str(&format!("Bearer {token}")) {
        Ok(value) => value,
        Err(_) => {
            set_status(&app, &status, "⚠️ Invalid account session".into());
            return;
        }
    };
    headers.insert(reqwest::header::AUTHORIZATION, authorization);
    let base = api_url("");
    if base.contains(".zrok.io") || base.contains("shares.zrok") {
        headers.insert(
            reqwest::header::HeaderName::from_static("skip_zrok_interstitial"),
            reqwest::header::HeaderValue::from_static("true"),
        );
    }
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .default_headers(headers)
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            set_status(&app, &status, "⚠️ Connection error".into());
            log_error!("[watcher] cannot create authenticated client: {error}");
            return;
        }
    };
    let source = load_vault_source(&client);
    let vault = source.root;

    if vault.as_os_str().is_empty() {
        set_status(&app, &status, "⚠️ Complete setup".into());
        return;
    }
    if !vault_exists(&vault) {
        set_status(&app, &status, "⚠️ Vault not found".into());
        patch_sync_status(&client, "missing");
        log_error!(
            "[watcher] cannot watch vault {}: not a directory",
            vault.display()
        );
        return;
    }
    log_info!(
        "[watcher] source {} ({}) at {}",
        source.source_type,
        source.label,
        vault.display()
    );

    // First install, or a model/pipeline change: index the whole vault before
    // watching for changes. The memory service's pipeline signature keeps this
    // idempotent while forcing extraction with the newly selected models.
    let remote_is_empty =
        fetch_remote_manifest(&client).is_some_and(|manifest| manifest.is_empty());
    if should_run_full_index(force_reindex, remote_is_empty)
        && initial_sync(
            &app,
            &status,
            &vault,
            &client,
            &cancelled,
            (
                &source.ingestion_provider,
                &source.claude_ingestion_model,
                &source.claude_embedding_model,
            ),
            &token,
        )
    {
        return;
    }
    let initial_reconcile = reconcile_vault(
        &app,
        &status,
        &vault,
        &client,
        &cancelled,
        (
            &source.ingestion_provider,
            &source.claude_ingestion_model,
            &source.claude_embedding_model,
        ),
        &token,
    );
    let initial_reconcile_ok = match initial_reconcile {
        ReconcileResult::Complete(ok) => ok,
        ReconcileResult::Retry => false,
        ReconcileResult::Paused => return,
    };
    let mut next_reconcile = Instant::now()
        + if matches!(initial_reconcile, ReconcileResult::Retry) {
            MANIFEST_RETRY_DELAY
        } else {
            RECONCILE_INTERVAL
        };
    let mut next_external_status_poll = Instant::now();
    let mut external_status_active = false;
    let mut pending_changes = HashMap::<PathBuf, PendingChange>::new();

    let (tx, rx) = mpsc::channel();
    let mut debouncer = match new_debouncer(Duration::from_secs(2), None, tx) {
        Ok(d) => d,
        Err(e) => {
            set_status(&app, &status, "⚠️ Watcher error".into());
            log_error!("[watcher] cannot start debouncer: {e}");
            return;
        }
    };
    if let Err(e) = debouncer.watch(&vault, RecursiveMode::Recursive) {
        set_status(&app, &status, "⚠️ Vault not found".into());
        log_error!("[watcher] cannot watch vault {}: {e}", vault.display());
        return;
    }
    log_info!("[watcher] watching {}", vault.display());
    if initial_reconcile_ok {
        set_status(&app, &status, "✓ Watching".into());
    }

    loop {
        if cancelled.load(Ordering::Acquire) {
            break;
        }
        if Instant::now() >= next_reconcile && pending_changes.is_empty() {
            let reconcile_result = reconcile_vault(
                &app,
                &status,
                &vault,
                &client,
                &cancelled,
                (
                    &source.ingestion_provider,
                    &source.claude_ingestion_model,
                    &source.claude_embedding_model,
                ),
                &token,
            );
            if matches!(reconcile_result, ReconcileResult::Paused) {
                return;
            }
            next_reconcile = Instant::now()
                + if matches!(reconcile_result, ReconcileResult::Retry) {
                    MANIFEST_RETRY_DELAY
                } else {
                    RECONCILE_INTERVAL
                };
        }
        if Instant::now() >= next_external_status_poll {
            if let Some(external) = external_companion_status(&client) {
                set_status(&app, &status, external);
                external_status_active = true;
            } else if external_status_active {
                set_status(&app, &status, "✓ Watching".into());
                external_status_active = false;
            }
            next_external_status_poll = Instant::now() + Duration::from_secs(1);
        }

        let (changed, removed) = take_due_changes(&mut pending_changes, Instant::now());
        if !changed.is_empty() || !removed.is_empty() {
            // Upserts before deletes preserve content-hash identity across moves.
            let total = changed.len();
            let mut sync_ok = true;
            for (i, path) in changed.iter().enumerate() {
                if cancelled.load(Ordering::Acquire) {
                    return;
                }
                set_status(&app, &status, format!("⟳ Sync {}/{}…", i + 1, total));
                match push_note(
                    path,
                    &vault,
                    &client,
                    &cancelled,
                    (
                        &source.ingestion_provider,
                        &source.claude_ingestion_model,
                        &source.claude_embedding_model,
                    ),
                    &token,
                ) {
                    NoteSyncResult::Synced => {}
                    NoteSyncResult::Failed => sync_ok = false,
                    NoteSyncResult::Paused(reason) => {
                        pause_sync(&app, &status, &client, reason);
                        return;
                    }
                    NoteSyncResult::Cancelled => return,
                }
            }
            for path in &removed {
                if cancelled.load(Ordering::Acquire) {
                    return;
                }
                set_status(&app, &status, "⟳ Deleting…".into());
                if !delete_note(path, &vault, &client) {
                    sync_ok = false;
                }
            }
            if cancelled.load(Ordering::Acquire) {
                return;
            }
            if !sync_ok {
                set_status(&app, &status, "⚠️ Sync failed".into());
            } else if pending_changes.is_empty() {
                let now = chrono::Local::now().format("%H:%M");
                set_status(&app, &status, format!("✓ Up to date · {now}"));
            } else {
                set_status(
                    &app,
                    &status,
                    format!("⏳ Waiting for edits · {} note(s)", pending_changes.len()),
                );
            }
        }

        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(result) => {
                let Ok(events) = result else { continue };
                let changed_at = Instant::now();
                for event in events {
                    let kind = match event.kind {
                        EventKind::Create(_) | EventKind::Modify(_) => PendingChangeKind::Upsert,
                        EventKind::Remove(_) => PendingChangeKind::Delete,
                        _ => continue,
                    };
                    for p in &event.paths {
                        if is_candidate(p) {
                            queue_pending_change(&mut pending_changes, p.clone(), kind, changed_at);
                        }
                    }
                }
                if !pending_changes.is_empty() {
                    set_status(
                        &app,
                        &status,
                        format!("⏳ Waiting for edits · {} note(s)", pending_changes.len()),
                    );
                }
            }
            Err(RecvTimeoutError::Timeout) => continue,
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn start_worker(
    app: AppHandle,
    status: MenuItem<Wry>,
    session_token: Option<String>,
    force_reindex: bool,
) -> (Arc<AtomicBool>, JoinHandle<()>) {
    let cancelled = Arc::new(AtomicBool::new(false));
    let worker_cancelled = cancelled.clone();
    let handle = std::thread::spawn(move || {
        run_worker(app, status, worker_cancelled, session_token, force_reindex)
    });
    (cancelled, handle)
}

/// Spawn the vault watcher. `status` is the tray menu item it keeps up to date.
pub fn start(app: AppHandle, status: MenuItem<Wry>, command_rx: Receiver<WatcherCommand>) {
    std::thread::spawn(move || {
        let mut session_token = None;
        let mut worker_cancelled: Option<Arc<AtomicBool>> = None;
        let mut worker_handle: Option<JoinHandle<()>> = None;
        set_status(&app, &status, MANUAL_PAUSED_STATUS.into());

        while let Ok(command) = command_rx.recv() {
            if matches!(&command, WatcherCommand::Pause { .. }) {
                set_status(&app, &status, "⏸ Pausing after current notes…".into());
            }
            if let Some(cancelled) = worker_cancelled.take() {
                cancelled.store(true, Ordering::Release);
            }
            if let Some(handle) = worker_handle.take() {
                let _ = handle.join();
            }
            match command {
                WatcherCommand::Pause { clear_session } => {
                    if clear_session {
                        session_token = None;
                    }
                    set_status(&app, &status, MANUAL_PAUSED_STATUS.into());
                }
                WatcherCommand::Start(restart) => {
                    if restart.clear_session {
                        session_token = None;
                    } else if restart.token.is_some() {
                        session_token = restart.token;
                    }
                    set_status(&app, &status, "⟳ Starting sync…".into());
                    let (cancelled, handle) = start_worker(
                        app.clone(),
                        status.clone(),
                        session_token.clone(),
                        restart.force_reindex,
                    );
                    worker_cancelled = Some(cancelled);
                    worker_handle = Some(handle);
                }
            }
        }

        if let Some(cancelled) = worker_cancelled.take() {
            cancelled.store(true, Ordering::Release);
        }
        if let Some(handle) = worker_handle.take() {
            let _ = handle.join();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        analyze_vault, is_claude_unavailable_error, is_provider_billing_error, job_pause_reason,
        queue_pending_change, should_run_full_index, take_due_changes, PendingChangeKind,
        SyncPauseReason, NOTE_IDLE_DELAY,
    };
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    #[test]
    fn full_index_runs_for_first_install_or_explicit_model_change() {
        assert!(should_run_full_index(false, true));
        assert!(should_run_full_index(true, false));
        assert!(!should_run_full_index(false, false));
    }

    #[test]
    fn vault_analysis_counts_only_indexable_markdown_content() {
        let root = std::env::temp_dir().join(format!(
            "sillage-vault-analysis-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        fs::create_dir_all(root.join("Notes")).unwrap();
        fs::create_dir_all(root.join(".obsidian")).unwrap();
        fs::write(root.join("Notes/one.md"), "12345678").unwrap();
        fs::write(root.join("empty.md"), "  \n").unwrap();
        fs::write(root.join("ignore.txt"), "not a note").unwrap();
        fs::write(root.join(".obsidian/private.md"), "ignored").unwrap();

        let result = analyze_vault(&root).unwrap();
        assert_eq!(result.note_count, 2);
        assert_eq!(result.indexable_note_count, 1);
        assert_eq!(result.total_characters, 8);
        assert_eq!(result.estimated_source_tokens, 2);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn provider_billing_errors_pause_sync_without_matching_generic_failures() {
        assert!(is_provider_billing_error(
            reqwest::StatusCode::PAYMENT_REQUIRED,
            "Internal Server Error"
        ));
        assert!(is_provider_billing_error(
            reqwest::StatusCode::BAD_GATEWAY,
            r#"{"detail":{"code":"provider_billing_required"}}"#
        ));
        assert!(!is_provider_billing_error(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"temporary failure"}"#
        ));
    }

    #[test]
    fn missing_claude_subscription_pauses_local_sync() {
        assert!(is_claude_unavailable_error(
            "Connect a Claude subscription before starting local extraction."
        ));
        assert!(!is_claude_unavailable_error("Artifact upload failed."));
    }

    #[test]
    fn ingestion_job_errors_keep_pause_semantics() {
        assert!(matches!(
            job_pause_reason(Some(&serde_json::json!({
                "code": "provider_billing_required"
            }))),
            Some(SyncPauseReason::ProviderBilling)
        ));
        assert!(matches!(
            job_pause_reason(Some(&serde_json::json!({
                "code": "memory_unavailable"
            }))),
            Some(SyncPauseReason::ConnectionUnavailable)
        ));
        assert!(matches!(
            job_pause_reason(Some(&serde_json::json!({
                "code": "note_ingestion_failed",
                "status": 500
            }))),
            Some(SyncPauseReason::ConnectionUnavailable)
        ));
        assert!(job_pause_reason(Some(&serde_json::json!({
            "code": "note_ingestion_failed",
            "status": 422
        })))
        .is_none());
    }

    #[test]
    fn note_changes_wait_for_five_quiet_minutes_and_reset_per_edit() {
        let started = Instant::now();
        let path = PathBuf::from("Ideas/Work in progress.md");
        let mut pending = HashMap::new();
        queue_pending_change(
            &mut pending,
            path.clone(),
            PendingChangeKind::Upsert,
            started,
        );
        queue_pending_change(
            &mut pending,
            path.clone(),
            PendingChangeKind::Delete,
            started + Duration::from_secs(60),
        );

        let (changed, removed) = take_due_changes(&mut pending, started + NOTE_IDLE_DELAY);
        assert!(changed.is_empty());
        assert!(removed.is_empty());

        let (changed, removed) = take_due_changes(
            &mut pending,
            started + Duration::from_secs(60) + NOTE_IDLE_DELAY,
        );
        assert!(changed.is_empty());
        assert_eq!(removed, vec![path]);
    }
}

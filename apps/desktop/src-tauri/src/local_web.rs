use reqwest::blocking::Client;
use serde::Serialize;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

const DEFAULT_PORT: u16 = 8787;

#[derive(Default)]
pub(crate) struct LocalWebControl {
    searxng: Mutex<Option<Child>>,
    child: Mutex<Option<Child>>,
    url: Mutex<Option<String>>,
}

#[derive(Serialize)]
pub(crate) struct LocalWebStatus {
    pub running: bool,
    pub url: Option<String>,
    pub error: Option<String>,
}

impl LocalWebControl {
    pub fn start(&self, resource_dir: Option<std::path::PathBuf>) -> LocalWebStatus {
        let port = std::env::var("SILLAGE_LOCAL_WEB_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(DEFAULT_PORT);
        let url = format!("http://127.0.0.1:{port}");
        if let Some(command_line) = std::env::var("SILLAGE_SEARXNG_COMMAND").ok() {
            let mut parts = command_line.split_whitespace();
            if let Some(program) = parts.next() {
                let mut command = Command::new(program);
                command.args(parts).env("SEARXNG_PORT", "8080").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
                match command.spawn() {
                    Ok(child) => *self.searxng.lock().expect("SearXNG mutex poisoned") = Some(child),
                    Err(error) => return LocalWebStatus { running: false, url: None, error: Some(format!("unable to start SearXNG: {error}")) },
                }
            }
        }
        let command_line = std::env::var("SILLAGE_WEB_SIDECAR_COMMAND").ok().or_else(|| {
            resource_dir.map(|dir| dir.join("local-web-sidecar").to_string_lossy().into_owned())
        });
        let Some(command_line) = command_line else {
            return LocalWebStatus { running: false, url: None, error: Some("local web sidecar is not packaged".into()) };
        };

        let mut parts = command_line.split_whitespace();
        let Some(program) = parts.next() else {
            return LocalWebStatus { running: false, url: None, error: Some("empty local web sidecar command".into()) };
        };
        let mut command = Command::new(program);
        command.args(parts)
            .env("SILLAGE_SEARXNG_URL", std::env::var("SILLAGE_SEARXNG_URL").unwrap_or_else(|_| "http://127.0.0.1:8080".into()))
            .env("SILLAGE_LOCAL_WEB_PORT", port.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = match command.spawn() {
            Ok(child) => child,
            Err(error) => return LocalWebStatus { running: false, url: None, error: Some(format!("unable to start local web sidecar: {error}")) },
        };
        *self.child.lock().expect("local web child mutex poisoned") = Some(child);
        *self.url.lock().expect("local web URL mutex poisoned") = Some(url.clone());

        let client = Client::builder().timeout(Duration::from_secs(2)).build().ok();
        let healthy = client.is_some_and(|client| {
            (0..10).any(|_| client.get(format!("{url}/health")).send().is_ok())
        });
        if !healthy {
            self.stop();
            return LocalWebStatus { running: false, url: None, error: Some("local web sidecar did not become healthy".into()) };
        }
        LocalWebStatus { running: true, url: Some(url), error: None }
    }

    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().expect("local web child mutex poisoned").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Some(mut child) = self.searxng.lock().expect("SearXNG mutex poisoned").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
        self.url.lock().expect("local web URL mutex poisoned").take();
    }

    pub fn status(&self) -> LocalWebStatus {
        let url = self.url.lock().expect("local web URL mutex poisoned").clone();
        LocalWebStatus { running: url.is_some(), url, error: None }
    }
}

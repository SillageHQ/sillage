# Sillage desktop

The Sillage desktop application uses Tauri, React, TypeScript, Vite, and Lingui.
Follow the [repository setup guide](../../README.md) to configure the backend,
environment variables, and desktop development tools. Run `pnpm desktop:dev`
from the repository root after starting the backend services.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Local web runtime

The desktop starts and stops the local web sidecar with the Tauri process. In
development, configure the commands before launching the app:

```sh
export SILLAGE_SEARXNG_COMMAND="/path/to/searxng --host 127.0.0.1 --port 8080"
export SILLAGE_WEB_SIDECAR_COMMAND="uv run uvicorn local_web_sidecar:app --host 127.0.0.1 --port 8787"
```

In packaged builds, `SILLAGE_WEB_SIDECAR_COMMAND` is replaced by the bundled
`local-web-sidecar` executable. Both processes are bound to loopback and are
terminated when the desktop exits.

# Sillage release registry

The server API stores desktop release metadata in PostgreSQL while Cloudflare R2 serves the public binaries from `releases.sillagehq.app`.

## Server environment

- `RELEASE_REGISTRY_TOKEN`: bearer token accepted by the private publishing endpoint
- `R2_PUBLIC_BASE_URL`: public bucket domain, currently `https://releases.sillagehq.app`

## GitHub Actions secrets

Configure the following repository secrets:

- `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- `RELEASE_REGISTRY_URL`, `RELEASE_REGISTRY_TOKEN`
- `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`

`RELEASE_REGISTRY_TOKEN` must have the same value on the server and in GitHub Actions.

## API

`POST /v1/app-releases/artifacts` is private and idempotently registers one built artifact. The workflow calls it after a successful R2 upload.

`GET /v1/app-releases/latest?platform=darwin&arch=universal&channel=beta` returns the newest compatible version, SHA-256 checksums, and permanent public R2 download URLs.

`GET /v1/app-releases` returns every published release and all of its artifacts, newest first. Pass `?channel=beta` or `?channel=stable` to filter the catalogue.

Both public read endpoints use a five-minute in-process cache and emit CDN-friendly `Cache-Control` headers (`s-maxage=300`, `stale-while-revalidate=86400`). Publishing an artifact clears the in-process cache immediately.

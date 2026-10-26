# Sillage

Sillage adds contextual memory to an Obsidian vault. It combines a Tauri/React
desktop application, a TypeScript API, and a Python memory service backed by
PostgreSQL/pgvector and FalkorDB.

Self-hosting is free. The hosted Sillage Cloud service is a paid alternative for
users who prefer not to operate the backend. Self-hosting still requires your
own model-provider credentials or supported local tooling; provider usage may
incur separate charges.

## Development setup

Prerequisites: Node.js 24, pnpm 11.10.0, Python 3.12 with `uv`, Docker Compose,
and Rust with the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/).
The desktop application requires a graphical desktop environment.

From a fresh clone:

```sh
pnpm install --frozen-lockfile
cd services/memory
uv sync --locked
cd ../..
cp config/example.env .env
```

Edit `.env`: generate independent random passwords and tokens for PostgreSQL,
FalkorDB, Better Auth, and the memory-service boundary. Keep the local URLs for
development. Configure an email provider for magic-link login, and Google OAuth
if you want Google login. The example file documents optional integrations.
Use `REQUIRE_BILLING_ACCESS=false` for a self-hosted instance without paid billing.

Copy the configured environment to the service working directories:

```sh
cp .env services/api/.env
cp .env services/memory/.env
cp .env apps/desktop/.env
pnpm docker:up
pnpm dev
```

The API development command initializes the database schema. Use this setup
against a dedicated development database. The API listens on port 3001, the
memory service on 8000, and the desktop frontend on 1420. PostgreSQL, FalkorDB,
and SearXNG bind to loopback. Authentication and external integrations need
their own credentials; placeholders are not usable credentials.

For the optional website, copy the same configured environment to
`apps/landing/.env` and run `pnpm landing:dev` in another terminal.

The tracked Compose configuration creates its own database volumes. Local
machine overrides belong in `compose.override.yml`, which is ignored by Git.
Never put personal vault data or credentials in tracked files.

## Checks

```sh
pnpm --filter @sb/desktop exec tsc --noEmit
pnpm --filter @sb/desktop test
VITE_API_URL=http://localhost:3001 pnpm --filter @sb/desktop build
pnpm --filter @sb/api test
pnpm landing:build
```

API integration tests additionally require configured services and a dedicated
test database. See [the evaluation documentation](services/memory/evaluation/README.md)
for retrieval evaluation and synthetic datasets.

## Deployment and security

See [COOLIFY.md](COOLIFY.md) for the container deployment path and
[SECURITY_AUDIT.md](SECURITY_AUDIT.md) for deployment security requirements.
Production needs configured authentication, independent secrets, trusted TLS
certificates, backups, and a private database/service network.

Release workflows depend on the repository owner's signing, storage, and
deployment credentials. Forks must configure their own infrastructure before
using them. `.env` files, local Compose overrides, build outputs, and private
evaluation artifacts must remain untracked.

## Repository layout

- `apps/desktop`: Tauri, React, TypeScript, and Lingui desktop application.
- `apps/landing`: website and account interface.
- `services/api`: TypeScript API, authentication, billing, and Prisma schema.
- `services/memory`: Python ingestion and retrieval service.
- `config/example.env`: documented environment-variable template.

## License

Sillage's original code is licensed under the [Elastic License 2.0](LICENSE)
(`Elastic-2.0`). You can use, modify, and self-host it for free, including for
internal business use. You may not provide it to third parties as a hosted or
managed service that exposes a substantial set of its features without a
separate agreement with the rights holders. Contact hello@sillagehq.app for
hosted-service licensing.

This is source-available software. Sillage Cloud is the paid hosted offering.
The license also prohibits circumventing license-key functionality and removing
licensing notices; consult the full text for all terms.

Third-party dependencies retain their own licenses. Provider names and logos
belong to their respective owners and are not relicensed by this repository.

# Multi-tenant architecture

## Decision

Sillage runs one FalkorDB instance and assigns one named graph to each workspace. A workspace UUID such as `f81d4fae-...` maps to `workspace_f81d4fae_...`. This is a database-level logical boundary: users do not get separate FalkorDB containers, processes, ports, or credentials.

PostgreSQL remains the source of truth for accounts, memberships, settings, conversations, documents, chunks, jobs, and review state. Every user-owned row has a required `tenantId`. Row-Level Security is enabled and forced with a default-deny policy. Application queries run inside transactions that set `app.tenant_id`; access without an authenticated tenant fails.

## Account lifecycle

1. The website and Tauri both use the same Better Auth instance mounted by Hono at `/api/auth/*`.
2. Better Auth stores users, accounts, verifications, and sessions in PostgreSQL.
3. Its user creation hook idempotently creates the personal `Workspace`, an owner `Membership`, and default `Settings`.
4. Visiting `/account` calls `POST /v1/account/bootstrap`, which repeats provisioning safely if a previous hook was interrupted.
5. Browser requests use a secure session cookie. Tauri captures the signed Better Auth bearer returned after direct sign-in and stores it in the operating-system keychain for React and the Rust watcher.
6. Every verified Better Auth user ID is resolved to a membership server-side; a client-supplied tenant identifier is never trusted.
7. Google OAuth opens the system browser, as required for installed desktop apps. The one-use web pairing code remains available as the secure bridge back to Tauri.

Password authentication is disabled. Account creation and email authentication use one-time magic links. Configure Google OAuth credentials and the callback `${BETTER_AUTH_URL}/api/auth/callback/google`. Magic links require `CLOUDFLARE_ACCOUNT_ID`, a `CLOUDFLARE_EMAIL_API_TOKEN` with Email Sending permission, and a verified `AUTH_EMAIL_FROM` sender. Passkeys use WebAuthn on the website domain; configure `BETTER_AUTH_PASSKEY_RP_ID` and `BETTER_AUTH_PASSKEY_ORIGINS`. Tauri opens that website flow and then uses the one-time pairing code, because WebAuthn credentials are scoped to their relying-party domain.

## Deployment

Copy `config/example.env` to an ignored environment file and replace every placeholder. Never expose PostgreSQL or FalkorDB publicly. The development Compose file binds both databases to `127.0.0.1`; in production, remove their host port mappings and place API, memory, PostgreSQL, and FalkorDB on a private network.

FalkorDB is a single service with persistent storage. `compose.yml` enables AOF persistence and password authentication. Scaling does not create an instance per user; it creates additional named graphs inside the same service. Backups remain instance-wide, while account export and deletion operate on the selected workspace graph and PostgreSQL rows.

Run the schema setup with:

```sh
pnpm db:push
```

This applies pgvector indexes and forced RLS policies after Prisma synchronizes the schema. Existing pre-multitenant development data must be exported or assigned to a workspace before applying the required `tenantId` columns.

The API's tenant transaction wrapper switches to the non-login `sillage_app` PostgreSQL role before setting `app.tenant_id`. This matters in development because the official image's bootstrap account is a superuser and would otherwise bypass RLS.

## Lemon Squeezy readiness

Billing should attach to `Workspace`, not directly to `User`, so teams and personal accounts share one entitlement model. Add subscription/customer identifiers and webhook event idempotency when payments are implemented; do not grant access based on client-provided checkout state.

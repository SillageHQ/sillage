# Multi-tenant security audit

Date: 2026-07-20

## Result

The server data path is default-deny and suitable for beta after deployment secrets, Google OAuth, and transactional email are configured.

- Identity: API requests accept verified Better Auth cookies, signed Better Auth bearer sessions, legacy one-use desktop bridge sessions, or the dedicated service-to-service secret. Workspace identity is resolved server-side.
- PostgreSQL: every user table has a required `tenantId`; forced RLS runs as the restricted `sillage_app` role. A live A/B test proves isolation for reads, updates, and deletes.
- Vector search: tenant filtering happens inside the candidate query before distance ordering. Document and chunk primary keys are tenant-composite.
- Graph: one FalkorDB named graph is selected from authenticated request context for every Graphiti and direct Cypher operation. Graphiti group IDs and graph entities are tenant-stamped. A live A/B graph test proves that identical query shapes cannot see the other graph.
- Service boundary: the memory service rejects requests without both its internal bearer secret and a tenant header supplied by the API. Browser clients cannot call it directly.
- Network: database ports bind only to loopback in development; production guidance requires a private network. CORS uses an explicit allowlist.
- Lifecycle: account deletion removes the tenant graph before cascading PostgreSQL data. Account export is tenant-scoped.
- Desktop: pairing codes are hashed, expire after ten minutes, and are atomically single-use. Desktop tokens are random, hashed at rest, expire after 90 days, and are stored in the OS keychain.

## Deployment gates

- Replace every placeholder in `config/example.env` with independently generated secrets.
- Generate a strong `BETTER_AUTH_SECRET`, configure exact trusted origins, Google OAuth, and the Cloudflare Email Service sender.
- Put rate limiting in front of `/v1/desktop-authorizations`, `/v1/desktop-authorizations/exchange`, and `/api/auth/*`.
- Run `pnpm db:push`, the API integration test, and the memory test suite against the production-like environment.
- Obtain an independent penetration test before handling sensitive production data; this repository audit is not a substitute for an external review.

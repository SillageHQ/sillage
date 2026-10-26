# Coolify deployment

The Docker workflow publishes changed images to GHCR. On `main`, images receive
the `main` and commit SHA tags; manually dispatched builds on another branch use
that branch name and its commit SHA:

- `ghcr.io/sillagehq/sillage-api:main`
- `ghcr.io/sillagehq/sillage-memory:main`
- `ghcr.io/sillagehq/sillage-landing:main`

It only builds a service when files relevant to that service changed. The existing desktop release workflow remains separate and runs from `v*` tags or manually.

## First-time Coolify setup

1. Make the three GHCR packages public, or add a read-only GHCR registry credential in Coolify using a GitHub token with `read:packages`.
2. Create a Coolify Docker Compose application from `compose.coolify.yml`.
3. Add the production environment variables from `config/example.env` to the Coolify application. Keep database and signing secrets in Coolify, never in Git.
4. Set `BETTER_AUTH_URL`, `SITE_URL`, `APP_API_URL`, `CORS_ALLOWED_ORIGINS`, `BETTER_AUTH_TRUSTED_ORIGINS`, `BETTER_AUTH_PASSKEY_RP_ID`, and `BETTER_AUTH_PASSKEY_ORIGINS` to the public production domains.
5. Configure domains for ports `3000` (landing) and `3001` (API). Do not expose Postgres or FalkorDB publicly.
6. Run the API database bootstrap once after the first deployment if the database is empty, and repeat it after a Prisma schema change:

   `docker compose -f compose.coolify.yml exec api pnpm db:push`

## Automatic deployment through Tailscale

Pushes to `main` publish images only. To redeploy, manually dispatch this workflow
from `main`, select the service, and enable the `deploy` option. Set the repository
Actions variable `DEPLOYMENTS_ENABLED=true` only after configuring image names and
resources.

GitHub Actions joins the private Tailscale network, then calls Coolify's authenticated deploy endpoint. The workflow does not expose the Coolify endpoint publicly.

Configure these GitHub secrets and variables. The Tailscale secrets can be organization secrets, provided the `SillageHQ/sillage` repository is allowed by the organization secret policy:

- Secret `TS_OAUTH_CLIENT_ID` (organization secret)
- Secret `TS_OAUTH_SECRET` (organization secret)
- Secret `COOLIFY_TOKEN` (Coolify API token)
- Variable `COOLIFY_DEPLOY_URL_TEMPLATE`, for example `http://<coolify-private-host>:8000/api/v1/deploy?uuid=UUID`
- Variable `COOLIFY_SILLAGE_RESOURCE_UUIDS`, preferably containing service-to-resource mappings such as `api=UUID,memory=UUID,landing=UUID`. The legacy positional format `api-uuid,memory-uuid,landing-uuid` remains supported.

The URL template must contain the literal `UUID`; the workflow replaces it for each rebuilt resource after connecting to Tailscale. The API is called directly over Coolify's internal port `8000`, through Tailscale. Only services whose images were published in the current workflow run are redeployed. If no relevant service changed, the image publish job is skipped and Coolify is not redeployed.

The desktop release registry and R2 endpoint must use valid TLS certificates trusted by the GitHub runners. Configure a trusted certificate for the registry hostname; do not disable certificate verification to accommodate a private certificate.

For the landing image, configure these GitHub repository build-time values: `VITE_API_URL`, `VITE_SITE_URL`, `VITE_GOOGLE_CLIENT_ID`, and `VITE_TURNSTILE_SITE_KEY` as Actions variables, plus `VITE_GOOGLE_ANALYTICS_ID`, `VITE_POSTHOG_KEY`, and `VITE_POSTHOG_HOST` as Actions secrets. Configure the same `WAITLIST_INTERNAL_TOKEN` value in the API and landing Coolify environments; it is the server-to-server credential used to reserve the first 20 beta places.

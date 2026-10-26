#!/usr/bin/env bash
# Interactive vault smoke judge — run from anywhere.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Load local secrets if present
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [[ -f ../api/.env ]]; then
  # MEMORY_INTERNAL_TOKEN often only in api .env
  set -a
  # shellcheck disable=SC1091
  source ../api/.env
  set +a
fi

export APP_API_URL="${APP_API_URL:-http://127.0.0.1:3001}"
export EMBEDDING_DIM="${EMBEDDING_DIM:-1024}"

if [[ -z "${SILLAGE_TENANT_ID:-}" ]]; then
  # Best-effort: first beta+billing workspace in local Postgres
  if command -v docker >/dev/null 2>&1; then
    SILLAGE_TENANT_ID="$(
      docker exec secondbrain-postgres-1 psql -U sb -d secondbrain -t -A -c \
        "SELECT m.\"workspaceId\" FROM \"Membership\" m JOIN \"User\" u ON u.id = m.\"userId\" WHERE u.enabled = true AND u.\"billingEnabled\" = true LIMIT 1;" \
        2>/dev/null | tr -d '[:space:]' || true
    )"
    export SILLAGE_TENANT_ID
  fi
fi

GOLD="evaluation/private/vault_smoke.json"
if [[ ! -f "$GOLD" ]]; then
  echo "Création de $GOLD depuis l'exemple…"
  cp evaluation/private/vault_smoke.example.json "$GOLD"
  echo "Édite tes questions dans $GOLD puis relance."
  exit 1
fi

echo "┌─────────────────────────────────────────────┐"
echo "│  Vault smoke judge (interactif)             │"
echo "└─────────────────────────────────────────────┘"
echo "  gold:   $GOLD"
echo "  mode:   ${1:-from-report}  (défaut: dernier rapport)"
echo ""
echo "  Commandes: 1-5 = bon résultat · m = miss · n = pas de RAG"
echo "             s = skip · b = précédent · q = quitter"
echo ""

if [[ "${1:-}" == "--live" ]]; then
  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "OPENROUTER_API_KEY manquant (export ou .env)"
    exit 1
  fi
  if [[ -z "${MEMORY_INTERNAL_TOKEN:-}" ]]; then
    echo "MEMORY_INTERNAL_TOKEN manquant"
    exit 1
  fi
  if [[ -z "${SILLAGE_TENANT_ID:-}" ]]; then
    echo "SILLAGE_TENANT_ID manquant"
    exit 1
  fi
  exec uv run python evaluation/judge_vault_smoke.py --live --only-ungraded
fi

# From last report (fast — no API needed for judging)
if ! ls evaluation/artifacts/vault-smoke-*.json >/dev/null 2>&1; then
  echo "Pas encore de rapport. Recherche live…"
  if [[ -z "${OPENROUTER_API_KEY:-}" || -z "${MEMORY_INTERNAL_TOKEN:-}" || -z "${SILLAGE_TENANT_ID:-}" ]]; then
    echo "Manque OPENROUTER_API_KEY / MEMORY_INTERNAL_TOKEN / SILLAGE_TENANT_ID"
    echo "Ou lance d'abord: uv run python evaluation/evaluate_vault_smoke.py --auto"
    exit 1
  fi
  exec uv run python evaluation/judge_vault_smoke.py --live --only-ungraded
fi

exec uv run python evaluation/judge_vault_smoke.py --only-ungraded

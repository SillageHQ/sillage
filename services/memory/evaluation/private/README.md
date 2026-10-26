# Private vault smoke evaluation

This folder holds **your** real-vault questions. Content is gitignored except the example template.

## Quick start

```bash
cd services/memory

# 1. Copy the template (gitignored after rename)
cp evaluation/private/vault_smoke.example.json evaluation/private/vault_smoke.json

# 2. Edit queries: write real questions; leave expected* empty for interactive mode

# 3. API up + OPENROUTER_API_KEY + SILLAGE_TENANT_ID + MEMORY_INTERNAL_TOKEN
export OPENROUTER_API_KEY=...
export SILLAGE_TENANT_ID=...   # workspace already synced
export MEMORY_INTERNAL_TOKEN=...
export APP_API_URL=http://127.0.0.1:3001

# 4a. Interactive judge (recommended) — pick 1-5 / m / n per question
./evaluation/run_judge.sh
# or with fresh search:
./evaluation/run_judge.sh --live

# 4b. Automatic re-run once gold has expectedPathContains
uv run python evaluation/evaluate_vault_smoke.py --auto
```

## What we measure

**Retrieval only** — not the chat answer.

- Hit@1 / Hit@5: any top path matches `expectedPathContains`
- Keyword support: optional `expectedKeywords` in chunk text
- Forbidden: `forbiddenPathContains` must not appear in top 5

## Judging in interactive mode

| Input | Meaning |
| --- | --- |
| `1`–`5` | That rank is the correct note |
| `path fragment` | Mark that path substring as expected (and hit if present) |
| `m` | Miss — nothing relevant in top 5 |
| `n` | No retrieval expected (greeting / ack) |
| `s` | Skip this question |
| `q` | Quit and save progress |

# Sillage memory service

Python ingestion and retrieval service using Graphiti, FalkorDB, and model
providers. Follow the [repository setup guide](../../README.md) first.

Run `uv sync --locked` in this directory, configure `.env`, and start the service
with `uv run uvicorn api:app --port 8000 --reload`. The API supplies tenant
identity and the internal service token; keep this service on a private network.

For the optional bulk-ingestion script, explicitly set `SILLAGE_VAULT_PATH` to
your vault directory and configure `OPENROUTER_API_KEY`, then run
`uv run python ingest.py 25`. This prototype script processes up to 25 notes by
default; normal desktop ingestion goes through the API.

See [evaluation/README.md](evaluation/README.md) for synthetic retrieval tests.

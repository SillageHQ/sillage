# RAG evaluation — QMD catch-up Phase 0

Isolated synthetic corpus for measuring retrieval quality. It never reads or writes a real user vault.

## Dataset

| Item | Count |
| --- | ---: |
| Documents | 30 |
| Queries | 200 |
| lexical_exact | 40 |
| semantic | 40 |
| conversational | 25 |
| temporal | 20 |
| multi_hop | 20 |
| explicit_note | 15 |
| negative (no retrieval) | 20 |
| adversarial | 20 |

Schema fields per query:

- `id`, `query`, `category`
- `requiresRetrieval`
- `expectedPaths`, `expectedChunkIds` (filled at runtime from paths when empty)
- `forbiddenPaths` (adversarial / temporal distractors)
- optional `conversation` for follow-up rewrite cases (Phase 5)

Regenerate the JSON after editing the builder:

```bash
python evaluation/build_rag_cases.py
```

## Commands

From `services/memory`, with PostgreSQL + app API up and `SILLAGE_TENANT_ID` set:

```bash
# Sillage only
uv run python evaluation/evaluate_rag.py

# QMD only (requires @tobilu/qmd@2.5.3 — see qmd_config.json)
uv run python evaluation/qmd_adapter.py --mode query

# Both engines + comparative report (Phase 0 done criterion)
uv run python evaluation/compare_engines.py
```

Outputs (gitignored):

- `evaluation/artifacts/sillage-report.json`
- `evaluation/artifacts/qmd-report.json`
- `evaluation/artifacts/comparison-report.json`
- `evaluation/artifacts/comparison-report.md`

## Metrics

| Metric | Meaning |
| --- | --- |
| Recall@1 / Recall@5 | Any expected path in top K |
| MRR | Mean reciprocal rank of first relevant path |
| nDCG@10 | Graded ranking quality |
| Citation openability | Every hit has `id`, `path`, `title` |
| Forbidden hit rate | Bad distractor in top 5 (lower is better) |
| No-retrieval routing | Greetings / acks skip RAG (Sillage only) |
| Latency p50 / p95 | Per-query search latency |
| AI calls / OpenRouter cost | Proxies (embedding counted today) |

## QMD pin

Pinned in `qmd_config.json`:

- Package: `@tobilu/qmd@2.5.3`
- Default mode: `query` (hybrid + expansion + rerank)
- Models documented in the same file

Install:

```bash
npm install -g @tobilu/qmd@2.5.3
# or let the adapter use: npx --yes @tobilu/qmd@2.5.3
```

QMD runs in an isolated home under `evaluation/artifacts/qmd-home/` (config + cache), never against a personal vault.

If QMD is missing, the adapter reports `status: skipped` and comparison still emits Sillage numbers.

## Regression gate

Freeze a reference after a known-good run:

```bash
cp evaluation/artifacts/sillage-report.json evaluation/baselines/sillage-reference.json
```

`evaluate_rag.py` fails if Recall@1/5, MRR, nDCG@10, or citation openability drop more than **2%** vs that baseline.

Hard floor (even without baseline): Recall@5 ≥ 0.80, citation openability = 1.0, non-retrieval routing = 1.0.

## Vault smoke (real synced vault)

Retrieval-only check against **your** already-indexed vault. Does not re-ingest. Does not call chat.

```bash
cp evaluation/private/vault_smoke.example.json evaluation/private/vault_smoke.json
# edit queries (real questions; leave expected* empty for the first interactive pass)

uv run python evaluation/evaluate_vault_smoke.py --interactive   # judge top-5, fill gold
uv run python evaluation/evaluate_vault_smoke.py --auto          # re-score from gold

# Identical baseline/planner runs
RETRIEVAL_QUERY_PLANNER=0 uv run python evaluation/evaluate_vault_smoke.py --auto
RETRIEVAL_QUERY_PLANNER=1 uv run python evaluation/evaluate_vault_smoke.py --auto
```

For direct multi-query cases, a private gold query may include a `retrievalPlan`
object with `standalone_query`, `alternatives`, `intent`, and `ambiguities`. It is
validated by the same `RetrievalPlan` type used by `recall_memory`.

Private gold (`vault_smoke.json`) is gitignored. See `private/README.md`.

## Unit tests (no services)

```bash
cd services/memory/evaluation && python -m unittest test_metrics.py -v
```

## Baseline — historical (36-query set, 2026-07-17)

| Metric | Result |
| --- | ---: |
| Queries | 36 |
| Recall@5 | 1.0000 |
| Top-1 precision | 0.8889 |
| Mean reciprocal rank | 0.9398 |
| Citation openability | 1.0000 |
| Greeting/small-talk routing | 1.0000 |

Re-run on the 200-query set to refresh `baselines/sillage-reference.json`.

## Product acceptance coverage

- Greetings bypass personal retrieval: `test_recall_memory_skips_greetings` and dataset `negative` category.
- Assistant answers are not learned automatically: `test_chat_requests_cannot_enable_automatic_memory`.
- Provenance distinguishes vault, conversation, and model synthesis: knowledge-source tests.
- Save to vault uses an editable draft and atomic confirmed write: save-draft and vault-apply tests.
- Consolidation with no durable change is valid: `test_consolidation_can_resolve_without_vault_changes`.
- Incremental consolidation starts strictly after its cursor: API knowledge-window tests.
- Concurrent edits fail during global preflight before writing: `test_batch_preflight_rejects_everything_before_first_write`.
- Watcher downtime produces `applied_pending_sync` without losing the local write.
- Move writes the destination before trashing its source: `test_move_writes_target_before_trashing_source`.
- Path traversal, non-Markdown targets, and symlinks are rejected.

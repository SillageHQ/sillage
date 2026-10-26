"""Reproducible hybrid chunk retrieval evaluation against an isolated synthetic corpus.

Phase 0 harness for the QMD catch-up plan:
  - 200 categorized queries
  - Recall@1/5, MRR, nDCG@10, citation openability, forbidden-hit rate
  - latency p50/p95
  - optional baseline regression gate (2%)

Run from services/memory while the app API and PostgreSQL are up:
    uv run python evaluation/evaluate_rag.py
    uv run python evaluation/evaluate_rag.py --output evaluation/artifacts/sillage-report.json
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
import uuid
from pathlib import Path

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0]))  # services/memory
sys.path.insert(0, str(HERE))  # evaluation/
import api
from graph import (
    DEFAULT_EMBED_MODEL,
    ProviderConfig,
    _graph_clients,
    reset_tenant,
    set_tenant,
)

from metrics import aggregate_query_results, fails_regression, score_query

BASE = api.APP_API_URL
DATASET = HERE / "rag_cases.json"
ARTIFACTS = HERE / "artifacts"
DEFAULT_BASELINE = HERE / "baselines" / "sillage-reference.json"


def embedding_model_id() -> str:
    return os.getenv("OPENROUTER_EMBEDDING_MODEL", DEFAULT_EMBED_MODEL)


def build_embedder():
    """OpenRouter embedder only — no FalkorDB/Graphiti required for RAG bench."""
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required")
    provider = ProviderConfig(
        api_key=api_key,
        embedding_model=embedding_model_id(),
    )
    _llm, embedder, _rerank = _graph_clients(provider)
    return embedder


async def embed_batch(embedder, texts: list[str], batch_size: int = 32) -> list[list[float]]:
    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        chunk = texts[start : start + batch_size]
        vectors.extend(await embedder.create_batch(chunk))
    return vectors


async def index_corpus(client: httpx.AsyncClient, embedder, documents: list[dict]) -> dict[str, list[str]]:
    """Index documents; return path -> chunk ids map."""
    path_to_chunks: dict[str, list[str]] = {}
    document_chunks = [
        (document, api._markdown_chunks(document["path"], document["content"]))
        for document in documents
    ]
    all_chunks = [chunk for _, chunks in document_chunks for chunk in chunks]
    all_embeddings = iter(
        await embed_batch(
            embedder,
            [
                api._chunk_search_text(
                    path=document["path"],
                    title=document["title"],
                    chunk=chunk,
                    structure=api._obsidian_structure(document["content"]),
                )
                for document, chunks in document_chunks
                for chunk in chunks
            ],
        )
    )
    for document, chunks in document_chunks:
        embeddings = [next(all_embeddings) for _ in chunks]
        path_to_chunks[document["path"]] = [chunk.id for chunk in chunks]
        payload = {
            "id": api._stable_id("evaluation-document", document["path"]),
            "path": document["path"],
            "title": document["title"],
            "contentHash": hashlib.sha256(document["content"].encode()).hexdigest(),
            "embeddingModel": embedding_model_id(),
            "metadata": {"evaluation": True},
            "chunks": [
                {
                    "id": chunk.id,
                    "headingPath": chunk.heading_path,
                    "startLine": chunk.start_line,
                    "endLine": chunk.end_line,
                    "text": chunk.text,
                    "contentHash": chunk.content_hash,
                    "embedding": embedding,
                }
                for chunk, embedding in zip(chunks, embeddings, strict=True)
            ],
        }
        response = await client.put(f"{BASE}/rag/documents", json=payload)
        response.raise_for_status()
    return path_to_chunks


def enrich_expected_chunk_ids(case: dict, path_to_chunks: dict[str, list[str]]) -> list[str]:
    if case.get("expectedChunkIds"):
        return list(case["expectedChunkIds"])
    ids: list[str] = []
    for path in case.get("expectedPaths") or []:
        ids.extend(path_to_chunks.get(path) or [])
    return ids


async def search_one(
    client: httpx.AsyncClient,
    embedder,
    query: str,
    limit: int,
    retrieval_trace_id: str,
) -> tuple[list[dict], float, int, float, str | None]:
    started = time.monotonic()
    ai_calls = 1  # embedding batch of 1
    cost_usd = 0.0
    try:
        embeddings = await embedder.create_batch([query])
        if not embeddings:
            return [], (time.monotonic() - started) * 1000, ai_calls, cost_usd, "empty embedding"
        response = await client.post(
            f"{BASE}/rag/search",
            json={
                "query": query,
                "embedding": embeddings[0],
                "limit": limit,
                "retrievalTraceId": retrieval_trace_id,
            },
        )
        response.raise_for_status()
        items = response.json().get("items") or []
        return items, (time.monotonic() - started) * 1000, ai_calls, cost_usd, None
    except Exception as exc:  # noqa: BLE001 — evaluation must capture errors per query
        return [], (time.monotonic() - started) * 1000, ai_calls, cost_usd, str(exc)


async def run_evaluation(
    *,
    limit: int = 10,
    output_path: Path | None = None,
    baseline_path: Path | None = None,
    fail_under_recall_at_5: float = 0.8,
    max_regression_drop: float = 0.02,
) -> dict:
    tenant_token = set_tenant(os.environ["SILLAGE_TENANT_ID"])
    dataset = json.loads(DATASET.read_text(encoding="utf-8"))
    embedder = build_embedder()
    client = httpx.AsyncClient(timeout=90, headers=api._app_api_headers())
    run_id = str(uuid.uuid4())
    try:
        path_to_chunks = await index_corpus(client, embedder, dataset["documents"])
        rows: list[dict] = []

        retrieval_cases = [case for case in dataset["queries"] if case.get("requiresRetrieval", True)]
        negative_cases = [case for case in dataset["queries"] if not case.get("requiresRetrieval", True)]

        # Batch embeddings for retrieval queries (cost/latency honesty: one call per query still counted)
        for case in retrieval_cases:
            # Conversational cases currently search the follow-up string as-is
            # (query rewrite lands in Phase 5). Still tracked by category.
            trace_id = f"eval-{run_id}-{case['id']}"
            items, latency, ai_calls, cost_usd, error = await search_one(
                client, embedder, case["query"], limit, trace_id
            )
            row = score_query(
                query_id=case["id"],
                query=case["query"],
                category=case["category"],
                requires_retrieval=True,
                expected_paths=case.get("expectedPaths") or [],
                forbidden_paths=case.get("forbiddenPaths") or [],
                items=items,
                latency_ms=latency,
                ai_calls=ai_calls,
                cost_usd=cost_usd,
                error=error,
            )
            row["expectedChunkIds"] = enrich_expected_chunk_ids(case, path_to_chunks)
            row["retrievalTraceId"] = trace_id
            rows.append(row)

        for case in negative_cases:
            routed = api._is_low_value_exchange(case["query"])
            rows.append(
                score_query(
                    query_id=case["id"],
                    query=case["query"],
                    category=case["category"],
                    requires_retrieval=False,
                    expected_paths=[],
                    forbidden_paths=[],
                    items=[],
                    latency_ms=0,
                    routed_without_retrieval=routed,
                )
            )

        metrics = aggregate_query_results(rows)
        report = {
            "engine": "sillage",
            "status": "ok",
            "runId": run_id,
            "dataset": {
                "path": str(DATASET.name),
                "version": dataset.get("version"),
                "documentCount": len(dataset["documents"]),
                "queryCount": len(dataset["queries"]),
            },
            "metrics": metrics,
            "queries": rows,
        }

        out = output_path or (ARTIFACTS / "sillage-report.json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

        print(json.dumps({"status": "ok", "metrics": metrics, "output": str(out)}, indent=2))

        # Hard quality floor (synthetic smoke)
        if (metrics.get("recallAt5") or 0) < fail_under_recall_at_5:
            raise SystemExit(f"recallAt5 {metrics.get('recallAt5')} < {fail_under_recall_at_5}")
        if (metrics.get("citationOpenability") or 0) < 1:
            raise SystemExit("citationOpenability < 1.0")
        if metrics.get("nonRetrievalRouting") is not None and metrics["nonRetrievalRouting"] < 1:
            raise SystemExit("nonRetrievalRouting < 1.0")

        baseline_file = baseline_path or DEFAULT_BASELINE
        if baseline_file.exists():
            baseline = json.loads(baseline_file.read_text(encoding="utf-8"))
            base_metrics = baseline.get("metrics") or baseline
            failures = fails_regression(metrics, base_metrics, max_drop=max_regression_drop)
            if failures:
                raise SystemExit("regression: " + "; ".join(failures))

        return report
    finally:
        for document in dataset["documents"]:
            try:
                await client.delete(f"{BASE}/rag/documents", params={"path": document["path"]})
            except Exception:  # noqa: BLE001
                pass
        await client.aclose()
        reset_tenant(tenant_token)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Sillage RAG on the synthetic corpus")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--baseline", type=Path, default=None)
    parser.add_argument("--fail-under-recall-at-5", type=float, default=0.8)
    parser.add_argument("--max-regression-drop", type=float, default=0.02)
    args = parser.parse_args()
    asyncio.run(
        run_evaluation(
            limit=args.limit,
            output_path=args.output,
            baseline_path=args.baseline,
            fail_under_recall_at_5=args.fail_under_recall_at_5,
            max_regression_drop=args.max_regression_drop,
        )
    )


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Smoke-test retrieval against the already-synced real vault (no re-index).

Modes:
  --interactive  Show top-K results; you judge; gold file is updated.
  --auto         Score from expectedPathContains / expectedKeywords in gold.

Does NOT call the chat LLM — only embed + /rag/search.

From services/memory:
  uv run python evaluation/evaluate_vault_smoke.py --interactive
  uv run python evaluation/evaluate_vault_smoke.py --auto
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0]))
sys.path.insert(0, str(HERE))

import api
from graph import DEFAULT_EMBED_MODEL, ProviderConfig, _graph_clients, reset_tenant, set_tenant
from retrieval import (
    fallback_retrieval_plan,
    parse_retrieval_plan,
    retrieval_queries,
    weighted_rrf_merge,
)

PRIVATE = HERE / "private"
DEFAULT_GOLD = PRIVATE / "vault_smoke.json"
EXAMPLE_GOLD = PRIVATE / "vault_smoke.example.json"
ARTIFACTS = HERE / "artifacts"


def build_embedder():
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required")
    provider = ProviderConfig(
        api_key=api_key,
        embedding_model=os.getenv("OPENROUTER_EMBEDDING_MODEL", DEFAULT_EMBED_MODEL),
    )
    _llm, embedder, _rerank = _graph_clients(provider)
    return embedder


def load_gold(path: Path) -> dict[str, Any]:
    if not path.exists():
        if path == DEFAULT_GOLD and EXAMPLE_GOLD.exists():
            raise SystemExit(
                f"Missing {path}.\n"
                f"Copy the template:\n"
                f"  cp {EXAMPLE_GOLD.relative_to(HERE.parents[0])} "
                f"{path.relative_to(HERE.parents[0])}\n"
                f"Then edit queries and re-run."
            )
        raise SystemExit(f"Gold file not found: {path}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data.get("queries"), list) or not data["queries"]:
        raise SystemExit("Gold file must contain a non-empty queries array")
    return data


def save_gold(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def path_matches(path: str, needles: list[str]) -> bool:
    if not needles:
        return False
    hay = path.lower()
    return any(n.lower() in hay for n in needles if n.strip())


def text_matches(text: str, needles: list[str]) -> bool:
    if not needles:
        return False
    hay = text.lower()
    return any(n.lower() in hay for n in needles if n.strip())


def score_items(
    case: dict[str, Any],
    items: list[dict[str, Any]],
    *,
    k: int = 5,
) -> dict[str, Any]:
    requires = bool(case.get("requiresRetrieval", True))
    expected_paths = list(case.get("expectedPathContains") or [])
    expected_kw = list(case.get("expectedKeywords") or [])
    forbidden = list(case.get("forbiddenPathContains") or [])
    top = items[:k]
    evaluation_k = max(k, min(int(case.get("evaluationK") or k), 30))
    evaluation_items = items[:evaluation_k]
    paths = [str(i.get("path") or "") for i in top]
    evaluation_paths = [str(i.get("path") or "") for i in evaluation_items]
    min_expected_matches = max(1, int(case.get("minExpectedMatches") or 1))

    if not requires:
        return {
            "requiresRetrieval": False,
            "hitAt1": None,
            "hitAt5": None,
            "keywordHit": None,
            "forbiddenHit": False,
            "nonRetrievalOk": len(top) == 0,  # informational; search always returns if docs exist
            "paths": paths,
        }

    def hit_at(n: int) -> bool:
        if not expected_paths:
            return False
        return any(path_matches(p, expected_paths) for p in paths[:n])

    keyword_hit = False
    if expected_kw:
        keyword_hit = any(text_matches(str(i.get("text") or ""), expected_kw) for i in top)

    forbidden_hit = any(path_matches(p, forbidden) for p in paths) if forbidden else False
    matching_evaluation_paths = {
        p for p in evaluation_paths if path_matches(p, expected_paths)
    }
    expected_coverage = len(matching_evaluation_paths)

    return {
        "requiresRetrieval": True,
        "hitAt1": hit_at(1) if expected_paths else None,
        "hitAt5": hit_at(5) if expected_paths else None,
        "keywordHit": keyword_hit if expected_kw else None,
        "expectedCoverage": expected_coverage,
        "expectedCoverageK": evaluation_k,
        "coverageHit": expected_coverage >= min_expected_matches if expected_paths else None,
        "forbiddenHit": forbidden_hit,
        "paths": paths,
        "ungraded": not expected_paths,
    }


def print_results(query: str, items: list[dict[str, Any]], ranking: str | None, channels: dict | None) -> None:
    print()
    print("=" * 72)
    print(f"Q: {query}")
    if ranking:
        print(f"ranking: {ranking}" + (f"  channels={channels}" if channels else ""))
    if not items:
        print("  (no results)")
        return
    for idx, item in enumerate(items, start=1):
        path = item.get("path") or "?"
        title = item.get("title") or ""
        score = item.get("score")
        text = (item.get("text") or "").replace("\n", " ").strip()
        if len(text) > 160:
            text = text[:157] + "..."
        score_s = f"{float(score):.4f}" if isinstance(score, (int, float)) else "?"
        print(f"  {idx}. [{score_s}] {path}")
        if title:
            print(f"      title: {title}")
        print(f"      {text}")


async def search(
    client: httpx.AsyncClient,
    embedder,
    query: str,
    limit: int,
    raw_plan: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any], float]:
    started = time.monotonic()
    plan, plan_fallback = (
        parse_retrieval_plan(raw_plan, query)
        if raw_plan is not None
        else (fallback_retrieval_plan(query), None)
    )
    planner_enabled = api._retrieval_query_planner_enabled()
    specs = retrieval_queries(query, plan, planner_enabled=planner_enabled)
    embeddings = await embedder.create_batch([spec.text for spec in specs])
    if len(embeddings) != len(specs):
        return [], {}, (time.monotonic() - started) * 1000

    async def search_one(spec, embedding):
        response = await client.post(
            f"{api.APP_API_URL}/rag/search",
            json={"query": spec.text, "embedding": embedding, "limit": min(max(limit * 6, 12), 30)},
        )
        response.raise_for_status()
        return response.json()

    outcomes = await asyncio.gather(
        *(search_one(spec, embedding) for spec, embedding in zip(specs, embeddings, strict=True)),
        return_exceptions=True,
    )
    result_sets = []
    failures = 0
    channel_counts: dict[str, int] = {}
    rankings: list[str] = []
    for spec, outcome in zip(specs, outcomes, strict=True):
        if isinstance(outcome, Exception):
            failures += 1
            continue
        items = outcome.get("items") or []
        result_sets.append((spec.weight, items))
        channel_counts[spec.channel] = channel_counts.get(spec.channel, 0) + len(items)
        if outcome.get("ranking"):
            rankings.append(outcome["ranking"])
    items = weighted_rrf_merge(result_sets)[:limit]
    meta = {
        "ranking": "multi_query_weighted_rrf" if len(specs) > 1 else (rankings[0] if rankings else None),
        "channels": channel_counts,
        "intent": plan.intent,
        "variants": max(0, len(specs) - 1),
        "fallback": plan_fallback or (f"chunk_search:{failures}" if failures else None),
    }
    return items, meta, (time.monotonic() - started) * 1000


def interactive_verdict(
    case: dict[str, Any],
    items: list[dict[str, Any]],
) -> str:
    """Return action: continue | quit. Mutates case gold fields."""
    print()
    print("Verdict:")
    print("  1-5     = that rank is correct (records path fragment)")
    print("  <text>  = expected path substring (e.g. Projects/Alpha)")
    print("  m       = miss (nothing relevant)")
    print("  n       = no retrieval expected")
    print("  s       = skip")
    print("  q       = quit and save")
    raw = input("> ").strip()
    if not raw:
        return "continue"
    low = raw.lower()
    if low == "q":
        return "quit"
    if low == "s":
        case["_lastVerdict"] = "skip"
        return "continue"
    if low == "n":
        case["requiresRetrieval"] = False
        case["expectedPathContains"] = []
        case["_lastVerdict"] = "no_retrieval"
        print("  → marked requiresRetrieval=false")
        return "continue"
    if low == "m":
        case["_lastVerdict"] = "miss"
        # leave expected empty so auto mode shows ungraded/miss
        if not case.get("expectedPathContains"):
            case["expectedPathContains"] = []
        case["notes"] = ((case.get("notes") or "") + " | interactive: miss").strip(" |")
        print("  → logged miss")
        return "continue"
    if low in {"1", "2", "3", "4", "5"}:
        rank = int(low)
        if rank > len(items):
            print("  rank out of range")
            return "continue"
        path = str(items[rank - 1].get("path") or "")
        # Use last path segment + parent folder as a stable fragment
        parts = path.strip("/").split("/")
        fragment = "/".join(parts[-2:]) if len(parts) >= 2 else path
        expected = list(case.get("expectedPathContains") or [])
        if fragment and fragment not in expected:
            expected.append(fragment)
        case["expectedPathContains"] = expected
        case["requiresRetrieval"] = True
        case["_lastVerdict"] = f"rank{rank}"
        print(f"  → expectedPathContains += {fragment!r}")
        return "continue"
    # free-text path fragment
    expected = list(case.get("expectedPathContains") or [])
    if raw not in expected:
        expected.append(raw)
    case["expectedPathContains"] = expected
    case["requiresRetrieval"] = True
    case["_lastVerdict"] = "path"
    print(f"  → expectedPathContains += {raw!r}")
    return "continue"


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    graded = [r for r in rows if r.get("hitAt5") is not None]
    retrieval = [r for r in rows if r.get("requiresRetrieval")]
    hits5 = [r for r in graded if r.get("hitAt5")]
    hits1 = [r for r in graded if r.get("hitAt1")]
    coverage_hits = [r for r in retrieval if r.get("coverageHit")]
    forbidden = [r for r in rows if r.get("forbiddenHit")]
    ungraded = [r for r in retrieval if r.get("ungraded")]
    return {
        "total": len(rows),
        "graded": len(graded),
        "ungraded": len(ungraded),
        "hitAt1": round(len(hits1) / len(graded), 4) if graded else None,
        "hitAt5": round(len(hits5) / len(graded), 4) if graded else None,
        "coverageHit": round(len(coverage_hits) / len(retrieval), 4) if retrieval else None,
        "forbiddenHitRate": round(len(forbidden) / len(rows), 4) if rows else None,
        "misses": [
            {"id": r.get("id"), "query": r.get("query"), "paths": r.get("paths")}
            for r in graded
            if not r.get("hitAt5")
        ],
    }


async def run(
    *,
    gold_path: Path,
    interactive: bool,
    limit: int,
    start_at: int,
) -> dict[str, Any]:
    tenant = os.environ.get("SILLAGE_TENANT_ID", "").strip()
    if not tenant:
        raise SystemExit("SILLAGE_TENANT_ID is required (synced workspace)")
    token = set_tenant(tenant)
    gold = load_gold(gold_path)
    embedder = build_embedder()
    client = httpx.AsyncClient(timeout=60, headers=api._app_api_headers())
    rows: list[dict[str, Any]] = []
    try:
        queries = gold["queries"]
        for index, case in enumerate(queries):
            if index < start_at:
                continue
            qid = case.get("id") or f"q{index+1}"
            query = (case.get("query") or "").strip()
            if not query:
                continue
            print(f"\n[{index + 1}/{len(queries)}] {qid}")
            try:
                items, meta, latency_ms = await search(
                    client,
                    embedder,
                    query,
                    limit,
                    case.get("retrievalPlan"),
                )
            except Exception as exc:  # noqa: BLE001
                print(f"  ERROR: {exc}")
                rows.append({"id": qid, "query": query, "error": str(exc)})
                continue

            print_results(query, items[:limit], meta.get("ranking"), meta.get("channels"))
            print(f"  latency_ms={latency_ms:.0f}")

            if interactive:
                action = interactive_verdict(case, items[:limit])
                # persist gold after each answer
                clean = {k: v for k, v in case.items() if not k.startswith("_")}
                gold["queries"][index] = clean
                save_gold(gold_path, gold)
                if action == "quit":
                    print("Stopping early; gold saved.")
                    break

            scored = score_items(case, items, k=limit)
            # Keep display payload for offline interactive judge
            display_items = [
                {
                    "path": it.get("path"),
                    "title": it.get("title"),
                    "score": it.get("score"),
                    "text": (it.get("text") or "")[:400],
                }
                for it in items[:limit]
            ]
            scored.update(
                {
                    "id": qid,
                    "query": query,
                    "category": case.get("category"),
                    "latencyMs": latency_ms,
                    "ranking": meta.get("ranking"),
                    "channels": meta.get("channels"),
                    "verdict": case.get("_lastVerdict"),
                    "items": display_items,
                }
            )
            rows.append(scored)
            if scored.get("hitAt5") is True:
                print("  auto: HIT@5")
            elif scored.get("hitAt5") is False:
                print("  auto: MISS@5")
            elif scored.get("ungraded"):
                print("  auto: ungraded (no expectedPathContains yet)")

        summary = summarize(rows)
        report = {
            "engine": "sillage-vault-smoke",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "tenantPrefix": tenant[:8],
            "gold": str(gold_path.name),
            "mode": "interactive" if interactive else "auto",
            "summary": summary,
            "queries": rows,
        }
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out = ARTIFACTS / f"vault-smoke-{stamp}.json"
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print()
        print(json.dumps({"summary": summary, "report": str(out)}, indent=2))
        return report
    finally:
        await client.aclose()
        reset_tenant(token)


def main() -> None:
    parser = argparse.ArgumentParser(description="Vault smoke retrieval evaluation (private gold)")
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD, help="Path to vault_smoke.json")
    parser.add_argument("--interactive", action="store_true", help="Judge each query and update gold")
    parser.add_argument("--auto", action="store_true", help="Score from gold only (default if not interactive)")
    parser.add_argument("--limit", type=int, default=5, help="Top-K to retrieve and display")
    parser.add_argument("--start-at", type=int, default=0, help="Skip first N queries (0-based)")
    args = parser.parse_args()
    interactive = args.interactive or not args.auto
    if args.auto:
        interactive = False
    asyncio.run(
        run(
            gold_path=args.gold,
            interactive=interactive,
            limit=args.limit,
            start_at=args.start_at,
        )
    )


if __name__ == "__main__":
    main()

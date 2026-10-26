"""Shared IR metrics for the QMD catch-up evaluation harness."""
from __future__ import annotations

import math
import statistics
from typing import Any, Iterable, Sequence


def _first_relevant_rank(ranked_paths: Sequence[str], expected: set[str]) -> int | None:
    for index, path in enumerate(ranked_paths, start=1):
        if path in expected:
            return index
    return None


def recall_at_k(ranked_paths: Sequence[str], expected: set[str], k: int) -> float:
    if not expected:
        return 1.0 if not ranked_paths[:k] else 0.0
    hit = any(path in expected for path in ranked_paths[:k])
    return 1.0 if hit else 0.0


def precision_at_k(ranked_paths: Sequence[str], expected: set[str], k: int) -> float:
    top = ranked_paths[:k]
    if not top:
        return 0.0 if expected else 1.0
    return sum(1 for path in top if path in expected) / len(top)


def mrr(ranked_paths: Sequence[str], expected: set[str]) -> float:
    rank = _first_relevant_rank(ranked_paths, expected)
    return 0.0 if rank is None else 1.0 / rank


def dcg_at_k(relevances: Sequence[float], k: int) -> float:
    total = 0.0
    for index, rel in enumerate(relevances[:k], start=1):
        total += rel / math.log2(index + 1)
    return total


def ndcg_at_k(ranked_paths: Sequence[str], expected: set[str], k: int) -> float:
    if not expected:
        # For negative queries, empty result is perfect; any retrieval is zero.
        return 1.0 if not ranked_paths[:k] else 0.0
    relevances = [1.0 if path in expected else 0.0 for path in ranked_paths[:k]]
    ideal = sorted(relevances, reverse=True)
    # Ideal should include all relevant docs up to k
    ideal_count = min(len(expected), k)
    ideal = [1.0] * ideal_count + [0.0] * max(0, k - ideal_count)
    ideal_dcg = dcg_at_k(ideal, k)
    if ideal_dcg == 0:
        return 0.0
    return dcg_at_k(relevances, k) / ideal_dcg


def citation_openable(items: Sequence[dict[str, Any]]) -> bool:
    if not items:
        return True
    return all(item.get("id") and item.get("path") and item.get("title") is not None for item in items)


def forbidden_hit(ranked_paths: Sequence[str], forbidden: set[str], k: int = 5) -> bool:
    return any(path in forbidden for path in ranked_paths[:k])


def percentile(values: Sequence[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * (p / 100.0)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return float(ordered[low])
    weight = rank - low
    return float(ordered[low] * (1 - weight) + ordered[high] * weight)


def aggregate_query_results(results: Iterable[dict[str, Any]]) -> dict[str, Any]:
    rows = list(results)
    retrieval_rows = [row for row in rows if row.get("requiresRetrieval", True)]
    negative_rows = [row for row in rows if not row.get("requiresRetrieval", True)]

    def mean(key: str, source: list[dict[str, Any]] | None = None) -> float | None:
        data = source if source is not None else rows
        values = [float(item[key]) for item in data if key in item and item[key] is not None]
        return round(sum(values) / len(values), 4) if values else None

    latencies = [float(item["latencyMs"]) for item in rows if item.get("latencyMs") is not None]
    by_category: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        by_category.setdefault(str(row.get("category") or "unknown"), []).append(row)

    category_metrics = {
        category: {
            "queries": len(items),
            "recallAt1": mean("recallAt1", items),
            "recallAt5": mean("recallAt5", items),
            "mrr": mean("mrr", items),
            "ndcgAt10": mean("ndcgAt10", items),
            "citationOpenability": mean("citationOpenability", items),
            "forbiddenHitRate": mean("forbiddenHit", items),
        }
        for category, items in sorted(by_category.items())
    }

    return {
        "queries": len(rows),
        "retrievalQueries": len(retrieval_rows),
        "negativeQueries": len(negative_rows),
        "recallAt1": mean("recallAt1", retrieval_rows),
        "recallAt5": mean("recallAt5", retrieval_rows),
        "mrr": mean("mrr", retrieval_rows),
        "ndcgAt10": mean("ndcgAt10", retrieval_rows),
        "citationOpenability": mean("citationOpenability", rows),
        "forbiddenHitRate": mean("forbiddenHit", retrieval_rows),
        "nonRetrievalRouting": mean("nonRetrievalCorrect", negative_rows),
        "latencyMs": {
            "p50": round(percentile(latencies, 50) or 0, 2) if latencies else None,
            "p95": round(percentile(latencies, 95) or 0, 2) if latencies else None,
            "mean": round(statistics.fmean(latencies), 2) if latencies else None,
            "count": len(latencies),
        },
        "aiCalls": {
            "total": sum(int(item.get("aiCalls") or 0) for item in rows),
            "perQueryMean": mean("aiCalls"),
        },
        "openRouterCostUsd": {
            "total": round(sum(float(item.get("costUsd") or 0) for item in rows), 6),
            "perQueryMean": mean("costUsd"),
        },
        "errors": sum(1 for item in rows if item.get("error")),
        "byCategory": category_metrics,
    }


def score_query(
    *,
    query_id: str,
    query: str,
    category: str,
    requires_retrieval: bool,
    expected_paths: Sequence[str],
    forbidden_paths: Sequence[str],
    items: Sequence[dict[str, Any]],
    latency_ms: float | None = None,
    ai_calls: int = 0,
    cost_usd: float = 0.0,
    error: str | None = None,
    routed_without_retrieval: bool | None = None,
) -> dict[str, Any]:
    paths = [str(item.get("path") or "") for item in items]
    expected = set(expected_paths)
    forbidden = set(forbidden_paths)

    if not requires_retrieval:
        correct = bool(routed_without_retrieval) if routed_without_retrieval is not None else len(items) == 0
        return {
            "id": query_id,
            "query": query,
            "category": category,
            "requiresRetrieval": False,
            "paths": paths,
            "latencyMs": latency_ms,
            "aiCalls": ai_calls,
            "costUsd": cost_usd,
            "error": error,
            "nonRetrievalCorrect": 1.0 if correct else 0.0,
            "citationOpenability": 1.0 if citation_openable(items) else 0.0,
            "recallAt1": None,
            "recallAt5": None,
            "mrr": None,
            "ndcgAt10": None,
            "forbiddenHit": 0.0,
        }

    return {
        "id": query_id,
        "query": query,
        "category": category,
        "requiresRetrieval": True,
        "paths": paths,
        "latencyMs": latency_ms,
        "aiCalls": ai_calls,
        "costUsd": cost_usd,
        "error": error,
        "recallAt1": recall_at_k(paths, expected, 1),
        "recallAt5": recall_at_k(paths, expected, 5),
        "mrr": mrr(paths, expected),
        "ndcgAt10": ndcg_at_k(paths, expected, 10),
        "citationOpenability": 1.0 if citation_openable(items) else 0.0,
        "forbiddenHit": 1.0 if forbidden_hit(paths, forbidden, 5) else 0.0,
        "precisionAt5": precision_at_k(paths, expected, 5),
    }


def regression_deltas(current: dict[str, Any], baseline: dict[str, Any]) -> dict[str, float]:
    keys = ("recallAt1", "recallAt5", "mrr", "ndcgAt10", "citationOpenability")
    deltas: dict[str, float] = {}
    for key in keys:
        cur = current.get(key)
        base = baseline.get(key)
        if cur is None or base is None:
            continue
        deltas[key] = round(float(cur) - float(base), 4)
    return deltas


def fails_regression(current: dict[str, Any], baseline: dict[str, Any], max_drop: float = 0.02) -> list[str]:
    failures: list[str] = []
    for key, delta in regression_deltas(current, baseline).items():
        if delta < -max_drop:
            failures.append(f"{key} dropped by {abs(delta):.4f} (limit {max_drop})")
    return failures

"""Shared query-planning primitives for adaptive memory retrieval."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MAX_QUERY_CHARS = 300
MAX_ALTERNATIVES = 2
MAX_CHUNK_SEARCHES = 3
RetrievalIntent = Literal["lookup", "list", "aggregate", "temporal", "compare"]


def _clean_query(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return re.sub(r"\s+", " ", value).strip()[:MAX_QUERY_CHARS]


class RetrievalAmbiguity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    term: str = Field(max_length=100)
    hypotheses: list[str] = Field(default_factory=list, max_length=4)

    @field_validator("term", mode="before")
    @classmethod
    def clean_term(cls, value: Any) -> str:
        return _clean_query(value)[:100]

    @field_validator("hypotheses", mode="before")
    @classmethod
    def clean_hypotheses(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for item in value:
            clean = _clean_query(item)
            key = clean.casefold()
            if clean and key not in seen:
                seen.add(key)
                out.append(clean)
            if len(out) >= 4:
                break
        return out


class RetrievalPlan(BaseModel):
    """Ephemeral plan emitted as part of the existing recall_memory tool call."""

    model_config = ConfigDict(extra="forbid")

    standalone_query: str = Field(max_length=MAX_QUERY_CHARS)
    alternatives: list[str] = Field(default_factory=list, max_length=MAX_ALTERNATIVES)
    intent: RetrievalIntent = "lookup"
    ambiguities: list[RetrievalAmbiguity] = Field(default_factory=list, max_length=6)

    @field_validator("standalone_query", mode="before")
    @classmethod
    def clean_standalone_query(cls, value: Any) -> str:
        return _clean_query(value)

    @field_validator("alternatives", mode="before")
    @classmethod
    def clean_alternatives(cls, value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        out: list[str] = []
        seen: set[str] = set()
        for item in value:
            clean = _clean_query(item)
            key = clean.casefold()
            if clean and key not in seen:
                seen.add(key)
                out.append(clean)
            if len(out) >= MAX_ALTERNATIVES:
                break
        return out


@dataclass(frozen=True)
class RetrievalQuery:
    text: str
    weight: float
    channel: Literal["original", "standalone", "alternative"]


def fallback_retrieval_plan(original_query: str) -> RetrievalPlan:
    return RetrievalPlan(standalone_query=_clean_query(original_query), intent="lookup")


def parse_retrieval_plan(raw: Any, original_query: str) -> tuple[RetrievalPlan, str | None]:
    """Validate untrusted tool/evaluation input and return a safe fallback on error."""
    try:
        if not isinstance(raw, dict):
            raise ValueError("plan is not an object")
        plan = RetrievalPlan.model_validate(raw)
        if not plan.standalone_query:
            raise ValueError("standalone query is empty")
        return plan, None
    except (TypeError, ValueError) as exc:
        return fallback_retrieval_plan(original_query), exc.__class__.__name__


def retrieval_queries(
    original_query: str,
    plan: RetrievalPlan,
    *,
    planner_enabled: bool = True,
) -> list[RetrievalQuery]:
    """Return original-first, deduplicated searches, capped at three total."""
    original = _clean_query(original_query) or plan.standalone_query
    queries = [RetrievalQuery(original, 1.2, "original")]
    if not planner_enabled:
        return queries

    seen = {original.casefold()}
    planned = [
        (plan.standalone_query, 1.0, "standalone"),
        *((alternative, 0.8, "alternative") for alternative in plan.alternatives),
    ]
    for text, weight, channel in planned:
        clean = _clean_query(text)
        key = clean.casefold()
        if not clean or key in seen:
            continue
        seen.add(key)
        queries.append(RetrievalQuery(clean, weight, channel))
        if len(queries) >= MAX_CHUNK_SEARCHES:
            break
    return queries


def _result_key(item: dict) -> str:
    identity = item.get("chunk_id") or item.get("id")
    if identity:
        return str(identity)
    path = item.get("note_path") or item.get("path")
    content = item.get("fact") or item.get("text")
    return f"{path}:{content}"


def weighted_rrf_merge(
    result_sets: list[tuple[float, list[dict]]],
    *,
    k: int = 60,
) -> list[dict]:
    """Merge ranked result lists without mixing incomparable raw scores."""
    merged: dict[str, dict] = {}
    first_seen: dict[str, int] = {}
    sequence = 0
    for weight, results in result_sets:
        if weight <= 0:
            continue
        for rank, result in enumerate(results, start=1):
            key = _result_key(result)
            if key not in merged:
                merged[key] = {**result, "rrf_score": 0.0}
                first_seen[key] = sequence
                sequence += 1
            merged[key]["rrf_score"] += weight / (k + rank)
    return sorted(
        merged.values(),
        key=lambda item: (-float(item["rrf_score"]), first_seen[_result_key(item)]),
    )


def diversify_by_document(items: list[dict], limit: int, intent: RetrievalIntent) -> list[dict]:
    """Prefer document breadth for list/aggregate, while backfilling when needed."""
    if limit <= 0:
        return []
    max_per_document = 1 if intent in {"list", "aggregate"} else 2
    selected: list[dict] = []
    deferred: list[dict] = []
    counts: dict[str, int] = {}
    for item in items:
        key = str(
            item.get("document_id")
            or item.get("documentId")
            or item.get("note_path")
            or item.get("path")
            or "unknown"
        )
        if counts.get(key, 0) >= max_per_document:
            deferred.append(item)
            continue
        counts[key] = counts.get(key, 0) + 1
        selected.append(item)
        if len(selected) >= limit:
            return selected
    for item in deferred:
        selected.append(item)
        if len(selected) >= limit:
            break
    return selected

#!/usr/bin/env python3
"""Single entrypoint: run Sillage and QMD on the same corpus, emit a comparative report.

Usage (from services/memory, API + Postgres up for Sillage):
    uv run python evaluation/compare_engines.py
    uv run python evaluation/compare_engines.py --skip-qmd
    uv run python evaluation/compare_engines.py --skip-sillage

Artifacts land in evaluation/artifacts/ (gitignored) — never in a user vault.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from metrics import regression_deltas
from qmd_adapter import evaluate_qmd, load_config

ARTIFACTS = HERE / "artifacts"


def write_markdown_report(report: dict, path: Path) -> None:
    sillage = report.get("sillage") or {}
    qmd = report.get("qmd") or {}
    sm = (sillage.get("metrics") or {}) if sillage.get("status") == "ok" else None
    qm = (qmd.get("metrics") or {}) if qmd.get("status") == "ok" else None
    qcfg = load_config()

    lines = [
        "# RAG comparative report — Sillage vs QMD",
        "",
        f"Generated: {report.get('generatedAt')}",
        f"Dataset: `{report.get('dataset')}`",
        "",
        "## Engines",
        "",
        f"- **Sillage**: status `{sillage.get('status')}`",
        f"- **QMD**: package `{qcfg['package']}@{qcfg['version']}` (pinned {qcfg.get('pinnedAt')}), "
        f"mode `{qmd.get('qmd', {}).get('mode') or qcfg.get('defaultMode')}`, status `{qmd.get('status')}`",
    ]
    if qmd.get("reason"):
        lines.append(f"- QMD note: {qmd['reason']}")
    lines += ["", "## Headline metrics", ""]

    def fmt(metrics: dict | None, key: str) -> str:
        if not metrics or metrics.get(key) is None:
            return "—"
        return f"{metrics[key]:.4f}"

    keys = [
        ("recallAt1", "Recall@1"),
        ("recallAt5", "Recall@5"),
        ("mrr", "MRR"),
        ("ndcgAt10", "nDCG@10"),
        ("citationOpenability", "Citation openability"),
        ("forbiddenHitRate", "Forbidden hit rate (lower better)"),
        ("nonRetrievalRouting", "No-retrieval routing"),
    ]
    lines += [
        "| Metric | Sillage | QMD |",
        "| --- | ---: | ---: |",
    ]
    for key, label in keys:
        lines.append(f"| {label} | {fmt(sm, key)} | {fmt(qm, key)} |")

    if sm and qm:
        deltas = regression_deltas(sm, qm)
        lines += ["", "## Sillage − QMD (positive = Sillage better)", ""]
        for key, delta in deltas.items():
            lines.append(f"- `{key}`: {delta:+.4f}")

    if sm and sm.get("byCategory"):
        lines += ["", "## Sillage by category", "", "| Category | n | R@5 | MRR | nDCG@10 |", "| --- | ---: | ---: | ---: | ---: |"]
        for category, stats in sm["byCategory"].items():
            lines.append(
                f"| {category} | {stats.get('queries')} | {fmt(stats, 'recallAt5')} | "
                f"{fmt(stats, 'mrr')} | {fmt(stats, 'ndcgAt10')} |"
            )

    if qm and qm.get("byCategory"):
        lines += ["", "## QMD by category", "", "| Category | n | R@5 | MRR | nDCG@10 |", "| --- | ---: | ---: | ---: | ---: |"]
        for category, stats in qm["byCategory"].items():
            lines.append(
                f"| {category} | {stats.get('queries')} | {fmt(stats, 'recallAt5')} | "
                f"{fmt(stats, 'mrr')} | {fmt(stats, 'ndcgAt10')} |"
            )

    if sm and sm.get("latencyMs"):
        lat = sm["latencyMs"]
        lines += [
            "",
            "## Latency (Sillage)",
            f"- p50: {lat.get('p50')} ms",
            f"- p95: {lat.get('p95')} ms",
            f"- mean: {lat.get('mean')} ms",
        ]
    if sm and sm.get("aiCalls"):
        lines += [
            "",
            "## Cost proxies (Sillage)",
            f"- AI calls total: {sm['aiCalls'].get('total')}",
            f"- OpenRouter cost USD total: {sm.get('openRouterCostUsd', {}).get('total')}",
        ]

    lines += [
        "",
        "## QMD pin",
        "",
        "```json",
        json.dumps(qcfg, indent=2),
        "```",
        "",
        "Raw JSON: `evaluation/artifacts/comparison-report.json`",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


async def run_sillage(limit: int, output: Path) -> dict:
    # Import lazily so --skip-sillage works without memory service deps loaded for QMD-only.
    from evaluate_rag import run_evaluation

    return await run_evaluation(limit=limit, output_path=output, fail_under_recall_at_5=0.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Sillage and QMD on the synthetic RAG corpus")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--skip-sillage", action="store_true")
    parser.add_argument("--skip-qmd", action="store_true")
    parser.add_argument("--qmd-mode", default=None)
    parser.add_argument("--output-dir", type=Path, default=ARTIFACTS)
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    sillage_report: dict | None = None
    qmd_report: dict | None = None

    if not args.skip_sillage:
        sillage_report = asyncio.run(
            run_sillage(args.limit, args.output_dir / "sillage-report.json")
        )
    else:
        sillage_report = {"engine": "sillage", "status": "skipped", "reason": "--skip-sillage"}

    if not args.skip_qmd:
        qmd_report = evaluate_qmd(
            mode=args.qmd_mode,
            limit=args.limit,
            output_path=args.output_dir / "qmd-report.json",
        )
    else:
        qmd_report = {"engine": "qmd", "status": "skipped", "reason": "--skip-qmd"}

    comparison = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "dataset": "rag_cases.json",
        "sillage": {
            "status": sillage_report.get("status"),
            "metrics": sillage_report.get("metrics"),
            "runId": sillage_report.get("runId"),
            "reason": sillage_report.get("reason"),
        },
        "qmd": {
            "status": qmd_report.get("status"),
            "metrics": qmd_report.get("metrics"),
            "qmd": qmd_report.get("qmd"),
            "reason": qmd_report.get("reason"),
        },
    }
    if (
        sillage_report.get("status") == "ok"
        and qmd_report.get("status") == "ok"
        and sillage_report.get("metrics")
        and qmd_report.get("metrics")
    ):
        comparison["deltasSillageMinusQmd"] = regression_deltas(
            sillage_report["metrics"], qmd_report["metrics"]
        )

    json_path = args.output_dir / "comparison-report.json"
    md_path = args.output_dir / "comparison-report.md"
    json_path.write_text(json.dumps(comparison, indent=2) + "\n", encoding="utf-8")
    write_markdown_report(
        {
            **comparison,
            "sillage": sillage_report,
            "qmd": qmd_report,
        },
        md_path,
    )
    print(json.dumps({"outputJson": str(json_path), "outputMd": str(md_path), "summary": comparison}, indent=2))

    # Exit non-zero only if Sillage was requested and failed hard
    if not args.skip_sillage and sillage_report.get("status") not in {"ok", "skipped"}:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

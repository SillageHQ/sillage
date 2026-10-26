#!/usr/bin/env python3
"""Interactive judge for vault smoke results — pick the right rank for each question.

Two modes:
  1) From a saved report (fast, no API / no embeddings):
       uv run python evaluation/judge_vault_smoke.py
       uv run python evaluation/judge_vault_smoke.py --report evaluation/artifacts/vault-smoke-….json

  2) Live search then judge (needs API + OPENROUTER_API_KEY):
       uv run python evaluation/judge_vault_smoke.py --live

Keys during a question:
  1-5   mark that result as correct (can type several: 1 3)
  m     miss — nothing relevant
  n     no retrieval needed
  s     skip
  b     back one question
  q     quit and save gold
  ?     help
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
PRIVATE = HERE / "private"
ARTIFACTS = HERE / "artifacts"
DEFAULT_GOLD = PRIVATE / "vault_smoke.json"


def latest_report() -> Path | None:
    files = sorted(ARTIFACTS.glob("vault-smoke-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    return files[0] if files else None


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def save_gold(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def path_fragment(path: str) -> str:
    parts = [p for p in path.strip("/").split("/") if p]
    if len(parts) >= 2:
        return "/".join(parts[-2:])
    return path


def clear() -> None:
    if sys.stdout.isatty():
        print("\033[2J\033[H", end="")


def print_header(index: int, total: int, case: dict[str, Any], meta: dict[str, Any] | None) -> None:
    print("=" * 72)
    print(f"  Question {index + 1}/{total}  ·  id={case.get('id')}")
    print("=" * 72)
    print()
    print(f"  Q: {case.get('query')}")
    print()
    if case.get("expectedPathContains"):
        print(f"  Gold actuel: {case.get('expectedPathContains')}")
    if case.get("notes"):
        print(f"  Notes: {case.get('notes')}")
    if meta:
        ranking = meta.get("ranking") or "?"
        print(f"  ranking: {ranking}")
    print()


def print_items(items: list[dict[str, Any]]) -> None:
    if not items:
        print("  (aucun résultat)")
        return
    for idx, item in enumerate(items, start=1):
        path = item.get("path") or "?"
        title = item.get("title") or ""
        score = item.get("score")
        text = (item.get("text") or "").replace("\n", " ").strip()
        if len(text) > 140:
            text = text[:137] + "..."
        score_s = f"{float(score):.4f}" if isinstance(score, (int, float)) else ""
        print(f"  [{idx}]  {path}")
        if title:
            print(f"       {title}" + (f"  · score {score_s}" if score_s else ""))
        else:
            if score_s:
                print(f"       score {score_s}")
        print(f"       {text}")
        print()


def apply_ranks(case: dict[str, Any], items: list[dict[str, Any]], ranks: list[int]) -> None:
    expected = list(case.get("expectedPathContains") or [])
    for rank in ranks:
        if rank < 1 or rank > len(items):
            print(f"  ! rang {rank} invalide")
            continue
        path = str(items[rank - 1].get("path") or "")
        frag = path_fragment(path)
        if frag and frag not in expected:
            expected.append(frag)
        print(f"  → OK  #{rank}  {frag}")
    case["expectedPathContains"] = expected
    case["requiresRetrieval"] = True
    case["notes"] = _note(case, f"judge: ranks {ranks}")


def apply_miss(case: dict[str, Any]) -> None:
    case["requiresRetrieval"] = True
    # Keep empty expected → auto mode treats as ungraded; flag in notes
    case["notes"] = _note(case, "judge: MISS")
    print("  → MISS enregistré")


def apply_no_retrieval(case: dict[str, Any]) -> None:
    case["requiresRetrieval"] = False
    case["expectedPathContains"] = []
    case["notes"] = _note(case, "judge: no_retrieval")
    print("  → no retrieval")


def _note(case: dict[str, Any], tag: str) -> str:
    prev = (case.get("notes") or "").strip()
    if tag in prev:
        return prev
    return f"{prev} | {tag}".strip(" |")


def parse_command(raw: str) -> tuple[str, list[int]]:
    raw = raw.strip()
    if not raw:
        return "empty", []
    low = raw.lower()
    if low in {"q", "quit"}:
        return "quit", []
    if low in {"s", "skip"}:
        return "skip", []
    if low in {"m", "miss"}:
        return "miss", []
    if low in {"n", "none"}:
        return "none", []
    if low in {"b", "back"}:
        return "back", []
    if low in {"?", "h", "help"}:
        return "help", []
    # ranks: "1", "1 3", "1,3", "1-3", "2+4"
    normalized = raw.replace(",", " ").replace("+", " ").replace("-", " ")
    parts = normalized.split()
    ranks: list[int] = []
    for p in parts:
        if p.isdigit():
            ranks.append(int(p))
        else:
            return "path", []  # free-text path handled by caller with raw
    if ranks:
        return "ranks", ranks
    return "path", []


def build_items_from_report_row(row: dict[str, Any]) -> list[dict[str, Any]]:
    """Report only stores paths — rebuild minimal items for display."""
    paths = row.get("paths") or []
    # If full items were stored, prefer them
    if row.get("items"):
        return list(row["items"])
    return [{"path": p, "title": "", "text": "", "score": None} for p in paths]


def enrich_report_with_items_from_log() -> None:
    """No-op placeholder — live mode stores full items."""
    return


async def live_fetch_all(gold: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    """Run live search for every query; return rows with full items."""
    sys.path.insert(0, str(HERE.parents[0]))
    sys.path.insert(0, str(HERE))
    import api
    from evaluate_vault_smoke import build_embedder, search
    from graph import reset_tenant, set_tenant

    tenant = os.environ.get("SILLAGE_TENANT_ID", "").strip()
    if not tenant:
        raise SystemExit("SILLAGE_TENANT_ID required for --live")
    token = set_tenant(tenant)
    embedder = build_embedder()
    import httpx

    rows: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=60, headers=api._app_api_headers()) as client:
        try:
            for case in gold["queries"]:
                query = (case.get("query") or "").strip()
                print(f"  searching: {case.get('id')} …", flush=True)
                items, meta, latency = await search(client, embedder, query, limit)
                rows.append(
                    {
                        "id": case.get("id"),
                        "query": query,
                        "paths": [i.get("path") for i in items],
                        "items": items,
                        "ranking": meta.get("ranking"),
                        "channels": meta.get("channels"),
                        "latencyMs": latency,
                    }
                )
        finally:
            reset_tenant(token)
    return rows


def is_judged(case: dict[str, Any]) -> bool:
    notes = case.get("notes") or ""
    if case.get("expectedPathContains"):
        return True
    if "judge: MISS" in notes or "judge: no_retrieval" in notes:
        return True
    return False


def judge_loop(
    gold: dict[str, Any],
    rows_by_id: dict[str, dict[str, Any]],
    gold_path: Path,
    *,
    only_ungraded: bool,
) -> None:
    queries = gold["queries"]
    indices = list(range(len(queries)))
    if only_ungraded:
        indices = [i for i, case in enumerate(queries) if not is_judged(case)]

    if not indices:
        print("Rien à juger (tout déjà noté). Relance sans --only-ungraded pour tout revoir.")
        return

    pos = 0
    while 0 <= pos < len(indices):
        index = indices[pos]
        case = queries[index]
        qid = case.get("id") or f"q{index}"
        row = rows_by_id.get(qid) or rows_by_id.get(case.get("query") or "")
        if not row:
            # try match by query text
            for r in rows_by_id.values():
                if r.get("query") == case.get("query"):
                    row = r
                    break
        items = build_items_from_report_row(row) if row else []
        meta = {"ranking": (row or {}).get("ranking")} if row else None

        clear()
        print_header(pos, len(indices), case, meta)
        if not row:
            print("  ⚠ pas de résultats dans le rapport pour cette question.")
            print("    Lance d'abord: uv run python evaluation/evaluate_vault_smoke.py --auto")
            print("    ou: uv run python evaluation/judge_vault_smoke.py --live")
            print()
        else:
            print_items(items[:5])

        print("-" * 72)
        print("  [1-5] bon résultat   [1 3] plusieurs   [m] miss   [n] pas de RAG")
        print("  [s] skip   [b] précédent   [q] quitter+sauver   [?] aide")
        print("-" * 72)
        try:
            raw = input("  ton choix > ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\n  Sauvé.")
            break

        cmd, ranks = parse_command(raw)
        if cmd == "help":
            print(__doc__)
            input("  Entrée pour continuer…")
            continue
        if cmd == "quit":
            break
        if cmd == "back":
            pos = max(0, pos - 1)
            continue
        if cmd == "skip" or cmd == "empty":
            pos += 1
            continue
        if cmd == "miss":
            apply_miss(case)
            queries[index] = case
            gold["queries"] = queries
            save_gold(gold_path, gold)
            pos += 1
            continue
        if cmd == "none":
            apply_no_retrieval(case)
            queries[index] = case
            gold["queries"] = queries
            save_gold(gold_path, gold)
            pos += 1
            continue
        if cmd == "ranks":
            apply_ranks(case, items, ranks)
            queries[index] = case
            gold["queries"] = queries
            save_gold(gold_path, gold)
            pos += 1
            continue
        if cmd == "path":
            expected = list(case.get("expectedPathContains") or [])
            if raw and raw not in expected:
                expected.append(raw)
            case["expectedPathContains"] = expected
            case["requiresRetrieval"] = True
            case["notes"] = _note(case, f"judge: path {raw}")
            print(f"  → path {raw!r}")
            queries[index] = case
            gold["queries"] = queries
            save_gold(gold_path, gold)
            pos += 1
            continue

    save_gold(gold_path, gold)
    print()
    print(f"Gold sauvé → {gold_path}")
    graded = sum(1 for c in gold["queries"] if c.get("expectedPathContains") or "judge: MISS" in (c.get("notes") or "") or c.get("requiresRetrieval") is False)
    print(f"Progression: {graded}/{len(gold['queries'])} jugées (approx)")
    print()
    print("Re-score auto:")
    print("  uv run python evaluation/evaluate_vault_smoke.py --auto")


def main() -> None:
    parser = argparse.ArgumentParser(description="Interactive vault smoke judge")
    parser.add_argument("--gold", type=Path, default=DEFAULT_GOLD)
    parser.add_argument("--report", type=Path, default=None, help="vault-smoke-*.json (default: latest)")
    parser.add_argument("--live", action="store_true", help="Re-run searches then judge")
    parser.add_argument("--limit", type=int, default=5)
    parser.add_argument("--only-ungraded", action="store_true", help="Skip already judged questions")
    parser.add_argument("--save-report", type=Path, default=None, help="When --live, also write a report")
    args = parser.parse_args()

    if not args.gold.exists():
        raise SystemExit(f"Gold manquant: {args.gold}\nCopie vault_smoke.example.json → vault_smoke.json")

    gold = load_json(args.gold)

    if args.live:
        import asyncio

        print("Recherche live sur le vault indexé…")
        rows = asyncio.run(live_fetch_all(gold, args.limit))
        report = {
            "engine": "sillage-vault-smoke",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "mode": "live-judge",
            "queries": rows,
        }
        ARTIFACTS.mkdir(parents=True, exist_ok=True)
        out = args.save_report or (ARTIFACTS / f"vault-smoke-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json")
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Rapport: {out}")
        rows_by_id = {r["id"]: r for r in rows if r.get("id")}
        for r in rows:
            if r.get("query"):
                rows_by_id[r["query"]] = r
    else:
        report_path = args.report or latest_report()
        if not report_path or not report_path.exists():
            raise SystemExit(
                "Aucun rapport vault-smoke-*.json trouvé.\n"
                "Lance d'abord:\n"
                "  uv run python evaluation/evaluate_vault_smoke.py --auto\n"
                "ou:\n"
                "  uv run python evaluation/judge_vault_smoke.py --live"
            )
        print(f"Rapport: {report_path}")
        report = load_json(report_path)
        rows_by_id = {}
        for r in report.get("queries") or []:
            if r.get("id"):
                rows_by_id[r["id"]] = r
            if r.get("query"):
                rows_by_id[r["query"]] = r

        # Rehydrate full text from live re-fetch if report has only paths?
        # Optional: if items missing, user still sees paths — OK for judging.

    judge_loop(gold, rows_by_id, args.gold, only_ungraded=args.only_ungraded)


if __name__ == "__main__":
    main()

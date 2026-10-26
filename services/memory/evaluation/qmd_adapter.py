"""QMD benchmark adapter — materializes the synthetic corpus and runs pinned QMD.

Produces the same normalized JSON shape as the Sillage engine runner so reports
can be compared side by side.

Requires: npm package @tobilu/qmd at the version pinned in qmd_config.json.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import sys

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from metrics import aggregate_query_results, score_query

DATASET = HERE / "rag_cases.json"
CONFIG_PATH = HERE / "qmd_config.json"
ARTIFACTS = HERE / "artifacts"


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def materialize_corpus(documents: list[dict[str, Any]], root: Path) -> Path:
    """Write dataset markdown files under root; return the collection directory."""
    collection = root / "vault"
    for document in documents:
        path = collection / document["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(document["content"], encoding="utf-8")
    return collection


def _run(cmd: list[str], *, env: dict[str, str], cwd: Path | None = None, timeout: int = 600) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd) if cwd else None,
        timeout=timeout,
    )


def resolve_qmd_bin(config: dict[str, Any]) -> str:
    override = os.environ.get("QMD_BIN")
    if override:
        return override
    which = shutil.which("qmd")
    if which:
        return which
    # npx fallback with pinned package
    package = f"{config['package']}@{config['version']}"
    return package  # used with npx


def qmd_cmd_prefix(config: dict[str, Any]) -> list[str]:
    override = os.environ.get("QMD_BIN")
    if override:
        return [override]
    which = shutil.which("qmd")
    if which:
        return [which]
    return ["npx", "--yes", f"{config['package']}@{config['version']}"]


def ensure_qmd_available(config: dict[str, Any]) -> tuple[bool, str]:
    prefix = qmd_cmd_prefix(config)
    try:
        result = _run([*prefix, "--version"], env=os.environ.copy(), timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, f"qmd unavailable: {exc}"
    if result.returncode != 0:
        # some builds print version on --help only
        result = _run([*prefix, "--help"], env=os.environ.copy(), timeout=120)
        if result.returncode != 0:
            return False, (result.stderr or result.stdout or "qmd not runnable").strip()
    version_out = (result.stdout or result.stderr or "").strip().splitlines()
    return True, version_out[0] if version_out else "qmd-present"


def normalize_qmd_items(raw: Any, limit: int) -> list[dict[str, Any]]:
    """Map QMD JSON output to {id, path, title, score, text?}."""
    if raw is None:
        return []
    rows: list[Any]
    if isinstance(raw, list):
        rows = raw
    elif isinstance(raw, dict):
        rows = raw.get("results") or raw.get("items") or raw.get("documents") or []
    else:
        return []

    items: list[dict[str, Any]] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        file_field = str(row.get("file") or row.get("path") or row.get("displayPath") or "")
        # qmd://collection/__evaluation__/... → __evaluation__/...
        path = file_field
        if path.startswith("qmd://"):
            parts = path.split("/", 3)
            path = parts[3] if len(parts) > 3 else path
        # strip collection prefix if present as first segment duplicate
        if path.startswith("vault/"):
            path = path[len("vault/") :]
        title = row.get("title")
        if title is None:
            title = Path(path).stem if path else ""
        items.append(
            {
                "id": str(row.get("docid") or row.get("id") or path),
                "path": path,
                "title": title,
                "score": float(row.get("score") or 0),
                "text": row.get("snippet") or row.get("text") or "",
            }
        )
    return items


def parse_qmd_json(stdout: str) -> Any:
    text = stdout.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Some CLI builds emit logs before JSON — take last JSON object/array.
        for start in (text.rfind("["), text.rfind("{")):
            if start >= 0:
                try:
                    return json.loads(text[start:])
                except json.JSONDecodeError:
                    continue
    return None


def setup_qmd_index(
    *,
    config: dict[str, Any],
    collection_dir: Path,
    home: Path,
    mode: str,
) -> dict[str, str]:
    """Create an isolated QMD home, add collection, update, optionally embed."""
    home.mkdir(parents=True, exist_ok=True)
    config_dir = home / "config"
    cache_dir = home / "cache"
    config_dir.mkdir(exist_ok=True)
    cache_dir.mkdir(exist_ok=True)

    env = os.environ.copy()
    env["QMD_CONFIG_DIR"] = str(config_dir)
    env["XDG_CONFIG_HOME"] = str(home / "xdg-config")
    env["XDG_CACHE_HOME"] = str(cache_dir)
    env["NO_COLOR"] = "1"

    prefix = qmd_cmd_prefix(config)
    name = config["cli"]["collectionName"]

    # Prefer project-local init inside home/work
    work = home / "work"
    work.mkdir(exist_ok=True)

    add = _run(
        [*prefix, "collection", "add", str(collection_dir), "--name", name, "--mask", "**/*.md"],
        env=env,
        cwd=work,
        timeout=180,
    )
    if add.returncode != 0:
        raise RuntimeError(f"qmd collection add failed: {add.stderr or add.stdout}")

    update = _run([*prefix, "update"], env=env, cwd=work, timeout=300)
    if update.returncode != 0:
        raise RuntimeError(f"qmd update failed: {update.stderr or update.stdout}")

    if mode in {"vsearch", "query", "vector-search", "deep-search"}:
        embed = _run([*prefix, "embed"], env=env, cwd=work, timeout=3600)
        if embed.returncode != 0:
            raise RuntimeError(f"qmd embed failed: {embed.stderr or embed.stdout}")

    return env


def run_qmd_search(
    *,
    config: dict[str, Any],
    env: dict[str, str],
    query: str,
    mode: str,
    limit: int,
    work: Path,
) -> tuple[list[dict[str, Any]], float, str | None]:
    prefix = qmd_cmd_prefix(config)
    name = config["cli"]["collectionName"]
    cmd = [*prefix, mode, query, "-n", str(limit), "-c", name, "--json"]
    started = time.monotonic()
    try:
        result = _run(cmd, env=env, cwd=work, timeout=300)
    except subprocess.TimeoutExpired:
        return [], (time.monotonic() - started) * 1000, "timeout"
    latency = (time.monotonic() - started) * 1000
    if result.returncode != 0:
        return [], latency, (result.stderr or result.stdout or "qmd search failed").strip()[:500]
    raw = parse_qmd_json(result.stdout)
    return normalize_qmd_items(raw, limit), latency, None


def evaluate_qmd(
    *,
    mode: str | None = None,
    limit: int = 10,
    output_path: Path | None = None,
    dataset_path: Path = DATASET,
) -> dict[str, Any]:
    config = load_config()
    mode = mode or str(config.get("defaultMode") or "query")
    dataset = json.loads(dataset_path.read_text(encoding="utf-8"))
    available, version_line = ensure_qmd_available(config)
    if not available:
        report = {
            "engine": "qmd",
            "status": "skipped",
            "reason": version_line,
            "qmd": config,
            "metrics": None,
            "queries": [],
        }
        if output_path:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return report

    home = ARTIFACTS / "qmd-home"
    if home.exists():
        shutil.rmtree(home)
    home.mkdir(parents=True)

    with tempfile.TemporaryDirectory(prefix="qmd-corpus-") as tmp:
        collection_dir = materialize_corpus(dataset["documents"], Path(tmp))
        env = setup_qmd_index(config=config, collection_dir=collection_dir, home=home, mode=mode)
        work = home / "work"
        rows: list[dict[str, Any]] = []
        for case in dataset["queries"]:
            requires = bool(case.get("requiresRetrieval", True))
            if not requires:
                # QMD always retrieves; score empty expectation as "would need routing"
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
                        routed_without_retrieval=True,
                    )
                )
                # Mark that QMD does not implement no-retrieval routing
                rows[-1]["nonRetrievalCorrect"] = 0.0
                rows[-1]["note"] = "qmd-has-no-no_retrieval-router"
                continue

            # Conversational: use query as-is (QMD has no history); still measurable.
            items, latency, error = run_qmd_search(
                config=config,
                env=env,
                query=case["query"],
                mode=mode,
                limit=limit,
                work=work,
            )
            rows.append(
                score_query(
                    query_id=case["id"],
                    query=case["query"],
                    category=case["category"],
                    requires_retrieval=True,
                    expected_paths=case.get("expectedPaths") or [],
                    forbidden_paths=case.get("forbiddenPaths") or [],
                    items=items,
                    latency_ms=latency,
                    error=error,
                )
            )

    metrics = aggregate_query_results(rows)
    report = {
        "engine": "qmd",
        "status": "ok",
        "qmd": {
            **config,
            "resolvedVersionLine": version_line,
            "mode": mode,
        },
        "metrics": metrics,
        "queries": rows,
    }
    out = output_path or (ARTIFACTS / "qmd-report.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return report


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Run QMD against the synthetic RAG corpus")
    parser.add_argument("--mode", default=None, help="qmd mode: search | vsearch | query")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    report = evaluate_qmd(mode=args.mode, limit=args.limit, output_path=args.output)
    print(json.dumps({"status": report["status"], "metrics": report.get("metrics"), "reason": report.get("reason")}, indent=2))
    if report["status"] not in {"ok", "skipped"}:
        raise SystemExit(1)


if __name__ == "__main__":
    main()

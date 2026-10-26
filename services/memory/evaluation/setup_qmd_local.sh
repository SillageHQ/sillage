#!/usr/bin/env bash
# Install / verify QMD and prepare an isolated index (does not touch your Obsidian vault).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PINNED="${QMD_VERSION:-2.5.3}"
HOME_DIR="$ROOT/evaluation/artifacts/qmd-home"
CORPUS="$HOME_DIR/corpus"

echo "==> QMD package @tobilu/qmd@${PINNED}"
if ! command -v qmd >/dev/null 2>&1 || [[ "$(qmd --version 2>/dev/null | head -1)" != *"${PINNED}"* ]]; then
  echo "    installing globally…"
  npm install -g "@tobilu/qmd@${PINNED}"
fi
qmd --version
echo

echo "==> Isolated home: $HOME_DIR"
mkdir -p "$HOME_DIR"/{config,cache,xdg-config,work,corpus}

export QMD_CONFIG_DIR="$HOME_DIR/config"
export XDG_CONFIG_HOME="$HOME_DIR/xdg-config"
export XDG_CACHE_HOME="$HOME_DIR/cache"
export NO_COLOR=1

echo "==> Doctor"
qmd doctor || true
echo

echo "==> Materialize synthetic corpus from rag_cases.json"
python3 - <<PY
import json, shutil
from pathlib import Path
root = Path(r"$CORPUS")
data = json.loads(Path(r"$ROOT/evaluation/rag_cases.json").read_text())
if root.exists():
    shutil.rmtree(root)
root.mkdir(parents=True)
for doc in data["documents"]:
    p = root / doc["path"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(doc["content"], encoding="utf-8")
print(f"    {len(data['documents'])} docs → {root}")
PY

echo "==> Collection sillage-eval (BM25 index)"
cd "$HOME_DIR/work"
if qmd collection list 2>/dev/null | grep -q sillage-eval; then
  qmd update -c sillage-eval || qmd update
else
  qmd collection add "$CORPUS" --name sillage-eval --mask '**/*.md'
fi
qmd status
echo

echo "==> BM25 smoke (no models)"
qmd search "public debt" -c sillage-eval -n 3 --json | head -40
echo

cat <<'EOF'
────────────────────────────────────────────────────────────
QMD is ready for BM25 (`qmd search`).

Full hybrid (like production QMD) needs ~2GB GGUF models:

  # uses isolated cache if env vars still set, else ~/.cache/qmd
  export QMD_CONFIG_DIR=…/evaluation/artifacts/qmd-home/config
  export XDG_CACHE_HOME=…/evaluation/artifacts/qmd-home/cache
  qmd pull          # download embed + rerank + expansion
  qmd embed -c sillage-eval
  qmd query "…" -c sillage-eval --json -n 5

Index YOUR vault (careful — separate collection name):

  qmd collection add "/path/to/obsidian/vault" --name sillage-vault --mask '**/*.md'
  qmd update -c sillage-vault
  qmd search "euro" -c sillage-vault --json   # BM25 only
  # after pull + embed:
  qmd query "pourquoi l'euro c'est de la merde ?" -c sillage-vault --json -n 5

Always set isolated QMD_CONFIG_DIR / XDG_CACHE_HOME for Sillage benchmarks
so you don't mix indexes with other projects.
────────────────────────────────────────────────────────────
EOF

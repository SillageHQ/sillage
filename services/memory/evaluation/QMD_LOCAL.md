# Faire tourner QMD en local

Package épinglé : **`@tobilu/qmd@2.5.3`** (voir `qmd_config.json`).

## Prérequis

- Node.js ≥ 22  
- macOS : `brew install sqlite` (extensions)  
- Disque : ~**2–3 Go** pour les modèles GGUF (hybrid complet)  
- GPU Metal (Mac) recommandé ; sinon CPU très lent sur `query` / `embed`

## Install

```bash
npm install -g @tobilu/qmd@2.5.3
qmd --version   # → qmd 2.5.3
qmd doctor
```

Setup isolé + corpus synthétique Sillage :

```bash
cd services/memory
./evaluation/setup_qmd_local.sh
```

L’index vit sous `evaluation/artifacts/qmd-home/` (gitignored), **pas** dans ton vault.

## Trois modes (du léger au lourd)

| Commande | Besoin modèles | RAM/GPU | Usage |
| --- | --- | --- | --- |
| `qmd search "…"` | **Non** | faible | BM25 only — comparable lexical |
| `qmd vsearch "…"` | embed (~300MB) | moyen | vectoriel only |
| `qmd query "…"` | embed + expand + rerank (~2GB) | **élevé** | pipeline “full QMD” |

### BM25 only (recommandé pour démarrer)

```bash
export QMD_CONFIG_DIR="$(pwd)/evaluation/artifacts/qmd-home/config"
export XDG_CONFIG_HOME="$(pwd)/evaluation/artifacts/qmd-home/xdg-config"
export XDG_CACHE_HOME="$(pwd)/evaluation/artifacts/qmd-home/cache"

qmd search "public debt" -c sillage-eval -n 5 --json
```

### Full hybrid (parité “vraie” QMD)

```bash
# same env exports…
qmd pull                          # télécharge les 3 GGUF (une fois)
qmd embed -c sillage-eval         # vecteurs
qmd query "What controls public debt sustainability?" -c sillage-eval --json -n 5
# plus rapide sans rerank LLM :
qmd query "…" -c sillage-eval --no-rerank --json -n 5
```

Sur M1 Pro, `qmd doctor` a vu **Metal** — le full est viable, mais le 1er `pull` + `embed` prend du temps.

## Indexer ton vault Obsidian (comparaison gold)

**Collection séparée**, jamais écraser `sillage-eval` :

```bash
# same isolated env as above
VAULT="/chemin/absolu/vers/ton/vault"
qmd collection add "$VAULT" --name sillage-vault --mask '**/*.md'
qmd update -c sillage-vault

# lexical only (rapide)
qmd search "j'ai quel MMR actuel ?" -c sillage-vault -n 5 --json

# full (après pull + embed -c sillage-vault)
qmd query "pourquoi l'euro c'est de la merde ?" -c sillage-vault --json -n 5
```

Puis comparer à la main avec le gold `private/vault_smoke.json` (mêmes 17 questions).

## Via l’adaptateur Sillage

```bash
cd services/memory
# QMD sur PATH (installé)
uv run python evaluation/qmd_adapter.py --mode search   # BM25
# après pull+embed du corpus synthétique :
uv run python evaluation/qmd_adapter.py --mode query
uv run python evaluation/compare_engines.py --skip-sillage   # QMD only
```

## Ressources

| Étape | Ordre de grandeur |
| --- | --- |
| `npm i -g` | ~minutes, peu de disque |
| `qmd search` | secondes, ~100MB RAM |
| `qmd pull` | ~2GB download |
| `qmd embed` vault moyen | minutes–dizaines de min, GPU utile |
| `qmd query` | plusieurs s–dizaines de s / query si CPU |

Si la machine sature : rester en **`search` (BM25)** pour le lexical, et n’utiliser `query` que sur le gold 17.

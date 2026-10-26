# Reference baselines

Commit only anonymized synthetic metrics here — never private vault results.

## Freeze Sillage reference

After a green full run on the synthetic corpus:

```bash
cp ../artifacts/sillage-report.json ./sillage-reference.json
```

`evaluate_rag.py` loads `sillage-reference.json` when present and fails CI/local runs if key metrics regress by more than 2%.

## Optional QMD snapshot

```bash
cp ../artifacts/qmd-report.json ./qmd-reference.json
```

Useful for offline comparison when local GGUF models are available in CI.

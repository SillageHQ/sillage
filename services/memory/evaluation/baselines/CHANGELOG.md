# Baseline changelog

## 2026-08-07 — retrieval_v2 (RRF + exact bonuses + quality soft-penalties)

Source: `artifacts/sillage-report-v2.json` after shipping `services/api/src/rag-search.ts`.

| Metric | legacy linear | rrf_v2 |
| --- | ---: | ---: |
| Recall@1 | 0.811 | 0.911 |
| Recall@5 | 0.978 | 0.978 |
| MRR | 0.889 | 0.939 |
| nDCG@10 | 0.910 | 0.933 |
| Forbidden hit rate | 0.128 | 0.006 |
| Adversarial forbidden | 0.900 | 0.050 |
| Adversarial R@1 | 0.400 | 1.000 |
| Temporal forbidden | 0.250 | 0.000 |

Rollback: `RETRIEVAL_V2=0` on the API process.

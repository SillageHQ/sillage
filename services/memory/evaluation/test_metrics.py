"""Unit tests for evaluation metrics (no live services required)."""
from __future__ import annotations

import unittest

from metrics import (
    aggregate_query_results,
    fails_regression,
    mrr,
    ndcg_at_k,
    recall_at_k,
    score_query,
)


class MetricsTest(unittest.TestCase):
    def test_recall_and_mrr(self) -> None:
        ranked = ["a", "b", "c"]
        self.assertEqual(recall_at_k(ranked, {"c"}, 1), 0.0)
        self.assertEqual(recall_at_k(ranked, {"c"}, 5), 1.0)
        self.assertEqual(mrr(ranked, {"c"}), 1 / 3)

    def test_ndcg_perfect(self) -> None:
        ranked = ["a", "b"]
        self.assertEqual(ndcg_at_k(ranked, {"a", "b"}, 2), 1.0)

    def test_negative_query_scoring(self) -> None:
        empty = score_query(
            query_id="n1",
            query="Salut !",
            category="negative",
            requires_retrieval=False,
            expected_paths=[],
            forbidden_paths=[],
            items=[],
            routed_without_retrieval=True,
        )
        self.assertEqual(empty["nonRetrievalCorrect"], 1.0)

        leaked = score_query(
            query_id="n2",
            query="OK",
            category="negative",
            requires_retrieval=False,
            expected_paths=[],
            forbidden_paths=[],
            items=[{"id": "x", "path": "p", "title": "t"}],
            routed_without_retrieval=False,
        )
        self.assertEqual(leaked["nonRetrievalCorrect"], 0.0)

    def test_forbidden_hit(self) -> None:
        row = score_query(
            query_id="a1",
            query="launch?",
            category="adversarial",
            requires_retrieval=True,
            expected_paths=["good.md"],
            forbidden_paths=["bad.md"],
            items=[{"id": "1", "path": "bad.md", "title": "Bad"}],
        )
        self.assertEqual(row["forbiddenHit"], 1.0)
        self.assertEqual(row["recallAt5"], 0.0)

    def test_aggregate_and_regression(self) -> None:
        rows = [
            score_query(
                query_id="s1",
                query="q",
                category="semantic",
                requires_retrieval=True,
                expected_paths=["a.md"],
                forbidden_paths=[],
                items=[{"id": "1", "path": "a.md", "title": "A"}],
                latency_ms=10,
            ),
            score_query(
                query_id="s2",
                query="q2",
                category="semantic",
                requires_retrieval=True,
                expected_paths=["b.md"],
                forbidden_paths=[],
                items=[{"id": "2", "path": "c.md", "title": "C"}],
                latency_ms=20,
            ),
        ]
        metrics = aggregate_query_results(rows)
        self.assertEqual(metrics["queries"], 2)
        self.assertEqual(metrics["recallAt5"], 0.5)
        self.assertEqual(metrics["latencyMs"]["count"], 2)

        baseline = {"recallAt5": 0.9, "mrr": 0.9, "ndcgAt10": 0.9, "citationOpenability": 1.0, "recallAt1": 0.9}
        failures = fails_regression(metrics, baseline, max_drop=0.02)
        self.assertTrue(any("recallAt5" in item for item in failures))


if __name__ == "__main__":
    unittest.main()

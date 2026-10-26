import hashlib
import unittest
from unittest.mock import AsyncMock

from pydantic import ValidationError

from local_artifacts import (
    IngestionArtifactV1,
    apply_ingestion_artifact,
    artifact_graph_rows,
    delete_local_artifact_path,
    feature_hash_embedding,
)


def artifact_payload():
    from local_artifacts import _stable_id

    chunk_text = "Ada maintains Sillage."
    chunk_hash = hashlib.sha256(chunk_text.encode()).hexdigest()
    payload = {
        "version": "1",
        "artifactId": "",
        "provider": "claude-code-oauth",
        "pipelineSignature": "claude-code:structured-extraction:v1:markdown-lines-v1:feature-hash-1024-v1",
        "note": {"path": "People/Ada.md", "title": "Ada", "contentHash": "b" * 64, "lineCount": 3},
        "extraction": {
            "summary": "Ada maintains Sillage.",
            "entities": [
                {"localId": "e1", "name": "Ada", "entityType": "person", "summary": "Maintainer", "sourceRanges": [{"startLine": 1, "endLine": 1}]},
                {"localId": "e2", "name": "Sillage", "entityType": "project", "summary": "Product", "sourceRanges": [{"startLine": 1, "endLine": 1}]},
            ],
            "facts": [
                {"localId": "f1", "subjectEntityId": "e1", "predicate": "maintains", "objectText": "the compiler", "validFrom": None, "validUntil": None, "sourceRanges": [{"startLine": 1, "endLine": 1}], "confidence": 0.9},
            ],
            "relations": [
                {"localId": "r1", "fromEntityId": "e1", "relationType": "works_on", "toEntityId": "e2", "sourceRanges": [{"startLine": 1, "endLine": 1}], "confidence": 0.95},
            ],
        },
        "embeddingModel": "sillage/feature-hash-1024-v1",
        "chunkerVersion": "markdown-lines-v1",
        "chunks": [{
            "id": _stable_id("People/Ada.md", "", "1", chunk_hash),
            "headingPath": "",
            "startLine": 1,
            "endLine": 1,
            "text": chunk_text,
            "contentHash": chunk_hash,
            "embedding": feature_hash_embedding("passage: Ada maintains Sillage."),
        }],
    }
    payload["artifactId"] = _stable_id(
        payload["note"]["path"], payload["note"]["contentHash"], payload["pipelineSignature"]
    )
    return payload


class LocalArtifactTests(unittest.IsolatedAsyncioTestCase):
    def test_contract_accepts_supported_claude_ingestion_model(self):
        payload = artifact_payload()
        payload["pipelineSignature"] = "claude-code:structured-extraction:v1:markdown-e5-1400chars-v2:local-embedding-v1:multilingual-e5-base:claude-sonnet"
        payload["embeddingModel"] = "sillage/multilingual-e5-base-padded-1024-v1"
        payload["chunkerVersion"] = "markdown-e5-1400chars-v2"
        payload["artifactId"] = hashlib.sha256(
            "\0".join(
                [payload["note"]["path"], payload["note"]["contentHash"], payload["pipelineSignature"]]
            ).encode()
        ).hexdigest()
        artifact = IngestionArtifactV1.model_validate(payload)
        self.assertEqual(artifact.pipeline_signature, payload["pipelineSignature"])

    def test_graph_rows_are_deterministic(self):
        artifact = IngestionArtifactV1.model_validate(artifact_payload())
        first = artifact_graph_rows(artifact, "tenant-123")
        second = artifact_graph_rows(artifact, "tenant-123")
        self.assertEqual(first, second)
        self.assertEqual(len(first[0]), 3)
        self.assertEqual(len(first[1]), 2)
        self.assertEqual(first[1][0]["fact"], "Ada maintains the compiler")

    def test_contract_rejects_unknown_entity_references(self):
        payload = artifact_payload()
        payload["extraction"]["facts"][0]["subjectEntityId"] = "missing"
        with self.assertRaisesRegex(ValidationError, "unknown entity"):
            IngestionArtifactV1.model_validate(payload)

    def test_feature_hash_embedding_is_normalized_and_stable(self):
        first = feature_hash_embedding("Ada maintains Sillage")
        self.assertEqual(first, feature_hash_embedding("Ada maintains Sillage"))
        self.assertEqual(len(first), 1_024)
        self.assertAlmostEqual(sum(value * value for value in first), 1.0)
        self.assertEqual([index for index, value in enumerate(first) if value], [76, 494, 983])

    async def test_apply_replaces_path_then_writes_graphiti_compatible_records(self):
        driver = AsyncMock()
        artifact = IngestionArtifactV1.model_validate(artifact_payload())
        result = await apply_ingestion_artifact(driver, artifact, "tenant-123")
        self.assertTrue(result["ok"])
        self.assertEqual(result["entities"], 3)
        self.assertEqual(result["relations"], 2)
        self.assertEqual(driver.execute_query.await_count, 6)
        for call in driver.execute_query.await_args_list:
            self.assertEqual(call.kwargs["tenant_id"], "tenant-123")

    async def test_delete_removes_local_path_and_orphans(self):
        driver = AsyncMock()
        driver.execute_query.side_effect = [([{"count": 1}], None, None), None, None, None]
        deleted = await delete_local_artifact_path(driver, "People/Ada.md", "tenant-123")
        self.assertEqual(deleted, 1)
        self.assertEqual(driver.execute_query.await_count, 4)
        for call in driver.execute_query.await_args_list:
            self.assertEqual(call.kwargs["tenant_id"], "tenant-123")


if __name__ == "__main__":
    unittest.main()

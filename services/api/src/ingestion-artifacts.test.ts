import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  currentClaudePipelineSignature,
  localEmbeddingModel,
  parseArtifactPreflight,
  parseIngestionArtifact,
} from "./ingestion-artifacts.js";

const hash = "a".repeat(64);
const signature = "claude-code:structured-extraction:v1:markdown-lines-v1:feature-hash-1024-v1";
const artifactId = createHash("sha256").update(`People/Ada.md\0${hash}\0${signature}`).digest("hex");

function validArtifact() {
  const chunkText = "Ada maintains the compiler.";
  const chunkHash = createHash("sha256").update(chunkText).digest("hex");
  const chunkId = createHash("sha256").update(["People/Ada.md", "", "1", chunkHash].join("\0")).digest("hex");
  return {
    version: "1",
    artifactId,
    provider: "claude-code-oauth",
    pipelineSignature: signature,
    note: { path: "People/Ada.md", title: "Ada", contentHash: hash, lineCount: 3 },
    extraction: {
      summary: "Ada maintains the compiler.",
      entities: [{ localId: "e1", name: "Ada", entityType: "person", summary: "Maintainer", sourceRanges: [{ startLine: 1, endLine: 1 }] }],
      facts: [{ localId: "f1", subjectEntityId: "e1", predicate: "maintains", objectText: "the compiler", validFrom: null, validUntil: null, sourceRanges: [{ startLine: 1, endLine: 1 }], confidence: 0.9 }],
      relations: [],
    },
    embeddingModel: "sillage/feature-hash-1024-v1",
    chunkerVersion: "markdown-lines-v1",
    chunks: [{
      id: chunkId, headingPath: "", startLine: 1, endLine: 1,
      text: chunkText, contentHash: chunkHash, embedding: Array(1_024).fill(0),
    }],
  };
}

describe("parseIngestionArtifact", () => {
  it("accepts a valid Claude Code artifact", () => {
    assert.equal(parseIngestionArtifact(validArtifact()).artifactId, artifactId);
  });

  it("accepts an artifact tied to a supported Claude ingestion model", () => {
    const artifact = validArtifact();
    artifact.pipelineSignature = "claude-code:structured-extraction:v1:markdown-e5-1400chars-v2:local-embedding-v1:multilingual-e5-small:claude-opus";
    artifact.embeddingModel = "sillage/multilingual-e5-small-padded-1024-v1";
    artifact.chunkerVersion = "markdown-e5-1400chars-v2";
    artifact.artifactId = createHash("sha256")
      .update(`${artifact.note.path}\0${artifact.note.contentHash}\0${artifact.pipelineSignature}`)
      .digest("hex");
    assert.equal(parseIngestionArtifact(artifact).pipelineSignature, artifact.pipelineSignature);
  });

  it("rejects evidence outside the note", () => {
    const artifact = validArtifact();
    artifact.extraction.entities[0].sourceRanges[0].endLine = 4;
    assert.throws(() => parseIngestionArtifact(artifact), /sourceRanges/);
  });

  it("rejects facts referencing an unknown entity", () => {
    const artifact = validArtifact();
    artifact.extraction.facts[0].subjectEntityId = "missing";
    assert.throws(() => parseIngestionArtifact(artifact), /fact fields/);
  });

  it("rejects unknown fields and traversal paths", () => {
    assert.throws(() => parseIngestionArtifact({ ...validArtifact(), tenantId: "forged" }), /unknown fields/);
    const artifact = validArtifact();
    artifact.note.path = "../Ada.md";
    assert.throws(() => parseIngestionArtifact(artifact), /path and title/);
  });

  it("rejects malformed local embeddings", () => {
    const artifact = validArtifact();
    artifact.chunks[0].embedding.pop();
    assert.throws(() => parseIngestionArtifact(artifact), /1024 finite dimensions/);
  });
});

describe("parseArtifactPreflight", () => {
  it("accepts the idempotency tuple", () => {
    assert.deepEqual(parseArtifactPreflight({ path: "Ada.md", contentHash: hash, pipelineSignature: signature }), {
      path: "Ada.md", contentHash: hash, pipelineSignature: signature,
    });
  });
});

describe("current local pipeline", () => {
  it("keeps storage and idempotency tied to the selected model pair", () => {
    assert.equal(localEmbeddingModel("multilingual-e5-base"), "sillage/multilingual-e5-base-padded-1024-v1");
    assert.equal(
      currentClaudePipelineSignature("opus", "multilingual-e5-base"),
      "claude-code:structured-extraction:v1:markdown-e5-1400chars-v2:local-embedding-v1:multilingual-e5-base:claude-opus",
    );
  });
});

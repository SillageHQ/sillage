import { createHash } from "node:crypto";

const SHA256 = /^[a-f0-9]{64}$/;
const LOCAL_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const MAX_ARTIFACT_BYTES = 12_000_000;
const MAX_ITEMS = 500;

export const INGESTION_ARTIFACT_VERSION = "1" as const;
export const CLAUDE_CODE_PROVIDER = "claude-code-oauth" as const;
export const LOCAL_EMBEDDING_MODEL = "sillage/feature-hash-1024-v1" as const;
export const CLAUDE_PIPELINE_SIGNATURE = "claude-code:structured-extraction:v1:markdown-lines-v1:feature-hash-1024-v1" as const;
export const CURRENT_CLAUDE_CHUNKER = "markdown-e5-1400chars-v2" as const;
const CLAUDE_PIPELINE_SIGNATURE_PATTERN = /^(?:claude-code:structured-extraction:v1:markdown-lines-v1:feature-hash-1024-v1(?::claude-(?:sonnet|opus|fable))?|claude-code:structured-extraction:v1:markdown-lines-v1:local-embedding-v1:(?:multilingual-e5-small|multilingual-e5-base):claude-(?:default|sonnet|opus|fable)|claude-code:structured-extraction:v1:markdown-e5-1400chars-v2:local-embedding-v1:(?:multilingual-e5-small|multilingual-e5-base):claude-(?:default|sonnet|opus|fable))$/;
const LOCAL_EMBEDDING_MODEL_PATTERN = /^sillage\/(?:feature-hash-1024-v1|(?:multilingual-e5-small|multilingual-e5-base)-padded-1024-v1)$/;

export function localEmbeddingModel(selection: string) {
  return new Set(["multilingual-e5-small", "multilingual-e5-base"]).has(selection)
    ? `sillage/${selection}-padded-1024-v1`
    : "sillage/multilingual-e5-small-padded-1024-v1";
}

export function currentClaudePipelineSignature(claudeModel: string, embeddingModel: string) {
  const model = new Set(["sonnet", "opus", "fable"]).has(claudeModel) ? claudeModel : "default";
  const embedding = new Set(["multilingual-e5-small", "multilingual-e5-base"]).has(embeddingModel)
    ? embeddingModel
    : "multilingual-e5-small";
  return `claude-code:structured-extraction:v1:${CURRENT_CLAUDE_CHUNKER}:local-embedding-v1:${embedding}:claude-${model}`;
}

type SourceRange = { startLine: number; endLine: number };
type Entity = {
  localId: string;
  name: string;
  entityType: string;
  summary: string;
  sourceRanges: SourceRange[];
};
type Fact = {
  localId: string;
  subjectEntityId: string;
  predicate: string;
  objectText: string;
  validFrom: string | null;
  validUntil: string | null;
  sourceRanges: SourceRange[];
  confidence: number;
};
type Relation = {
  localId: string;
  fromEntityId: string;
  relationType: string;
  toEntityId: string;
  sourceRanges: SourceRange[];
  confidence: number;
};
type ArtifactChunk = {
  id: string;
  headingPath: string;
  startLine: number;
  endLine: number;
  text: string;
  contentHash: string;
  embedding: number[];
};

export type IngestionArtifactV1 = {
  version: typeof INGESTION_ARTIFACT_VERSION;
  artifactId: string;
  provider: typeof CLAUDE_CODE_PROVIDER;
  pipelineSignature: string;
  note: {
    path: string;
    title: string;
    contentHash: string;
    lineCount: number;
  };
  extraction: {
    summary: string;
    entities: Entity[];
    facts: Fact[];
    relations: Relation[];
  };
  embeddingModel: string;
  chunkerVersion: "markdown-lines-v1" | "markdown-e5-1400chars-v2";
  chunks: ArtifactChunk[];
};

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedString(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && value.length <= max && (allowEmpty || value.trim().length > 0);
}

function exactKeys(value: Record<string, unknown>, keys: string[], label: string) {
  const allowed = new Set(keys);
  if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error(`${label} contains unknown fields`);
}

function validNotePath(value: string) {
  const parts = value.split("/");
  return value.endsWith(".md")
    && !value.includes("\\")
    && !value.startsWith("/")
    && !/^[A-Za-z]:/.test(value)
    && !parts.includes(".")
    && !parts.includes("..")
    && !parts.includes("");
}

function validRange(value: unknown, lineCount: number): value is SourceRange {
  const range = object(value);
  if (range) exactKeys(range, ["startLine", "endLine"], "source range");
  return Boolean(range
    && Number.isInteger(range.startLine)
    && Number.isInteger(range.endLine)
    && Number(range.startLine) >= 1
    && Number(range.endLine) >= Number(range.startLine)
    && Number(range.endLine) <= lineCount);
}

function validRanges(value: unknown, lineCount: number) {
  return Array.isArray(value) && value.length <= 100 && value.every((range) => validRange(range, lineCount));
}

function validConfidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validPipelineSignature(value: unknown): value is string {
  return typeof value === "string" && CLAUDE_PIPELINE_SIGNATURE_PATTERN.test(value);
}

export function parseIngestionArtifact(value: unknown): IngestionArtifactV1 {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_ARTIFACT_BYTES) throw new Error("artifact exceeds 12 MB");
  const artifact = object(value);
  const note = object(artifact?.note);
  const extraction = object(artifact?.extraction);
  if (!artifact || artifact.version !== INGESTION_ARTIFACT_VERSION) throw new Error("unsupported artifact version");
  exactKeys(artifact, ["version", "artifactId", "provider", "pipelineSignature", "note", "extraction", "embeddingModel", "chunkerVersion", "chunks"], "artifact");
  if (!SHA256.test(String(artifact.artifactId ?? ""))) throw new Error("artifactId must be a SHA-256 hex digest");
  if (artifact.provider !== CLAUDE_CODE_PROVIDER) throw new Error("provider is not supported");
  if (!validPipelineSignature(artifact.pipelineSignature)) throw new Error("pipelineSignature is invalid");
  if (!note || !boundedString(note.path, 1_024) || !validNotePath(note.path) || !boundedString(note.title, 500)) throw new Error("note path and title are required");
  exactKeys(note, ["path", "title", "contentHash", "lineCount"], "note");
  if (!SHA256.test(String(note.contentHash ?? ""))) throw new Error("note contentHash must be a SHA-256 hex digest");
  if (!Number.isInteger(note.lineCount) || Number(note.lineCount) < 1 || Number(note.lineCount) > 2_000_000) {
    throw new Error("note lineCount is invalid");
  }
  if (!extraction || !boundedString(extraction.summary, 20_000, true)) throw new Error("extraction summary is invalid");
  exactKeys(extraction, ["summary", "entities", "facts", "relations"], "extraction");
  const expectedId = createHash("sha256")
    .update(`${note.path}\0${note.contentHash}\0${artifact.pipelineSignature}`)
    .digest("hex");
  if (artifact.artifactId !== expectedId) throw new Error("artifactId does not match its idempotency tuple");

  const entities = extraction.entities;
  const facts = extraction.facts;
  const relations = extraction.relations;
  if (![entities, facts, relations].every((items) => Array.isArray(items) && items.length <= MAX_ITEMS)) {
    throw new Error("extraction collections must contain at most 500 items");
  }
  const lineCount = Number(note.lineCount);
  const entityIds = new Set<string>();
  for (const raw of entities as unknown[]) {
    const item = object(raw);
    if (item) exactKeys(item, ["localId", "name", "entityType", "summary", "sourceRanges"], "entity");
    if (!item || !LOCAL_ID.test(String(item.localId ?? "")) || entityIds.has(String(item.localId))) throw new Error("entity localId is invalid or duplicated");
    if (!boundedString(item.name, 500) || !boundedString(item.entityType, 120) || !boundedString(item.summary, 10_000, true)) throw new Error("entity fields are invalid");
    if (!validRanges(item.sourceRanges, lineCount)) throw new Error("entity sourceRanges are invalid");
    entityIds.add(String(item.localId));
  }
  const itemIds = new Set(entityIds);
  for (const raw of facts as unknown[]) {
    const item = object(raw);
    if (item) exactKeys(item, ["localId", "subjectEntityId", "predicate", "objectText", "validFrom", "validUntil", "sourceRanges", "confidence"], "fact");
    const localId = String(item?.localId ?? "");
    if (!item || !LOCAL_ID.test(localId) || itemIds.has(localId)) throw new Error("fact localId is invalid or duplicated");
    if (!entityIds.has(String(item.subjectEntityId)) || !boundedString(item.predicate, 500) || !boundedString(item.objectText, 10_000)) throw new Error("fact fields are invalid");
    if (!(item.validFrom === null || boundedString(item.validFrom, 100)) || !(item.validUntil === null || boundedString(item.validUntil, 100))) throw new Error("fact validity is invalid");
    if (!validRanges(item.sourceRanges, lineCount) || !validConfidence(item.confidence)) throw new Error("fact evidence is invalid");
    itemIds.add(localId);
  }
  for (const raw of relations as unknown[]) {
    const item = object(raw);
    if (item) exactKeys(item, ["localId", "fromEntityId", "relationType", "toEntityId", "sourceRanges", "confidence"], "relation");
    const localId = String(item?.localId ?? "");
    if (!item || !LOCAL_ID.test(localId) || itemIds.has(localId)) throw new Error("relation localId is invalid or duplicated");
    if (!entityIds.has(String(item.fromEntityId)) || !entityIds.has(String(item.toEntityId)) || !boundedString(item.relationType, 500)) throw new Error("relation fields are invalid");
    if (!validRanges(item.sourceRanges, lineCount) || !validConfidence(item.confidence)) throw new Error("relation evidence is invalid");
    itemIds.add(localId);
  }
  if (typeof artifact.embeddingModel !== "string" || !LOCAL_EMBEDDING_MODEL_PATTERN.test(artifact.embeddingModel)
    || !new Set(["markdown-lines-v1", "markdown-e5-1400chars-v2"]).has(String(artifact.chunkerVersion))) {
    throw new Error("local index signature is not supported");
  }
  if (!Array.isArray(artifact.chunks) || artifact.chunks.length < 1 || artifact.chunks.length > MAX_ITEMS) {
    throw new Error("chunks must contain between 1 and 500 items");
  }
  const chunkIds = new Set<string>();
  for (const raw of artifact.chunks) {
    const chunk = object(raw);
    if (chunk) exactKeys(chunk, ["id", "headingPath", "startLine", "endLine", "text", "contentHash", "embedding"], "chunk");
    const id = String(chunk?.id ?? "");
    if (!chunk || !SHA256.test(id) || chunkIds.has(id) || !SHA256.test(String(chunk.contentHash ?? ""))) {
      throw new Error("chunk identity is invalid or duplicated");
    }
    if (!boundedString(chunk.headingPath, 2_000, true) || !boundedString(chunk.text, 20_000)) {
      throw new Error("chunk text is invalid");
    }
    const expectedContentHash = createHash("sha256").update(chunk.text as string).digest("hex");
    const expectedChunkId = createHash("sha256")
      .update(`${note.path}\0${chunk.headingPath}\0${chunk.startLine}\0${expectedContentHash}`)
      .digest("hex");
    if (chunk.contentHash !== expectedContentHash || id !== expectedChunkId) {
      throw new Error("chunk identity does not match its content");
    }
    if (!Number.isInteger(chunk.startLine) || !Number.isInteger(chunk.endLine)
      || Number(chunk.startLine) < 1 || Number(chunk.endLine) < Number(chunk.startLine)
      || Number(chunk.endLine) > lineCount) {
      throw new Error("chunk line range is invalid");
    }
    if (!Array.isArray(chunk.embedding) || chunk.embedding.length !== 1_024
      || chunk.embedding.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
      throw new Error("chunk embedding must contain 1024 finite dimensions");
    }
    chunkIds.add(id);
  }
  return value as IngestionArtifactV1;
}

export function parseArtifactPreflight(value: unknown) {
  const body = object(value);
  if (!body || !boundedString(body.path, 1_024) || !validNotePath(body.path)) throw new Error("path is required");
  exactKeys(body, ["path", "contentHash", "pipelineSignature"], "preflight");
  if (!SHA256.test(String(body.contentHash ?? ""))) throw new Error("contentHash must be a SHA-256 hex digest");
  if (!validPipelineSignature(body.pipelineSignature)) throw new Error("pipelineSignature is invalid");
  return {
    path: body.path as string,
    contentHash: body.contentHash as string,
    pipelineSignature: body.pipelineSignature as string,
  };
}

"""Deterministic application of locally extracted ingestion artifacts."""

import hashlib
import math
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class SourceRange(StrictModel):
    start_line: int = Field(alias="startLine", ge=1)
    end_line: int = Field(alias="endLine", ge=1)


class ExtractedEntity(StrictModel):
    local_id: str = Field(alias="localId", min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=500)
    entity_type: str = Field(alias="entityType", min_length=1, max_length=120)
    summary: str = Field(max_length=10_000)
    source_ranges: list[SourceRange] = Field(alias="sourceRanges", max_length=100)


class ExtractedFact(StrictModel):
    local_id: str = Field(alias="localId", min_length=1, max_length=120)
    subject_entity_id: str = Field(alias="subjectEntityId", min_length=1, max_length=120)
    predicate: str = Field(min_length=1, max_length=500)
    object_text: str = Field(alias="objectText", min_length=1, max_length=10_000)
    valid_from: str | None = Field(alias="validFrom", max_length=100)
    valid_until: str | None = Field(alias="validUntil", max_length=100)
    source_ranges: list[SourceRange] = Field(alias="sourceRanges", max_length=100)
    confidence: float = Field(ge=0, le=1)


class ExtractedRelation(StrictModel):
    local_id: str = Field(alias="localId", min_length=1, max_length=120)
    from_entity_id: str = Field(alias="fromEntityId", min_length=1, max_length=120)
    relation_type: str = Field(alias="relationType", min_length=1, max_length=500)
    to_entity_id: str = Field(alias="toEntityId", min_length=1, max_length=120)
    source_ranges: list[SourceRange] = Field(alias="sourceRanges", max_length=100)
    confidence: float = Field(ge=0, le=1)


class Extraction(StrictModel):
    summary: str = Field(max_length=20_000)
    entities: list[ExtractedEntity] = Field(max_length=500)
    facts: list[ExtractedFact] = Field(max_length=500)
    relations: list[ExtractedRelation] = Field(max_length=500)


class ArtifactNote(StrictModel):
    path: str = Field(min_length=1, max_length=1_024)
    title: str = Field(min_length=1, max_length=500)
    content_hash: str = Field(alias="contentHash", pattern=r"^[a-f0-9]{64}$")
    line_count: int = Field(alias="lineCount", ge=1, le=2_000_000)


class ArtifactChunk(StrictModel):
    id: str = Field(pattern=r"^[a-f0-9]{64}$")
    heading_path: str = Field(alias="headingPath", max_length=2_000)
    start_line: int = Field(alias="startLine", ge=1)
    end_line: int = Field(alias="endLine", ge=1)
    text: str = Field(min_length=1, max_length=20_000)
    content_hash: str = Field(alias="contentHash", pattern=r"^[a-f0-9]{64}$")
    embedding: list[float] = Field(min_length=1_024, max_length=1_024)


class IngestionArtifactV1(StrictModel):
    version: str = Field(pattern=r"^1$")
    artifact_id: str = Field(alias="artifactId", pattern=r"^[a-f0-9]{64}$")
    provider: str = Field(pattern=r"^claude-code-oauth$")
    pipeline_signature: str = Field(
        alias="pipelineSignature",
        pattern=r"^(?:claude-code:structured-extraction:v1:markdown-lines-v1:feature-hash-1024-v1(?::claude-(?:sonnet|opus|fable))?|claude-code:structured-extraction:v1:markdown-lines-v1:local-embedding-v1:(?:multilingual-e5-small|multilingual-e5-base):claude-(?:default|sonnet|opus|fable)|claude-code:structured-extraction:v1:markdown-e5-1400chars-v2:local-embedding-v1:(?:multilingual-e5-small|multilingual-e5-base):claude-(?:default|sonnet|opus|fable))$",
    )
    note: ArtifactNote
    extraction: Extraction
    embedding_model: str = Field(
        alias="embeddingModel",
        pattern=r"^sillage/(?:feature-hash-1024-v1|(?:multilingual-e5-small|multilingual-e5-base)-padded-1024-v1)$",
    )
    chunker_version: str = Field(
        alias="chunkerVersion", pattern=r"^(?:markdown-lines-v1|markdown-e5-1400chars-v2)$"
    )
    chunks: list[ArtifactChunk] = Field(max_length=500)

    @model_validator(mode="after")
    def validate_contract(self):
        expected_id = _stable_id(self.note.path, self.note.content_hash, self.pipeline_signature)
        if self.artifact_id != expected_id:
            raise ValueError("artifactId does not match its idempotency tuple")
        parts = self.note.path.split("/")
        if (
            not self.note.path.endswith(".md")
            or "\\" in self.note.path
            or (len(self.note.path) >= 2 and self.note.path[1] == ":")
            or any(part in {"", ".", ".."} for part in parts)
        ):
            raise ValueError("note path must be a normalized relative Markdown path")
        entity_ids = {entity.local_id for entity in self.extraction.entities}
        all_ids = [entity.local_id for entity in self.extraction.entities]
        all_ids.extend(fact.local_id for fact in self.extraction.facts)
        all_ids.extend(relation.local_id for relation in self.extraction.relations)
        if len(all_ids) != len(set(all_ids)):
            raise ValueError("local IDs must be unique")
        if any(fact.subject_entity_id not in entity_ids for fact in self.extraction.facts):
            raise ValueError("fact references an unknown entity")
        if any(
            relation.from_entity_id not in entity_ids or relation.to_entity_id not in entity_ids
            for relation in self.extraction.relations
        ):
            raise ValueError("relation references an unknown entity")
        ranges = [item for entity in self.extraction.entities for item in entity.source_ranges]
        ranges.extend(item for fact in self.extraction.facts for item in fact.source_ranges)
        ranges.extend(item for relation in self.extraction.relations for item in relation.source_ranges)
        if any(item.start_line > item.end_line or item.end_line > self.note.line_count for item in ranges):
            raise ValueError("source range is outside the note")
        if any(
            chunk.start_line > chunk.end_line
            or chunk.end_line > self.note.line_count
            or any(not math.isfinite(value) for value in chunk.embedding)
            for chunk in self.chunks
        ):
            raise ValueError("chunk range or embedding is invalid")
        for chunk in self.chunks:
            content_hash = hashlib.sha256(chunk.text.encode()).hexdigest()
            chunk_id = _stable_id(
                self.note.path,
                chunk.heading_path,
                str(chunk.start_line),
                content_hash,
            )
            if chunk.content_hash != content_hash or chunk.id != chunk_id:
                raise ValueError("chunk identity does not match its content")
        return self


def _stable_id(*parts: str) -> str:
    return hashlib.sha256("\0".join(parts).encode()).hexdigest()


def feature_hash_embedding(text: str) -> list[float]:
    vector = [0.0] * 1_024
    token: list[str] = []

    def add_token() -> None:
        if not token:
            return
        digest = hashlib.sha256("".join(token).lower().encode()).digest()
        bucket = int.from_bytes(digest[:2], "big") % len(vector)
        vector[bucket] += -1.0 if digest[2] & 1 else 1.0
        token.clear()

    for char in text:
        if char.isalnum():
            token.append(char)
        else:
            add_token()
    add_token()
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else vector


def _ranges_json(ranges: list[SourceRange]) -> str:
    return "[" + ",".join(
        f'{{"startLine":{item.start_line},"endLine":{item.end_line}}}' for item in ranges
    ) + "]"


def _entity_uuid(tenant_id: str, name: str, entity_type: str) -> str:
    return _stable_id(tenant_id, "entity", entity_type.casefold().strip(), name.casefold().strip())


def artifact_graph_rows(artifact: IngestionArtifactV1, tenant_id: str) -> tuple[list[dict], list[dict]]:
    entity_ids: dict[str, str] = {}
    entities: dict[str, dict] = {}
    for entity in artifact.extraction.entities:
        uuid = _entity_uuid(tenant_id, entity.name, entity.entity_type)
        entity_ids[entity.local_id] = uuid
        entities[uuid] = {
            "uuid": uuid,
            "name": entity.name,
            "entity_type": entity.entity_type,
            "summary": entity.summary,
            "source_ranges": _ranges_json(entity.source_ranges),
            "mention_uuid": _stable_id(artifact.artifact_id, "mention", entity.local_id),
        }

    edges: list[dict] = []
    for fact in artifact.extraction.facts:
        source_uuid = entity_ids[fact.subject_entity_id]
        object_uuid = _entity_uuid(tenant_id, fact.object_text, "fact-object")
        entities.setdefault(object_uuid, {
            "uuid": object_uuid,
            "name": fact.object_text,
            "entity_type": "fact-object",
            "summary": "",
            "source_ranges": _ranges_json(fact.source_ranges),
            "mention_uuid": _stable_id(artifact.artifact_id, "mention-object", fact.local_id),
        })
        subject = next(entity.name for entity in artifact.extraction.entities if entity.local_id == fact.subject_entity_id)
        edges.append({
            "uuid": _stable_id(artifact.artifact_id, "fact", fact.local_id),
            "source_uuid": source_uuid,
            "target_uuid": object_uuid,
            "name": fact.predicate,
            "fact": f"{subject} {fact.predicate} {fact.object_text}".strip(),
            "confidence": fact.confidence,
            "source_ranges": _ranges_json(fact.source_ranges),
            "valid_from": fact.valid_from,
            "valid_until": fact.valid_until,
        })

    for relation in artifact.extraction.relations:
        source = next(entity for entity in artifact.extraction.entities if entity.local_id == relation.from_entity_id)
        target = next(entity for entity in artifact.extraction.entities if entity.local_id == relation.to_entity_id)
        edges.append({
            "uuid": _stable_id(artifact.artifact_id, "relation", relation.local_id),
            "source_uuid": entity_ids[relation.from_entity_id],
            "target_uuid": entity_ids[relation.to_entity_id],
            "name": relation.relation_type,
            "fact": f"{source.name} {relation.relation_type} {target.name}".strip(),
            "confidence": relation.confidence,
            "source_ranges": _ranges_json(relation.source_ranges),
            "valid_from": None,
            "valid_until": None,
        })
    return list(entities.values()), edges


async def apply_ingestion_artifact(driver, artifact: IngestionArtifactV1, tenant_id: str) -> dict:
    entities, edges = artifact_graph_rows(artifact, tenant_id)
    episode_uuid = _stable_id(tenant_id, "episode", artifact.artifact_id)
    now = datetime.now(timezone.utc).isoformat()
    common = {
        "tenant_id": tenant_id,
        "path": artifact.note.path,
        "artifact_id": artifact.artifact_id,
    }
    await driver.execute_query(
        "MATCH ()-[r:RELATES_TO {local_artifact: true, path: $path}]->() DELETE r",
        **common,
    )
    await driver.execute_query(
        "MATCH (e:Episodic {local_artifact: true, path: $path}) DETACH DELETE e",
        **common,
    )
    await driver.execute_query(
        "MATCH (n:Entity {local_artifact: true}) WHERE NOT (n)--() DELETE n",
        **common,
    )
    await driver.execute_query(
        "MERGE (e:Episodic {uuid: $episode_uuid}) "
        "SET e.name = $title, e.group_id = $tenant_id, e.tenant_id = $tenant_id, "
        "e.source = 'text', e.source_description = 'Local Claude Code extraction', "
        "e.content = $summary, e.valid_at = datetime($now), e.created_at = datetime($now), "
        "e.path = $path, e.content_hash = $content_hash, e.pipeline_signature = $pipeline_signature, "
        "e.artifact_id = $artifact_id, e.local_artifact = true",
        episode_uuid=episode_uuid,
        title=artifact.note.title,
        summary=artifact.extraction.summary,
        now=now,
        content_hash=artifact.note.content_hash,
        pipeline_signature=artifact.pipeline_signature,
        tenant_id=tenant_id,
        path=artifact.note.path,
        artifact_id=artifact.artifact_id,
    )
    if entities:
        await driver.execute_query(
            "UNWIND $entities AS item MERGE (n:Entity {uuid: item.uuid}) "
            "SET n.name = item.name, n.group_id = $tenant_id, n.tenant_id = $tenant_id, "
            "n.summary = item.summary, n.entity_type = item.entity_type, n.local_artifact = true "
            "WITH n, item MATCH (e:Episodic {uuid: $episode_uuid}) "
            "MERGE (e)-[m:MENTIONS {uuid: item.mention_uuid}]->(n) "
            "SET m.group_id = $tenant_id, m.tenant_id = $tenant_id, m.created_at = datetime($now), "
            "m.source_ranges = item.source_ranges, m.artifact_id = $artifact_id",
            entities=entities,
            episode_uuid=episode_uuid,
            now=now,
            **common,
        )
    if edges:
        await driver.execute_query(
            "UNWIND $edges AS item MATCH (source:Entity {uuid: item.source_uuid}) "
            "MATCH (target:Entity {uuid: item.target_uuid}) "
            "MERGE (source)-[r:RELATES_TO {uuid: item.uuid}]->(target) "
            "SET r.name = item.name, r.fact = item.fact, r.group_id = $tenant_id, "
            "r.tenant_id = $tenant_id, r.episodes = [$episode_uuid], r.created_at = datetime($now), "
            "r.reference_time = datetime($now), r.confidence = item.confidence, "
            "r.source_ranges = item.source_ranges, r.valid_from_text = item.valid_from, "
            "r.valid_until_text = item.valid_until, r.artifact_id = $artifact_id, "
            "r.path = $path, r.local_artifact = true",
            edges=edges,
            episode_uuid=episode_uuid,
            now=now,
            **common,
        )
    return {
        "ok": True,
        "artifactId": artifact.artifact_id,
        "episodeId": episode_uuid,
        "entities": len(entities),
        "relations": len(edges),
    }


async def delete_local_artifact_path(driver, path: str, tenant_id: str) -> int:
    records, _, _ = await driver.execute_query(
        "MATCH (e:Episodic {local_artifact: true, path: $path}) RETURN count(e) AS count",
        path=path,
        tenant_id=tenant_id,
        routing_="r",
    )
    await driver.execute_query(
        "MATCH ()-[r:RELATES_TO {local_artifact: true, path: $path}]->() DELETE r",
        path=path,
        tenant_id=tenant_id,
    )
    await driver.execute_query(
        "MATCH (e:Episodic {local_artifact: true, path: $path}) DETACH DELETE e",
        path=path,
        tenant_id=tenant_id,
    )
    await driver.execute_query(
        "MATCH (n:Entity {local_artifact: true}) WHERE NOT (n)--() DELETE n",
        path=path,
        tenant_id=tenant_id,
    )
    return int(records[0].get("count", 0)) if records else 0

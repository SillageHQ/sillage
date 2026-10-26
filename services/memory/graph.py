"""Tenant-scoped Graphiti clients backed entirely by OpenRouter."""
import os
import re
import asyncio
import copy
import hashlib
from dataclasses import dataclass
from contextvars import ContextVar, Token
from typing import Any

import httpx

from dotenv import load_dotenv

# Load .env BEFORE importing graphiti_core: EMBEDDING_DIM is read at import time
# of the embedder module, so it must already be in the environment.
load_dotenv()

from graphiti_core import Graphiti  # noqa: E402
from graphiti_core.cross_encoder.client import CrossEncoderClient
from graphiti_core.embedder.openai import OpenAIEmbedder, OpenAIEmbedderConfig
from graphiti_core.llm_client.config import LLMConfig
from graphiti_core.llm_client.openai_generic_client import OpenAIGenericClient
from graphiti_core.driver.falkordb_driver import FalkorDriver

FALKORDB_HOST = os.getenv("FALKORDB_HOST", "localhost")
FALKORDB_PORT = int(os.getenv("FALKORDB_PORT", "6380"))
FALKORDB_USER = os.getenv("FALKORDB_USER") or None
FALKORDB_PASSWORD = os.getenv("FALKORDB_PASSWORD") or None

OPENROUTER_BASE = "https://openrouter.ai/api/v1"
DEFAULT_LLM = "google/gemini-2.5-flash"
DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small"
DEFAULT_RERANK_MODEL = "cohere/rerank-v3.5"
OPENROUTER_HEADERS = {
    "HTTP-Referer": "https://sillagehq.app",
    "X-OpenRouter-Title": "Sillage",
}


@dataclass(frozen=True)
class ProviderConfig:
    api_key: str
    llm_model: str = DEFAULT_LLM
    embedding_model: str = DEFAULT_EMBED_MODEL
    rerank_model: str = DEFAULT_RERANK_MODEL

    @property
    def signature(self) -> str:
        key_hash = hashlib.sha256(self.api_key.encode()).hexdigest()[:16]
        return ":".join((key_hash, self.llm_model, self.embedding_model, self.rerank_model))

    @property
    def pipeline_signature(self) -> str:
        return f"openrouter:{self.llm_model}:{self.embedding_model}"


def _make_strict(schema: dict) -> dict:
    """Transform a pydantic JSON schema into strict form: every object gets
    additionalProperties:false and lists all its props as required. Without a
    strict schema the model invents key names instead of following the model."""
    if isinstance(schema, dict):
        if schema.get("type") == "object" and "properties" in schema:
            schema["additionalProperties"] = False
            schema["required"] = list(schema["properties"].keys())
        for value in schema.values():
            _make_strict(value)
    elif isinstance(schema, list):
        for item in schema:
            _make_strict(item)
    return schema


class StrictSchemaClient(OpenAIGenericClient):
    """Force a strict json_schema so extraction returns the exact field names."""

    def _build_response_format(self, response_model: Any) -> dict:
        return {
            "type": "json_schema",
            "json_schema": {
                "name": getattr(response_model, "__name__", "structured_response"),
                "strict": True,
                "schema": _make_strict(response_model.model_json_schema()),
            },
        }


class ManagedFalkorDriver(FalkorDriver):
    async def build_indices_and_constraints(self, delete_existing=False):
        # FalkorDriver schedules this in __init__. Tenant graphs are initialized
        # explicitly so the first query cannot race index creation.
        return None


class OpenRouterRerankerClient(CrossEncoderClient):
    def __init__(self, provider: ProviderConfig):
        self.provider = provider

    async def rank(self, query: str, passages: list[str]) -> list[tuple[str, float]]:
        if not passages:
            return []
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{OPENROUTER_BASE}/rerank",
                headers={
                    "Authorization": f"Bearer {self.provider.api_key}",
                    "Content-Type": "application/json",
                    **OPENROUTER_HEADERS,
                },
                json={
                    "model": self.provider.rerank_model,
                    "query": query,
                    "documents": passages,
                    "top_n": len(passages),
                },
            )
            response.raise_for_status()
            payload = response.json()
        ranked: list[tuple[str, float]] = []
        for item in payload.get("results", []):
            index = item.get("index")
            score = item.get("relevance_score")
            if isinstance(index, int) and 0 <= index < len(passages) and isinstance(score, (int, float)):
                ranked.append((passages[index], float(score)))
        return ranked


class OpenRouterEmbedder(OpenAIEmbedder):
    async def create(self, input_data) -> list[float]:
        result = await self.client.embeddings.create(
            input=input_data,
            model=self.config.embedding_model,
            dimensions=self.config.embedding_dim,
        )
        return result.data[0].embedding

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        result = await self.client.embeddings.create(
            input=input_data_list,
            model=self.config.embedding_model,
            dimensions=self.config.embedding_dim,
        )
        return [embedding.embedding for embedding in result.data]


def _graph_clients(provider: ProviderConfig):
    llm_config = LLMConfig(
        api_key=provider.api_key,
        model=provider.llm_model,
        small_model=provider.llm_model,
        base_url=OPENROUTER_BASE,
    )
    llm_client = StrictSchemaClient(config=llm_config)
    llm_client.client.default_headers.update(OPENROUTER_HEADERS)

    embedder = OpenRouterEmbedder(
        config=OpenAIEmbedderConfig(
            api_key=provider.api_key,
            embedding_model=provider.embedding_model,
            embedding_dim=1024,
            base_url=OPENROUTER_BASE,
        )
    )
    embedder.client.default_headers.update(OPENROUTER_HEADERS)

    reranker = OpenRouterRerankerClient(provider)

    return llm_client, embedder, reranker


def tenant_graph_name(tenant_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_]", "_", tenant_id).strip("_")
    if not safe:
        raise ValueError("tenant id cannot produce an empty graph name")
    return f"workspace_{safe}"


class TenantGraphManager:
    def __init__(self):
        self.base_driver = ManagedFalkorDriver(
            host=FALKORDB_HOST,
            port=FALKORDB_PORT,
            username=FALKORDB_USER,
            password=FALKORDB_PASSWORD,
        )
        self._graphs: dict[tuple[str, str], Graphiti] = {}
        self._ready: set[str] = set()
        self._locks: dict[str, asyncio.Lock] = {}

    def graph(self, tenant_id: str) -> Graphiti:
        provider = current_provider()
        cache_key = (tenant_id, provider.signature)
        graph = self._graphs.get(cache_key)
        if graph is None:
            llm_client, embedder, reranker = _graph_clients(provider)
            driver = copy.copy(self.base_driver)
            driver._database = tenant_graph_name(tenant_id)
            graph = Graphiti(
                graph_driver=driver,
                llm_client=llm_client,
                embedder=embedder,
                cross_encoder=reranker,
            )
            self._graphs[cache_key] = graph
        return graph

    def raw_driver(self, tenant_id: str):
        """Return a tenant-scoped driver without constructing provider clients."""
        driver = copy.copy(self.base_driver)
        driver._database = tenant_graph_name(tenant_id)
        return driver

    async def ensure(self, tenant_id: str) -> Graphiti:
        graph = self.graph(tenant_id)
        if tenant_id in self._ready:
            return graph
        lock = self._locks.setdefault(tenant_id, asyncio.Lock())
        async with lock:
            if tenant_id not in self._ready:
                await FalkorDriver.build_indices_and_constraints(graph.driver)
                self._ready.add(tenant_id)
        return graph

    async def stamp_tenant(self, tenant_id: str) -> None:
        driver = self.graph(tenant_id).driver
        await driver.execute_query(
            "MATCH (n) WHERE n.tenant_id IS NULL SET n.tenant_id = $tenant_id",
            tenant_id=tenant_id,
        )
        await driver.execute_query(
            "MATCH ()-[r]->() WHERE r.tenant_id IS NULL SET r.tenant_id = $tenant_id",
            tenant_id=tenant_id,
        )

    async def delete(self, tenant_id: str) -> None:
        graph_name = tenant_graph_name(tenant_id)
        await self.base_driver.client.select_graph(graph_name).delete()
        self._graphs = {key: graph for key, graph in self._graphs.items() if key[0] != tenant_id}
        self._ready.discard(tenant_id)
        self._locks.pop(tenant_id, None)

    async def close(self) -> None:
        await self.base_driver.close()


_tenant: ContextVar[str | None] = ContextVar("sillage_tenant", default=None)
_provider: ContextVar[ProviderConfig | None] = ContextVar("sillage_provider", default=None)


def set_tenant(tenant_id: str) -> Token:
    return _tenant.set(tenant_id)


def reset_tenant(token: Token) -> None:
    _tenant.reset(token)


def current_tenant() -> str:
    tenant_id = _tenant.get()
    if not tenant_id:
        raise RuntimeError("graph access attempted without a tenant")
    return tenant_id


def set_provider(provider: ProviderConfig | None) -> Token:
    return _provider.set(provider)


def reset_provider(token: Token) -> None:
    _provider.reset(token)


def current_provider() -> ProviderConfig:
    provider = _provider.get()
    if not provider or not provider.api_key:
        raise RuntimeError("OpenRouter is not configured for this tenant")
    return provider


def current_pipeline_signature() -> str:
    """Return the index signature without requiring an LLM credential.

    Read-only manifest checks must remain available when a tenant has not
    configured a provider key yet. Actual ingestion still validates the key
    when it needs to call the provider.
    """
    provider = _provider.get()
    if provider:
        return provider.pipeline_signature
    return f"openrouter:{DEFAULT_LLM}:{DEFAULT_EMBED_MODEL}"


def provider_available() -> bool:
    provider = _provider.get()
    return bool(provider and provider.api_key)


class TenantGraphitiProxy:
    def __init__(self, manager: TenantGraphManager):
        self.manager = manager

    def __getattr__(self, name: str):
        if name in {"embedder", "llm_client", "cross_encoder", "driver"}:
            return getattr(self.manager.graph(current_tenant()), name)
        async def call(*args, **kwargs):
            tenant_id = current_tenant()
            graph = await self.manager.ensure(tenant_id)
            if name == "add_episode":
                kwargs["group_id"] = tenant_id
            elif name == "search":
                kwargs["group_ids"] = [tenant_id]
            result = await getattr(graph, name)(*args, **kwargs)
            if name in {"add_episode", "remove_episode"}:
                await self.manager.stamp_tenant(tenant_id)
            return result
        return call


class TenantDriverProxy:
    def __init__(self, manager: TenantGraphManager):
        self.manager = manager

    async def execute_query(self, query: str, **kwargs):
        tenant_id = current_tenant()
        kwargs["tenant_id"] = tenant_id
        normalized = query.lstrip().upper()
        mutates_graph = any(
            keyword in normalized
            for keyword in ("CREATE ", "MERGE ", " SET ", "DELETE ", "REMOVE ")
        )
        if mutates_graph:
            graph = await self.manager.ensure(tenant_id)
            result = await graph.driver.execute_query(query, **kwargs)
            await self.manager.stamp_tenant(tenant_id)
        else:
            # Read-only requests must work for tenants that have not configured
            # an LLM provider yet (for example vault sync manifest checks).
            result = await self.manager.raw_driver(tenant_id).execute_query(query, **kwargs)
        return result


async def build_graphiti() -> Graphiti:
    """CLI compatibility: return a Graphiti instance for an explicit tenant."""
    tenant_id = os.getenv("SILLAGE_TENANT_ID")
    if not tenant_id:
        raise RuntimeError("SILLAGE_TENANT_ID is required")
    api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is required")
    provider_token = set_provider(ProviderConfig(
        api_key=api_key,
        llm_model=os.getenv("OPENROUTER_MODEL", DEFAULT_LLM),
        embedding_model=os.getenv("OPENROUTER_EMBEDDING_MODEL", DEFAULT_EMBED_MODEL),
        rerank_model=os.getenv("OPENROUTER_RERANK_MODEL", DEFAULT_RERANK_MODEL),
    ))
    manager = TenantGraphManager()
    try:
        graph = await manager.ensure(tenant_id)
        graph._tenant_manager = manager
        graph._provider_token = provider_token
        return graph
    except Exception:
        reset_provider(provider_token)
        raise

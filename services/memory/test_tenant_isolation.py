import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from graph import (
    OpenRouterRerankerClient,
    ProviderConfig,
    TenantDriverProxy,
    TenantGraphitiProxy,
    _graph_clients,
    current_provider,
    reset_provider,
    reset_tenant,
    set_provider,
    set_tenant,
    tenant_graph_name,
)


class TenantIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_graphiti_forces_group_for_each_tenant(self):
        graphs = {
            "tenant-a": SimpleNamespace(search=AsyncMock(return_value=["a"]), add_episode=AsyncMock(return_value="added-a")),
            "tenant-b": SimpleNamespace(search=AsyncMock(return_value=["b"]), add_episode=AsyncMock(return_value="added-b")),
        }
        manager = SimpleNamespace(
            graph=lambda tenant: graphs[tenant],
            ensure=AsyncMock(side_effect=lambda tenant: graphs[tenant]),
            stamp_tenant=AsyncMock(),
        )
        proxy = TenantGraphitiProxy(manager)

        token = set_tenant("tenant-a")
        try:
            self.assertEqual(await proxy.search("memory", group_ids=["tenant-b"]), ["a"])
            await proxy.add_episode(name="note", episode_body="body", source_description="test", reference_time=None)
        finally:
            reset_tenant(token)

        graphs["tenant-a"].search.assert_awaited_once_with("memory", group_ids=["tenant-a"])
        self.assertEqual(graphs["tenant-a"].add_episode.await_args.kwargs["group_id"], "tenant-a")
        manager.stamp_tenant.assert_awaited_once_with("tenant-a")
        graphs["tenant-b"].search.assert_not_awaited()

    async def test_direct_queries_are_routed_to_only_the_current_database(self):
        driver_a = SimpleNamespace(execute_query=AsyncMock(return_value=([{"value": "a"}], [], None)))
        driver_b = SimpleNamespace(execute_query=AsyncMock(return_value=([{"value": "b"}], [], None)))
        manager = SimpleNamespace(
            graph=lambda tenant: SimpleNamespace(driver=driver_a if tenant == "tenant-a" else driver_b),
            ensure=AsyncMock(side_effect=lambda tenant: SimpleNamespace(driver=driver_a if tenant == "tenant-a" else driver_b)),
            stamp_tenant=AsyncMock(),
        )
        proxy = TenantDriverProxy(manager)
        token = set_tenant("tenant-b")
        try:
            rows, _, _ = await proxy.execute_query("MATCH (n) RETURN n")
        finally:
            reset_tenant(token)
        self.assertEqual(rows, [{"value": "b"}])
        driver_a.execute_query.assert_not_awaited()
        self.assertEqual(driver_b.execute_query.await_args.kwargs["tenant_id"], "tenant-b")

    def test_graph_names_cannot_escape_the_workspace_namespace(self):
        self.assertEqual(tenant_graph_name("abc-123"), "workspace_abc_123")
        self.assertEqual(tenant_graph_name("../../other"), "workspace_other")

    def test_provider_context_is_request_scoped(self):
        first = set_provider(ProviderConfig(api_key="sk-or-first", llm_model="vendor/first"))
        try:
            self.assertEqual(current_provider().llm_model, "vendor/first")
            second = set_provider(ProviderConfig(api_key="sk-or-second", llm_model="vendor/second"))
            try:
                self.assertEqual(current_provider().api_key, "sk-or-second")
            finally:
                reset_provider(second)
            self.assertEqual(current_provider().api_key, "sk-or-first")
        finally:
            reset_provider(first)

    def test_graph_clients_all_use_openrouter_provider_configuration(self):
        provider = ProviderConfig(
            api_key="sk-or-tenant",
            llm_model="vendor/chat",
            embedding_model="vendor/embed",
            rerank_model="vendor/rerank",
        )
        llm, embedder, reranker = _graph_clients(provider)
        self.assertEqual(llm.config.model, "vendor/chat")
        self.assertEqual(embedder.config.embedding_model, "vendor/embed")
        self.assertEqual(str(embedder.client.base_url), "https://openrouter.ai/api/v1/")
        self.assertIsInstance(reranker, OpenRouterRerankerClient)
        self.assertEqual(reranker.provider.rerank_model, "vendor/rerank")

    async def test_embedding_requests_the_database_dimension_from_openrouter(self):
        _, embedder, _ = _graph_clients(ProviderConfig(api_key="sk-or-tenant"))
        embedder.client.embeddings.create = AsyncMock(return_value=SimpleNamespace(
            data=[SimpleNamespace(embedding=[0.1] * 1024)],
        ))

        result = await embedder.create_batch(["note"])

        self.assertEqual(len(result[0]), 1024)
        self.assertEqual(embedder.client.embeddings.create.await_args.kwargs["dimensions"], 1024)

    async def test_reranker_uses_openrouter_rerank_endpoint(self):
        provider = ProviderConfig(api_key="sk-or-tenant", rerank_model="cohere/rerank-v3.5")
        reranker = OpenRouterRerankerClient(provider)
        response = SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: {"results": [{"index": 1, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.2}]},
        )
        client = SimpleNamespace(post=AsyncMock(return_value=response))

        class ClientContext:
            async def __aenter__(self):
                return client

            async def __aexit__(self, *_args):
                return None

        with patch("graph.httpx.AsyncClient", return_value=ClientContext()):
            ranked = await reranker.rank("query", ["first", "second"])

        self.assertEqual(ranked, [("second", 0.9), ("first", 0.2)])
        request = client.post.await_args
        self.assertEqual(request.args[0], "https://openrouter.ai/api/v1/rerank")
        self.assertEqual(request.kwargs["json"]["model"], "cohere/rerank-v3.5")


if __name__ == "__main__":
    unittest.main()

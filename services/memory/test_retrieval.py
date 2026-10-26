import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import api
from graph import reset_tenant, set_tenant
from retrieval import (
    MAX_CHUNK_SEARCHES,
    RetrievalPlan,
    RetrievalQuery,
    diversify_by_document,
    parse_retrieval_plan,
    retrieval_queries,
    weighted_rrf_merge,
)


def _raw_item(item_id: str, path: str) -> dict:
    return {
        "id": item_id,
        "documentId": path,
        "path": path,
        "title": path.removesuffix(".md"),
        "headingPath": "",
        "startLine": 1,
        "endLine": 1,
        "text": f"Content for {item_id}",
        "score": 1,
    }


class _Response:
    def __init__(self, payload: dict):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _ClientContext:
    def __init__(self, post=None, put=None):
        self.post = post
        self.put = put

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None


class RetrievalPlanTests(unittest.TestCase):
    def test_simple_plan_has_no_variant(self):
        plan = RetrievalPlan(
            standalone_query="Shopify pricing",
            alternatives=[],
            intent="lookup",
            ambiguities=[],
        )

        queries = retrieval_queries("Shopify pricing", plan)

        self.assertEqual([(item.text, item.weight) for item in queries], [("Shopify pricing", 1.2)])

    def test_ambiguous_acronym_keeps_hypotheses_and_caps_searches(self):
        plan = RetrievalPlan(
            standalone_query="MRR metric",
            alternatives=["monthly recurring revenue", "mean reciprocal rank"],
            intent="compare",
            ambiguities=[{"term": "MRR", "hypotheses": ["monthly recurring revenue", "mean reciprocal rank"]}],
        )

        queries = retrieval_queries("What did I write about MRR?", plan)

        self.assertEqual(len(queries), MAX_CHUNK_SEARCHES)
        self.assertEqual(queries[0].channel, "original")
        self.assertEqual(plan.ambiguities[0].hypotheses, ["monthly recurring revenue", "mean reciprocal rank"])

    def test_mixed_language_plan_is_generic(self):
        plan, fallback = parse_retrieval_plan(
            {
                "standalone_query": "mes notes sur le churn rate",
                "alternatives": ["taux d'attrition dans mes notes"],
                "intent": "lookup",
                "ambiguities": [],
            },
            "Qu'ai-je noté sur le churn rate ?",
        )

        self.assertIsNone(fallback)
        self.assertEqual(plan.alternatives, ["taux d'attrition dans mes notes"])

    def test_queries_are_trimmed_deduplicated_and_limited(self):
        plan = RetrievalPlan(
            standalone_query="  same   query  ",
            alternatives=["SAME QUERY", "x" * 400, "ignored"],
            intent="lookup",
            ambiguities=[],
        )

        queries = retrieval_queries("same query", plan)

        self.assertEqual(len(queries), 2)
        self.assertEqual(len(queries[1].text), 300)
        self.assertEqual(len(plan.alternatives), 2)

    def test_invalid_plan_falls_back_to_original(self):
        plan, fallback = parse_retrieval_plan({"standalone_query": 12, "intent": "unknown"}, "original")

        self.assertIsNotNone(fallback)
        self.assertEqual(plan.standalone_query, "original")
        self.assertEqual(retrieval_queries("original", plan)[0].text, "original")

    def test_weighted_rrf_prioritizes_original_query(self):
        merged = weighted_rrf_merge([
            (1.2, [{"id": "original"}]),
            (0.8, [{"id": "alternative"}]),
        ])

        self.assertEqual(merged[0]["id"], "original")

    def test_list_intent_prefers_distinct_documents_then_backfills(self):
        items = [
            {"id": "a1", "path": "A.md"},
            {"id": "a2", "path": "A.md"},
            {"id": "b1", "path": "B.md"},
        ]

        diversified = diversify_by_document(items, 3, "list")

        self.assertEqual([item["id"] for item in diversified], ["a1", "b1", "a2"])


class AdaptiveRetrievalTests(unittest.IsolatedAsyncioTestCase):
    def test_claude_mode_blocks_server_side_openrouter_clients(self):
        provider_token = api._ingestion_provider.set("claude-code")
        try:
            with patch.object(api.app.state, "llm", object(), create=True):
                with self.assertRaisesRegex(RuntimeError, "disabled in Claude Code mode"):
                    api._llm_client()
        finally:
            api._ingestion_provider.reset(provider_token)

    async def asyncSetUp(self):
        self.tenant_token = set_tenant("tenant-adaptive")

    async def asyncTearDown(self):
        reset_tenant(self.tenant_token)

    async def test_claude_tool_calls_use_the_shared_server_tool_contract(self):
        local_model = AsyncMock(return_value={
            "content": "",
            "toolCalls": [{
                "id": "call-1",
                "name": "recall_memory",
                "argumentsJson": '{"query":"Ada"}',
            }],
        })
        provider_token = api._ingestion_provider.set("claude-code")
        try:
            with patch.object(api, "_local_model_task", local_model):
                _content, calls = await api._provider_tool_completion([], [], "auto")
        finally:
            api._ingestion_provider.reset(provider_token)
        self.assertEqual(calls[0]["name"], "recall_memory")
        self.assertEqual(calls[0]["arguments"], {"query": "Ada"})

    async def test_resumed_claude_session_does_not_replay_saved_history(self):
        local_model = AsyncMock(return_value={"content": "answer", "sessionId": "session-1"})
        provider_token = api._ingestion_provider.set("claude-code")
        session_token = api._claude_session_id.set("session-1")
        try:
            with patch.object(api, "_local_model_task", local_model):
                answer = await api._provider_text_completion([
                    {"role": "user", "content": "[message_id=old]\nold question"},
                    {"role": "system", "content": "current memory context"},
                ], persist_session=True)
        finally:
            api._claude_session_id.reset(session_token)
            api._ingestion_provider.reset(provider_token)
        self.assertEqual(answer, "answer")
        payload = local_model.await_args.args[1]
        self.assertEqual(payload["sessionId"], "session-1")
        self.assertEqual(payload["messages"], [{"role": "system", "content": "current memory context"}])

    async def test_feature_flag_restores_single_compatibility_query(self):
        with (
            patch.dict(os.environ, {"RETRIEVAL_QUERY_PLANNER": "0"}),
            patch.object(api, "_hybrid_recall", AsyncMock(return_value=[])) as hybrid_recall,
        ):
            result = await api._tool_call(
                "recall_memory",
                {
                    "query": "legacy query",
                    "standalone_query": "rewritten",
                    "alternatives": ["variant"],
                    "intent": "compare",
                    "ambiguities": [{"term": "x", "hypotheses": ["a", "b"]}],
                },
                "original question",
                "read",
            )

        self.assertEqual(result, {"facts": [], "ambiguities": []})
        self.assertEqual(hybrid_recall.await_args.args, ("legacy query", 5))
        self.assertFalse(hybrid_recall.await_args.kwargs["planner_enabled"])
        self.assertEqual(hybrid_recall.await_args.kwargs["plan"].standalone_query, "legacy query")

    async def test_invalid_tool_json_falls_back_without_losing_retrieval(self):
        tool_call = SimpleNamespace(
            id="call-1",
            function=SimpleNamespace(name="recall_memory", arguments="{invalid"),
        )
        tool_message = SimpleNamespace(
            content="",
            tool_calls=[tool_call],
            model_dump=lambda **_kwargs: {"role": "assistant", "content": ""},
        )
        no_tool_message = SimpleNamespace(content="", tool_calls=[])
        final_message = SimpleNamespace(content="Final answer", tool_calls=[])
        create = AsyncMock(
            side_effect=[
                SimpleNamespace(choices=[SimpleNamespace(message=tool_message)]),
                SimpleNamespace(choices=[SimpleNamespace(message=no_tool_message)]),
                SimpleNamespace(choices=[SimpleNamespace(message=final_message)]),
            ]
        )
        llm = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))

        with (
            patch.object(api.app.state, "llm", llm, create=True),
            patch.object(api, "_hybrid_recall", AsyncMock(return_value=[])) as hybrid_recall,
        ):
            answer, facts, actions, changes = await api._answer_with_tools(
                "What did I note about MRR?",
                [],
                [],
            )

        self.assertEqual(answer, "Final answer")
        self.assertEqual((facts, actions, changes), ([], [], []))
        self.assertEqual(hybrid_recall.await_args.args[0], "What did I note about MRR?")

    async def test_unchanged_document_with_missing_chunks_is_reindexed(self):
        body = "| Metric | Value |\n| --- | --- |\n| MRR | 42 |"
        content_hash = api._content_hash(body)
        chunk = api.MarkdownChunk(
            id="chunk-1",
            heading_path="",
            start_line=1,
            end_line=3,
            text=body,
            content_hash=content_hash,
        )
        embedder = SimpleNamespace(create_batch=AsyncMock(return_value=[[1.0]]))
        put = AsyncMock(return_value=_Response({"ok": True, "chunks": 1}))

        with (
            patch.object(
                api,
                "_rag_document_state",
                AsyncMock(return_value={
                    "contentHash": content_hash,
                    "embeddingModel": "test/embed",
                    "chunks": [],
                }),
            ),
            patch.object(api, "_markdown_chunks", return_value=[chunk]),
            patch.object(api, "current_provider", return_value=SimpleNamespace(embedding_model="test/embed")),
            patch.object(api.app.state, "graphiti", SimpleNamespace(embedder=embedder), create=True),
            patch.object(api.httpx, "AsyncClient", return_value=_ClientContext(put=put)),
            patch.dict(os.environ, {"MEMORY_INTERNAL_TOKEN": "secret"}),
        ):
            result = await api._index_note_chunks(
                api.Note(title="Shopify", body=body, path="Business/Shopify/Metrics.md"),
                content_hash,
                "Business/Shopify/Metrics.md",
            )

        self.assertTrue(result["ok"])
        embedded_text = embedder.create_batch.await_args.args[0][0]
        self.assertIn("Title: Shopify", embedded_text)
        self.assertIn("Path: Business/Shopify/Metrics.md", embedded_text)
        self.assertIn("Content:\n" + body, embedded_text)
        put.assert_awaited_once()
        self.assertEqual(len(put.await_args.kwargs["json"]["chunks"]), 1)

    def test_chunk_search_text_contains_generic_note_context(self):
        body = "---\ntags: [finance]\nmetric: recurring revenue\n---\n# Dashboard\n\n| Metric | Value |\n| --- | --- |\n| Revenue | 42 |\n\n![Monthly report](report.png)"
        chunk = api._markdown_chunks("Projects/Dashboard.md", body)[0]
        structure = api._obsidian_structure(body)
        search_text = api._chunk_search_text(
            path="Projects/Dashboard.md",
            title="Dashboard",
            chunk=chunk,
            structure=structure,
        )
        self.assertIn("Title: Dashboard", search_text)
        self.assertIn("Path: Projects/Dashboard.md", search_text)
        self.assertIn("Tags: finance", search_text)
        self.assertIn("metric: recurring revenue", search_text)
        self.assertIn("Table fields: Metric, Value, Revenue, 42", search_text)
        self.assertIn("Image descriptions: Monthly report", search_text)
        self.assertIn("Content:", search_text)
        self.assertNotEqual(search_text, chunk.text)

    def test_technical_token_signal_preserves_exact_acronym_hits(self):
        exact = {"fact": "MRR: 75", "note_path": "Projects/Metrics.md"}
        distractor = {"fact": "monthly revenue context", "note_path": "Projects/Other.md"}
        self.assertEqual(api._technical_token_signal("Quel MRR actuel ?", exact), 1.0)
        self.assertEqual(api._technical_token_signal("Quel MRR actuel ?", distractor), 0.0)

    def test_note_image_references_supports_wikilinks_and_markdown_images(self):
        body = "![[scan.png]]\n![diagram](assets/diagram.jpg)\n![[scan.png|alias]]"
        self.assertEqual(
            api._note_image_references(body),
            ["scan.png", "assets/diagram.jpg"],
        )

    def test_knowledge_source_status_exposes_general_fallback_without_memory(self):
        self.assertEqual(api._knowledge_source_status("what did I note about MRR?", []), "general_fallback")
        self.assertEqual(api._knowledge_source_status("what is a vector database?", []), "general")
        self.assertEqual(api._knowledge_source_status("what did I note about MRR?", [{"fact": "MRR: 75"}]), "vault")

    async def test_embeddings_are_batched_and_chunk_searches_are_tenant_scoped(self):
        plan = RetrievalPlan(
            standalone_query="MRR metric",
            alternatives=["monthly recurring revenue", "mean reciprocal rank"],
            intent="compare",
            ambiguities=[],
        )
        embedder = SimpleNamespace(create_batch=AsyncMock(return_value=[[1.0], [2.0], [3.0]]))
        post = AsyncMock(side_effect=lambda _url, **kwargs: _Response({"items": [_raw_item(kwargs["json"]["query"], "Note.md")]}))

        with (
            patch.object(api.app.state, "graphiti", SimpleNamespace(embedder=embedder), create=True),
            patch.object(api.httpx, "AsyncClient", return_value=_ClientContext(post)),
            patch.dict(os.environ, {"MEMORY_INTERNAL_TOKEN": "secret"}),
        ):
            result_sets, fallback = await api._chunk_result_sets(
                "What did I write about MRR?",
                plan,
                30,
                planner_enabled=True,
            )

        self.assertIsNone(fallback)
        embedder.create_batch.assert_awaited_once()
        self.assertEqual(len(embedder.create_batch.await_args.args[0]), MAX_CHUNK_SEARCHES)
        self.assertEqual(len(result_sets), MAX_CHUNK_SEARCHES)
        self.assertEqual(post.await_count, MAX_CHUNK_SEARCHES)
        self.assertTrue(all(call.kwargs["headers"]["X-Sillage-Tenant"] == "tenant-adaptive" for call in post.await_args_list))

    async def test_batch_embedding_failure_retries_original_only(self):
        plan = RetrievalPlan(
            standalone_query="standalone",
            alternatives=["variant"],
            intent="lookup",
            ambiguities=[],
        )
        embedder = SimpleNamespace(create_batch=AsyncMock(side_effect=[TimeoutError(), [[1.0]]]))
        post = AsyncMock(return_value=_Response({"items": [_raw_item("original", "Original.md")]}))

        with (
            patch.object(api.app.state, "graphiti", SimpleNamespace(embedder=embedder), create=True),
            patch.object(api.httpx, "AsyncClient", return_value=_ClientContext(post)),
            patch.dict(os.environ, {"MEMORY_INTERNAL_TOKEN": "secret"}),
        ):
            result_sets, fallback = await api._chunk_result_sets(
                "original",
                plan,
                30,
                planner_enabled=True,
            )

        self.assertIn("embedding_batch", fallback)
        self.assertEqual(len(result_sets), 1)
        self.assertEqual(result_sets[0][0].text, "original")
        self.assertEqual(post.await_count, 1)

    async def test_claude_ingestion_uses_local_query_embeddings(self):
        plan = RetrievalPlan(standalone_query="Ada Sillage", alternatives=[], intent="lookup", ambiguities=[])
        embedder = SimpleNamespace(create_batch=AsyncMock(side_effect=AssertionError("cloud embedder used")))
        post = AsyncMock(return_value=_Response({"items": [_raw_item("local", "Ada.md")]}))
        local_model = AsyncMock(return_value={"embeddings": [[0.0] * 1_023 + [1.0]]})
        provider_token = api._ingestion_provider.set("claude-code")
        try:
            with (
                patch.object(api.app.state, "graphiti", SimpleNamespace(embedder=embedder), create=True),
                patch.object(api, "_local_model_task", local_model),
                patch.object(api.httpx, "AsyncClient", return_value=_ClientContext(post)),
                patch.dict(os.environ, {"MEMORY_INTERNAL_TOKEN": "secret"}),
            ):
                result_sets, fallback = await api._chunk_result_sets(
                    "Ada Sillage", plan, 30, planner_enabled=True
                )
        finally:
            api._ingestion_provider.reset(provider_token)

        self.assertIsNone(fallback)
        embedder.create_batch.assert_not_awaited()
        local_model.assert_awaited_once()
        self.assertEqual(local_model.await_args.args[0], "embedding")
        self.assertEqual(len(result_sets), 1)
        self.assertEqual(len(post.await_args.kwargs["json"]["embedding"]), 1_024)

    async def test_local_artifact_facts_are_ranked_without_graphiti_embeddings(self):
        driver = SimpleNamespace(execute_query=AsyncMock(return_value=([
            {"fact": "Ada maintains Sillage", "title": "Ada", "path": "People/Ada.md", "group_id": "tenant-adaptive"},
            {"fact": "Bob likes tea", "title": "Bob", "path": "People/Bob.md", "group_id": "tenant-adaptive"},
        ], None, None)))
        manager = SimpleNamespace(raw_driver=lambda _tenant: driver)
        with patch.object(api.app.state, "graph_manager", manager, create=True):
            facts = await api._local_artifact_facts("Who maintains Sillage?", 5)
        self.assertEqual([item["fact"] for item in facts], ["Ada maintains Sillage"])
        self.assertEqual(facts[0]["note_path"], "People/Ada.md")

    async def test_reranker_failure_returns_fused_candidates(self):
        plan = RetrievalPlan(standalone_query="rewritten", alternatives=[], intent="lookup", ambiguities=[])
        graph_fact = {"fact": "Graph fact", "note_path": "Graph.md", "source_title": "Graph"}
        chunk_fact = {"fact": "Chunk fact", "note_path": "Chunk.md", "chunk_id": "chunk"}
        graphiti = SimpleNamespace(cross_encoder=SimpleNamespace(rank=AsyncMock(side_effect=TimeoutError())))

        with (
            patch.object(api.app.state, "graphiti", graphiti, create=True),
            patch.object(api, "_facts_for", AsyncMock(return_value=[graph_fact])) as facts_for,
            patch.object(
                api,
                "_chunk_result_sets",
                AsyncMock(return_value=([(RetrievalQuery("original", 1.2, "original"), [chunk_fact])], None)),
            ),
        ):
            results = await api._hybrid_recall("original", 2, plan=plan, planner_enabled=True)

        self.assertEqual(len(results), 2)
        self.assertEqual(facts_for.await_args.args[1], "original")
        graphiti.cross_encoder.rank.assert_awaited_once()
        self.assertEqual(graphiti.cross_encoder.rank.await_args.args[0], "original")

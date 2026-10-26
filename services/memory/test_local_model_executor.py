import unittest
from unittest.mock import AsyncMock, patch

import local_model_executor


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


class _Client:
    def __init__(self, states):
        self.states = iter(states)
        self.post = AsyncMock(return_value=_Response({"id": "task-1"}))
        self.delete = AsyncMock(return_value=_Response({"ok": True}))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def get(self, *_args, **_kwargs):
        return _Response(next(self.states))


class LocalModelExecutorTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_completed_result_and_cleans_up(self):
        client = _Client([
            {"status": "leased"},
            {"status": "completed", "result": {"content": "hello"}},
        ])
        with (
            patch.object(local_model_executor.httpx, "AsyncClient", return_value=client),
            patch.object(local_model_executor.asyncio, "sleep", new=AsyncMock()),
        ):
            result = await local_model_executor.execute_local_model_task(
                api_url="http://api",
                headers={"Authorization": "Bearer token"},
                kind="chat",
                payload={"messages": []},
            )
        self.assertEqual(result, {"content": "hello"})
        client.delete.assert_awaited_once()

    async def test_surfaces_worker_failure_and_cleans_up(self):
        client = _Client([{"status": "failed", "error": "Claude is unavailable"}])
        with patch.object(local_model_executor.httpx, "AsyncClient", return_value=client):
            with self.assertRaisesRegex(local_model_executor.LocalModelExecutionError, "Claude is unavailable"):
                await local_model_executor.execute_local_model_task(
                    api_url="http://api",
                    headers={"Authorization": "Bearer token"},
                    kind="chat",
                    payload={},
                )
        client.delete.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()

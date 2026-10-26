import asyncio
import time
from typing import Any

import httpx


class LocalModelExecutionError(RuntimeError):
    pass


async def execute_local_model_task(
    *,
    api_url: str,
    headers: dict[str, str],
    kind: str,
    payload: dict[str, Any],
    timeout_seconds: float = 660,
) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=30) as client:
        created = await client.post(
            f"{api_url}/v1/local-model-tasks",
            headers=headers,
            json={"kind": kind, "payload": payload},
        )
        created.raise_for_status()
        task_id = str(created.json()["id"])
        started = time.monotonic()
        try:
            while time.monotonic() - started < timeout_seconds:
                response = await client.get(
                    f"{api_url}/v1/local-model-tasks/{task_id}",
                    headers=headers,
                )
                response.raise_for_status()
                task = response.json()
                if task.get("status") == "completed":
                    result = task.get("result")
                    if not isinstance(result, dict):
                        raise LocalModelExecutionError("The local model returned an invalid result.")
                    return result
                if task.get("status") == "failed":
                    raise LocalModelExecutionError(
                        str(task.get("error") or "The local model task failed.")
                    )
                await asyncio.sleep(0.25)
            raise LocalModelExecutionError("The local model task timed out.")
        finally:
            try:
                await client.delete(
                    f"{api_url}/v1/local-model-tasks/{task_id}",
                    headers=headers,
                )
            except httpx.HTTPError:
                pass

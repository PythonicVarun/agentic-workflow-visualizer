from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .codex_adapter import codex_hook_to_event
from .demo import play_demo
from .graph_state import GraphState
from .models import WorkflowEvent

ROOT = Path(__file__).resolve().parents[1]
UI_DIR = ROOT / "ui"

app = FastAPI(title="Agentic Workflow Visualizer")
graph = GraphState()
subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
demo_task: asyncio.Task[None] | None = None


async def _cancel_demo_task() -> None:
    global demo_task
    if demo_task and not demo_task.done():
        demo_task.cancel()
        with suppress(asyncio.CancelledError):
            await demo_task
    demo_task = None


def _clear_subscribers() -> None:
    subscribers.clear()


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


async def publish(kind: str, event: WorkflowEvent | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"kind": kind, "state": graph.snapshot()}
    if event is not None:
        payload["event"] = event.model_dump(mode="json")

    stale: list[asyncio.Queue[dict[str, Any]]] = []
    for queue in subscribers:
        try:
            queue.put_nowait(payload)
        except asyncio.QueueFull:
            stale.append(queue)
    for queue in stale:
        subscribers.discard(queue)
    return payload["state"]


async def ingest_event(event: WorkflowEvent) -> dict[str, Any]:
    state = graph.apply_event(event)
    await publish("event", event)
    return state


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(UI_DIR / "index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/state")
async def state() -> dict[str, Any]:
    return graph.snapshot()


@app.post("/event")
async def event(event_payload: WorkflowEvent) -> dict[str, Any]:
    state_payload = await ingest_event(event_payload)
    return {"ok": True, "state": state_payload}


@app.post("/codex-hook/{hook_name}")
async def codex_hook(hook_name: str, request: Request) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400, detail="Codex hook payload must be a JSON object."
        )
    event_payload = codex_hook_to_event(hook_name, payload)
    state_payload = await ingest_event(event_payload)
    return {"ok": True, "state": state_payload}


@app.post("/reset")
async def reset() -> dict[str, Any]:
    await _cancel_demo_task()
    graph.reset()
    await publish("reset")
    return {"ok": True, "state": graph.snapshot()}


@app.post("/demo")
async def demo() -> dict[str, str]:
    global demo_task
    if demo_task and not demo_task.done():
        return {"status": "already_running"}
    graph.reset()
    await publish("reset")
    demo_task = asyncio.create_task(play_demo(ingest_event))
    return {"status": "started"}


@app.get("/stream")
async def stream(request: Request) -> StreamingResponse:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=20)
    subscribers.add(queue)

    async def events():
        try:
            yield _sse("state", {"kind": "initial", "state": graph.snapshot()})
            while not await request.is_disconnected():
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield _sse(payload["kind"], payload)
                except asyncio.TimeoutError:
                    yield _sse("tick", {"kind": "tick", "state": graph.snapshot()})
        finally:
            subscribers.discard(queue)

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.on_event("shutdown")
async def shutdown() -> None:
    await _cancel_demo_task()
    _clear_subscribers()


app.mount("/static", StaticFiles(directory=UI_DIR), name="static")


def run() -> None:
    import uvicorn

    uvicorn.run("server.main:app", host="127.0.0.1", port=8765, reload=False)


if __name__ == "__main__":
    run()

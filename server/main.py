from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .codex_adapter import codex_hook_to_event
from .demo import play_demo
from .graph_state import GraphState
from .log_store import EventLogStore, events_from_log_entries, parse_log_content
from .models import WorkflowEvent

ROOT = Path(__file__).resolve().parents[1]
UI_DIR = ROOT / "ui"

app = FastAPI(title="Agentic Workflow Visualizer")
graph = GraphState()
log_store = EventLogStore(ROOT)
subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
demo_task: asyncio.Task[None] | None = None
view_mode = "live"
replay_source: str | None = None


class ReplayLogRequest(BaseModel):
    content: str
    filename: str | None = None


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


def _graph_snapshot() -> dict[str, Any]:
    return {
        **graph.snapshot(),
        "log": {
            **log_store.snapshot(),
            "mode": view_mode,
            "replay_source": replay_source,
        },
    }


async def publish(kind: str, event: WorkflowEvent | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"kind": kind, "state": _graph_snapshot()}
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


async def ingest_event(
    event: WorkflowEvent,
    *,
    source: str = "event",
    hook_name: str | None = None,
    hook_payload: dict[str, Any] | None = None,
    persist: bool = True,
) -> dict[str, Any]:
    global view_mode, replay_source
    view_mode = "live"
    replay_source = None
    graph.apply_event(event)
    if persist:
        if hook_name and hook_payload is not None:
            log_store.append_hook_event(hook_name, hook_payload, event)
        else:
            log_store.append_workflow_event(event, source=source)
    await publish("event", event)
    return _graph_snapshot()


@app.get("/")
async def index() -> FileResponse:
    return FileResponse(UI_DIR / "index.html")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/state")
async def state() -> dict[str, Any]:
    return _graph_snapshot()


@app.post("/event")
async def event(event_payload: WorkflowEvent) -> dict[str, Any]:
    state_payload = await ingest_event(event_payload)
    return {"ok": True, "state": state_payload}


@app.post("/codex-hook/{hook_name}")
async def codex_hook(hook_name: str, request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON payload.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(
            status_code=400, detail="Codex hook payload must be a JSON object."
        )
    event_payload = codex_hook_to_event(hook_name, payload)
    state_payload = await ingest_event(
        event_payload,
        source="codex_hook",
        hook_name=hook_name,
        hook_payload=payload,
    )
    return {"ok": True, "state": state_payload}


@app.post("/reset")
async def reset() -> dict[str, Any]:
    global view_mode, replay_source
    await _cancel_demo_task()
    graph.reset()
    log_store.rotate(reason="reset")
    view_mode = "live"
    replay_source = None
    await publish("reset")
    return {"ok": True, "state": _graph_snapshot()}


@app.post("/demo")
async def demo() -> dict[str, str]:
    global demo_task, view_mode, replay_source
    if demo_task and not demo_task.done():
        return {"status": "already_running"}
    graph.reset()
    log_store.rotate(reason="demo")
    view_mode = "live"
    replay_source = None
    await publish("reset")
    demo_task = asyncio.create_task(play_demo(ingest_event))
    return {"status": "started"}


@app.get("/log/current")
async def current_log() -> FileResponse:
    current_path = log_store.current_path
    if current_path is None:
        raise HTTPException(
            status_code=404, detail="No workflow log has been created yet."
        )

    return FileResponse(
        current_path,
        media_type="application/x-ndjson",
        filename=current_path.name,
    )


@app.post("/replay-log")
async def replay_log(payload: ReplayLogRequest) -> dict[str, Any]:
    global view_mode, replay_source
    try:
        entries = parse_log_content(payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    events = events_from_log_entries(entries)
    if not events:
        raise HTTPException(
            status_code=400,
            detail="No workflow events were found in the supplied log.",
        )

    await _cancel_demo_task()
    graph.reset()
    for event in events:
        graph.apply_event(event)

    view_mode = "replay"
    replay_source = payload.filename or "uploaded log"
    await publish("reset")
    return {
        "ok": True,
        "events_replayed": len(events),
        "state": _graph_snapshot(),
    }


@app.get("/stream")
async def stream(request: Request) -> StreamingResponse:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=20)
    subscribers.add(queue)

    async def events():
        try:
            yield _sse("state", {"kind": "initial", "state": _graph_snapshot()})
            while not await request.is_disconnected():
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=1.0)
                    yield _sse(payload["kind"], payload)
                except asyncio.TimeoutError:
                    yield _sse("tick", {"kind": "tick", "state": _graph_snapshot()})
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

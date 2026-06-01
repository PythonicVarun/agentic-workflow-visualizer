from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from .graph_state import ROOT_AGENT_ID
from .models import WorkflowEvent

Ingest = Callable[[WorkflowEvent], Awaitable[dict[str, Any]]]


def event(
    event_type: str, agent_id: str, *, parent_id: str | None = None, **data: Any
) -> WorkflowEvent:
    return WorkflowEvent(
        event_type=event_type, agent_id=agent_id, parent_id=parent_id, data=data
    )


async def play_demo(ingest: Ingest) -> None:
    await ingest(
        event(
            "user_input",
            ROOT_AGENT_ID,
            prompt="Perform any task of your choice using five non-linear sub-agents at very low cost.",
            summary="Acceptance-test prompt received",
        )
    )
    await asyncio.sleep(0.8)

    spawns = [
        (
            "context_scout",
            ROOT_AGENT_ID,
            "Context Scout",
            "Map the workspace and constraints",
        ),
        (
            "backend_builder",
            ROOT_AGENT_ID,
            "Backend Builder",
            "Shape the event bus and SSE stream",
        ),
        ("ui_mapper", ROOT_AGENT_ID, "UI Mapper", "Design the live graph layout"),
        (
            "plugin_packager",
            ROOT_AGENT_ID,
            "Plugin Packager",
            "Prepare Codex hook packaging",
        ),
        (
            "cost_sentinel",
            ROOT_AGENT_ID,
            "Cost Sentinel",
            "Keep the task to no model calls in demo mode",
        ),
        ("sse_probe", "backend_builder", "SSE Probe", "Verify live browser updates"),
        (
            "layout_probe",
            "ui_mapper",
            "Layout Probe",
            "Check that branching fits on one screen",
        ),
    ]
    for agent_id, parent_id, name, purpose in spawns:
        await ingest(
            event(
                "subagent_spawn",
                agent_id,
                parent_id=parent_id,
                name=name,
                role="subagent",
                purpose=purpose,
                summary=purpose,
            )
        )
        await asyncio.sleep(0.45)

    tool_calls = [
        ("context_scout", "read_project_context", {"path": "PROJECT_CONTEXT.md"}),
        (
            "backend_builder",
            "draft_fastapi_routes",
            {"routes": ["/event", "/state", "/stream"]},
        ),
        ("sse_probe", "open_event_stream", {"interval_seconds": 1}),
        ("ui_mapper", "layout_tree", {"mode": "branching"}),
        ("layout_probe", "fit_viewbox", {"target": "single screen"}),
        ("plugin_packager", "emit_hooks_json", {"events": 6}),
        ("cost_sentinel", "estimate_cost", {"model_calls": 0}),
    ]
    for agent_id, tool_name, args in tool_calls:
        await ingest(
            event(
                "tool_call",
                agent_id,
                tool_name=tool_name,
                args=args,
                summary=f"{tool_name} started",
            )
        )
        await asyncio.sleep(0.55)
        await ingest(
            event(
                "tool_output",
                agent_id,
                tool_name=tool_name,
                output={"status": "ok", "note": "demo event"},
                summary=f"{tool_name} completed",
            )
        )
        await asyncio.sleep(0.35)

    completions = [
        ("context_scout", "Repository context mapped"),
        ("sse_probe", "SSE ticks and state pushes verified"),
        ("backend_builder", "FastAPI event bus ready"),
        ("layout_probe", "Graph scales to the viewport"),
        ("ui_mapper", "Branching workflow diagram ready"),
        ("plugin_packager", "Hook and plugin files prepared"),
        ("cost_sentinel", "Demo cost is $0.00 because it replays local events"),
    ]
    for agent_id, result in completions:
        await ingest(
            event(
                "subagent_complete",
                agent_id,
                result_summary=result,
                status="complete",
                summary=result,
            )
        )
        await asyncio.sleep(0.45)

    await ingest(
        event(
            "agent_output",
            ROOT_AGENT_ID,
            output="Dashboard demo completed with seven visible sub-agent boxes and branching edges.",
            status="complete",
            summary="Demo complete",
        )
    )

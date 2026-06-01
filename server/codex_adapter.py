from __future__ import annotations

import re
from typing import Any

from .graph_state import ROOT_AGENT_ID, summarize
from .models import WorkflowEvent


def _agent_id(value: Any, fallback: str = ROOT_AGENT_ID) -> str:
    raw = str(value or fallback)
    safe = re.sub(r"[^a-zA-Z0-9_.:-]+", "_", raw).strip("_")
    return safe or fallback


def _hook_name(hook_name: str | None, payload: dict[str, Any]) -> str:
    return (
        hook_name
        or payload.get("hook_event_name")
        or payload.get("hookEventName")
        or payload.get("event_name")
        or payload.get("eventName")
        or ""
    )


def codex_hook_to_event(
    hook_name: str | None, payload: dict[str, Any]
) -> WorkflowEvent:
    name = _hook_name(hook_name, payload)
    root_id = ROOT_AGENT_ID
    model = payload.get("model")
    permission_mode = payload.get("permission_mode")
    common = {
        "model": model,
        "permission_mode": permission_mode,
        "session_id": payload.get("session_id"),
        "turn_id": payload.get("turn_id"),
    }

    if name == "SessionStart":
        return WorkflowEvent(
            event_type="session_start",
            agent_id=root_id,
            data={
                **common,
                "source": payload.get("source"),
                "summary": f"Session {payload.get('source') or 'started'}",
            },
        )

    if name == "UserPromptSubmit":
        prompt = payload.get("prompt") or ""
        return WorkflowEvent(
            event_type="user_input",
            agent_id=root_id,
            data={
                **common,
                "prompt": prompt,
                "summary": summarize(prompt, 120) or "User prompt submitted",
            },
        )

    if name == "PreToolUse":
        tool_name = payload.get("tool_name") or payload.get("toolName") or "tool"
        return WorkflowEvent(
            event_type="tool_call",
            agent_id=_agent_id(payload.get("agent_id"), root_id),
            data={
                **common,
                "tool_name": tool_name,
                "tool_use_id": payload.get("tool_use_id"),
                "args": payload.get("tool_input"),
                "summary": f"Calling {tool_name}",
            },
        )

    if name == "PermissionRequest":
        tool_name = payload.get("tool_name") or payload.get("toolName") or "tool"
        return WorkflowEvent(
            event_type="tool_call",
            agent_id=_agent_id(payload.get("agent_id"), root_id),
            data={
                **common,
                "tool_name": tool_name,
                "args": payload.get("tool_input"),
                "summary": f"Permission requested for {tool_name}",
            },
        )

    if name == "PostToolUse":
        tool_name = payload.get("tool_name") or payload.get("toolName") or "tool"
        return WorkflowEvent(
            event_type="tool_output",
            agent_id=_agent_id(payload.get("agent_id"), root_id),
            data={
                **common,
                "tool_name": tool_name,
                "tool_use_id": payload.get("tool_use_id"),
                "output": payload.get("tool_response"),
                "summary": f"{tool_name} completed",
            },
        )

    if name == "SubagentStart":
        child_id = _agent_id(payload.get("agent_id"))
        agent_type = payload.get("agent_type") or "subagent"
        return WorkflowEvent(
            event_type="subagent_spawn",
            agent_id=child_id,
            parent_id=root_id,
            data={
                **common,
                "name": payload.get("agent_name") or agent_type,
                "agent_type": agent_type,
                "purpose": f"{agent_type} started",
                "summary": f"{agent_type} started",
            },
        )

    if name == "SubagentStop":
        child_id = _agent_id(payload.get("agent_id"))
        message = payload.get("last_assistant_message") or "Sub-agent finished"
        return WorkflowEvent(
            event_type="subagent_complete",
            agent_id=child_id,
            parent_id=root_id,
            data={
                **common,
                "agent_type": payload.get("agent_type"),
                "result_summary": message,
                "summary": summarize(message, 120),
                "status": "complete",
            },
        )

    if name == "Stop":
        message = payload.get("last_assistant_message") or "Turn finished"
        return WorkflowEvent(
            event_type="agent_output",
            agent_id=root_id,
            data={
                **common,
                "output": message,
                "summary": summarize(message, 120),
                "status": "complete",
            },
        )

    return WorkflowEvent(
        event_type="tool_call",
        agent_id=root_id,
        data={
            **common,
            "tool_name": name or "unknown_hook",
            "args": payload,
            "summary": name or "Codex hook",
        },
    )

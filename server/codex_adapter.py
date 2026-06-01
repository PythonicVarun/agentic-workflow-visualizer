from __future__ import annotations

import json
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


def _maybe_json(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "{[":
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def _extract_prompt(tool_input: Any) -> str:
    value = _maybe_json(tool_input)
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, dict):
        for key in (
            "prompt",
            "task",
            "instructions",
            "message",
            "input",
            "goal",
            "request",
            "content",
        ):
            candidate = value.get(key)
            if isinstance(candidate, str) and candidate.strip():
                return candidate.strip()
        messages = value.get("messages")
        if isinstance(messages, list):
            parts: list[str] = []
            for item in messages:
                if isinstance(item, dict):
                    content = item.get("content")
                    if isinstance(content, str) and content.strip():
                        parts.append(content.strip())
            if parts:
                return "\n".join(parts)
    return summarize(value, 400)


def _spawn_metadata(tool_input: Any, tool_response: Any) -> dict[str, Any]:
    response = _maybe_json(tool_response)
    if not isinstance(response, dict):
        return {}

    raw_agent_id = response.get("agent_id") or response.get("agentId")
    if not raw_agent_id:
        return {}

    prompt = _extract_prompt(tool_input)
    return {
        "spawned_agent_id": _agent_id(raw_agent_id),
        "spawned_agent_label": (
            response.get("nickname")
            or response.get("agent_name")
            or response.get("name")
            or None
        ),
        "spawn_prompt": prompt or None,
        "spawn_response": response,
    }


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
                "tool_input": payload.get("tool_input"),
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
                "tool_input": payload.get("tool_input"),
                "summary": f"Permission requested for {tool_name}",
            },
        )

    if name == "PostToolUse":
        tool_name = payload.get("tool_name") or payload.get("toolName") or "tool"
        tool_input = payload.get("tool_input")
        tool_response = payload.get("tool_response")
        spawn_metadata = _spawn_metadata(tool_input, tool_response)
        summary = f"{tool_name} completed"
        if spawn_metadata.get("spawned_agent_id"):
            prompt = spawn_metadata.get("spawn_prompt")
            detail = f" -> {spawn_metadata['spawned_agent_id']}"
            if prompt:
                detail += f" | {summarize(prompt, 80)}"
            summary = f"{tool_name} spawned{detail}"
        return WorkflowEvent(
            event_type="tool_output",
            agent_id=_agent_id(payload.get("agent_id"), root_id),
            data={
                **common,
                "tool_name": tool_name,
                "tool_use_id": payload.get("tool_use_id"),
                "tool_input": tool_input,
                "output": tool_response,
                "summary": summary,
                **spawn_metadata,
            },
        )

    if name == "SubagentStart":
        child_id = _agent_id(payload.get("agent_id"))
        agent_type = payload.get("agent_type") or "subagent"
        parent_value = (
            payload.get("parent_agent_id")
            or payload.get("parentAgentId")
            or payload.get("parent_id")
        )
        return WorkflowEvent(
            event_type="subagent_spawn",
            agent_id=child_id,
            parent_id=_agent_id(parent_value) if parent_value else None,
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

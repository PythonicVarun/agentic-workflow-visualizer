from __future__ import annotations

import json
import re
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from threading import RLock
from typing import Any

from .models import WorkflowEvent, utc_now

MAX_EVENT_HISTORY = 80
ROOT_AGENT_ID = "primary_agent"
SECRET_KEY_PATTERN = re.compile("key|token|secret|password|credential", re.IGNORECASE)


def _humanize(value: str) -> str:
    words = re.sub(r"[_\-]+", " ", value).strip().split()
    return " ".join(word.capitalize() for word in words) or "Agent"


def _trim(value: str, limit: int = 140) -> str:
    clean = " ".join(value.split())
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3].rstrip() + "..."


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: "[redacted]" if SECRET_KEY_PATTERN.search(str(key)) else _redact(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact(item) for item in value[:12]]
    return value


def summarize(value: Any, limit: int = 140) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return _trim(value, limit)
    try:
        return _trim(json.dumps(_redact(value), default=str, sort_keys=True), limit)
    except TypeError:
        return _trim(str(value), limit)


@dataclass
class WorkflowNode:
    id: str
    label: str
    role: str = "agent"
    status: str = "pending"
    last_action: str = "Waiting"
    started_at: datetime = field(default_factory=utc_now)
    updated_at: datetime = field(default_factory=utc_now)
    completed_at: datetime | None = None
    model: str | None = None
    event_count: int = 0
    tool_count: int = 0

    def snapshot(self, now: datetime) -> dict[str, Any]:
        end = self.completed_at or now
        elapsed_seconds = max(0, int((end - self.started_at).total_seconds()))
        return {
            "id": self.id,
            "label": self.label,
            "role": self.role,
            "status": self.status,
            "last_action": self.last_action,
            "elapsed_seconds": elapsed_seconds,
            "started_at": self.started_at.isoformat(),
            "updated_at": self.updated_at.isoformat(),
            "completed_at": (
                self.completed_at.isoformat() if self.completed_at else None
            ),
            "model": self.model,
            "event_count": self.event_count,
            "tool_count": self.tool_count,
        }


@dataclass(frozen=True)
class WorkflowEdge:
    source: str
    target: str
    label: str = "spawned"

    def snapshot(self) -> dict[str, str]:
        return {
            "from": self.source,
            "to": self.target,
            "label": self.label,
        }


class GraphState:
    def __init__(self) -> None:
        self._lock = RLock()
        self._nodes: dict[str, WorkflowNode] = {}
        self._edges: dict[tuple[str, str, str], WorkflowEdge] = {}
        self._events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENT_HISTORY)
        self._sequence = 0

    def reset(self) -> None:
        with self._lock:
            self._nodes.clear()
            self._edges.clear()
            self._events.clear()
            self._sequence = 0

    def apply_event(self, event: WorkflowEvent) -> dict[str, Any]:
        with self._lock:
            self._sequence += 1
            handler = getattr(self, f"_handle_{event.event_type}")
            handler(event)
            self._events.appendleft(self._event_snapshot(event))
            return self.snapshot()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            now = utc_now()
            nodes = [node.snapshot(now) for node in self._nodes.values()]
            nodes.sort(key=lambda node: (node["started_at"], node["id"]))
            edges = [edge.snapshot() for edge in self._edges.values()]
            active = sum(1 for node in nodes if node["status"] == "running")
            return {
                "nodes": nodes,
                "edges": edges,
                "events": list(self._events),
                "active_count": active,
                "sequence": self._sequence,
                "updated_at": now.isoformat(),
            }

    def _ensure_node(
        self,
        agent_id: str,
        *,
        label: str | None = None,
        role: str | None = None,
        status: str | None = "running",
        model: str | None = None,
        timestamp: datetime | None = None,
    ) -> WorkflowNode:
        now = timestamp or utc_now()
        node = self._nodes.get(agent_id)
        if node is None:
            node = WorkflowNode(
                id=agent_id,
                label=label or _humanize(agent_id),
                role=role or "agent",
                status=status or "pending",
                started_at=now,
                updated_at=now,
                model=model,
            )
            self._nodes[agent_id] = node
            return node

        if label:
            node.label = label
        if role:
            node.role = role
        if status and node.status not in {"complete", "failed"}:
            node.status = status
        if model:
            node.model = model
        node.updated_at = now
        return node

    def _touch(
        self,
        event: WorkflowEvent,
        *,
        status: str | None = "running",
        action: str,
        role: str | None = None,
        label: str | None = None,
    ) -> WorkflowNode:
        data = event.data
        node = self._ensure_node(
            event.agent_id,
            label=label or data.get("label") or data.get("name"),
            role=data.get("role") or role,
            status=status,
            model=data.get("model"),
            timestamp=event.timestamp,
        )
        node.last_action = _trim(action)
        node.updated_at = event.timestamp
        node.event_count += 1
        return node

    def _add_edge(self, source: str, target: str, label: str = "spawned") -> None:
        self._edges[(source, target, label)] = WorkflowEdge(source, target, label)

    def _handle_session_start(self, event: WorkflowEvent) -> None:
        action = "Visualizer attached"
        source = event.data.get("source")
        if source:
            action = f"Session {source}"
        self._touch(event, action=action, role="primary", label="Primary Agent")

    def _handle_user_input(self, event: WorkflowEvent) -> None:
        prompt = (
            event.data.get("prompt") or event.data.get("input") or "Prompt received"
        )
        self._touch(
            event,
            action=f"User prompt: {summarize(prompt, 110)}",
            role="primary",
            label=event.data.get("label") or "Primary Agent",
        )

    def _handle_agent_output(self, event: WorkflowEvent) -> None:
        output = event.data.get("output") or event.data.get("message") or "Responded"
        status = event.data.get("status") or "complete"
        node = self._touch(
            event, status=status, action=f"Output: {summarize(output, 120)}"
        )
        if status in {"complete", "failed"}:
            node.completed_at = event.timestamp

    def _handle_tool_call(self, event: WorkflowEvent) -> None:
        tool_name = event.data.get("tool_name") or event.data.get("tool") or "tool"
        args = (
            event.data.get("args")
            or event.data.get("input")
            or event.data.get("tool_input")
        )
        suffix = f" {summarize(args, 90)}" if args else ""
        node = self._touch(event, action=f"Calling {tool_name}{suffix}")
        node.tool_count += 1

    def _handle_tool_output(self, event: WorkflowEvent) -> None:
        tool_name = event.data.get("tool_name") or event.data.get("tool") or "tool"
        output = (
            event.data.get("output")
            or event.data.get("result")
            or event.data.get("tool_response")
        )
        self._touch(event, action=f"{tool_name} result: {summarize(output, 100)}")

    def _handle_subagent_spawn(self, event: WorkflowEvent) -> None:
        parent_id = event.parent_id or ROOT_AGENT_ID
        parent_label = "Primary Agent" if parent_id == ROOT_AGENT_ID else None
        parent_role = "primary" if parent_id == ROOT_AGENT_ID else None
        self._ensure_node(
            parent_id, label=parent_label, role=parent_role, status="running"
        )

        purpose = event.data.get("purpose") or event.data.get("prompt") or "Started"
        label = (
            event.data.get("name")
            or event.data.get("label")
            or _humanize(event.agent_id)
        )
        node = self._touch(
            event,
            status="running",
            action=f"Spawned: {summarize(purpose, 110)}",
            role=event.data.get("agent_type") or event.data.get("role") or "subagent",
            label=label,
        )
        node.started_at = min(node.started_at, event.timestamp)
        self._add_edge(
            parent_id, event.agent_id, event.data.get("edge_label") or "spawned"
        )

    def _handle_subagent_complete(self, event: WorkflowEvent) -> None:
        result = (
            event.data.get("result_summary")
            or event.data.get("result")
            or event.data.get("output")
            or "Finished"
        )
        status = event.data.get("status") or "complete"
        if status == "completed":
            status = "complete"
        if status not in {"complete", "failed"}:
            status = "complete"
        node = self._touch(
            event, status=status, action=f"Complete: {summarize(result, 120)}"
        )
        node.completed_at = event.timestamp

    def _handle_agent_error(self, event: WorkflowEvent) -> None:
        error = event.data.get("error") or event.data.get("message") or "Error"
        node = self._touch(
            event, status="failed", action=f"Error: {summarize(error, 120)}"
        )
        node.completed_at = event.timestamp

    def _event_snapshot(self, event: WorkflowEvent) -> dict[str, Any]:
        data = event.data
        labels = {
            "session_start": "Session",
            "user_input": "Input",
            "agent_output": "Output",
            "tool_call": "Tool call",
            "tool_output": "Tool output",
            "subagent_spawn": "Sub-agent spawned",
            "subagent_complete": "Sub-agent complete",
            "agent_error": "Error",
        }
        summary = (
            data.get("summary")
            or data.get("purpose")
            or data.get("tool_name")
            or data.get("output")
            or data.get("prompt")
            or data.get("message")
            or data.get("error")
            or event.event_type
        )
        return {
            "sequence": self._sequence,
            "event_type": event.event_type,
            "label": labels[event.event_type],
            "agent_id": event.agent_id,
            "parent_id": event.parent_id,
            "summary": summarize(summary, 130),
            "timestamp": event.timestamp.astimezone(timezone.utc).isoformat(),
        }

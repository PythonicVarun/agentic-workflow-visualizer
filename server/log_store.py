from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Iterable

from .models import WorkflowEvent

LOG_VERSION = 1


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class EventLogStore:
    def __init__(self, root: Path) -> None:
        self._root = root
        self._dir = root / ".awv-logs"
        self._lock = RLock()
        self._current_path: Path | None = None
        self._pending_reason = "startup"

    @property
    def current_path(self) -> Path | None:
        return self._current_path

    def snapshot(self) -> dict[str, Any]:
        path = self.current_path
        return {
            "current_path": str(path) if path else None,
            "file_name": path.name if path else None,
        }

    def rotate(self, *, reason: str) -> None:
        with self._lock:
            self._current_path = None
            self._pending_reason = reason

    def append_workflow_event(
        self, event: WorkflowEvent, *, source: str = "event"
    ) -> None:
        self.append_entry(
            {
                "kind": "workflow_event",
                "source": source,
                "recorded_at": _utc_now().isoformat(),
                "event": event.model_dump(mode="json"),
            }
        )

    def append_hook_event(
        self, hook_name: str, payload: dict[str, Any], event: WorkflowEvent
    ) -> None:
        self.append_entry(
            {
                "kind": "hook_event",
                "hook_name": hook_name,
                "recorded_at": _utc_now().isoformat(),
                "payload": payload,
                "event": event.model_dump(mode="json"),
            }
        )

    def append_entry(self, entry: dict[str, Any]) -> None:
        with self._lock:
            self._append_locked(entry)

    def _append_locked(self, entry: dict[str, Any]) -> None:
        path = self._ensure_current_path_locked()
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=True, default=str))
            handle.write("\n")

    def _ensure_current_path_locked(self) -> Path:
        path = self._current_path
        if path is not None:
            return path

        self._dir.mkdir(parents=True, exist_ok=True)
        created_at = _utc_now()
        filename = created_at.strftime("workflow-%Y%m%d-%H%M%S-%f.jsonl")
        path = self._dir / filename
        self._current_path = path
        self._write_entry_locked(
            path,
            {
                "kind": "meta",
                "version": LOG_VERSION,
                "reason": self._pending_reason,
                "created_at": created_at.isoformat(),
            },
        )
        return path

    def _write_entry_locked(self, path: Path, entry: dict[str, Any]) -> None:
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=True, default=str))
            handle.write("\n")


def parse_log_content(content: str) -> list[dict[str, Any]]:
    text = content.strip()
    if not text:
        return []

    if text[0] == "[":
        data = json.loads(text)
        if not isinstance(data, list):
            raise ValueError("Expected a JSON array.")
        return [item for item in data if isinstance(item, dict)]

    entries: list[dict[str, Any]] = []
    for line_number, line in enumerate(content.splitlines(), start=1):
        raw = line.strip()
        if not raw:
            continue
        try:
            item = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON on line {line_number}.") from exc
        if not isinstance(item, dict):
            raise ValueError(f"Expected a JSON object on line {line_number}.")
        entries.append(item)
    return entries


def events_from_log_entries(entries: Iterable[dict[str, Any]]) -> list[WorkflowEvent]:
    events: list[WorkflowEvent] = []
    for entry in entries:
        if "event_type" in entry:
            events.append(WorkflowEvent.model_validate(entry))
            continue

        payload = entry.get("event")
        if isinstance(payload, dict) and payload.get("event_type"):
            events.append(WorkflowEvent.model_validate(payload))
    return events

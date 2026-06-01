from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EventType = Literal[
    "session_start",
    "user_input",
    "agent_output",
    "tool_call",
    "tool_output",
    "subagent_spawn",
    "subagent_complete",
    "agent_error",
]

NodeStatus = Literal["pending", "running", "complete", "failed"]


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class WorkflowEvent(BaseModel):
    model_config = ConfigDict(extra="allow")

    event_type: EventType
    agent_id: str = "primary_agent"
    parent_id: str | None = None
    timestamp: datetime = Field(default_factory=utc_now)
    data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("timestamp", mode="before")
    @classmethod
    def default_timestamp(cls, value: Any) -> Any:
        return value or utc_now()

    @field_validator("timestamp")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

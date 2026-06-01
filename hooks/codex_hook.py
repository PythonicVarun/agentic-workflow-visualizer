#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_PORT = int(os.environ.get("AWV_PORT", "8765"))
BASE_URL = os.environ.get("AWV_URL", f"http://127.0.0.1:{DEFAULT_PORT}")


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return {"raw_stdin": raw}
    return payload if isinstance(payload, dict) else {"payload": payload}


def find_repo_root(payload: dict[str, Any]) -> Path:
    env_root = os.environ.get("AWV_REPO_ROOT")
    if env_root:
        return Path(env_root).resolve()

    candidates = []
    cwd = payload.get("cwd")
    if cwd:
        candidates.append(Path(cwd).resolve())
    candidates.extend(Path(__file__).resolve().parents)

    for candidate in candidates:
        if (candidate / "server" / "main.py").exists() and (
            candidate / "ui" / "index.html"
        ).exists():
            return candidate
    return Path.cwd().resolve()


def server_up() -> bool:
    try:
        with urllib.request.urlopen(f"{BASE_URL}/health", timeout=0.35) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def post_hook(hook_name: str, payload: dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{BASE_URL}/codex-hook/{hook_name}",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=1.2):
        pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def buffered_log_path(repo: Path) -> Path:
    override = os.environ.get("AWV_BUFFER_LOG")
    if override:
        return Path(override).expanduser().resolve()
    return repo / ".awv-logs" / "offline-capture.jsonl"


def ensure_repo_importable(repo: Path) -> None:
    repo_str = str(repo)
    if repo_str not in sys.path:
        sys.path.insert(0, repo_str)


def append_buffered_hook(repo: Path, hook_name: str, payload: dict[str, Any]) -> None:
    ensure_repo_importable(repo)
    from server.codex_adapter import codex_hook_to_event

    event = codex_hook_to_event(hook_name, payload)
    path = buffered_log_path(repo)
    path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "kind": "hook_event",
        "hook_name": hook_name,
        "recorded_at": utc_now(),
        "buffered": True,
        "payload": payload,
        "event": event.model_dump(mode="json"),
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, ensure_ascii=True, default=str))
        handle.write("\n")


def main() -> int:
    hook_name = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = read_payload()
    hook_name = hook_name or str(payload.get("hook_event_name") or "Unknown")
    repo = find_repo_root(payload)

    try:
        if server_up():
            post_hook(hook_name, payload)
        else:
            append_buffered_hook(repo, hook_name, payload)
    except Exception:
        # Visualization should never interfere with the coding agent.
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

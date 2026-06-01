#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import Any

DEFAULT_PORT = int(os.environ.get("AWV_PORT", "8765"))
BASE_URL = os.environ.get("AWV_URL", f"http://127.0.0.1:{DEFAULT_PORT}")
LOG_PATH = Path(os.environ.get("AWV_LOG", "/tmp/agentic-workflow-visualizer.log"))
BROWSER_MARKER = Path(f"/tmp/agentic-workflow-visualizer-browser-{DEFAULT_PORT}.marker")


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


def wait_for_server(seconds: float = 4.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if server_up():
            return True
        time.sleep(0.15)
    return False


def open_browser_once() -> None:
    if BROWSER_MARKER.exists():
        return
    try:
        BROWSER_MARKER.write_text(str(time.time()), encoding="utf-8")
        webbrowser.open_new_tab(BASE_URL)
    except OSError:
        pass


def ensure_server(repo: Path) -> None:
    if server_up():
        open_browser_once()
        return

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = LOG_PATH.open("ab")
    subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "server.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(DEFAULT_PORT),
        ],
        cwd=repo,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    if wait_for_server():
        open_browser_once()


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


def main() -> int:
    hook_name = sys.argv[1] if len(sys.argv) > 1 else ""
    payload = read_payload()
    hook_name = hook_name or str(payload.get("hook_event_name") or "Unknown")
    repo = find_repo_root(payload)

    try:
        ensure_server(repo)
        post_hook(hook_name, payload)
    except Exception:
        # Visualization should never interfere with the coding agent.
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

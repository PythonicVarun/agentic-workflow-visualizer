from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
LOG_PATH = Path("/tmp/agentic-workflow-visualizer.log")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def base_url(host: str, port: int) -> str:
    return f"http://{host}:{port}"


def server_up(url: str) -> bool:
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=0.4) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


def wait_for_server(url: str, seconds: float = 5.0) -> bool:
    deadline = time.time() + seconds
    while time.time() < deadline:
        if server_up(url):
            return True
        time.sleep(0.15)
    return False


def start_server(host: str, port: int) -> subprocess.Popen[bytes] | None:
    url = base_url(host, port)
    if server_up(url):
        return None

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log = LOG_PATH.open("ab")
    process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "server.main:app",
            "--host",
            host,
            "--port",
            str(port),
        ],
        cwd=repo_root(),
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,
    )

    if not wait_for_server(url):
        raise RuntimeError(f"Server did not start. See {LOG_PATH}")
    return process


def post(url: str, path: str) -> None:
    request = urllib.request.Request(f"{url}{path}", method="POST", data=b"{}")
    request.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(request, timeout=2.0):
        pass


def run_server_foreground(host: str, port: int) -> None:
    import uvicorn

    uvicorn.run("server.main:app", host=host, port=port, reload=False)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Launch the Agentic Workflow Visualizer."
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument(
        "--demo", action="store_true", help="Replay a branching demo after launch."
    )
    parser.add_argument(
        "--no-browser", action="store_true", help="Do not try to open a browser tab."
    )
    parser.add_argument(
        "--serve", action="store_true", help="Run the FastAPI server in the foreground."
    )
    args = parser.parse_args(argv)

    if args.serve:
        run_server_foreground(args.host, args.port)
        return 0

    url = base_url(args.host, args.port)
    start_server(args.host, args.port)

    if not args.no_browser:
        webbrowser.open_new_tab(url)

    if args.demo:
        post(url, "/demo")

    print(f"Agentic Workflow Visualizer: {url}")
    print(f"Server log: {LOG_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

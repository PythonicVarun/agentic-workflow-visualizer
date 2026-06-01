# Agentic Workflow Visualizer

Real-time browser dashboard for Codex activity: user prompts, tool calls, tool outputs, sub-agent starts/stops, and final outputs. The dashboard serves a self-contained SVG graph through FastAPI and streams live updates with SSE.

The current ready-to-run path is project-local Codex hooks in `.codex/hooks.json`. A Codex plugin scaffold is also included under `plugins/agentic-workflow-visualizer`.

## What It Runs

```text
Codex hook event
  -> hooks/codex_hook.py
  -> POST /codex-hook/{HookName}
  -> FastAPI in-memory graph state
  -> GET /stream SSE
  -> browser workflow diagram
```

No frontend build step is required.

## Prerequisites

- Python 3.12 or newer
- `pip`
- Codex CLI, if you want live Codex hook capture
- A browser available on the machine running the dashboard

Check Python:

```bash
python --version
```

## Fresh Setup & Direct Execution (uv / uvx)

You can run this project directly without cloning, or install/run it locally using `uv`.

### Direct Execution with `uvx`

To start the server and run the branching demo without downloading the repository:

```bash
uvx --from git+https://github.com/PythonicVarun/agentic-workflow-visualizer.git start --demo
```

### Local Setup with `uv`

If you have cloned the repository, you can install and run it using `uv`:

```bash
uv pip install -e .
uv run start --demo
```

After installing, the following commands are available:

```bash
uv run start --demo  # Launch the visualizer dashboard and play demo
uv run server        # Start the FastAPI server directly in the foreground
uv run install       # Install the Codex hooks
uv run uninstall     # Uninstall the Codex hooks
```

> [!NOTE]
> The `start` command starts the FastAPI server in the background (logging output to a temporary log file) and opens the web browser dashboard. If you prefer to run the server in the foreground, use `uv run server` or `uv run start --serve`.


### Installing Global Codex Hooks (Root / User)

To install the Codex hooks globally for the active user (including `root` if run with `sudo` / Administrator), you can do it in two ways:

#### Option A: Directly using `uvx` (without cloning the repo)

```bash
sudo uvx --from git+https://github.com/PythonicVarun/agentic-workflow-visualizer.git install
```

#### Option B: Using `uv run` (if you have cloned the repo)

```bash
sudo uv run install
```

This installs the hooks configuration to your home folder or `/root/.codex/hooks.json` utilizing `uvx --from <git-url>`. If run inside the repository clone, it dynamically detects and uses your local/forked git URL; otherwise, it falls back to the official upstream URL automatically.

### Uninstalling Global Codex Hooks (Root / User)

To uninstall/remove the Codex hooks configuration, you can do it in two ways:

#### Option A: Directly using `uvx` (without cloning the repo)

```bash
sudo uvx --from git+https://github.com/PythonicVarun/agentic-workflow-visualizer.git uninstall
```

#### Option B: Using `uv run` (if you have cloned the repo)

```bash
sudo uv run uninstall
```

> [!NOTE]
> The uninstallation command only removes visualizer-specific hooks from `hooks.json` and preserves all other user-defined hooks. If no other hooks remain after filtering, the `hooks.json` file is deleted completely.



## Run The Demo

Use this first. It verifies the dashboard without spending model tokens:

```bash
uv run start --demo
```

This starts the FastAPI server in the background on:

```text
http://127.0.0.1:8765
```

It also tries to open the browser automatically. If the browser does not open, visit the URL manually.

The demo replays a branching workflow with:

- 8 visible agent boxes
- 7 directed edges
- 30 streamed events
- zero model calls

Run without opening a browser:

```bash
uv run start --demo --no-browser
```

Run the server in the foreground:

```bash
uv run start --serve
```

Choose a different port:

```bash
uv run start --demo --port 8777
```

## Verify The Server

Health check:

```bash
curl http://127.0.0.1:8765/health
```

Current graph state:

```bash
curl http://127.0.0.1:8765/state
```

Manual event test:

```bash
curl -X POST http://127.0.0.1:8765/event \
  -H "Content-Type: application/json" \
  -d '{
    "event_type": "subagent_spawn",
    "agent_id": "manual_probe",
    "parent_id": "primary_agent",
    "data": {
      "name": "Manual Probe",
      "purpose": "Verify POST /event"
    }
  }'
```

## Use With Codex Project Hooks

Project-local hooks are defined in:

```text
.codex/hooks.json
```

They capture these Codex hook events:

- `SessionStart`
- `UserPromptSubmit`
- `PreToolUse`
- `PostToolUse`
- `SubagentStart`
- `SubagentStop`
- `Stop`

To use them:

1. Start Codex from this repo, or from a subdirectory inside this repo.
2. In Codex, run `/hooks`.
3. Review and trust the hooks from `.codex/hooks.json`.
4. Run your normal Codex prompt.

Once trusted, the first hook event starts the dashboard if needed, opens the browser when possible, and posts hook payloads to:

```text
POST /codex-hook/{HookName}
```

The hook script intentionally returns no model-visible content. It observes actions and results without exposing or visualizing internal reasoning text.

## Acceptance Test Prompt

After setup and hook trust, run this prompt in Codex:

```text
Perform any task of your choice using five non-linear sub-agents at very low cost.
```

Expected result:

- Browser opens automatically when the environment permits it
- At least 5 agent boxes are visible
- Arrows show branching, not a simple line
- Statuses and elapsed times update live
- Tool calls and outputs appear in the event feed
- Demo mode costs $0.00; live Codex cost depends on the selected model

## Plugin Scaffold

A repo-local plugin scaffold lives at:

```text
plugins/agentic-workflow-visualizer
```

It includes:

- `.codex-plugin/plugin.json`
- `hooks/hooks.json`
- `hooks/emit_event.py`
- `scripts/visualize.py`
- `skills/visualize/SKILL.md`

The plugin-bundled hooks use `PLUGIN_ROOT` and delegate to the same FastAPI dashboard. The project-local hook setup above is the simplest path for local development and demos.

If you install this as a Codex plugin, make sure the plugin manager loads `hooks/hooks.json`, then ask Codex to use the `visualize` skill or run:

```bash
python3 "$PLUGIN_ROOT/scripts/visualize.py" --demo
```

## Environment Variables

The hook script supports these overrides:

```text
AWV_PORT       Port for the local server. Default: 8765
AWV_URL        Full dashboard URL. Default: http://127.0.0.1:$AWV_PORT
AWV_REPO_ROOT  Explicit repo root for hook execution
AWV_LOG        Server log path. Default: /tmp/agentic-workflow-visualizer.log
```

Example:

```bash
AWV_PORT=8777 codex
```

## Endpoints

```text
GET  /                 Serve the browser UI
GET  /health           Health check
GET  /state            Current graph state
GET  /stream           SSE stream for live browser updates
POST /event            Generic workflow event ingest
POST /codex-hook/{x}   Raw Codex hook ingest
POST /demo             Replay the local branching demo
POST /reset            Clear in-memory graph state
```

## Troubleshooting

If the browser does not open:

```bash
open http://127.0.0.1:8765
```

On Linux or Codespaces, manually open the forwarded/local URL if `webbrowser.open_new_tab` cannot launch a GUI browser.

If port `8765` is already in use:

```bash
python -m scripts.visualize --demo --port 8777
```

For Codex hooks on a custom port:

```bash
AWV_PORT=8777 codex
```

If hooks do not fire:

- Confirm Codex was started inside this git repo.
- Run `/hooks` and verify `.codex/hooks.json` is trusted.
- Check the hook/server log:

```bash
tail -100 /tmp/agentic-workflow-visualizer.log
```

If dependencies are missing:

```bash
source .venv/bin/activate
python -m pip install -r requirements.txt
```

If the dashboard is stale:

```bash
curl -X POST http://127.0.0.1:8765/reset
curl -X POST http://127.0.0.1:8765/demo
```

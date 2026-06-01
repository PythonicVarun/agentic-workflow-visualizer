---
name: visualize
description: Launch the Agentic Workflow Visualizer dashboard and capture Codex hook activity as a live graph.
---

# Visualize

Run the local launcher when the user asks to visualize this Codex session:

```bash
python3 "$PLUGIN_ROOT/scripts/visualize.py"
```

For a local branching demo with no model calls:

```bash
python3 "$PLUGIN_ROOT/scripts/visualize.py" --demo
```

The dashboard listens on `http://127.0.0.1:8765` and receives hook events through the bundled
`hooks/hooks.json` configuration.

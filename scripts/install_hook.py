#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path


def main() -> int:
    if os.name == "nt":  # Windows
        user_profile = os.environ.get("USERPROFILE") or str(Path.home())
        target_dir = Path(user_profile) / ".codex"
    else:  # Linux/Unix/macOS
        try:
            is_root = os.geteuid() == 0
        except AttributeError:
            is_root = False

        if is_root:
            target_dir = Path("/root/.codex")
        else:
            target_dir = Path.home() / ".codex"

    target_file = target_dir / "hooks.json"

    git_url = "git+https://github.com/PythonicVarun/agentic-workflow-visualizer.git"
    print(f"Detected git URL: {git_url}")

    hooks_config = {"hooks": {}}

    events = [
        (
            "SessionStart",
            "startup|resume|clear|compact",
            "Starting workflow visualizer",
        ),
        ("UserPromptSubmit", "*", "Visualizing user prompt"),
        ("PreToolUse", "*", "Visualizing tool call"),
        ("PostToolUse", "*", "Visualizing tool result"),
        ("SubagentStart", "*", "Visualizing sub-agent start"),
        ("SubagentStop", "*", "Visualizing sub-agent stop"),
        ("Stop", "*", "Visualizing final output"),
    ]

    for event_name, matcher, status_message in events:
        hooks_config["hooks"][event_name] = [
            {
                "matcher": matcher,
                "hooks": [
                    {
                        "type": "command",
                        "command": f"uvx --from {git_url} hook {event_name}",
                        "timeout": 10,
                        "statusMessage": status_message,
                    }
                ],
            }
        ]

    try:
        # Check if we have permission to write to target directory
        if not target_dir.exists():
            try:
                target_dir.mkdir(parents=True, exist_ok=True)
            except PermissionError:
                print(
                    f"Permission denied when creating {target_dir}. Please run this script with appropriate privileges:"
                )
                if os.name == "nt":
                    print("Please run as Administrator.")
                else:
                    print(f"sudo sys.executable {__file__} or sudo uv run install")
                return 1

        with open(target_file, "w", encoding="utf-8") as f:
            json.dump(hooks_config, f, indent=4)

        print(f"Successfully installed Codex hooks to {target_file}!")
        print("Generated hooks configuration:")
        print(json.dumps(hooks_config, indent=2))
        return 0

    except Exception as e:
        print(f"Error installing hooks: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

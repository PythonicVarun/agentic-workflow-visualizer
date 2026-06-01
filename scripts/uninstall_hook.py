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

    if not target_file.exists():
        print(f"No Codex hooks found at {target_file}. Already uninstalled.")
        return 0

    try:
        # Load existing hooks configuration
        try:
            with open(target_file, "r", encoding="utf-8") as f:
                hooks_config = json.load(f)
        except Exception:
            hooks_config = {}

        hooks = hooks_config.get("hooks", {})
        if not isinstance(hooks, dict):
            # If the file format is invalid/corrupted, delete the file
            target_file.unlink()
            print(f"Successfully uninstalled Codex hooks by removing invalid {target_file}!")
            return 0

        modified = False
        keys_to_delete = []

        # Iterate over all events and filter out visualizer-specific hook entries
        for event_name, event_hooks_list in list(hooks.items()):
            if not isinstance(event_hooks_list, list):
                continue

            new_event_hooks_list = []
            for matcher_entry in event_hooks_list:
                if not isinstance(matcher_entry, dict) or "hooks" not in matcher_entry:
                    new_event_hooks_list.append(matcher_entry)
                    continue

                hooks_list = matcher_entry.get("hooks", [])
                if not isinstance(hooks_list, list):
                    new_event_hooks_list.append(matcher_entry)
                    continue

                filtered_hooks_list = []
                for hook_item in hooks_list:
                    is_visualizer = False
                    if isinstance(hook_item, dict):
                        command = hook_item.get("command", "")
                        if isinstance(command, str) and "agentic-workflow-visualizer" in command:
                            is_visualizer = True
                            modified = True

                    if not is_visualizer:
                        filtered_hooks_list.append(hook_item)

                if filtered_hooks_list:
                    matcher_entry["hooks"] = filtered_hooks_list
                    new_event_hooks_list.append(matcher_entry)
                else:
                    modified = True

            if new_event_hooks_list:
                hooks[event_name] = new_event_hooks_list
            else:
                keys_to_delete.append(event_name)
                modified = True

        for key in keys_to_delete:
            del hooks[key]

        if not modified:
            print(f"No visualizer-specific hooks were found in {target_file}. Preserved other user hooks.")
            return 0

        # If no hooks are left, remove the file entirely
        if not hooks:
            target_file.unlink()
            print(f"Successfully uninstalled all visualizer hooks and removed {target_file}!")

            # Clean up the directory if it is now empty
            if target_dir.exists() and not any(target_dir.iterdir()):
                try:
                    target_dir.rmdir()
                    print(f"Removed empty directory {target_dir}")
                except Exception:
                    pass
        else:
            # Save the updated hooks configuration back to the file
            hooks_config["hooks"] = hooks
            with open(target_file, "w", encoding="utf-8") as f:
                json.dump(hooks_config, f, indent=4)
            print(f"Successfully removed visualizer-specific hooks from {target_file} while preserving your other user hooks.")

        return 0

    except PermissionError:
        print(
            f"Permission denied when updating {target_file}. Please run this script with appropriate privileges:"
        )
        if os.name == "nt":
            print("Please run as Administrator.")
        else:
            print(f"sudo sys.executable {__file__} or sudo uv run uninstall")
        return 1
    except Exception as e:
        print(f"Error uninstalling hooks: {e}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

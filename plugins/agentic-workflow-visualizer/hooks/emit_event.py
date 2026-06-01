#!/usr/bin/env python3
from __future__ import annotations

import os
import runpy
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault("AWV_REPO_ROOT", str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT))

runpy.run_path(str(REPO_ROOT / "hooks" / "codex_hook.py"), run_name="__main__")

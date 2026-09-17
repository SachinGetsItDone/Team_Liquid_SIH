"""Path + import bootstrap.

The kiosk server imports the *real* module-b and module-c packages in place;
they are not vendored or copied. This module makes that import path explicit
and is the single place that knows the repository layout.
"""
from __future__ import annotations

import sys
from pathlib import Path

KIOSK_DIR = Path(__file__).resolve().parent
REPO_ROOT = KIOSK_DIR.parent

MODULE_A_DIR = REPO_ROOT / "module-a"
MODULE_B_DIR = REPO_ROOT / "module-b"
MODULE_C_DIR = REPO_ROOT / "module-c"

CONFIG_DIR = KIOSK_DIR / "config"
WEB_DIR = KIOSK_DIR / "web"
VAR_DIR = KIOSK_DIR / "var"


def _ensure_on_path() -> None:
    for p in (str(MODULE_A_DIR), str(MODULE_B_DIR), str(MODULE_C_DIR)):
        if p not in sys.path:
            sys.path.insert(0, p)


_ensure_on_path()


def sessions_dir() -> Path:
    d = VAR_DIR / "sessions"
    d.mkdir(parents=True, exist_ok=True)
    return d


def uploads_dir() -> Path:
    d = VAR_DIR / "uploads"
    d.mkdir(parents=True, exist_ok=True)
    return d

"""Repo-wide pytest path setup.

Makes the three module packages importable by their package names
(`media`, `medib`, `medic`) regardless of the working directory, so the
integration tests in `kiosk/tests/` can wire A + B + C together.
"""
from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
for _sub in ("module-a", "module-b", "module-c", "."):
    _p = str(_ROOT / _sub)
    if _p not in sys.path:
        sys.path.insert(0, _p)

"""Loads the kiosk's data-driven configuration.

Everything the UI renders (questions, options, labels, red-flag rules, ROS
sets, versions, limits) comes from these JSON files. The frontend hardcodes
no clinical content, so a clinician can change capture without touching code.
Configs are loaded once, validated for the fields the server relies on, and
cached.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from .paths import CONFIG_DIR


class ConfigError(RuntimeError):
    """Raised when a kiosk config file is missing or malformed."""


def _load(name: str) -> dict:
    path = CONFIG_DIR / name
    if not path.exists():
        raise ConfigError(f"missing config file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:  # pragma: no cover - config is checked in
        raise ConfigError(f"{name} is not valid JSON: {exc}") from exc


@lru_cache(maxsize=1)
def app_config() -> dict:
    cfg = _load("app.json")
    for key in ("languages", "versions", "limits", "brand"):
        if key not in cfg:
            raise ConfigError(f"app.json missing required key {key!r}")
    return cfg


@lru_cache(maxsize=1)
def interview() -> dict:
    cfg = _load("interview.json")
    if "turns" not in cfg or "sections" not in cfg or "complaints" not in cfg:
        raise ConfigError("interview.json must define turns, sections and complaints")
    return cfg


@lru_cache(maxsize=1)
def red_flags() -> dict:
    cfg = _load("red_flags.json")
    if "rules" not in cfg or "terms" not in cfg:
        raise ConfigError("red_flags.json must define rules and terms")
    return cfg


@lru_cache(maxsize=1)
def ros() -> dict:
    cfg = _load("ros.json")
    if "sets" not in cfg:
        raise ConfigError("ros.json must define sets")
    return cfg


def reload_configs() -> None:
    """Clear the cache (used by tests and by a config-watch reload)."""
    app_config.cache_clear()
    interview.cache_clear()
    red_flags.cache_clear()
    ros.cache_clear()

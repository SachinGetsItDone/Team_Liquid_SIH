"""Kiosk runtime configuration.

RAM profile is the binding constraint (doc/23 section 2.3/4.4). The 8 GB
P-Hospital profile is the recommended combined A+B kiosk; the 4 GB profile is
the reduced-feature fallback where LLM structuring is not kiosk-resident.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .scheduler import STAGE_RAM_MB, Stage


@dataclass
class KioskConfig:
    profile: str = "p-hospital"
    total_ram_mb: int = 8192
    baseline_mb: int = 2000                # OS + Tauri/FastAPI + SQLCipher
    reserve_mb: int = 1024                 # headroom for spikes/queue/buffers
    stage_ram_mb: dict = field(
        default_factory=lambda: {Stage(k): v for k, v in STAGE_RAM_MB.items()})
    scheduler_timeout_s: float = 30.0
    llm_load_mb: int = 2500                # Qwen3-1.7B Q4 (doc/09 section 5)
    llm_base_url: str = "http://127.0.0.1:8080/v1"
    llm_model: str = "qwen3"
    llm_idle_evict: bool = True

    @classmethod
    def four_gb(cls) -> "KioskConfig":
        """Reduced-feature 4 GB profile (doc/23 section 4.4)."""
        return cls(profile="reduced-4gb", total_ram_mb=4096, baseline_mb=1800,
                   reserve_mb=512)

    @classmethod
    def eight_gb(cls) -> "KioskConfig":
        """Recommended combined A+B kiosk profile."""
        return cls(profile="p-hospital", total_ram_mb=8192)

"""Engine configuration. Thresholds are PLACEHOLDERS pending M0 measured
distributions (doc/17 section 7.1) - do not treat as validated numbers."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class EngineConfig:
    # B3 engines
    rapidocr_enabled: bool = True
    tesseract_enabled: bool = True          # auto-degrades if binary missing
    tesseract_langs: str = "hin+eng"
    ocr_lang: str = "hi"                 # primary rec script (PP-OCRv5 mobile)
    # watchdog ladder: primary -> fallback -> manual-entry (doc/17 section 4)
    fallback_on: tuple = ("engine_error", "low_field_confidence", "empty_result")

    # B2 router thresholds (placeholder until M0)
    handwriting_if_avg_line_conf_below: float = 0.55
    table_if_col_alignment_score_above: float = 0.60
    low_conf_cutoff: float = 0.60            # a line below this counts as low-conf
    handwriting_low_conf_ratio_above: float = 0.5
    col_alignment_tol: int = 25              # px tolerance for column bucketing

    # B5 confidence gate (placeholder until M0)
    field_conf_threshold: float = 0.80
    vote_bonus_agree: float = 0.15           # used by voting.Vote.voted_conf
    vote_penalty_disagree: float = 0.25
    vote_iou_min: float = 0.30               # min bbox overlap to match two lines

    # B4 structurer: deterministic rules by default; llama.cpp adapter optional
    llm_url: str | None = None              # e.g. http://127.0.0.1:8080/v1
    llm_model: str = "qwen3"

    # B1 DPDP: transient session by default (doc/17 section 4 data-flow rule)
    persist_raw_scan_default: bool = False

    out_dir: Path = field(default_factory=lambda: Path("out"))


CONFIG = EngineConfig()


def config_from_env() -> EngineConfig:
    import os
    cfg = EngineConfig()
    cfg.llm_url = os.environ.get("MEDIB_LLM_URL") or cfg.llm_url
    if os.environ.get("MEDIB_NO_TESSERACT"):
        cfg.tesseract_enabled = False
    return cfg

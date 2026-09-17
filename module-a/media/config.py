"""Module A runtime configuration.

Thresholds marked PLACEHOLDER are pending the ASR/NLU bake-off on real OPD
audio (doc/09 section 6/10) - they are not validated clinical numbers.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class MediaConfig:
    # languages v1 (doc/09 section 1)
    language: str = "hi"                       # "hi" | "en" | "rom" (Hinglish)
    supported_languages: tuple = ("hi", "en", "rom")

    # slot confidence gate (PLACEHOLDER, doc/09 section 2 selective confirmation)
    slot_conf_threshold: float = 0.80
    # slots that always get an explicit audio confirmation when uncertain
    critical_slot_keys: tuple = ("severity", "medications", "allergies",
                                 "dose", "onset")

    # excerpt policy (doc/09 / demo directive: keep only clinical content)
    max_excerpt_chars: int = 280

    # red-flag rules: only clinician-signed rules run when True
    require_clinician_signoff: bool = False

    # adapters (None = deterministic/offline default; model weights not bundled)
    # `*_command` is a real runtime path: run an external binary, parse output.
    # Placeholders: {model} {wav} {lang} {text} {out} {voice}
    asr_command: tuple | None = None
    tts_command: tuple | None = None
    asr_model_path: str | None = None
    tts_voice_path: str | None = None
    # in-process real speech (module-a/media/speech.py)
    asr_engine: str | None = None            # "faster-whisper" | None
    asr_model: str = "base"                  # tiny | base | small (multilingual)
    tts_engine: str | None = None            # "system" | None
    mic_device: int | None = None
    mic_energy_threshold: float = 0.012
    nlu_url: str | None = None
    nlu_model: str = "qwen3"

    extra: dict = field(default_factory=dict)

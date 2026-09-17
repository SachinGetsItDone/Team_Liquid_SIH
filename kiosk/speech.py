"""Speech I/O service for the kiosk: real Module A ears and voice.

Wraps `module-a/media/speech.py` (offline faster-whisper ASR + OS TTS) behind
the kiosk API so the browser can capture audio locally and have the kiosk
runtime transcribe/synthesize it.

Design notes:
- The browser captures the microphone (a kiosk has one; the server process may
  not). Audio is posted as WAV, transcribed on the kiosk/edge CPU, and the
  audio bytes are dropped immediately (transient; no audio is written to the
  session store). This is the Module A "ring buffer, purge after transcription"
  posture.
- Models are lazy-loaded once and guarded by a lock: faster-whisper is not
  guaranteed thread-safe and load is ~1-2 s.
- Everything degrades: if a dependency or model is missing, the capability
  probe reports unavailable and callers fall back to touch/text. Nothing here
  raises at import time.
"""
from __future__ import annotations

import base64
import binascii
import io
import os
import tempfile
import threading
from pathlib import Path

from . import config_loader as cfg

_LOCK = threading.Lock()
_ASR = None
_TTS = None
_ASR_ERROR = ""
_TTS_ERROR = ""


def _speech_cfg() -> dict:
    app = cfg.app_config()
    return app.get("speech") or {}


def _lang_code(session_lang: str) -> str | None:
    """Map the kiosk language to a whisper language (None = auto-detect)."""
    speech = _speech_cfg()
    mapping = {
        "en": "en", "hi": "hi", "rom": "auto",
    }
    mapping.update(speech.get("asr_language_overrides") or {})
    code = mapping.get(session_lang, "auto")
    return None if code in (None, "auto") else code


def _get_asr():
    global _ASR, _ASR_ERROR
    if not _speech_cfg().get("enabled", True):
        _ASR_ERROR = "speech disabled in config"
        return None
    if _ASR is None and not _ASR_ERROR:
        try:
            from media.speech import FasterWhisperASR  # module-a on sys.path
            model = _speech_cfg().get("asr_model", "tiny")
            _ASR = FasterWhisperASR(model_size=model, device="cpu",
                                    compute_type="int8", language=None)
        except Exception as exc:  # dependency or model import failure
            _ASR_ERROR = f"{type(exc).__name__}: {exc}"
            return None
    return _ASR


def _get_tts():
    global _TTS, _TTS_ERROR
    if not _speech_cfg().get("tts_enabled", True):
        _TTS_ERROR = "tts disabled in config"
        return None
    if _TTS is None and not _TTS_ERROR:
        try:
            from media.speech import SystemTTS
            _TTS = SystemTTS(rate=int(_speech_cfg().get("tts_rate", 165)))
        except Exception as exc:
            _TTS_ERROR = f"{type(exc).__name__}: {exc}"
            return None
    return _TTS


def capabilities() -> dict:
    """Report availability WITHOUT loading models (fast, safe to poll)."""
    asr_dep = asr_model_ready()
    return {
        "auto_speak_default": bool(_speech_cfg().get("auto_speak_default", True)),
        "asr": {
            "available": bool(_speech_cfg().get("enabled", True) and asr_dep),
            "engine": "faster-whisper",
            "model": _speech_cfg().get("asr_model", "tiny"),
            "ready": asr_dep,
            "error": _ASR_ERROR or None,
        },
        "tts": {
            "available": bool(_speech_cfg().get("tts_enabled", True)),
            "engine": "system",
            "error": _TTS_ERROR or None,
        },
    }


def asr_model_ready() -> bool:
    """True when the faster-whisper package and the configured model exist."""
    try:
        import importlib.util
        if importlib.util.find_spec("faster_whisper") is None:
            return False
    except Exception:
        return False
    model = _speech_cfg().get("asr_model", "tiny")
    names = [f"models--Systran--faster-whisper-{model}",
             f"models--Systran--faster-whisper-{model}.en"]
    roots = [Path.home() / ".cache" / "huggingface" / "hub",
             Path(os.environ.get("HF_HOME", "")) / "hub" if os.environ.get("HF_HOME") else None,
             Path(os.environ.get("LOCALAPPDATA", "")) / "huggingface" / "hub" if os.environ.get("LOCALAPPDATA") else None]
    for root in roots:
        if root and root.exists():
            for n in names:
                if (root / n).exists():
                    return True
    return False


def transcribe(audio_bytes: bytes, session_lang: str = "en") -> dict:
    asr = _get_asr()
    if asr is None:
        raise RuntimeError(_ASR_ERROR or "ASR unavailable")
    if not audio_bytes:
        raise ValueError("empty audio")
    with _LOCK:
        result = asr.transcribe(audio_bytes)
    # audio bytes are local to this call and go out of scope here (transient)
    return {"text": (result.text or "").strip(), "conf": result.conf,
            "engine": "faster-whisper"}


def synthesize(text: str, lang: str = "hi") -> bytes:
    tts = _get_tts()
    if tts is None:
        raise RuntimeError(_TTS_ERROR or "TTS unavailable")
    if not text or not text.strip():
        raise ValueError("empty text")
    with _LOCK:
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            tts.synthesize_to_wav(text, path, lang=lang)
            data = Path(path).read_bytes()
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
    if len(data) < 1000:
        raise RuntimeError("TTS produced no audio")
    return data

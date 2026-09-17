"""Real speech I/O: microphone recorder, offline ASR (faster-whisper), system TTS.

These are the "ears and sound" behind the Module A adapters:
- `MicrophoneRecorder` captures 16 kHz mono from a real input device and stops
  on silence (energy VAD), so the kiosk listens per turn.
- `FasterWhisperASR` runs an offline multilingual Whisper model (Hindi/English/
  Hinglish) on CPU with no network at inference time; the model file is local.
- `SystemTTS` speaks through the OS voice (SAPI on Windows) and can also
  synthesize to WAV for tests/verification.

Honesty notes:
- The offline model is downloaded ONCE at setup, then runs locally; nothing is
  sent to a cloud service (residency constraint).
- Whisper's per-segment `avg_logprob` is exposed as a *confidence proxy*, not a
  calibrated probability.
- Hindi/Hinglish accuracy on real OPD audio is UNVALIDATED (doc/09 §10, M0).
"""
from __future__ import annotations

import io
import math
import os
import time
from dataclasses import dataclass, field
from typing import Protocol

from .adapters import ASRResult

SAMPLE_RATE = 16000


class Recorder(Protocol):
    def record(self, max_seconds: float = 15.0) -> bytes: ...


class MicrophoneRecorder:
    """Records one utterance from a real mic, stopping after trailing silence."""

    name = "microphone"

    def __init__(self, device: int | None = None, sample_rate: int = SAMPLE_RATE,
                 energy_threshold: float = 0.012, block_ms: int = 30):
        self.device = device
        self.sample_rate = sample_rate
        self.energy_threshold = energy_threshold
        self.block_ms = block_ms

    def _open_stream(self):
        import sounddevice as sd
        blocksize = int(self.sample_rate * self.block_ms / 1000)
        return sd.InputStream(device=self.device, samplerate=self.sample_rate,
                              channels=1, dtype="float32", blocksize=blocksize)

    def record(self, max_seconds: float = 15.0, silence_seconds: float = 1.0,
               start_timeout: float = 12.0) -> bytes:
        import numpy as np
        frames: list = []
        speaking = False
        silence = 0.0
        elapsed = 0.0
        block_s = self.block_ms / 1000.0
        with self._open_stream() as stream:
            while elapsed < max_seconds:
                block, _overflow = stream.read(int(block_s * self.sample_rate))
                block = np.asarray(block, dtype="float32").reshape(-1)
                rms = float(np.sqrt(np.mean(block ** 2) + 1e-12))
                elapsed += block_s
                if not speaking:
                    if rms >= self.energy_threshold:
                        speaking = True
                        frames.append(block)
                    elif elapsed >= start_timeout:
                        break                      # nobody spoke in time
                else:
                    frames.append(block)
                    silence = 0.0 if rms >= self.energy_threshold else silence + block_s
                    if silence >= silence_seconds:
                        break
        if not frames:
            return _to_wav(_silence(self.sample_rate))
        audio = np.concatenate(frames)
        return _to_wav(audio, self.sample_rate)


def _silence(sample_rate: int):
    import numpy as np
    return np.zeros(sample_rate // 10, dtype="float32")     # 100 ms of silence


def _to_wav(samples, sample_rate: int = SAMPLE_RATE) -> bytes:
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV", subtype="PCM_16")
    return buf.getvalue()


def wav_to_float32(audio: bytes, target_rate: int = SAMPLE_RATE):
    """Decode WAV bytes to mono float32 at target_rate (no ffmpeg needed)."""
    import numpy as np
    import soundfile as sf
    data, sr = sf.read(io.BytesIO(audio), dtype="float32")
    if getattr(data, "ndim", 1) > 1:
        data = data.mean(axis=1)
    if sr != target_rate and len(data):
        # numpy linear resample: no scipy (its BLAS DLL can be blocked by host
        # security policy, and speech ASR tolerates the small quality cost)
        n_out = int(round(len(data) * float(target_rate) / float(sr)))
        x_old = np.linspace(0.0, 1.0, len(data), endpoint=False)
        x_new = np.linspace(0.0, 1.0, n_out, endpoint=False)
        data = np.interp(x_new, x_old, data)
    return np.asarray(data, dtype="float32")


class FasterWhisperASR:
    """Offline multilingual ASR (faster-whisper / CTranslate2, CPU int8)."""

    name = "faster-whisper"

    def __init__(self, model_size: str = "base", device: str = "cpu",
                 compute_type: str = "int8", language: str | None = None,
                 model_dir: str | None = None, beam_size: int = 1):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.language = None if language in (None, "auto") else language
        self.model_dir = model_dir
        self.beam_size = beam_size
        self._model = None

    def _ensure(self):
        if self._model is None:
            from faster_whisper import WhisperModel
            self._model = WhisperModel(self.model_size, device=self.device,
                                       compute_type=self.compute_type,
                                       download_root=self.model_dir)
        return self._model

    def transcribe(self, audio) -> ASRResult:
        model = self._ensure()
        samples = wav_to_float32(audio) if isinstance(audio, (bytes, bytearray)) else audio
        segments, info = model.transcribe(samples, beam_size=self.beam_size,
                                          language=self.language)
        segs = list(segments)
        text = " ".join(s.text.strip() for s in segs).strip()
        conf = None
        if segs:
            avg = sum(getattr(s, "avg_logprob", 0.0) for s in segs) / len(segs)
            conf = round(min(1.0, max(0.0, math.exp(avg))), 4)   # proxy, not calibrated
        return ASRResult(text=text, conf=conf)


@dataclass
class SystemTTS:
    """Speaks through the OS voice; also synthesizes to WAV (for tests)."""

    name: str = "system-tts"
    rate: int = 165
    voice: str | None = None
    enabled: bool = True
    spoken: list = field(default_factory=list)
    _engine: object = None

    def _ensure(self):
        if self._engine is None:
            import pyttsx3
            self._engine = pyttsx3.init()
            self._engine.setProperty("rate", self.rate)
            if self.voice:
                self._engine.setProperty("voice", self.voice)
        return self._engine

    def speak(self, text: str, lang: str = "hi") -> None:
        if not self.enabled or not text:
            return
        engine = self._ensure()
        engine.say(text)
        engine.runAndWait()
        self.spoken.append((text, lang))

    def synthesize_to_wav(self, text: str, path: str, lang: str = "hi") -> str:
        """Write speech to a WAV file (fresh engine; avoids stateful flakiness)."""
        import pyttsx3
        engine = pyttsx3.init()
        engine.setProperty("rate", self.rate)
        if self.voice:
            engine.setProperty("voice", self.voice)
        engine.save_to_file(text, str(path))
        engine.runAndWait()
        deadline = time.time() + 5.0
        while time.time() < deadline:
            if os.path.exists(path) and os.path.getsize(path) > 1000:
                return str(path)
            time.sleep(0.1)
        raise RuntimeError(f"TTS produced no audio at {path!r}")


def list_input_devices() -> list[dict]:
    import sounddevice as sd
    out = []
    for i, d in enumerate(sd.query_devices()):
        if d.get("max_input_channels", 0) > 0:
            out.append({"index": i, "name": d["name"],
                        "channels": d["max_input_channels"]})
    return out

# MediKiosk Module A — Conversational History Capture (CPU-only, offline-first)

Implements the Module A design (doc/09) as a production-shaped Python package.
Deterministic dialogue state machine + deterministic red-flag classifier +
slot-level provenance, emitting the `medikiosk-history-bundle/1` contract that
Module C consumes.

- **A3 dialogue FSM**: deterministic sequence owns *what* to ask (pain and
  non-pain HPI variants); the extractor only fills a slot
- **A5 red flags**: deterministic rules only, never an LLM. RF-1..RF-4 are the
  prototype's demo list (en/hi/Hinglish terms); the 8 production candidates are
  inactive placeholders until dual-physician sign-off
- **A6 HistoryBundle emitter**: mirrors `module-c/medic/contracts.py` field-for-field
- **NLU**: rules-based default (offline, verbatim free text, parsed severity/yes-no)
  + a llama.cpp/Qwen3 adapter with a refusal value and no authority framing
- **Real speech (`speech.py`)**: `MicrophoneRecorder` (mic → silence-trimmed
  WAV), `FasterWhisperASR` (offline multilingual whisper, CPU int8) and
  `SystemTTS` (OS voice; also synthesizes to WAV). This is what makes the
  interview actually spoken — ears and sound.
- **Adapters**: VAD/ASR/TTS interfaces; external-binary adapters (whisper.cpp /
  sherpa) and offline doubles remain for deployment flexibility

## Layout

```
media/            the package (contracts, fsm, redflags, nlu, adapters,
                  speech, voice, session, config, cli)
tests/            unit + session + speech tests (real ASR test self-skips if
                  the model is unavailable)
```

## Run / test

```
python -m media.cli --demo --out out/                 # scripted
python -m media.cli --voice --language en             # real mic + ASR + TTS
python -m media.cli --voice --asr-model tiny --mic 1
pytest module-a/tests -q
```

Real speech needs `sounddevice`, `faster-whisper` and `pyttsx3` installed once:

```
pip install sounddevice faster-whisper pyttsx3
```

The ASR model is downloaded once (HuggingFace) then runs fully offline — no
audio leaves the machine. Hindi/Hinglish accuracy on real OPD audio is
**unvalidated** (doc/09 §10); the model size is configurable (`tiny|base|small`).

## Honest status (what is real vs stubbed)

| Component | Status |
|---|---|
| A3 FSM (pain/non-pain sequence) | Real, deterministic |
| A4 slot schema + states + provenance | Real (`media/contracts.py`) |
| A5 red-flag engine | Real for RF-1..RF-4 (demo list, **not clinician-signed**); 8 candidates declared inactive |
| A6 HistoryBundle emitter | Real; round-trips through `medic.contracts.load_history` |
| NLU rules extractor | Real, offline |
| NLU llama.cpp adapter | Real code path; needs a running `llama-server` |
| VAD / ASR / TTS adapters | Interfaces + deterministic test doubles; real-model bindings are not implemented, and refuse to run unattended |
| Audio retention | Ring-buffer stand-in with explicit `purge()`; wiring to Module D consent is the kiosk's job |

Red-flag rules are a **demo list** (doc/09 §10, research log 2026-09-16): the
production set needs clinician sign-off before it can gate escalation. The
engine therefore reports each hit's sign-off status, and
`MediaConfig.require_clinician_signoff=True` restricts evaluation to signed
rules only.

# Module A Design - Conversational History Capture

> **Status: UNRATIFIED CANDIDATE.** This doc captures the Module A design work done in two
> Codex sessions on **2026-09-09** (design-brief planning + full architecture). It existed
> only in Codex chat logs until it was distilled here on 2026-09-11. Scope items marked
> *user-confirmed* were confirmed by the team member driving those sessions; everything else
> is engineering recommendation pending team ratification (see `decisions/06-decisions-log.md`).

## 0. Provenance

| Session | Time (2026-09-09) | What it produced | How it ended |
|---|---|---|---|
| Codex design-brief session | 17:35 | Plan for this doc (file `~\.claude\plans\giggly-weaving-tide.md`, since deleted - recovered from chat), 3 scope decisions, 4 architectural safety rules | User pasted the safety rules; session stopped before the brief was written |
| Codex architecture session | 19:25 | 35-bullet scope confirmation, full architecture, verified tool survey (5 candidate tables), hardware fit, failure policy, trade-offs | User requested prototype ("move forward to its prototype stage"); session died on a **402 quota error before any prototype work started. No prototype exists.** |

The two sessions partially overlap: session 1 planned a 5-part brief, session 2 delivered a
different, larger cut of the same material. This doc merges both.

## 1. Scope (user-confirmed in the 2026-09-09 sessions)

**Framing:** Module A is the patient-facing conversational history-capture component of
MediKiosk, running on a public-hospital OPD kiosk before the patient sees a doctor.
Target environment: 4,000-10,000 OPD registrations/day (planning assumption - web validation
attempted, no reliable primary source found), **2-5 min doctor consultation time** (user-confirmed;
the original brief's "25 min" was a typo).

- **Languages v1 (user-confirmed):** Hindi, English, and Hindi-English code-mixed (Hinglish).
  Top-22 Indian languages deferred to v2.
- **Consent:** not researched yet. Module A consumes an opaque session token from Module D;
  it must not authenticate ABHA, create consent, or infer consent.
- **Interaction:** voice + touchscreen together (not separate workflows); usable independently
  by first-time, elderly, low-literacy patients. Every important prompt has both audio and
  visual form; touch is a first-class fallback for every answer.
- **Interview sequence:** open-ended narrative first, then structured gap-fill: chief complaint →
  SOCRATES/HPI (adapts to non-pain complaints) → red-flag screening → past medical/surgical
  history → medications → allergies → family/social history → focused ROS → ICE (ideas,
  concerns, expectations) → patient read-back. AYUSH/Dashavidha runs as a configurable second layer.
- **Hard behavior rules:** elicits and structures, never diagnoses or recommends treatment.
  Red flags trigger priority-triage/escalation, not ordinary queueing. Red-flag detection is a
  deterministic classifier, never an LLM decision.
- **Deployment posture:** offline-first for the core interview; queue handoff to Module C/HIS
  when the network is down; low maintenance, no sustained heavy CPU/GPU/RAM load.
- **Data residency (non-negotiable per the brief):** no non-Indian cloud API may touch patient
  health data - not as primary, not as fallback, not for a minor sub-task. Cloud components need
  confirmed India hosting/residency or get flagged as blocking risks.
- **Hardware ceiling (hard ceiling, NOT a target - figures are inherited assumptions, unsourced):**
  - Profile A: 4 GB VRAM / 12 GB DDR5
  - Profile B: 6 GB VRAM / 16 GB DDR5

## 2. Architectural safety rules (from `ocr_asr_rnd.md`, session 1)

These are **architectural requirements, not tooling preferences** - each traceable to a finding:

| Rule | Source | Why |
|---|---|---|
| Every slot carries an explicit `not_elicited` state | arXiv:2608.26167 | Makes fabrication structurally impossible for unasked fields. Authority-framed prompts swung abstention 0.18→1.00; confident fabrication measured 0.53-0.76. A kiosk saying "the physician needs a severity score" IS an authority frame. |
| No authority framing in NLU system prompts | arXiv:2608.26167 | Same result - prompt framing alone collapses abstention. |
| Slot-level confidence + selective audio confirmation | arXiv:2608.22872 | Entity corruption causes 87-96% of downstream degradation. Confirm drug names, dosages, numerals, red-flag slots. Do not confirm filler - throughput matters. |
| System elicits and structures; never diagnoses | g-AMIE; MedConsultBench (arXiv:2601.12661); arXiv:2507.15743 | The deliverable is the history, not the diagnosis. |

## 3. Decisions settled with the user in session 1 (pending team ratification)

- **Dashavidha v1 = self-reportable subset only.** 6 of 10 params captured by self-report;
  the 4 examination-dependent ones emitted as typed slots marked `requires_clinician`.
  Do NOT fabricate CCRAS Prakriti Assessment Scale items - the official item set is an open question.
- **ASR = pluggable adapter + bake-off gate.** One interface; working default vs. IndicConformer
  swap decided by measurement on real OPD audio. (Session 1 default: faster-whisper INT8;
  session 2 refined this - see §5.)
- **Hardware profiles = unknown.** The 4 GB / 6 GB figures are inherited assumptions. Must be
  replaced with real Indian OPD kiosk specs before the hardware budget is final (see §10, Step 0).

## 4. Architecture (session 2)

Pattern (from MEDCOD, arXiv:2111.09381): **the deterministic DM owns *what* to ask; the LLM owns
*how* to ask it.** This is what every recent clinical dialogue system converges on (Note2Chat,
MedClarify, g-AMIE).

```text
Module D
  │  opaque encounter/session token
  │  language allow-list, consent scope, retention policy
  ▼
Module A kiosk
  Touch UI ───────────────────────────────┐
  Microphone                              │
      │                                   │
      ▼                                   │
  Audio preprocessing → VAD → segmenter   │
      │                                   │
      ▼                                   │
  Local ASR → transcript + confidence     │
      │                                   │
      ▼                                   │
  Constrained NLU JSON extractor           │
      │                                   │
      ├── deterministic red-flag rules
      └── deterministic dialogue state machine
      │                                   │
      ▼                                   │
  Next prompt → local TTS + touch prompt ─┘
      │
      ▼
  Encrypted local event store
      │
      ▼
  Patient read-back and confirmation
      │
      ▼
  Signed HistoryBundle → Module C / HIS queue
```

**Module A requirements (from session 2's design):**

1. Accept only an opaque session token from Module D - no ABHA auth, no consent creation/inference.
2. Capture an initial free narrative before structured questions.
3. Run an explicit state machine for the full interview sequence (§1).
4. Dashavidha/AYUSH as a configurable second layer.
5. Never fabricate CCRAS items (open question).
6. Preserve original Hindi/Hinglish utterances AND normalized structured fields.
7. Store confidence and provenance for every extracted clinical field.
8. Red-flag detection = separate deterministic safety classifier, not LLM.
9. Never diagnose or recommend treatment; assessment/plan stay physician-owned.
10. Touch as first-class fallback for every important answer.
11. Raw audio in an encrypted memory ring buffer only; delete after transcription unless
    Module D's consent contract explicitly permits retention.
12. Encrypted local event DB with WAL + crash recovery.
13. Hand Module C a versioned `HistoryBundle`: source utterances, normalized fields, confidence,
    timestamps, red flags, consent/session references.
14. Idempotency keys so retries cannot duplicate a history.
15. Offline queue for Module C/HIS delivery when network is down.
16. Never send patient audio/transcript to a non-Indian cloud service.
17. Bhashini stays disabled unless written evidence confirms Indian processing, retention,
    contractual DPDP terms, production quotas, no cross-border transfer.
18. Signed model + app updates from an approved hospital or India-hosted endpoint.
19. Health-minimal operational telemetry only: latency, failures, queue age, temperature,
    disk space, model version.
20. Manual/nurse escalation when confidence is low, audio is unintelligible, or a safety rule fires.

## 5. Recommended stack (session 2; licenses/maintenance verified 2026-09-09)

| Component | Recommended tool | License | Footprint | Hosting | Last updated | Source |
|---|---|---|---|---|---|---|
| VAD and audio | Silero VAD + WebRTC Audio Processing | MIT + BSD-3-Clause | VAD model ~2 MB; CPU-only | Local | Silero 2026-08-24; APM date not pinned | [Silero](https://github.com/snakers4/silero-vad), [WebRTC APM](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/) |
| ASR | `whisper.cpp` multilingual Whisper-small, quantized; Qwen3-ASR-0.6B as Profile-B experiment | MIT runtime; model artifact terms must be pinned | ~0.8-1.5 GB RAM small quantized; ~1-2 GB VRAM | Local | 2026-09-08 | [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) |
| Dialogue NLU/state | `pytransitions` + `llama.cpp` with Qwen3-1.7B Q4 | MIT + Apache-2.0 | ~1.5-2.5 GB RAM/VRAM; state machine negligible | Local | llama.cpp 2026-09-09; pytransitions 2025-09-11 | [llama.cpp](https://github.com/ggml-org/llama.cpp), [Qwen3-1.7B](https://huggingface.co/Qwen/Qwen3-1.7B), [transitions](https://github.com/pytransitions/transitions) |
| TTS | `sherpa-onnx` with an approved Hindi Piper-format voice | Apache-2.0 runtime; voice license checked separately | ~100-300 MB per voice; CPU-capable | Local | 2026-09-09 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [Hindi voice catalog](https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/piper.html) |
| Storage and IPC | SQLCipher-backed SQLite + FastAPI + Tauri shell | BSD-3-Clause + public domain + MIT/Apache-2.0 | <300 MB incl. process overhead | Local or hospital LAN (India) | SQLCipher 2026-09-08; FastAPI 2026-07-29; Tauri 2026-09-09 | [SQLCipher](https://github.com/sqlcipher/sqlcipher), [SQLite](https://sqlite.org/copyright.html), [FastAPI](https://github.com/fastapi/fastapi), [Tauri](https://github.com/tauri-apps/tauri) |
| Cloud fallback | **None approved** | Bhashini service terms not sufficiently verified | Network-dependent | Claimed India service; residency/retention not confirmed | Unknown | [Bhashini ULCA](https://bhashini.gov.in/ulca) |

Memory numbers are engineering estimates, not vendor guarantees. Pin exact model files and
benchmark on the actual kiosk motherboard, GPU driver, and quantization before procurement.

Key changes vs. the 2026-09-01 candidate runtime (decisions log): NLU model **Qwen3-1.7B Q4**
(not 4B - too large for safe concurrency on Profile A); ASR baseline **quantized whisper.cpp**
(not sherpa-onnx ASR); **Bhashini demoted from "fallback" to "blocked risk"** (residency/
retention/quotas unverified). Also: Qwen3-ASR now documents streaming + 52 languages, so
"no streaming Hindi ASR exists" is **no longer safe to state** - its resource use still needs
a hardware benchmark.

## 6. Hardware fit, scheduling, and kiosk count

| Profile | Default deployment | Expected peak | Verdict |
|---|---|---:|---|
| 4 GB VRAM / 12 GB RAM | Whisper-small Q5/Q8, Qwen3-1.7B Q4, Silero VAD, sherpa TTS | ~2.5-3.5 GB VRAM, 7-10 GB RAM with ASR and NLU scheduled serially | Fits; ≥2 GB RAM headroom required |
| 6 GB VRAM / 16 GB RAM | Same stack; optionally test Qwen3-ASR-0.6B or Qwen3-4B Q4 (one at a time) | ~4.5-5.8 GB VRAM, 10-14 GB RAM | Fits only with strict scheduling; larger models are a stretch |

**Never run ASR, NLU, and TTS concurrently on one GPU.** Scheduler rules:
1. Keep VAD resident. 2. ASR only while the patient is speaking. 3. Release/reduce ASR GPU
allocation after a final segment. 4. NLU only after an utterance/answer completes. 5. TTS on
CPU where possible. 6. Hard memory watchdog - on allocation failure, fall back to the smaller
model, then to touch input.

**Kiosk-count math (sizing estimate, not validated hospital data):** at a 10-hour OPD day and
2.5-minute sessions, one kiosk supports ~240 sessions/day → **~17 kiosks for 4,000 patients/day,
~42 for 10,000**, before breaks, cleaning, abandonment, and maintenance.

## 7. Candidate survey (session 2; license + maintenance verified 2026-09-09)

"Free local" = no per-call fee when self-hosted; models/voices still need their own license review.

### VAD / audio preprocessing (13 candidates)

| Candidate | License / free status | Footprint | Hosting | Maintenance signal | Source |
|---|---|---:|---|---|---|
| Silero VAD | MIT; free local | ~2 MB, CPU | Local | Active; 2026-08-24 | [Repo](https://github.com/snakers4/silero-vad) |
| WebRTC VAD | BSD-3-Clause; free local | <1 MB | Local | Active upstream; date not pinned | [Source](https://webrtc.googlesource.com/src/) |
| RNNoise | BSD-3-Clause; free local | 1-5 MB | Local | 2025-02-22 | [Repo](https://github.com/xiph/rnnoise) |
| WebRTC Audio Processing | BSD-3-Clause; free local | 5-20 MB | Local | Active; date not pinned | [Source](https://webrtc.googlesource.com/src/+/refs/heads/main/modules/audio_processing/) |
| SpeexDSP | BSD-3-Clause; free local | <5 MB | Local | Active, slower-moving | [Repo](https://github.com/xiph/speexdsp) |
| DeepFilterNet | MIT; free local | 100-300 MB | Local | Active; date not pinned | [Repo](https://github.com/Rikorose/DeepFilterNet) |
| FFmpeg | LGPL-2.1+ base; build may become GPL | 20-80 MB | Local | Active; pin build config | [Repo](https://github.com/FFmpeg/FFmpeg) |
| GStreamer | LGPL-2.1+; plugin licenses vary | 30-100 MB | Local | Active; date not pinned | [Repo](https://gitlab.freedesktop.org/gstreamer/gstreamer) |
| PortAudio | MIT-style; free local | <1 MB | Local | Active; date not pinned | [Repo](https://github.com/PortAudio/portaudio) |
| python-sounddevice | MIT; free local | <1 MB + Python | Local | 2026-08-29 | [Repo](https://github.com/spatialaudio/python-sounddevice) |
| torchaudio | BSD-2-Clause; free local | >500 MB w/ PyTorch | Local | Active, heavyweight | [Repo](https://github.com/pytorch/audio) |
| webrtcvad-wheels | MIT wrapper; free local | <1 MB | Local | Community; verify before pinning | [Repo](https://github.com/daanzu/py-webrtcvad-wheels) |
| noisereduce | MIT; free local | 50-150 MB stack | Local | Active, not latency-specialized | [Repo](https://github.com/timsainb/noisereduce) |

**Pick:** Silero VAD + WebRTC APM. Add RNNoise/DeepFilterNet only if acoustic testing shows
material improvement. A directional close-talk mic + acoustic treatment likely beats any denoiser.

### ASR (13 candidates)

| Candidate | License / free status | Footprint | Hosting | Maintenance signal | Source |
|---|---|---:|---|---|---|
| Qwen3-ASR 0.6B/1.7B | Apache-2.0; free local; pin model card | ~1.5-3 GB (0.6B quantized); 1.7B larger | Local | Active; 2026-06-26 | [Repo](https://github.com/QwenLM/Qwen3-ASR), [Models](https://huggingface.co/collections/Qwen/qwen3-asr) |
| IndicConformerASR | MIT repo; some artifacts gated | ~2-4 GB (600M-class) | Local | 2025-06-20; less active | [Repo](https://github.com/AI4Bharat/IndicConformerASR) |
| Vakyansh | Varies by artifact; verify each | ~100 MB-1+ GB | Local | Older research signal | [Repo](https://github.com/AI4Bharat/Vakyansh) |
| Bhashini ASR API | Service, not self-hosted OSS; production terms unconfirmed | Network | India (claimed) | Pricing/quotas/retention/cross-border unverified | [ULCA](https://bhashini.gov.in/ulca) |
| sherpa-onnx | Apache-2.0; free local | Small runtime; models 0.5-1.5 GB | Local | Very active; 2026-09-09 | [Repo](https://github.com/k2-fsa/sherpa-onnx) |
| whisper.cpp | MIT; free local; pin model artifact | ~0.5-1.5 GB quantized multilingual | Local | Very active; 2026-09-08 | [Repo](https://github.com/ggml-org/whisper.cpp) |
| faster-whisper | MIT; free local | ~1-3 GB | Local | 2025-11-19; comparatively stale | [Repo](https://github.com/SYSTRAN/faster-whisper) |
| Vosk | Apache-2.0; free local | ~50-500 MB/model | Local | Active; 2026-08-09 | [Repo](https://github.com/alphacep/vosk-api) |
| NVIDIA NeMo | Apache-2.0; free local | 4-12+ GB w/ deps | Local | Very active; 2026-09-09 | [Repo](https://github.com/NVIDIA/NeMo) |
| ESPnet | Apache-2.0; free local | 4-12+ GB | Local | Very active; 2026-09-09 | [Repo](https://github.com/espnet/espnet) |
| WeNet | Apache-2.0; free local | 2-8 GB | Local | Active; 2026-09-07 | [Repo](https://github.com/wenet-e2e/Wenet) |
| FunASR | MIT; free local | 2-8 GB | Local | Very active; 2026-09-09 | [Repo](https://github.com/modelscope/FunASR) |
| SpeechBrain | Apache-2.0; free local | 2-8 GB | Local | Active; 2026-08-27 | [Repo](https://github.com/speechbrain/speechbrain) |

**Pick:** quantized `whisper.cpp` as conservative v1 baseline (well-understood resources;
reasonable Hindi/English/code-switch). Qwen3-ASR-0.6B as a controlled Profile-B experiment
(promising documented streaming). IndicConformer/Vakyansh stay phase-2 until model access,
Hinglish accuracy, and resource use are measured.

### Dialogue NLU / state (13 candidates)

| Candidate | License / free status | Footprint | Hosting | Maintenance signal | Source |
|---|---|---:|---|---|---|
| llama.cpp | MIT; free local | <100 MB runtime | Local | Very active; 2026-09-09 | [Repo](https://github.com/ggml-org/llama.cpp) |
| llama-cpp-python | MIT; free local | <150 MB + model | Local | 2026-08-17 | [Repo](https://github.com/abetlen/llama-cpp-python) |
| Qwen3-1.7B | Apache-2.0; free local | ~1.5-2.5 GB Q4 | Local | Current; pin revision | [Model](https://huggingface.co/Qwen/Qwen3-1.7B) |
| Qwen3-4B | Apache-2.0; free local | ~3.5-5 GB Q4 | Local | Current | [Model](https://huggingface.co/Qwen/Qwen3-4B) |
| Qwen2.5-1.5B-Instruct | Apache-2.0; free local | ~1.3-2.2 GB Q4 | Local | Current | [Model](https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct) |
| Phi-4-mini-instruct | MIT; free local | ~2-4 GB quantized | Local | Current | [Model](https://huggingface.co/microsoft/Phi-4-mini-instruct) |
| SmolLM2-1.7B-Instruct | Apache-2.0; free local | ~1.5-2.5 GB Q4 | Local | Current | [Model](https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct) |
| Granite-3.3-2B-Instruct | Apache-2.0; free local | ~2-3 GB Q4 | Local | Current | [Model](https://huggingface.co/ibm-granite/granite-3.3-2b-instruct) |
| Rasa Open Source | Apache-2.0 core; Pro/Studio paid | 300-700 MB + models | Local | Active; 2026-07-24 | [Repo](https://github.com/RasaHQ/rasa) |
| XState | MIT; free local | <1 MB | Local | Very active; 2026-09-09 | [Repo](https://github.com/statelyai/xstate) |
| pytransitions | MIT; free local | <1 MB | Local | Active, slower; 2025-09-11 | [Repo](https://github.com/pytransitions/transitions) |
| Haystack | Apache-2.0; free local | 200-500 MB + model | Local | Active; date not pinned | [Repo](https://github.com/deepset-ai/haystack) |
| Semantic Kernel | MIT; free local | 100-300 MB | Local | Active; date not pinned | [Repo](https://github.com/microsoft/semantic-kernel) |

**Pick:** `pytransitions` owns interview state/validation; `llama.cpp` + Qwen3-1.7B does
constrained extraction to a JSON schema. JSON-only output, fixed field enumerations, medical
vocabulary lists, and a refusal value (`unknown`) instead of letting the model guess.

### TTS (13 candidates)

| Candidate | License / free status | Footprint | Hosting | Maintenance signal | Source |
|---|---|---:|---|---|---|
| sherpa-onnx TTS | Apache-2.0 runtime; voices separate | ~100-300 MB/voice | Local | Very active; 2026-09-09 | [Repo](https://github.com/k2-fsa/sherpa-onnx) |
| AI4Bharat IndicF5 | MIT repo; model terms need review | 1-3+ GB, GPU-heavy | Local | Current; date not pinned | [Repo](https://github.com/AI4Bharat/IndicF5) |
| Bhashini TTS | Govt API; production terms unconfirmed | Network | India (claimed) | Blocked | [ULCA](https://bhashini.gov.in/ulca) |
| Piper1-gpl | GPL-3.0; free but not Apache-clean | ~20-100 MB/voice | Local | Active; 2026-09-04 | [Repo](https://github.com/OHF-Voice/piper1-gpl) |
| Coqui TTS | MPL-2.0; free local | ~200 MB-1 GB | Local | 2024-08-16; stale risk | [Repo](https://github.com/coqui-ai/TTS) |
| Mimic3 | AGPL-3.0; copyleft | ~100-500 MB | Local | Maintenance risk | [Repo](https://github.com/MycroftAI/mimic3) |
| F5-TTS | MIT; free local | Several GB, GPU-heavy | Local | 2026-07-23 | [Repo](https://github.com/SWivid/F5-TTS) |
| OpenVoice | MIT; free local; voice terms separate | 1-4 GB | Local | 2025-04-19 | [Repo](https://github.com/myshell-ai/OpenVoice) |
| Bark | MIT; free local | Several GB; slow on kiosk | Local | 2024-08-19; stale risk | [Repo](https://github.com/suno-ai/bark) |
| eSpeak NG | GPL-3.0; copyleft | <100 MB | Local | Active | [Repo](https://github.com/espeak-ng/espeak-ng) |
| Flite | BSD-style; free local | <50 MB | Local | Mature, slow-moving | [Repo](https://github.com/festvox/flite) |
| Festival | X11-style; voices separate terms | <100 MB | Local | Mature, slow-moving | [Project](https://www.cstr.ed.ac.uk/projects/festival/) |
| MaryTTS | LGPL-3.0; free local | 100-500 MB | Local | Mature; date not pinned | [Repo](https://github.com/marytts/marytts) |

**Pick:** sherpa-onnx with a Hindi voice whose individual model license is documented
compatible. Do NOT embed the GPL Piper runtime. Keep pre-recorded bilingual prompts as a
fallback so a TTS failure never stops the interview.

### Offline storage / orchestration (13 candidates)

| Candidate | License / free status | Footprint | Hosting | Maintenance signal | Source |
|---|---|---:|---|---|---|
| SQLite | Public domain; free | <1 MB library | Local | Mature, active | [License](https://sqlite.org/copyright.html) |
| SQLCipher | BSD-3-Clause; free to build; commercial support optional | SQLite-sized + crypto | Local | 2026-09-08 | [Repo](https://github.com/sqlcipher/sqlcipher) |
| DuckDB | MIT; free local | 20-50 MB | Local | Active | [Repo](https://github.com/duckdb/duckdb) |
| RocksDB | Apache-2.0; free local | 20-100 MB | Local | Active | [Repo](https://github.com/facebook/rocksdb) |
| LMDB | OpenLDAP Public License | Few MB | Local | Mature | [Repo](https://github.com/LMDB/lmdb) |
| Badger | Apache-2.0; free local | 20-100 MB | Local | Active | [Repo](https://github.com/dgraph-io/badger) |
| NATS Server | Apache-2.0; free local | 20-50 MB | Local/LAN | Active | [Repo](https://github.com/nats-io/nats-server) |
| Celery | BSD-3-Clause; free local | 100+ MB + broker | Local | Active | [Repo](https://github.com/celery/celery) |
| APScheduler | MIT; free local | <10 MB | Local | Active | [Repo](https://github.com/agronholm/apscheduler) |
| FastAPI | MIT; free local | 50-150 MB w/ Python | Local/LAN | 2026-07-29 | [Repo](https://github.com/fastapi/fastapi) |
| Tauri | Apache-2.0/MIT; free local | 5-15 MB shell | Local | 2026-09-09 | [Repo](https://github.com/tauri-apps/tauri) |
| Qt | LGPL-3.0 or commercial; LGPL-compatible modules only | 50-150 MB | Local | Active | [Project](https://www.qt.io/) |
| Electron | MIT; free local | 150-300 MB | Local | Active | [Repo](https://github.com/electron/electron) |

**Pick:** SQLCipher-backed SQLite for a single kiosk: append-only event table, encrypted WAL,
monotonic sequence numbers, outbox table for Module C/HIS delivery. FastAPI for local IPC;
Tauri keeps the public shell small. Celery/Kafka/Redis-style brokers add maintenance without
solving a real Module A requirement.

## 8. Failure and fallback policy

| Failure | Response |
|---|---|
| Noisy audio | Prompt patient to move closer; acoustic enclosure + directional mic; then RNNoise/DeepFilterNet |
| ASR timeout / GPU allocation failure | Switch to smaller Whisper model; offer touch-entry questions |
| Qwen3-ASR instability | Use quantized `whisper.cpp` segmented decoding |
| NLU timeout | Deterministic slot parser + repeat the question; never accept an unvalidated LLM field |
| Low confidence on drug, dose, allergy, or date | Mark `unreadable/unknown`; require touch confirmation or clinician review |
| TTS failure | Play pre-recorded Hindi/English prompts; show text/icons |
| Power loss | Recover from SQLCipher WAL; resume session via the opaque token |
| Network loss | Continue fully offline; queue Module C/HIS delivery |
| Red flag | Stop routine flow; display + speak escalation instruction; notify the configured nurse/triage channel |
| Bhashini unavailable or non-compliant | Do not upload health data; remain local; escalate to staff |

## 9. Trade-offs and reconsideration points

- The 4 GB profile forces segmented near-real-time ASR, not a large always-streaming model.
- The 6 GB profile can test Qwen3-ASR-0.6B but must not run it concurrently with a 4B NLU model.
- Qwen3-4B would improve extraction quality but is a stretch; Qwen3-1.7B is the production default.
- Hindi/Hinglish medical accuracy depends heavily on a local corpus, microphone design, decoder
  vocabulary, and evaluation of medication names/dosages - not just model choice.
- Bhashini cannot be a compliant fallback until India-only processing, retention, pricing, and
  contractual terms are confirmed in writing.
- Piper's maintained runtime is GPL-3.0; sherpa-onnx + separately licensed voices is the cleaner
  deployment boundary.
- AYUSH coverage is incomplete until the official CCRAS questionnaire and a unified
  SOCRATES/Dashavidha schema exist.
- **If hardware increases substantially:** reconsider Qwen3-ASR-1.7B, IndicConformer, or a larger
  domain-adapted model.
- **If residency constraints change:** cloud ASR/TTS could improve language coverage (currently
  outside the design).
- **If the kiosk fleet is small:** evaluate a hospital-owned India-hosted inference server with
  thin clients - still inside the hospital's DPDP/ABDM control boundary.

## 10. Open items carried forward

1. **Step 0 (BLOCKING, from session 1's plan): ground the hardware profiles.** The 4 GB / 6 GB
   ceilings appear nowhere in a sourced doc. Research targets: commercial Indian health-kiosk
   vendor specs; ABDM-linked kiosk deployments (ABHA registration kiosks, e-Sanjeevani terminals)
   and tender hardware; whether real Indian public-hospital kiosks have a discrete GPU at all.
   **If they don't, the entire on-device LLM premise changes** - pivot to CPU/iGPU-quantized tier
   or room-server-per-hospital with thin kiosk clients.
2. **Bhashini residency verification** (blocked risk, not a fallback, until terms are in writing).
3. **CCRAS Prakriti Assessment Scale items** - must not be invented; official item set unresolved.
4. **OPD scale figures (4,000-10,000/day) unvalidated** - session 2's web searches found no
   reliable primary source; the local search layer was inconsistent.
5. **Model artifact license pinning:** Whisper model terms, Qwen3-ASR model card, exact Qwen3-1.7B
   revision, individual Hindi TTS voice licenses.
6. **Prototype: not started.** The session died (402 quota error) on the user's request to move
   to prototype ("download and run models via a Python script"). This is the natural next step
   once the team ratifies this design.
7. **HistoryBundle contract with Module C:** ontology, serialization, API contract, confidence
   schema, session-retention policy, consent boundary all undefined.
8. **`ocr_asr_rnd.md` was never folded into doc 08** (session 1 finding) - it carries ~40 cited
   papers with hard design consequences; doc 08 conflicts with it on the launch ASR engine
   (frozen FastConformer vs. segmented Whisper - both correct on different axes).

---

*Captured from Codex sessions 2026-09-09 (17:35 design-brief planning; 19:25 full architecture)
by opencode session `module-1-1` on 2026-09-11. Raw session logs:
`~/.codex/sessions/2026/09/09/rollout-2026-09-09T17-35-33-*.jsonl` and
`rollout-2026-09-09T19-25-39-*.jsonl`.*

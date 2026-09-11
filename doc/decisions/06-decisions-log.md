# Decisions Log

**How to use:** log every architectural/design decision with a "why". Record alternatives considered and why they lost. Shared across sessions.

**Phase note:** the overall solution approach (`ocr_asr_rnd.md`, `solution.txt`) is still NOT ratified by the team. The confirmed rows below are **demo-prototype scope decisions** only — they constrain the SIH presentation artifact, not the product architecture (that stays in the candidate table until ratified).

## Candidate decisions under discussion (NOT decided)

| Decision | Options being weighed | Status |
|----------|----------------------|--------|
| Dialogue architecture for Module A | Slot-filling DM owns state vs free-running LLM vs **hybrid (DM owns state, LLM as NLU)** | Research ongoing - see doc 08 §4 |
| Document AI for Module B | VLM-first vs classical OCR vs **router** | Research ongoing - see doc 08 §2 |
| ASR engine | IndicConformer vs fine-tuned Whisper vs IndicWav2Vec (+ Bhashini fallback) | Research ongoing - see doc 08 §1 |
| ABDM integration posture | Direct FHIR vs facade onto legacy HIS; offline-queued sync | Research ongoing - see doc 08 §3 |
| Summary output schema | SOAP (S/O/A/P) over a single FHIR `HistoryBundle` canon | Draft - see doc 04 + doc 08 §5 |
| Module A runtime posture (PROPOSED 2026-09-01) | Offline-first hybrid: unified **sherpa-onnx** (Apache-2.0) for VAD+ASR+TTS + **llama.cpp/Qwen3-4B** (Apache-2.0) for NLU, with **Bhashini (bhashini.gov.in)** as the India-hosted cloud fallback; AYUSH two-layer schema in v1 | Proposed by design session - team to ratify. Why: verified license/footprint fit (see research log 2026-09-01) - clean Apache stack, one runtime => fewest moving parts on a 4-6GB kiosk; segmented Whisper ASR because no streaming Hindi model exists on-device today |
| Module A runtime posture v2 (PROPOSED 2026-09-09, supersedes row above if ratified) | Silero VAD + WebRTC APM \| **quantized whisper.cpp** ASR (Qwen3-ASR-0.6B as experiment) \| **pytransitions + llama.cpp/Qwen3-1.7B Q4** (not 4B - too large for Profile A concurrency) \| sherpa-onnx TTS (per-voice license) \| SQLCipher + FastAPI + Tauri; **Bhashini = blocked risk, not fallback** | Proposed by Codex architecture session - see `doc/09-module-a-design.md`. Why: licenses + maintenance verified 2026-09-09 first-party; Qwen3-4B breaks 4GB-profile concurrency; Bhashini residency/retention/quotas unverified; Qwen3-ASR streaming invalidates the "no streaming Hindi ASR" assumption behind the 09-01 row |

## Decisions confirmed 2026-09-11 (demo prototype session, `module-1-2`)

| Decision | Choice | Why |
|---|---|---|
| Demo behavior after a red-flag escalation | **Escalate, then continue capture**: full-screen alert + simulated staff acknowledgment, then the interview continues in "priority mode" and the summary hands off to the priority-triage queue | Confirmed by team member in session. One 90-second run then shows the safety layer AND the read-back AND the physician handoff. Doc 09 §8's "stop routine flow" is honored in spirit (routine queueing stops; escalation is a gate, not a dead end); the literal hard-stop variant remains available by re-running. |
| ~~Voice input in the demo~~ (SUPERSEDED same day — see next section) | ~~Text input labeled "voice simulated as text"~~, plus a browser-TTS "Listen" demo aid | Original rationale (no real ASR in a brief) was overridden by direct user directive the same evening. |
| Red-flag rules in the demo | **4 demo rules (RF-1 thunderclap headache, RF-2 chest pain + breathlessness, RF-3 stroke signs, RF-4 severity≥8 + concerning association), all shown on screen with matched-word evidence; list labeled "demo list, final rules clinician-validated"** | Judges probe whether AI silently gatekeeps safety; the demo must read as deterministic, auditable, and owned by doctors. Rules derive from doc 02's red-flag list; the real rule set remains an open question (doc 07). |
| Demo scope cuts | No Dashavidha layer, no Module B/C/D screens beyond a simulated opaque session token; 8-complaint detection vocabulary; free-text fallback for everything else | 90-second demo legibility; Dashavidha is a configurable second layer in the confirmed design and its CCRAS item set is an open question — showing it half-baked would misrepresent the architecture. |
| Prototype artifact shape | **Single offline HTML file, React inlined, core logic as a DOM-free JS block testable in Node** (`prototype/module-a-kiosk-demo.html` + `verify-demo.mjs`, logic + DOM checks) | Must run live in front of judges with zero network risk; tested logic must be exactly the shipped logic, so the verifier extracts the core from the shipped file. |

## Decisions confirmed 2026-09-11, evening (voice I/O; supersedes the "Voice input" row above, per user directive)

> User directives: "there is no input via voice option — add it, and keep only the stuff important
> for the clinical history"; "it's not picking hindi accent and it's not speaking hindi language".
> Work started in the 14:33 Codex session (died mid-work, 2 aborted turns); completed and verified
> by the follow-up opencode session the same evening.

| Decision | Choice | Why |
|---|---|---|
| Voice input in the demo (supersedes "text-as-voice simulation") | **Real browser `SpeechRecognition`/`webkitSpeechRecognition`** — `hi-IN` for Hindi/Hinglish, `en-IN` for English, interim live feedback, plain-language error mapping, text always remains a first-class fallback | User directive. Browser API is free, works from the local page (with the localhost caveat surfaced), and every failure mode (permission denied, file:// mic block, network-dependent recognition, unsupported language) is surfaced honestly instead of silently degrading. Accent coverage is the vendor speech service's property — the demo displays the active locale so failures are diagnosable. |
| What speech gets stored | **`clinicalExcerpt()` on every voice-source slot** (mic input AND scripted presenter fills): Roman + Devanagari filler stripping, clinical-sentence keep-filter, 280-char cap; leading "no"/"नहीं" never stripped (meaning-flip guard); raw conversation never retained | User directive ("keep only the stuff that is important for the clinical history"). Deterministic and testable — 9 regression checks added to `verify-demo.mjs`, incl. "excerpted narrative still triggers RF-2" (safety rules run on what is actually stored). |
| Hindi playback in the demo | **Always speak the Devanagari line with `hi-IN`** for Hindi/Hinglish (never the Roman line); `voiceschanged`-aware voice pick preferring local voices; **honest "no Hindi voice installed" note with the exact Windows fix** when none exists | Roman text through a Hindi voice is unintelligible; an English voice reading Devanagari is gibberish. Verified root cause of the user's complaint: the dev machine exposes 23 TTS voices, zero `hi-IN` — the old silent fallback was masking a missing-OS-voice problem. The demo now tells the presenter exactly what to install (see doc 12 presenter checklist). |

## Decisions confirmed 2026-09-11 (Module B CPU-only reading engine — per user directive in session)

| Decision | Choice | Why |
|---|---|---|
| Module B (Module 2) CPU-only reading engine | **Primary: PP-OCRv5-mobile multilingual** (mobile det + Devanagari-capable multilingual rec, 2M params) packaged via **RapidOCR/ONNX Runtime CPU** (OpenVINO backend to be A/B-tested). **Fallback: Tesseract 5 `hin+eng`**. Handwriting lane stays **verify-default** (physician attestation); **PaddleOCR-VL-1.6-GGUF = phase-2 upgrade** for the hard-page minority, gated on the doc/14 §5 local CPU benchmark | User directive ("pick 2 models, 1 primary 1 fallback"), anchored on doc/14's evidence: the classical lane is the ONLY lane with current maintainer-published CPU figures (1.75 s/img, 2.2GB peak RAM on Xeon 6271C; PP-OCRv6-tiny at 0.20 s shows headroom once multilingual variants ship — v6 today is zh/en/ja+Latin only, NOT Devanagari). Tesseract is the only engine with independently replicated Hindi accuracy (93%, ICON-2024) and is a fully independent codebase — it covers all three primary-failure modes (Paddle/ONNX stack breakage as seen in arXiv:2606.29213's env, Hindi-accuracy miss as ICON-2024 showed for old PaddleOCR, RapidOCR det bottleneck per issue #514). Both Apache-2.0; both trivially inside 12-16GB alongside Module A's stack. Running both = the cross-engine per-field voting confidence signal (doc/13 addendum). PaddleOCR-VL is NOT the fallback: official CPU path but zero published CPU latency — unproven under the CPU-only constraint. |

---

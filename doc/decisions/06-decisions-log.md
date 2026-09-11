# Decisions Log

**How to use:** log every architectural/design decision with a "why". Record alternatives considered and why they lost. Shared across sessions.

---

*(No decisions confirmed yet - the team is in research phase. The solution approach in `ocr_asr_rnd.md` and `solution.txt` is NOT yet confirmed.)*

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

---

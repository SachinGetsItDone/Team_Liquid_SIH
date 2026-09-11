# Research Log

**How to use:** append a dated entry below whenever research is done. Keep a one-line summary of what was found and link to the relevant doc or source. This is the shared record for all sessions.

---

## 2026-09-01 - Clinical Domain Research (SOCRATES / Dashavidha / Note Formats)

**What was done:** Ran `/last30days` research on clinical history structuring + Dashavidha Pariksha + standard clinical note formats, supplemented with targeted web research. Exported a PDF to `Research_SOCRATES.pdf` and distilled into docs 02-04.

**Key findings:**
- SOCRATES = 8-field **symptom** characterizer (Site, Onset, Character, Radiation, Associations, Timing, Exacerbating/Relieving, Severity) - sits inside a 9-step interview sequence.
- Dashavidha Pariksha = 10-parameter **person** assessment (Charaka Samhita, Vimana Sthana ch.8): Prakriti, Vikriti, Sara, Samhanana, Pramana, Satmya, Sattva, Ahara Shakti, Vyayama Shakti, Vaya.
- SOAP plus OLD CARTS / OPQRST define the Module C output schema.
- **Competing SIH team found:** `rohit-h11/medikiosk-sih-26047` - already drafted clinical-ontology schemas (issue #2) for SOCRATES + Dashavidha/CCRAS-PAS, and a SOCRATES adaptive LLM dialogue engine (issue #7). Consider studying before building.
- **Live market signal:** Kith (Show HN Aug 2026) does AI clinical notes for therapists from ambient audio - different approach (passive vs active), validates the market.

**Sources:** Geeky Medics, ClinicalBridge, EasyAyurveda, Wikipedia (SOAP), github.com/rohit-h11/medikiosk-sih-26047, HN, r/clinicalresearch, r/Ayurveda, r/medicine. Raw: `~/Documents/Last30Days/socrates-*-raw.md`.

---

## 2026-09-01 - Technical Foundations Knowledge Contribution

**What was done:** A Claude session contributed technical engineering knowledge to fill the gap
between the (strong) clinical-domain docs and the (thin) module/architecture side. Added new
`doc/08-technical-foundations.md`.

**Key findings / contributions (all UNCONFIRMED, for team to weigh in `06-decisions-log.md`):**
- **ASR:** streaming Conformer-transducer (IndicConformer base) favored for dialogue; Bhashini as
  fallback; noise is the bigger lever than model choice; code-mixed Hinglish is a differentiator;
  offline-first posture recommended for rural connectivity.
- **Document AI:** router pattern recommended — printed → fast OCR, handwritten/tables → VLM;
  hallucination control with per-field confidence + human escalation, never silent guess.
- **ABDM/DH:** FHIR R4 via HAPI; HIP/HIU consent pattern; the real work is often a FHIR facade
  onto legacy HIS; DPDP emphasizes explicit, revocable, audio-guided consent.
- **Dialogue:** hybrid recommended — deterministic DM owns the SOCRATES/Dashavidha state machine,
  LLM as NLU + natural re-prompts; red-flag triage as a separate classifier; system elicits but
  never diagnoses.
- **Cross-cutting:** acoustics/booth over model capacity; session-resume and throughput for
  4k-10k patients/day are first-class requirements.

**Sources:** Engineering knowledge of the contributing model (IndicConformer/Bhashini/Whisper,
PaddleOCR/VLM/router, FHIR/ABDM, dialogue systems). Items marked *(verify)* in the doc need
confirmation before relying on them.

---

## 2026-09-01 - Module A Engineering Verification (kiosk hardware design feed)

**What was done:** System-design session (systems-design APPLIER mode, scope confirmed by team) for
Module A on the two kiosk GPUs (4GB VRAM/12GB DDR5 and 6GB VRAM/16GB DDR5, offline-first hybrid,
Hindi+English+Hinglish, AYUSH in v1). Verified current (2026-08/09) licenses and release activity
for candidate speech/NLU tools via PyPI + GitHub + vendor docs; ran `/last30days` for supply on the
on-device ASR landscape (thin window; sherpa-onnx confirmed actively shipping).

**Key findings (verified, with dates):**
- **sherpa-onnx v1.13.7 (2026-09-01), Apache-2.0** - unified ONNX VAD + ASR + TTS + KWS + speaker
  ID; very active. Caveat: **no out-of-the-box streaming Hindi model** (streaming set = Bengali/
  Chinese/Korean...); Hindi **TTS** voices DO exist (`vits-piper-hi_IN-pratham/priyamvada/rohan`,
  `supertonic-3-hi`) - closes the audio-prompt gap under Apache-2.0.
- **faster-whisper v1.2.1 (2025-10-31), MIT** (CTranslate2) - release now ~10mo stale (flag);
  live streaming policy lives outside core: **ufal/SimulStreaming** (MIT, IWSLT'25 winner, Whisper
  large-v3 backend, 99 langs) - reference for a LocalAgreement partials layer.
- **whisper.cpp v1.9.2 (2026-08-04) MIT**; **silero-vad 6.2.1 (2026-02-24) MIT ~2MB**;
  **llama-cpp-python 0.3.35 (2026-08-17) MIT** (CUDA+Vulkan); **onnxruntime 1.29.0 (2026-08-17) MIT**;
  **FastAPI 0.141.1 (2026-07-29) MIT**; **pytransitions 0.9.2 MIT**.
- **piper TTS on PyPI (v1.7.0, 2026-08-15) is now GPL-3.0-or-later** (formerly MIT; revived as
  Home-Assistant fork `piper1-gpl`). Avoid GPL by running piper-format Hindi voices inside
  **sherpa-onnx** (Apache runtime + per-voice CC-BY model) instead.
- **Qwen3-4B: Apache-2.0**, 100+/119 languages (Hindi in Qwen3 set). Qwen3-ASR (1.7B/0.6B, open)
  lists Hindi among 52 langs - **emerging ASR candidate, phase-2**.
- **Bhashini** (`bhashini.gov.in`): govt, India-hosted STT/TTS/MT/OCR API; free org registration,
  5 keys/integrator, no public pricing/quotas found (verify for production). **`bhashini.ai` is a
  separate commercial paid service - do not confuse with the govt API.**

**Design implication:** doc 08's "IndicConformer-first" ASR stance remains UNCONFIRMED; verified
reality for a Hinglish kiosk = segmented near-real-time decode with a multilingual Whisper-ONNX
model (sherpa-onnx) or faster-whisper INT8 + LocalAgreement policy; IndicConformer/IndicWhisper ONNX
stays phase-2. See decisions log candidate row.

**Sources:** PyPI project pages (sherpa-onnx, faster-whisper, silero-vad, piper-tts,
llama-cpp-python, onnxruntime, fastapi), k2-fsa.github.io TTS Hindi index, github.com/ufal/SimulStreaming,
huggingface.co/Qwen/Qwen3-4B, github.com/QwenLM/Qwen3-ASR, bhashini.gov.in + bhashini gitbook,
releasealert.dev (whisper.cpp), systems-design v0.1.0 skill.

---

## 2026-09-09 - Module A architecture (Codex sessions; captured 2026-09-11)

**What was done:** Two Codex sessions designed Module A end-to-end (scope confirmation with the
user, full architecture, verified tool survey, hardware fit, failure policy, trade-offs).
Codex intended to log this here but the session died on a 402 quota error before writing it.
Full distillation: **`doc/09-module-a-design.md`** (written 2026-09-11 from the session logs).

**Key findings (licenses/maintenance verified 2026-09-09 via first-party repos):**
- **User-confirmed scope:** 2-5 min consultation time; v1 languages = Hindi + English + Hinglish
  (22 languages → v2); consent = Module D dependency (opaque session token only).
- **Recommended stack (candidate):** Silero VAD + WebRTC APM | quantized whisper.cpp (Qwen3-ASR-0.6B
  as Profile-B experiment) | pytransitions FSM + llama.cpp/Qwen3-1.7B Q4 (not 4B) | sherpa-onnx TTS
  with per-voice-licensed Hindi voice | SQLCipher + FastAPI + Tauri. **Bhashini demoted from
  "fallback" to "blocked risk"** (residency/retention/quotas unverified).
- **"No streaming Hindi ASR exists" is no longer safe to state** - Qwen3-ASR now documents
  streaming + 52 languages (resource use still needs hardware benchmark).
- **Session 1 decisions (pending ratification):** Dashavidha v1 = self-reportable subset (6 params;
  4 as `requires_clinician` typed slots); ASR = pluggable adapter + bake-off gate; hardware
  profiles (4GB/6GB) are unsourced assumptions - **Step 0 grounding task is BLOCKING** (if real
  Indian OPD kiosks have no discrete GPU, the on-device LLM premise changes).
- **4 architectural safety rules** from ocr_asr_rnd.md folded into the design (not_elicited slot
  state, no authority framing, slot-level confidence, elicit-never-diagnose).
- **Kiosk sizing math:** ~240 sessions/kiosk/day at 2.5 min → ~17 kiosks per 4,000 patients/day.
- **Prototype: not started** - session died on the user's prototype request (402 quota error).

**Sources:** github.com repos (silero-vad, whisper.cpp, sherpa-onnx, llama.cpp, pytransitions,
SQLCipher, fastapi, tauri, Qwen3-ASR, IndicConformerASR + 40 more, with observed push dates),
huggingface.co model cards, bhashini.gov.in/ulca. Raw: `~/.codex/sessions/2026/09/09/`
(17-35-33 and 19-25-39 rollouts).

---

## 2026-09-11 - Positioning & evidence research (judge-facing track)

**What was done:** Web-sourced evidence brief, competitor/prior-art scan, differentiator, SDG/theme
justification, and deployment feasibility/impact case for the SIH submission. Output:
**`doc/10-positioning-evidence.md`** (deck explicitly NOT wanted by user - research only).

**PS identity verified:** SIH26047 "Patient Case-Taking Software", Ministry of Ayush / AIIA,
theme Smart Automation, Software category, deadline 20 Sep 2026 (sih.gov.in catalogue via
ace-ify/sih-hub mirror).

**Key findings (all link-cited in doc 10):**
- AIIMS Delhi: ~10,000 OPD patients/day, 35 lakh/yr (AIIMS official PDF + HT). No national
  per-hospital dataset exists - "4,000-10,000/day" stays an assumption anchored on AIIMS.
- India consultation time: ~2.3 min average (Irving et al., BMJ Open 2017, 67-country review,
  28.5M consultations; range 48s Bangladesh - 22.5 min Sweden). PS's "2-5 min" is optimistic.
- Doctor:population 1:834 (Lok Sabha PQ; registration-based + includes AYUSH - caveat noted).
- History yields diagnosis in 76-83% of cases (Hampton BMJ 1975: 83%; 1992/2000/2003 follow-ups:
  76/79/78%) - PS's "70-80%" claim is defensible.
- AYUSH scale: 28.87 crore beneficiaries at 12,500 Ayushman Arogya Mandirs (Rajya Sabha PQ).
- ABDM rails: 90 crore ABHAs (PIB); 104 crore records linked to 93 crore ABHAs (PIB Jul 2026);
  eSanjeevani 47+ crore teleconsults by Jul 2026.
- Competitor scan: intake kiosks exist (Phreesia ~180M visits, US/admin-only), health ATMs exist
  in India (Yolo, 500 units, vitals-only), AI scribes exist (Augnito/EkaScribe/Sunoh, doctor-side),
  AYUSH software exists (NirogStreet, practitioner-side). NOBODY combines patient-elicited deep
  history + paper-record digitization + pre-consultation HIS/ABDM delivery. Differentiator written.
- SIH-internal competition: 5+ teams publicly building SIH26047 (A-941, divyamc1803, siraj343,
  medickiosk.in, rohit-h11) - execution depth must win, not the idea.
- Kiosk cost bounds: Health ATM ~Rs 5 lakh/unit (IndiaMART); digital kiosks Rs 18k-5L. MediKiosk
  is software-first (no diagnostic devices) - low end, vendor quote still needed.
- Impact arithmetic: 1 min saved x 4,000 patients/day = ~66 clinician-hours/day (~8 FTE doctors).

**Could NOT source (flagged as assumptions in doc 10 §1.7/§6):** national OPD-volume dataset,
OPD wait-time hours, tertiary-OPD-specific consultation-time studies, NHA sandbox process,
AIIA's own OPD volume.

**Tooling note:** websearch skill rate-limited mid-session; gaps partially filled via Bing/IndiaMART
direct fetches. Re-verify cost/wait-time numbers before slide-printing.

**Sources:** ~30 links in doc/10-positioning-evidence.md (aiims.edu, bmjopen.bmj.com, bmj.com,
sansad.in x2, pib.gov.in x2, ET, yolohealth.in, expresshealthcare.in, phreesia.com, fabrichealth.com,
buoyhealth.com, khealth.com, augnito.ai, sunoh.ai, patientsquare.com, financialexpress.com,
nirogstreet coverage, ors.gov.in, esanjeevani.mohfw.gov.in, indiamart.com, saisiddhielectronics.com,
sdgs.un.org, sih.gov.in + 5 competitor repos/sites, family-medicine.org, prothomalo.com,
medicaldialogues.in, freepressjournal.in, hindustantimes.com, ndtv.com).

---

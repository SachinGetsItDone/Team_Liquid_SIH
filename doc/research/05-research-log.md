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

## 2026-09-11 - Innovation candidates (answered "is the 4-module solution innovative?")

**What was done:** Strategy pass on where defensible innovation lives, given the 4-module
decomposition is prescribed by the PS (all competing SIH26047 teams share it) and matches the
standard intake-platform pattern. Output: new **"Innovation Candidates" section in
`doc/research/07-open-questions.md`** — 7 candidates + 3 explicit exclusions, all checked
against the doc-10 prior-art scan.

**Headline answer:** No — the A–D decomposition is compliance with the spec, not innovation.
Defensible novelty = the combination + context (doc-10 differentiator), Module A internals
(Dashavidha structuring, dual-mode zero-training UX, deterministic red flags,
`not_elicited` anti-fabrication), and execution depth (evidence, DPDP/ABDM rigor, pilot).

**Top two picks for the submission:** repeat-visit delta summaries; attendant/proxy mode with
provenance tags. Runner-ups (phase-2): body-map touch entry, queue-time nurse workup checklist,
patient-language discharge loop, de-identified admin analytics, persistent Prakriti baseline card.
Explicitly out: diagnosis/prediction, acuity queue reordering, hardware gimmicks/blockchain.

**Status:** candidates only — team to ratify (pick ≤2 for the submission).

---

## 2026-09-11 - Module A evidence-verification pass + hardware grounding (Step 0 CLOSED)

**What was done:** Continued opencode session `module-1-work-remaining`: (1) carried the
2026-09-11 evidence-verification findings (Qwen3-ASR benchmark, Bhashini ToS verdict, CCRAS item
set, component re-verification) into the final report; (2) closed doc 09 §10 item 1 (Step 0,
BLOCKING) — replaced the assumed 4GB/6GB VRAM profiles with real Indian health-kiosk hardware
data, per user directive ("the figure given 4/6gb is just an assumption, web search for real
one"). All fetches done via the `cc-websearch` skill pipeline (DDG search script + Readability
fetch pipeline), per user directive.

**Key findings — hardware (verified today via direct vendor-page fetches):**
- **Yolo Health datasheet** (market leader, 750+ HealthATM installs — NHM, UPMSCL, Railways,
  smart cities): Processor **ARM Cortex / Intel i3 / Qualcomm Snapdragon / AMD Ryzen 3**; RAM
  **4GB+**; storage 128GB+; OS Android/Windows/Linux; **no discrete GPU**.
  Source: yolohealth.ai/standard-model/ (fetched 2026-09-11).
- **TradeIndia listing (INNOVOSOFT): "Health Care Kiosk — Intel 4th Gen Core i3"**, ₹2.2–3 lakh
  (prior-session extraction) — integrated graphics only, no dGPU.
- **Clinics On Cloud Health ATM** (2,000+ installs incl. govt projects, seller Sehatpro
  Technologies): 15-inch LCD touchscreen, **battery-operated with 8-hr backup**, portable,
  mild steel, 680×780×2125mm — ARM/mobile-class compute implied, no dGPU.
  Source: indiamart.com product page 2851674287873 (fetched 2026-09-11).
- **Clinics On Cloud publishes no compute specs** (sitemap = marketing pages only) — specs are
  quote-gated across the market, not published.
- **VERDICT: 4GB/6GB VRAM profiles have zero basis in market reality. No Indian health kiosk
  found ships a discrete GPU.** Kiosk tier = CPU/iGPU only, ~4GB RAM. Consequences: Qwen3-ASR
  via vLLM streaming is dead on real hardware (needs CUDA dGPU); on-device stack must be
  CPU-quantized (whisper.cpp INT8, sherpa-onnx, llama.cpp Q4); room-server-per-hospital + thin
  kiosk stays the scale-up path. Full report + decisions-log draft delivered in session
  (draft shown, NOT written to `06-decisions-log.md`).

**Key findings — carried from the 2026-09-11 verification pass (researched, reported in session):**
- Qwen3-ASR-0.6B = 938M params total; ~2.0GB VRAM FP16 / ~1.0GB INT8 / ~0.5GB INT4 (Spheron
  safetensors-derived estimates ±15%, no public kiosk benchmark); streaming ONLY via vLLM
  backend; Hindi in 52-language list; WER Fleurs 10.37 (0.6B) vs Whisper-large-v3 6.85.
- Bhashini: **0/5 conditions confirmable → stays DISABLED** (PoC-only free APIs; ToS
  "demonstration purposes only"; voice recordings retainable indefinitely absent consent
  withdrawal; no DPA/residency clause).
- CCRAS Prakriti instrument exists but item set is **copyrighted, restricted, training-gated**
  — never reproduce items; assessors must be CCRAS-trained.
- Components: whisper.cpp v1.9.4, sherpa-onnx v1.13.8, Qwen3-1.7B Q4_K_M ≈ 1.28GB; red flags:
  WebRTC APM supply-chain risk, no streaming Hindi model in sherpa-onnx.

**Tooling note:** cc-websearch `websearch.cjs` works but DDG serves HTTP-202 challenge pages to
this network (zero results on all queries — provider-side block, retries + delays did not clear).
`webfetch.cjs` bundle is broken upstream (stale jsdom-inline build patch targets
`style-rules.js`, removed in current jsdom; plus css-tree `createRequire(import.meta.url)`
fails in CJS). Used the skill's search script for discovery attempts + a skill-identical
fetch→Readability→Turndown pipeline for page fetches. Submodule left clean. Recommend filing
upstream issue / rebuilding bundle (`npm run build` after fixing `build.ts` filters).

**Sources:** yolohealth.ai/standard-model/, indiamart.com/proddetail/health-atm-kiosk-digital-machine-2851674287873.html,
clinicsoncloud.com (homepage + sitemap.xml), yolohealth.ai + yolohealth.in homepages.

---

## 2026-09-11 - Module A interactive demo prototype (SIH presentation)

**What was done:** Built and verified the demo-grade interactive prototype (`prototype/module-a-kiosk-demo.html`,
single file, offline, React inlined). Session `module-1-2`. Full details in `doc/12-prototype-demo.md`.

**Key results:**
- Single self-contained HTML (~251 KB, React 18.3.1 + ReactDOM + htm inlined, zero runtime network) —
  works by double-click, safe for judge demos without network.
- Implements the confirmed flow: narrative → CC → SOCRATES(8) → visible deterministic safety check →
  PMH/meds/allergies/family/social → focused ROS → ICE → read-back → physician handoff; en/hi/Hinglish.
- Red-flag layer styled as a separate system component: 4 demo rules shown with pass/fail + matched-word
  evidence; hit → full-screen escalation, staff-ack gate, priority-triage handoff. Rule list is explicitly
  labeled a demo list pending clinician validation (open question in doc 07).
- Honesty features verified working: `not_elicited`/`not_answered`/`needs_review` slot states, dose-number
  touch confirmation, "voice — original words kept" provenance, locked "Assessment & plan — physician only".
- Verification: 54/54 logic checks (`prototype/verify-demo.mjs`, extracts the core from the shipped HTML and
  runs it in Node) + 57/57 headless-Edge DOM checks across 12 screen states. One render bug found & fixed
  (React #31: component reading positional args instead of props).
- Demo-tooling gotchas recorded: (a) inlining libs requires escaping `</script>` in the splice step;
  (b) headless Edge `--dump-dom`/`--screenshot` silently drops URL fragments when it delegates to a
  lingering Edge instance — always pass a fresh `--user-data-dir` per launch.

**Decisions from this session:** see `decisions/06-decisions-log.md` 2026-09-11 entries (escalate-then-
continue demo arc confirmed by team member; text-as-voice simulation; deterministic-rules-first framing).

---

## 2026-09-11 - Module B research track (prior art, standards, OSS landscape)

**What was done:** Research-only pass for Module B (Medical Document Digitization & Intelligence), scope derived
from doc/01 + doc/08 §2 (user confirmed "derive from doc/"). Engine run (last30days: Reddit/HN/GitHub, keyless,
30-day window - mostly noise for this evergreen topic; 3 usable GitHub/community signals) + authoritative web
fetches (NRCeS, EY, PIB, AWS, Google Cloud, Eka Care, SNOMED, arXiv) + GitHub REST API license/maintenance
survey of 21 repos. Raw engine file with full source appendix:
`~/Documents/Last30Days/medical-document-digitization-ocr-prescriptions-lab-reports-raw-v3.md`.

**Key findings:**

1. **The ABDM output contract is published and concrete:** NRCeS FHIR IG for ABDM v6.5.0 (FHIR R4, "ABDM Health
   Data Interchange Specifications 1.0", nrces.in/ndhm/fhir/r4/) defines exactly the artifact set Module B must
   emit: Composition-based `PrescriptionRecord`, `DiagnosticReportRecord`, `DischargeSummaryRecord`,
   `HealthDocumentRecord` (explicitly "unstructured historical health records... uploaded by the patients through
   the Health Locker" - i.e., the kiosk-scan use case has a named profile), `OPConsultRecord`; plus resource
   profiles `DocumentReference` (inline base64 attachment MUST-SUPPORT), `MedicationRequest`,
   `MedicationStatement`, `Observation`, `Condition`. HIP/HIU actors; sandbox.abdm.gov.in.
2. **DPDP Rules 2025 are notified (13 Nov 2025), phased to full compliance 13 May 2027** (EY, PIB). Scope
   explicitly covers personal data "collected offline and later digitized" - kiosk paper-document scanning is in
   scope. Notices must be available in the 22 Eighth Schedule languages; breach report to Board within 72h;
   Consent Manager registration (INR 2cr net worth, 7-year consent audit trails); penalties up to INR 250 crore.
   NOTE: doc/08's "health data = sensitive personal data" framing is the pre-DPDP IT-Act SPDI framing; DPDP 2023
   applies uniform obligations to all personal data (no GDPR-style special category) - needs a proper legal read.
3. **Prior art (deployed):** Eka Care "Medical Records Analyser" (Orbi Health; production; NHA-approved,
   ABDM+FHIR compliant; 140Mn+ records) = closest patient-side Indian digitization, but app-first/cloud, no
   kiosk, no pre-consultation handoff. AWS HealthLake + Data Transformation Agent (Mar 2026, "legacy clinical
   documents into queryable FHIR") = closest document-to-FHIR cloud service (HIPAA/US-centric). Google Cloud
   Document AI = general IDP platform (no verifiable healthcare-FHIR processor on the product page - flagged).
   No deployed Indian product found for handwritten-prescription/report OCR (Bing scan: only text-to-handwriting
   toys + 0-star GitHub hobby prototypes). Gap from doc/10 §2 holds.
4. **Research prototypes:** MIRAGE (arXiv:2410.09729, verified live) - 743,118 SIMULATED images from 1,133 Indian
   doctors, Qwen-VL/LLaVA-1.6/Idefics2 fine-tunes, 82% med-name/dosage accuracy. Simulated-corpus caveat:
   real-OPD-handwriting performance unproven.
5. **OSS landscape (GitHub API, 2026-09-11):** Active + permissive: Tesseract (Apache-2.0, 76.4K stars, pushed
   today), PaddleOCR (Apache-2.0, 89.3K), docTR (Apache-2.0), docling (MIT, 66.3K), marker + surya (Apache-2.0
   per live API, ~40K/21K), DeepSeek-OCR (MIT, 23.9K), olmocr (Apache-2.0), unstructured (Apache-2.0), HAPI FHIR
   (Apache-2.0), scispaCy (Apache-2.0), medspaCy (MIT), cTAKES (Apache-2.0). License-risk: MinerU (custom
   NOASSERTION), GOT-OCR2.0 (no license file), EasyOCR slowing (last push 2025-12). Indic-specific gap:
   AI4Bharat/IndicDLP (MIT, 9 stars, last push 2025-09) and Indic-OCR (dormant 2022) are early-stage/dormant.
6. **Community signals (30-day window):** smiles70/geradoc PR#51 compared Tesseract/OCRmyPDF/PaddleOCR/docTR/
   Google Vision/Textract for a privacy-first local pipeline and picked PaddleOCR as primary experiment;
   JRAdams472/LENA2 PR#44 documents the "local OCR (Tesseract default, PaddleOCR/docTR multi-column) then local
   LLM (Ollama) structured-JSON" pattern; r/computervision thread on replacing Apple Vision OCR: "we use
   tesseract in prod, it's actually good... Have you tried paid apis from aws/gcp?"

**New open questions:** see doc/07 additions (HIP posture for kiosk-scanned docs, SNOMED India licence terms for
a commercial product, SaMD/CDSCO classification question, MinerU/GOT-OCR2.0 license review, Indic OCR benchmark
gap, ABDM HDM Policy data-residency clause unverified this pass).

---

## 2026-09-11 (evening) - Prototype voice I/O: completed the interrupted Codex session

**What was done:** The 14:33 Codex session (rollout `01a08fb5-5f46`) died mid-work on the user's
Hindi-voice complaint (2 aborted turns, last message "tightening the browser voice implementation…
then I'll add regression checks"). This session read the rollout log, identified the exact unfinished
items, and completed them in `prototype/module-a-kiosk-demo.html` + `verify-demo.mjs`.

**Defects found in the partial state and fixed:**
1. **`Lang` passed the wrong text to the Hindi speech engine in hi mode** — `props.secondary` in hi
   mode is *English* (biText: primary=hi, secondary=en), so Hindi prompts spoke English text with a
   Hindi voice. Now: always pick the Devanagari line (primary in hi mode, secondary in rom mode);
   fall back to English speech only if no Devanagari exists anywhere.
2. **`SpeakBtn` voice loading was a single 150 ms blind retry** — no `voiceschanged` listener, no
   feedback when no Hindi voice exists. Now: voices primed at startup + `voiceschanged` cache, retry
   up to ~1.6 s, exact-locale → prefix → name-based voice matching preferring `localService` voices,
   click-again-to-stop, and an honest note ("No hi-IN voice on this device. Windows: Settings → Time
   & Language → Speech → Add voices → Hindi…") instead of silent English-voice fallback.
3. **`clinicalExcerpt` only handled Roman fillers** — Devanagari mic input (hi-IN) was never
   stripped/filtered. Now: parallel Devanagari filler list (नमस्ते/डॉक्टर/मुझे बताना है/…), Devanagari
   clinical-term keep-filter (दर्द/बुखार/खांसी/सांस/…), iterative separator-aware stripping, and a
   meaning-flip guard (leading "no"/"नहीं" is never stripped — "no allergies" must stay "no allergies").
4. Presenter skip-step path stored raw narrative; now excerpted like every other voice-source slot.
5. `InputRow`: `interimResults` now on (live "… heard so far" feedback), full error mapping
   (not-allowed / no-speech / audio-capture / network / language-not-supported / aborted), and the
   active locale is displayed so a failed Hindi mic is diagnosable.

**Root cause of "not speaking Hindi language" (measured, not guessed):** headless-Edge voice
inventory on the dev machine → **23 TTS voices, zero `hi-IN`** (only en-IN "Microsoft Priya Online"
for India). No browser code can synthesize Hindi without an OS Hindi voice; the old code silently
read Devanagari through an English voice. Fix on the machine: Windows → Settings → Time & Language →
Speech → Add voices → हिन्दी (requires elevation; not installable from this session — documented in
doc 12 presenter checklist and surfaced in the demo UI itself).

**Verification:**
- `node verify-demo.mjs`: **63/63 checks pass** (54 prior + 9 new voice-excerpt regressions, incl.
  Devanagari stripping, "no"-meaning preservation, 280-char cap, excerpt still triggers RF-2 and
  complaint detection).
- All 5 inlined `<script>` blocks pass `node --check` after the edits.
- Headless Edge (fresh `--user-data-dir` per launch): **0 rendered error banners across 7 deep-linked
  states** (welcome, interview en/hi/rom, safety, readback, handoff); speakBtn renders on all.
- Gotcha re-confirmed: grepping dump-dom for "DEMO ERROR" matches the inlined `window.onerror`
  *source*, not the rendered banner — grep `>DEMO ERROR:` for the real check.

**Browser-API findings worth remembering (demo tier only, not product ASR/TTS):**
- Chromium `SpeechRecognition` uses the vendor's **online** speech service even for a local page —
  `network` error fires when offline; mic may be blocked on `file://` (serve on localhost).
- `speechSynthesis.getVoices()` is async and empty until `voiceschanged`; priming it once at startup
  is required. Chrome offers the online "Google हिन्दी" voice; Edge exposes Microsoft online voices
  (Hindi: Swara/Madhur/Minal) only after the Windows Hindi speech pack is installed.
- `u.onerror` with `interrupted`/`canceled` fires on deliberate `cancel()` — must be ignored or the
  stop-toggle shows a false error.

**Docs updated:** doc/12 (voice behavior, presenter checklist, verification counts), decisions log
(new evening section superseding the "text-as-voice simulation" row, per user directive).

---

## 2026-09-11 (night) - Voice input still failing → root cause: file:// microphone block; one-click local server added

**What was done:** User reported voice input taking neither Hindi nor English. Root cause (browser
platform behavior, not our code): **Chrome/Edge cannot grant microphone permission to pages opened
via `file://`** — and the demo's documented entry point was double-clicking the HTML. The old code
showed a soft "tip" on file:// and attempted recognition anyway → guaranteed `not-allowed` failure
on top of the tip = confusing double message.

**Fixes:**
1. **`prototype/serve-demo.bat` + `serve-demo.mjs`** (new): zero-dependency Node static server,
   loopback-only (127.0.0.1; verified NOT reachable via LAN hostname — right posture for a health
   demo), port 8000 with 8001-8005 fallback, auto-opens the demo in the default browser, path-
   traversal-safe (WHATWG URL parser normalizes dot-segments + explicit ROOT-prefix guard — both
   tested with curl: `/../doc/README.md` and `%2e%2e` variants all 404).
2. **`InputRow` file:// early-return:** one actionable bilingual message ("double-click
   serve-demo.bat inside the prototype folder…") instead of a doomed attempt. No more double
   messaging.
3. **`not-allowed` error message expanded:** address-bar tune icon → Microphone → Allow, AND
   Windows Settings → Privacy & security → Microphone → ON (desktop apps) — covers the OS-level
   block that produces the same error code.
4. Welcome honesty box now leads with serve-demo.bat.

**Verification:** `node --check` all 5 script blocks OK; `verify-demo.mjs` 63/63; server curl checks
(200 + correct MIME on demo/root, 404 on missing, traversal blocked, loopback-only confirmed);
headless Edge over `http://127.0.0.1:8000` → 0 rendered error banners across welcome/interview
states, welcome screen names serve-demo.bat.

**Browser-platform facts recorded (demo tier):**
- Mic on `file://` = impossible in Chrome/Edge (no permission surface for file origins; Firefox
  has no SpeechRecognition at all). Localhost http = the minimum viable origin for voice.
- Chromium SpeechRecognition streams audio to the vendor's online speech service → needs internet
  even when the page itself is fully offline (`network` error otherwise).
- Windows OS-level mic privacy toggle produces the same `not-allowed` as a site-level denial —
  error copy must cover both.

**Presenter path is now:** double-click `serve-demo.bat` → browser opens at
`http://127.0.0.1:8000/module-a-kiosk-demo.html` → tap Speak → Allow mic → talk. Remaining
environment prerequisites (documented in-app + doc 12): Chromium browser, internet for the vendor
speech service, Hindi voice pack for Hindi *playback*.

---

## 2026-09-11 - Module B DEEP-DIVE (fit synthesis for the team)

**What was done:** Second pass on Module B, one level deeper: parsed the NRCeS ABDM
StructureDefinition JSONs directly (machine-verified output contract), read the MIRAGE paper in
full, pulled ClinOCR-Bench abstract + repo, verified model WEIGHTS licenses via the HuggingFace
API, read the current READMEs of PaddleOCR/surya/marker/DeepSeek-OCR/docling/IndicDLP/RapidOCR,
and inventoried Tesseract's Indic traineddata. Full findings + source register in
**`doc/13-module-b-deep-dive.md`** (new doc, indexed in README).

**Headline findings:**
1. **ABDM output contract is machine-verified now** (not blog-inferred): Composition-based
   records need status/type(SNOMED)/subject/date/author/title; `attester` is the FHIR-native
   physician-verify slot; raw kiosk scans ride as DocumentReference (inline base64) inside
   HealthDocumentRecord; MedicationRequest.medication[x] is example-bound to SNOMED CT Intl
   clinical drugs + **CDCI (Common Drug Codes for India, National Extension)**.
2. **MIRAGE full-paper numbers kill the naive plan**: zero-shot GPT-4o = F1 7.57%, Gemini 1.5
   Pro = 5.53%, LLaVA 1.6 = 2.00% on Indian doctor handwriting; best fine-tuned 7B-class = 82%
   on med names+dosages ONLY (simulated corpus), ~40% F1 on full-field extraction; authors:
   "in no way deployable." Handwriting lane must default to verify.
3. **PaddleOCR-VL-0.9B is the standout VLM fit**: Apache-2.0 WEIGHTS (verified via HF API),
   sub-1B (fits 4-6GB VRAM), 109-111 languages incl. Hindi/Devanagari, structured JSON output,
   layout front-end targets kiosk-camera artifacts (skew/illumination/screen-photo). Indic
   medical-handwriting performance UNVERIFIED - local eval set is the gate.
4. **surya/marker license nuance found**: code Apache-2.0 but WEIGHTS are OpenRAIL-M - free only
   under $5M funding/revenue; commercial hospital deployment needs a Datalab license.
5. **IndicDLP is a dataset, not an engine** (correction to ocr_asr_rnd.md): ICDAR 2025 oral,
   119,806 images, 11 Indic languages + English, layout-parsing research asset.
6. **Classical lane is comfortably solvable on CPU**: PaddleOCR PP-OCRv5 multilingual rec model
   is 2M params with Devanagari/Tamil/Telugu support (109 langs); RapidOCR packages those models
   as Apache-2.0 ONNX; Tesseract ships traineddata for all 14+ Indic scripts (verified from
   tessdata repo contents).
7. **ClinOCR-Bench caveat**: its Handwriting subset is font-rendered (synthetic); per-subset
   numbers still un-pulled; no public real-Indic-medical-handwriting corpus exists at all.
8. **Cloud APIs priced out as primary lane**: Google Document AI Custom Extractor $30/1K pages
   ≈ $3,600/month at 4,000 patients/day x 1 page (assumption-labeled arithmetic) + offline +
   residency conflicts.

**Recommendation shape (for team ratification, not a decision):** router (printed->CPU OCR lane;
handwriting->small Apache/MIT doc-VLM lane with bounding-box grounding + verify-default),
structuring on the same llama.cpp runtime as Module A, emission validated against NRCeS
profiles via HAPI FHIR; de-risk by building the local eval set FIRST. See doc/13 §5.

**Addendum (same day, team Q&A):** two engine questions resolved from live sources and logged
in doc/13: (a) multi-engine voting = cross-engine per-field agreement, NOT bagging (no bootstrap/
retraining, heterogeneous members; value = free confidence signal, not variance reduction);
(b) **MedGemma rejected for document digitalization** - it is a clinical-*image* comprehension
model (chest X-rays, dermatology, ophthalmology, histopathology per its card; no document/OCR
benchmark), gated under Google Health AI Developer Foundations terms (not Apache/MIT), 4B
multimodal (27B is text-only). Wrong domain + restrictive license + 4x the size of the
purpose-built 0.9B option.

## 2026-09-11 (evening) - Module B CPU-Only Model Research Pass (`doc/14`)

**Activity:** paper-level research for Module B under a hard CPU-only constraint (GPU
unavailable, 12-16GB RAM), per analyst brief. Deep pass across arXiv, maintainer benchmark
tables, llama.cpp PRs, and HF model cards; a /last30days community sweep found nothing new
in-window. Full comparison table + source register in `14-module-b-cpu-research.md`.

**Findings:**
1. **Classical lane is the only CPU-proven lane.** PP-OCRv5_mobile: 1.75 s/img, peak RAM
   2.2GB on Xeon Gold 6271C (official perf docs); PP-OCRv6_tiny (arXiv:2606.13108, NEW):
   0.20 s/img on Xeon+OpenVINO, 3.9x faster than v5_mobile, 1.5M params. All Apache-2.0.
2. **The independent CPU-only benchmark paper E-ARMOR (arXiv:2509.03615)** confirms the
   split: traditional pipeline 4.36 s/img & 0.89GiB on 8-core Xeon vs Qwen-VL-class LVLM
   69.4 s/img & 10.8GiB. Traditional wins on CPU.
3. **PaddleOCR-VL now has an OFFICIAL llama.cpp/GGUF CPU path** (llama.cpp PR #18825 merged
   2026-02-19; official PaddleOCR-VL-1.5/1.6-GGUF on HF; accuracy parity verified 92.80 vs
   92.86). Still NO published CPU latency - maintainer docs warn "may be slow". Unverified
   candidate needing local benchmark.
4. **Indic accuracy does not follow English leaderboards** (arXiv:2606.29213 Devanagari
   stress-test): DeepSeek-OCR median CER 100%, 89% catastrophic repetition loops on real
   Hindi prints; olmOCR-7B chrF++ 40.5; Qwen3-VL-8B is the best open (75.2). PaddleOCR/GOT
   couldn't run in that study's env. Reinforces: local Indic eval is the gate for ANY engine.
5. **ICON-2024 (ACL)**: Tesseract Hindi 93% vs old-PaddleOCR 56% - Tesseract is the credible
   CPU floor for Devanagari printed text; RapidOCR has NO maintainer latency benchmark and
   conflicting community evidence (forum 200ms/page vs issue #514's 2-3x-slower det).
6. **GPU-first, no CPU benchmark = disqualified/unproven**: DeepSeek-OCR(-2) (also
   Indic-fatal per #4), dots.ocr (3.0B, vLLM-only; separate license agreement file in repo),
   MonkeyOCR, MinerU2.5, olmOCR, Unlimited-OCR, GLM-OCR, SmolDocling/GraniteDocling
   (CPU-runnable but minutes/page and English-only - no Devanagari).
7. **GraniteDocling-258M CPU reality**: docling issue #2348 reports 15-20 min/document on
   CPU; a third-party "5 pages/s CPU" claim contradicts IBM's own A100 figure - discarded.
8. **License flags**: surya-ocr-2 weights OpenRAIL-M (HF tag verified) - $5M clause stands;
   HunyuanOCR-1.5 = Tencent community license (territorial, AUP) despite official llama.cpp
   CPU path. CTranslate2 confirmed NOT applicable to doc-OCR (text/Whisper models only).

**Strongest candidates by evidence quality (not a decision):** (1) PP-OCRv5/v6 classical
lane (only maintainer-published CPU tables; zh/en variants benchmarked, multilingual rec
unmeasured), (2) PaddleOCR-VL GGUF/llama.cpp (official path + Devanagari element metrics,
CPU latency unmeasured), (3) Tesseract+RapidOCR floor/packaging. Deciding benchmark defined
in doc/14 §5 (kiosk CPU, local eval set, field-level CER + catastrophic-rate, p50/p95
latency, peak RSS).

**Decision (same session, user directive - logged in decisions/06):** Primary =
**PP-OCRv5-mobile multilingual via RapidOCR/ONNX CPU**, Fallback = **Tesseract 5 hin+eng**.
PaddleOCR-VL-1.6-GGUF deferred to phase-2 (zero published CPU latency; unproven under the
CPU-only constraint). Handwriting lane stays verify-default.

---

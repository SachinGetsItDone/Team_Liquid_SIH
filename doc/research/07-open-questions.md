# Open Questions & TODO Backlog

**How to use:** keep this current. When a question is answered, move it to the research log with the answer. Cross-session - anyone can add.

---

## Research / Domain Questions

- [ ] **CCRAS Prakriti Assessment Scale (PAS)** - get the actual standardized questionnaire items for Prakriti assessment (the modern reference for Module A's AYUSH battery).
  - *Update (2026-09-01):* modern PAS questionnaires typically score ~15-20 items per Vata/Pitta/Kapha
    domain on a Likert scale; final Prakriti = highest-scoring dosha (often a blend). Exact official
    CCRAS item set still needs sourcing — do not fabricate the items from memory.
- [ ] Build example touchscreen question flows for EACH of the 10 Dashavidha parameters.
- [ ] Compile red-flag detection rules as a concrete rule set (thunderclap headache, acute chest pain + dyspnoea, stroke symptoms, etc.). *See proposed triage-classifier design in `08-technical-foundations.md` §4.*
  - *Update (2026-09-11):* the demo prototype now ships a **working 4-rule demo list** (RF-1..RF-4, en/hi/Hinglish
    term matching, see `doc/12-prototype-demo.md`) — but it is explicitly a demo list. The production rule set
    (full symptom coverage, thresholds, sensitivity/specificity targets, clinician sign-off) is still open.
- [ ] Map the SOCRATES 8 fields + Dashavidha 10 params into a single unified clinical ontology schema (JSON/FHIR). *Proposed shape: a `HistoryBundle` FHIR/JSON resource — `08-technical-foundations.md` §5.*
  - [ ] **Hinglish + medical-vocabulary ASR corpus** — curate/generate code-mixed Hindi-English OPD
    audio; candidate novelty contribution, see `08-technical-foundations.md` §1.
- [ ] Study competing repo `rohit-h11/medikiosk-sih-26047` - what to adopt vs differentiate. (Blocked: github.com not fetachable in this env - try `gh` CLI or WebFetch from other domains.)

## Technical / Module Questions

- [ ] ABDM sandbox docs - Module D compliance (FHIR APIs, consent flow).
- [ ] ClinOCR-Bench per-subset numbers (Handwriting vs Normal).
- [ ] SCRIBE full paper - entity/numeral error rates for Hindi.
- [ ] SamaVaani full paper - real WER numbers for the 8-system clinical audit.
- [~] IndicConformer vs IndicWhisper head-to-head on noisy conditions (no published result yet).
  - *Note (2026-09-01):* the ~30pt noise WER cliff (see `ocr_asr_rnd.md`) suggests the physical
    acoustics fix may dominate engine choice — worth testing the booth/mic first, then models.
  - *Update (2026-09-01, partial answer):* verified sherpa-onnx ships NO out-of-the-box streaming
    Hindi model; pragmatic v1 = segmented multilingual Whisper-ONNX (sherpa-onnx) or faster-whisper
    INT8 + ufal/SimulStreaming LocalAgreement policy. IndicConformer/IndicWhisper ONNX = phase-2.
    Also verified piper TTS moved to GPL-3.0; use sherpa-onnx TTS with hi_IN voices (Apache) instead.
- [ ] Synthetic code-mixed Hindi-English OPD dialogue - potential novelty contribution.
- [ ] Dashboard for low-literacy UX - audio prompt + icon design specs.
- [ ] Audio booth hardware specs (given ~30pt WER cliff from noise).

## Module B questions (from 2026-09-11 research pass)

- [ ] **HIP posture for kiosk-scanned documents** - when the kiosk digitizes a patient-carried paper record and pushes it into ABDM, is the kiosk operator the HIP (Health Information Provider) or is the hospital HIS? NRCeS IG defines the profiles (HealthDocumentRecord et al.) but the deployment-model answer decides who registers in the ABDM sandbox and owns the consent artefact. (Blocking for Module B/D integration design.)
- [ ] **SNOMED CT India licence terms for a commercial product** - India is an SNOMED International member with NRCeS as representative (snomed.org/members/india), so SNOMED CT is usable in-country; exact terms/redistribution rules for a commercial kiosk product need verification with NRCeS before the med/diagnosis coding design is locked.
- [ ] **SaMD/CDSCO classification** - does OCR + structuring of prescriptions (no diagnosis, no treatment advice) fall outside India's medical-device regulations, or does feeding a physician-facing summary trigger Software-as-Medical-Device scrutiny? Unverified; needs a regulatory read.
- [ ] **DPDP legal read** - (a) doc/08's "health data = sensitive personal data" is the old IT-Act SPDI framing; DPDP 2023 applies uniform obligations - confirm the delta; (b) is the kiosk operator a Data Fiduciary or a Data Processor for the hospital (depends on deployment model)? DPDP Rules 2025 notified 13 Nov 2025, full compliance due 13 May 2027 (EY/PIB, see research log 2026-09-11).
- [ ] **OSS license reviews before adoption** - MinerU carries a custom (GitHub NOASSERTION) license; Got-OCR2.0 has no license file; both need legal review if considered. EasyOCR's maintenance is slowing (last push Dec 2025).
- [ ] **Indic document-OCR benchmark** - AI4Bharat's document tooling (IndicDLP, 9 stars, dormant-ish; Indic-OCR, dormant 2022) is early-stage; no Indic handwriting benchmark found in this pass beyond MIRAGE (simulated corpus). A local eval set (real OPD scans, incl. ClinOCR-Bench per-subset numbers - already open above) is the gating item for engine choice.
- [ ] **ABDM Health Data Management Policy / data-residency clause** - not fetched this pass; the "India-only data residency" constraint needs an official citation before quoting it to judges (also flagged in doc/10 §6).
- [ ] **Google "healthcare Document AI to FHIR"** - could not verify a healthcare-FHIR-specific processor on Google Cloud's product page (only general Document AI + healthcare SI partners). Do not cite such a product without a source.

### Module B deep-dive updates (2026-09-11, see doc/13)

- [ ] **Validate the VLM candidates on real Indic OPD handwriting** - PaddleOCR-VL-0.9B / DeepSeek-OCR (quantized) / GraniteDocling-258M have NO published real-Indic-medical-handwriting numbers (MIRAGE is simulated; OmniDocBench is zh/en-centric general docs). This validation is the gate for the Module B engine decision. Requires the local eval set first (below).
- [ ] **Build the local eval set** - consented real OPD scans (Hindi+English, mixed print/handwriting) with field-level ground truth; seed with MIRAGE's public 100-record subset (HF: chaithanyakota/100-handwritten-medical-records) + ClinOCR-Bench subsets for method validation. DPDP-clean consent flow needed for collection.
- [ ] ClinOCR-Bench per-subset numbers (Handwriting vs Normal) - **updated caveat**: the Handwriting subset is rendered with handwriting FONTS (synthetic), so even this benchmark does not test real clinician handwriting; numbers still to pull from the PDF (arXiv:2607.03650).
- [ ] **DiagnosticReportLab / Observation lab-code bindings** - NRCeS lab profiles not parsed this pass; LOINC vs NRCeS lab value sets unverified. Needed before the lab-report structuring design is locked.
- [ ] **surya/marker weights commercial clause** - OpenRAIL-M free under $5M funding/revenue; a hospital-deployed commercial product needs Datalab pricing. Decide consciously if ever shortlisted.
- [ ] **PaddleOCR-VL integration cost** - Apache-2.0 weights but it runs on the Paddle stack, not llama.cpp; weigh a second inference runtime on the kiosk vs surya's llama.cpp serving (license tradeoff is the inverse).
  - *Update (2026-09-11, CPU pass - doc/14):* largely RESOLVED for the CPU lane - PaddleOCR-VL now ships **official GGUFs (HF: PaddleOCR-VL-1.5/1.6-GGUF) + merged llama.cpp support** (PR #18825, 2026-02-19, accuracy parity verified), so the Module A llama.cpp runtime can host it; remaining cost is the pipeline's layout model (PP-DocLayoutV2/V3, small detection model, Paddle/ONNX-runnable).

### Module B CPU-only pass additions (2026-09-11 evening, doc/14)

- [ ] **CPU latency benchmark on kiosk hardware** - no doc-VLM has any published x86-CPU latency (PaddleOCR-VL, surya 2, GraniteDocling, HunyuanOCR, DeepSeek-OCR all unmeasured; surya's only CPU-adjacent table is Apple-Silicon/Metal). *Reframed after the 2026-09-11 pick (decisions/06): the benchmark now (a) VALIDATES the picked primary on the real 12-16GB machine - PP-OCRv5-mobile multilingual via RapidOCR (onnxruntime-cpu vs openvino A/B) vs Tesseract hin+eng fallback, field-level; and (b) measures PaddleOCR-VL-1.6-GGUF Q4/Q8 for the phase-2 hard-page lane, gated on the dwell-time budget.*
- [ ] **PP-OCRv5/v6 multilingual rec model on CPU + Hindi accuracy** - all maintainer CPU tables cover the zh/en/ja unified models; the Devanagari-capable multilingual rec model (2M params) has neither a CPU latency table nor any real-Hindi-scan accuracy number (ICON-2024's PaddleOCR-Hindi 56% predates it; that study's env couldn't run current PaddleOCR per arXiv:2606.29213).
- [ ] **DeepSeek-OCR Indic catastrophic failure** - arXiv:2606.29213 reports median CER 100% / 89% catastrophic repetition loops on real Devanagari prints. Confirm team treats DeepSeek-OCR(-2) as excluded for the Indic lane regardless of runtime.
- [ ] **HunyuanOCR-1.5 license review** - Tencent community license is territory-limited + AUP-bound despite an official llama.cpp CPU path; needs legal read before any consideration.
- [ ] **RapidOCR speed discrepancy** - no maintainer benchmark; forum claims 200ms/page vs issue #514's reproducible 2-3x-slower det stage. Measure both onnxruntime-cpu and openvino backends locally before trusting either.


## Innovation Candidates (proposed 2026-09-11 — pending team ratification)

Context: the 4-module decomposition (A–D) is prescribed by the PS, not itself innovative —
competing SIH26047 teams share it. These candidates are checked against the prior-art scan in
`doc/10-positioning-evidence.md` §2. Recommendation: pick at most two for the submission;
the rest are phase-2 backlog.

**Top picks (recommended for the submission):**
- [ ] **Repeat-visit delta summaries** — first visit builds the baseline; return visits capture
  and display "what changed since last time" instead of re-asking everything. Directly attacks
  the PS's named harm (repeated questioning across visits). No public-OPD product does
  visit-to-visit continuity where patients are quasi-re-registered each time.
- [ ] **Attendant/proxy mode with provenance tags** — capture family-member statements separately
  from patient self-report, tagged "stated by attendant" vs "stated by patient". Matches Indian
  OPD reality (elderly arrive with family who answer for them). Not found in any intake product
  surveyed (Phreesia, scribes, Yolo all assume one respondent).

**Strong seconds (phase-2 or if capacity allows):**
- [ ] **Body-map touch entry** — tap-where-it-hurts diagram + pain scale as the conversation
  starter; zero literacy / zero voice / zero language required. Checklists exist; visual-first
  body map as *primary* input for Hindi/rural users is the differentiator.
- [ ] **Queue-time workup checklist for the nurse station** — intake gaps drive a nurse-facing
  task list (BP for headache, glucose for polyuria) so vitals/labs happen in the queue.
  Pre-visit planning exists in US systems; self-service queue workup in Indian OPDs does not.
  Must be rules-based, physician-approved protocols only (no diagnostic scope creep).
- [ ] **Discharge loop in the patient's language** — post-consult audio + printed prescription /
  next-visit instructions. Fixes the exit (counselling time is the other 2-minute casualty);
  judges like closed loops.
- [ ] **De-identified OPD analytics for hospital admin** — complaint mix by hour, red-flag rates,
  document burden (aggregate only, DPDP-clean). Gives the administrator a reason to buy beyond
  "helps doctors."
- [ ] **Persistent Prakriti baseline card (AYUSH moat)** — patient's Dashavidha/Prakriti carried
  across visits on the ABHA record; follow-ups reference drift from baseline. NirogStreet does
  practitioner-side records, not patient-carried structured Dashavidha. Speaks to the Ministry
  of Ayush ownership of SIH26047.

**Explicitly OUT (credibility guardrails — do not add):**
- Anything that diagnoses or predicts (violates the PS safety framing + elicit-never-diagnose rule).
- Acuity-based queue reordering beyond red flags (liability + staff-acceptance risk).
- Hardware gimmicks or blockchain (Module A already carries a hardware-grounding risk).

---

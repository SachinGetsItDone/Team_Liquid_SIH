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
  - *Update (2026-09-12):* **schema side RESOLVED — HistoryBundle v1 is now DEFINED** in
    `module-c/medic/contracts.py` (slot states per doc/09 §2, per-slot provenance, red
    flags, session/consent refs; single-loader enforcement). Remaining: team ratification,
    Dashavidha layer (v2), FHIR serialization of the canon (the OPConsultRecord emitter
    covers the physician-facing side; doc/21 §C-J/§C-A govern canon versioning and the
    emission shape). A **FHIR-serialized HistoryBundle for Module D exchange is transferred
    to Module D** (doc/22) — it is a Module D contract, not a Module C deliverable.
  - [ ] **Hinglish + medical-vocabulary ASR corpus** — curate/generate code-mixed Hindi-English OPD
    audio; candidate novelty contribution, see `08-technical-foundations.md` §1.
- [x] Study competing repo `rohit-h11/medikiosk-sih-26047` - what to adopt vs differentiate. *(Blocked: github.com not fetachable in this env - try `gh` CLI or WebFetch from other domains.)*
  - *Update (2026-09-11 night pass 2):* **RESOLVED — README read in full via raw.githubusercontent.com + GitHub API.** Stack: FastAPI/React, Supabase+pgvector RAG, Groq Llama-3.3-70B, Sarvam ASR/TTS, IndicConformer/IndicTrans2/Bhashini; `/api/v1/summary` = "FHIR-shaped" 30-second summaries (not NRCeS-profile-validated); NAMASTE/ICD-11 + CCRAS PAS claims confirmed in their README; **no license file**; created 2026-08-29, last push 2026-09-06, 0★. Differentiation levers unchanged: offline/India-residency, NRCeS-conformant emission, provenance/confidence per field, physician attestation. Full detail: doc/15 §7b.
  - *Update (2026-09-16, Module 3 deep sweep):* **README CLAIM CORRECTED — there is no `/api/v1/summary` endpoint.** Implemented endpoints are `/api/v1/dialogue/*` and `/api/v1/ocr/*`; the summary is a custom `ClinicalSummaryTicket` Pydantic JSON and **FHIR R4 export is an OPEN ISSUE (#15)**. "FHIR-shaped 30-second summaries" is aspirational, not shipped. Also: ICD version is internally inconsistent (README/spec = ICD-11 TM2, implementation docs = ICD-10) and self-claimed metrics contradict (100% vs 98.7% recall; 0% vs <1.8% hallucination). Do not cite their metrics.
  - *New (2026-09-16, Module 3 deep sweep):* **new competitor found — `labishbardiya/CureNet`**, an ABDM-native offline-first platform (handwritten prescriptions/labs → FHIR R4 via **Gemma 4 edge**, AES-256-GCM local storage, claimed ABDM M1/M2/M3). Caveats: no published accuracy/benchmark results, M1/M2/M3 author-asserted with **no NHA certificate**, no activity since 2026-06-17, and a license contradiction (LICENSE = proprietary "All Rights Reserved", README = MIT — trust LICENSE). Add to the doc/10 competitor scan; it is the closest overlap with our offline+ABDM+FHIR positioning.

## Technical / Module Questions

- [x] ABDM sandbox docs - Module D compliance (FHIR APIs, consent flow). **RESOLVED 2026-09-16
  (doc/22 §D-C, §D-H).** M1/M2/M3 sequence, consent-artefact fields (`purpose`, `hiTypes`,
  `dateRange`, `dataEraseAt`), care-context linking, encrypted data push, and the sandbox-exit
  gates (functional testing → WASA/Safe-to-Host → NHA committee) are documented. Remaining are
  external-authority answers only — see doc/22 Appendix B (16 tracked blockers).
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
  - *Update (2026-09-11, doc/16 §2):* **largely RESOLVED from NHA HIP/HIU Guidelines** — HIP = a healthcare provider (hospital/clinic/diagnostic center), NOT a tech vendor. Default posture: hospital = HIP, kiosk = part of the hospital's ABDM-compliant certified software (HFR registration → HIP; care-context linking under hospital keys). Independent kiosk-operator push would need an HRP/partner arrangement — remaining team design decision only.
  - *Update (2026-09-16, doc/22 §D-A):* **deployment model DECIDED** — hospital-owned certified
    software under the hospital's HFR/HIP keys (the independent-kiosk/HRP route is rejected for
    v1). Data Fiduciary = hospital; MediKiosk = processor. This closes the remaining team design
    decision that doc/16 §2 left open.
- [ ] **SNOMED CT India licence terms for a commercial product** - India is an SNOMED International member with NRCeS as representative (snomed.org/members/india), so SNOMED CT is usable in-country; exact terms/redistribution rules for a commercial kiosk product need verification with NRCeS before the med/diagnosis coding design is locked.
  - *Update (2026-09-11, doc/16 §3):* **RESOLVED via NRCeS FAQ** — Affiliate License required but free for all use within India (MLDS registration); vendor must sublicense to end users + report usage per declared period; deployment outside India needs a separate International Affiliate License. Not a blocker; process item before shipping.
- [ ] **SaMD/CDSCO classification** - does OCR + structuring of prescriptions (no diagnosis, no treatment advice) fall outside India's medical-device regulations, or does feeding a physician-facing summary trigger Software-as-Medical-Device scrutiny? Unverified; needs a regulatory read.
  - *Update (2026-09-11, doc/16 §4):* **partially RESOLVED from CDSCO MDSW guidance (MDR-2017)** — Module B's OCR+structuring maps to "Inform clinical management" (lowest band, plausibly Class A/B). **Flag: Module A's red-flag triage sits in CDSCO's "Drive clinical management" definition ("to triage or identify early signs") → higher band.** Intended-use wording (administrative intake + clinician-approved deterministic rules vs automated triage) is now a regulatory-strategy decision. Expert/CDSCO confirmation still the closing step.
- [x] **DPDP legal read** - **RESOLVED 2026-09-16 (doc/22 §D-A, §D-F).** (a) DPDP 2023 applies
  uniform obligations with **no separate "sensitive personal data" category** (delta from the
  old IT-Act SPDI framing confirmed; deep sweep + DPDP JSON). (b) **Hospital = Data Fiduciary;
  MediKiosk = Data Processor**; contractually settled via a required DPA. Deployment model
  DECIDED: hospital-owned ABDM-compliant certified software under the hospital HFR ID. DPDP
  Rules 2025 notified **14 Nov 2025** (correcting the earlier 13 Nov 2025 KB value); substantive
  duties from 13 May 2027. Legal review remains only for the "compatible purpose" question and
  Fourth Schedule scope (doc/22 D-K-15).
- [ ] **OSS license reviews before adoption** - MinerU carries a custom (GitHub NOASSERTION) license; Got-OCR2.0 has no license file; both need legal review if considered. EasyOCR's maintenance is slowing (last push Dec 2025).
- [ ] **Indic document-OCR benchmark** - AI4Bharat's document tooling (IndicDLP, 9 stars, dormant-ish; Indic-OCR, dormant 2022) is early-stage; no Indic handwriting benchmark found in this pass beyond MIRAGE (simulated corpus). A local eval set (real OPD scans, incl. ClinOCR-Bench per-subset numbers - already open above) is the gating item for engine choice.
- [ ] **ABDM Health Data Management Policy / data-residency clause** - not fetched this pass; the "India-only data residency" constraint needs an official citation before quoting it to judges (also flagged in doc/10 §6).
  - *Update (2026-09-11, doc/16 §1):* **RESOLVED — the clause exists and is citable:** HDM Policy (April 2022 revision), Clause 26: "No personal data shall be stored beyond the geographical boundaries of India, subject always to the provision of applicable laws." Plus federated storage (records stay at the originating facility; only registries are central). doc/10 §6 flag can be cleared.
- [ ] **Google "healthcare Document AI to FHIR"** - could not verify a healthcare-FHIR-specific processor on Google Cloud's product page (only general Document AI + healthcare SI partners). Do not cite such a product without a source.

### Module B deep-dive updates (2026-09-11, see doc/13)

- [ ] **Validate the VLM candidates on real Indic OPD handwriting** - PaddleOCR-VL-0.9B / DeepSeek-OCR (quantized) / GraniteDocling-258M have NO published real-Indic-medical-handwriting numbers (MIRAGE is simulated; OmniDocBench is zh/en-centric general docs). This validation is the gate for the Module B engine decision. Requires the local eval set first (below).
- [ ] **Build the local eval set** - **methodology DESIGNED 2026-09-16 (doc/20 §B-A, incl. a runnable M0 execution plan); execution still open.** Design: two-stage stratified sample ≥280 pages (per-stratum minimums incl. ≥60 EN handwritten Rx, ≥40 HI handwritten Rx, ≥20 poor-quality), per-field GT with bbox + legibility grade, double annotation + adjudication (Krippendorff α ≥ 0.80 categorical / char-agreement ≥ 0.90 strings), 20% frozen gold set, ICMR-2017/IEC + DPDP itemized study consent, on-device de-identification, India-resident encrypted storage + crypto-erasure. Cold start: MIRAGE-100 (`cc-by-nd-4.0` — **method validation only; no fine-tuning / no redistribution of derivatives**) + ClinOCR-Bench (font-synthetic handwriting) for method validation only. **Open:** collecting the data (site list + IEC SOPs), and the derived numeric thresholds (all BLOCKED-M0; see doc/20 Appendix A).
- [x] **Module B defect — status always `final`** — **FIXED 2026-09-16 (gap-fill pass).** `pipeline.run` now stores `any_verify` **inside** `verify` (mirrored at top level), so `fhir_emitter.build_bundle` reads it and emits `preliminary` whenever any field needs verify. Regression tests: `module-b/tests/test_fixes.py` (`test_verify_forces_preliminary_status`, `test_pipeline_merge_places_any_verify_inside_verify`).
- [ ] ClinOCR-Bench per-subset numbers (Handwriting vs Normal) - **updated caveat**: the Handwriting subset is rendered with handwriting FONTS (synthetic), so even this benchmark does not test real clinician handwriting; numbers still to pull from the PDF (arXiv:2607.03650).
- [x] **DiagnosticReportLab / Observation lab-code bindings** - **RESOLVED 2026-09-16 (doc/20 §B-D).** Primary-source profile bindings confirmed: `DiagnosticReport.code` 1..1 → `LOINCDiagnosticReportCodes` (preferred), `result` 1..\*; `Observation.code` 1..1 → `LOINCCodes` (example) and `Observation.code.coding` is **sliced closed by system with `system` fixed `http://loinc.org`**. NRCeS also publishes **Common Lab Codes for India (CLCI)** (2026) — a curated LOINC subset as `common_lab_codes_for_india.csv` (1,473 tests; fields General Name / LOINC Code / FSN / LCN), built with the LOINC India Working Group. **Decision:** CLCI-first, LOINC fallback, unmapped → free-text + verify. Remaining: `[uncertain]` LOINC/CLCI redistribution terms for a commercial kiosk (release gate, not a build blocker); and the CDCI Flat Files `License.txt` must be read before embedding.
- [ ] **surya/marker weights commercial clause** - OpenRAIL-M free under $5M funding/revenue; a hospital-deployed commercial product needs Datalab pricing. Decide consciously if ever shortlisted.
- [ ] **PaddleOCR-VL integration cost** - Apache-2.0 weights but it runs on the Paddle stack, not llama.cpp; weigh a second inference runtime on the kiosk vs surya's llama.cpp serving (license tradeoff is the inverse).
  - *Update (2026-09-11, CPU pass - doc/14):* largely RESOLVED for the CPU lane - PaddleOCR-VL now ships **official GGUFs (HF: PaddleOCR-VL-1.5/1.6-GGUF) + merged llama.cpp support** (PR #18825, 2026-02-19, accuracy parity verified), so the Module A llama.cpp runtime can host it; remaining cost is the pipeline's layout model (PP-DocLayoutV2/V3, small detection model, Paddle/ONNX-runnable).

### Module B CPU-only pass additions (2026-09-11 evening, doc/14)

- [x] **Model vendoring** - **RESOLVED 2026-09-16 (doc/20 §B-F).** RapidOCR's official offline path: `rapidocr download_models --config config.yaml` (added `>=3.7.0`; default config `>=3.8.2`) prefetches models into `rapidocr/models/`; production forces local files via `Det.model_path` / `Rec.model_path` / `Rec.model_dir` / `Rec.rec_keys_path`. Models default to the ModelScope CDN with **SHA-256 pins** in `default_models.yaml` (pin + verify at build; run CI with network disabled). `rapidocr>=3.5.0` is confirmed as the Devanagari PP-OCRv5-mobile floor (official model list); **note `rapidocr>=3.9.0` defaults to non-Devanagari PP-OCRv6, so explicit model config is mandatory**. Remaining risk only: `[uncertain]` ModelScope (China CDN) downloadability from India at build time — fallback is the official PaddleOCR HuggingFace Devanagari weights (`PaddlePaddle/devanagari_PP-OCRv5_mobile_rec`) converted to ONNX; the unofficial `watts-ai/RapidOCR` HF mirror is Latin-only, do not rely on it.

- [ ] **CPU latency benchmark on kiosk hardware** - no doc-VLM has any published x86-CPU latency (PaddleOCR-VL, surya 2, GraniteDocling, HunyuanOCR, DeepSeek-OCR all unmeasured; surya's only CPU-adjacent table is Apple-Silicon/Metal). *Reframed after the 2026-09-11 pick (decisions/06): the benchmark now (a) VALIDATES the picked primary on the real 12-16GB machine - PP-OCRv5-mobile multilingual via RapidOCR (onnxruntime-cpu vs openvino A/B) vs Tesseract hin+eng fallback, field-level; and (b) measures PaddleOCR-VL-1.6-GGUF Q4/Q8 for the phase-2 hard-page lane, gated on the dwell-time budget.*
- [ ] **PP-OCRv5/v6 multilingual rec model on CPU + Hindi accuracy** - all maintainer CPU tables cover the zh/en/ja unified models; the Devanagari-capable multilingual rec model (2M params) has neither a CPU latency table nor any real-Hindi-scan accuracy number (ICON-2024's PaddleOCR-Hindi 56% predates it; that study's env couldn't run current PaddleOCR per arXiv:2606.29213).
  - *Update (2026-09-11, reference impl - module-b/):* CPU path now VERIFIED LIVE: RapidOCR 3.9.2 default is zh/en PP-OCRv6 (Hindi CER 0.93 — must set `Rec.lang_type: DEVANAGARI` + PPOCRV5 + MOBILE explicitly); the Devanagari PP-OCRv5-mobile model (7.57MB) reads both Hindi (conf 0.94-0.96) and English (0.97-1.0) on synthetic pages, p95 3.2s/page, peak RSS 199MB on a dev laptop. Real-OPD-scan Hindi accuracy still unmeasured — M0 eval set remains the gate.
- [ ] **DeepSeek-OCR Indic catastrophic failure** - arXiv:2606.29213 reports median CER 100% / 89% catastrophic repetition loops on real Devanagari prints. Confirm team treats DeepSeek-OCR(-2) as excluded for the Indic lane regardless of runtime.
- [ ] **HunyuanOCR-1.5 license review** - Tencent community license is territory-limited + AUP-bound despite an official llama.cpp CPU path; needs legal read before any consideration.
- [x] **RapidOCR speed discrepancy** - **protocol DECIDED 2026-09-16 (doc/20 §B-B.2); numbers BLOCKED-M0.** Issue **#514** re-verified (2025-07-24): det 101–210 ms vs PaddleOCR-ONNX 30–59 ms on **PP-OCRv4 *server*** models (not our PP-OCRv5-mobile models, so it cannot decide our case); thread #669 (2026-05) again shows ONNX slower and the maintainer advises the OpenVINO engine. **Settle it with RapidOCR's own `RapidOCROutput.elapse_list` per-stage det/cls/rec timing** (no source patching), onnxruntime vs OpenVINO A/B, pinned cores, ≥3 warmups discarded, ≥30 mixed-resolution pages, report p50/p95 + peak RSS.
  - *New open sub-items (2026-09-16, doc/20 Appendix C):* `[uncertain]` NRCeS DocumentReference permitted `contentType` set; `[uncertain]` HEIC decoder choice/licence; `[uncertain]` ABDM's exact `dataEraseAt` duty for a HIP that is itself the record originator (vs an HIU holding a fetched copy); M0 collection site list + site IEC SOPs (team/partner decision).


### Module B production-design audit findings (2026-09-16, independent audit of doc/20)

- [ ] **doc/20 M0 instrument misdescribed — field vs page CER (HIGH, fix before B8).** doc/20 §B-A states the catastrophic rate is "CER > 0.5 on a field", but `module-b/medib/eval_harness.py:89` computes `bool(page_cer > 0.5)` and the harness is page-CER-only (`eval_harness.py:85,94-100`). Per-field CER / field-catastrophic is **M0 build work**, not an existing instrument. Owner: Module B lead.
- [x] **doc/20 dead config thresholds `vote_bonus_agree` / `vote_penalty_disagree`** — **FIXED 2026-09-16.** `voting.field_vote(primary, fallback, cfg)` now reads `vote_bonus_agree` / `vote_penalty_disagree` / `vote_iou_min` from config (defaults preserve prior behaviour); `pipeline.process_page` passes `cfg`. Tests: `test_vote_bonus_and_penalty_are_configurable`, `test_vote_iou_min_is_configurable`.
- [ ] **B8 queue under-specified (MEDIUM).** doc/20 §B-C gives no max-attempt count for the dead-letter transition, no named owner for DLQ re-drive, and the idempotency key `sha256(session_id + artifact_kind + content_hash)` omits `consent_ref`, so a re-emit under a different consent would dedupe.
- [x] **Router threshold semantics undocumented** — **FIXED 2026-09-16.** The inversion is now documented in `router.py` ("columnar-score threshold; comparison inverted"), and the hardcoded cutoffs moved into `EngineConfig` (`low_conf_cutoff`, `handwriting_low_conf_ratio_above`, `col_alignment_tol`). Test: `test_router_uses_config_low_conf_cutoff`.
- [x] **Hardcoded thresholds escape the M0 config sweep** — **FIXED 2026-09-16.** `router.py`/`voting.py` decision thresholds now live in `EngineConfig` (see row above); they join the M0 derivation list in doc/20 Appendix A.
- [ ] **`[uncertain]` items lack owner/condition in doc/20 (LOW).** DocumentReference `contentType` (doc/20 §B-C) and HEIC decoder (doc/20 §B-F) name no owner or unblocking condition.
- [ ] **B-C.3 machine-extraction DocumentReference authorship unspecified (LOW).** doc/20 §B-C.3 names only the raw-scan author.
- **Audit verdict: PASS-WITH-ISSUES** — all six gaps B-A…B-F addressed; invariants 1,2,3,6,7 hold in the design, 5 at risk, **4 violated by current code** (dead config + `any_verify`). Full report: research log 2026-09-16 "Module B production-design audit" entry.

### Module C research pass additions (2026-09-11 evening, doc/15)

- [x] **Which NRCeS/ABDM artifact carries the kiosk-generated pre-consultation summary?** — **CLOSED 2026-09-16 (doc/21 §C-A).** **Decision:** two artifacts pinned to the NRCeS IG **release ndhm.in#6.5.0** — structured pre-visit summary as **OPConsultRecord** (`status=preliminary` until physician attestation flips it to `final`), raw scans as **HealthDocumentRecord**. **INPS (v7.0.0 preview) is deferred** as the structured-summary carrier until NRCeS publishes v7.0.0 as a non-preview release and M3 validation passes; fallback if it never ships is the v1 design itself (content rides in OtherObservations/MedicalHistory/narrative). Author = hospital Organization + kiosk Device (patient is the source, not the author). The "PATAST / Mediated Submission" reference remains **unsourced — dropped**. Remaining NRCeS-facing sub-item: `[uncertain]` whether NRCeS would prefer a HealthDocumentRecord wrapper for an unattested patient-elicited document (owned by Module D, doc/21 Appendix C).
  - *Update (2026-09-16, Module D design — doc/22 §D-G):* **aligned with Module C.** Raw scans → HealthDocumentRecord (DocumentReference-only); structured summary → OPConsultRecord (`371530004`) now, **INPS** when v7.0.0 publishes (still preview-only). Application-enforced attestation is mandatory (`attester` is 0..\*). INPS publication status is the top external blocker (doc/22 D-K-01).
  - *Update (2026-09-11 night pass 2):* **"PATAST / Mediated Submission" could NOT be verified** — no such US Core guidance found on hl7.org/fhir/us/core/ pages this session (candidate pages 404 or lack the term). Treat the international-precedent claim as unsourced; either find the real US-core-equivalent page or drop the reference. The underlying question (which ABDM artifact carries the pre-visit summary) remains open and NRCeS-facing.
  - *Update (2026-09-16, Module 3 deep sweep):* **PARTIALLY RESOLVED — a candidate artifact now exists.** NRCeS IG **v7.0.0 preview** (generated 2026-07-15, local-development build, no confirmed publication date) adds an **Indian Patient Summary (INPS)** profile family derived from **HL7 IPS 2.0.0**, including a `Patient Story` section. INPS is a substantially better fit for a patient-elicited pre-visit summary than OPConsultRecord (doctor's note) or HealthDocumentRecord (patient-uploaded scans). v7.0.0 does NOT change OPConsultRecord's fixed type or its 12 section codes. Action: decide INPS vs preliminary-OPConsultRecord as the emission shape, and confirm INPS publication status with NRCeS.
  - *Update (2026-09-16, Module 3 deep sweep):* **`Composition.attester` is 0..* (must-support), NOT mandatory.** Physician attestation therefore must be enforced at the application layer — it is not guaranteed by the profile. This also applies to the OPConsultRecord `attester` slot for physician attestation.
- [x] **Module C evaluation protocol** — **ADOPTED 2026-09-16 as MCFP-1 (doc/21 §C-G).** Named protocol = deterministic suite (per-view field recall = 1.0, omissions = 0, fabrications = 0, determinism) + concept recall bound to **SNOMED CT / CDCI / ICD-11 TM2 (not UMLS** — licence-unsuitable) + **inference-aware judge** (Augnito five-tier taxonomy + safety floor; a lexical judge inflates hallucination 35.2% vs a 10.4% human baseline) + **per-section omission checks** (enumerate facts from the canon, not the summary — arXiv:2608.31016). ROUGE/BERTScore/BLEURT apply only to the phase-2 LLM lane. Real-OPD clinical set **MC-1** (n>=280) designed; collection gated on ethics + site agreements (Clinical lead).
  - *Update (2026-09-11 completion pass, doc/15 §8b):* **research side ANSWERED.**
    Established protocol = ROUGE + BERTScore + BLEURT + concept-recall
    ("medical concept recall", UMASS_BioNLP) + rubric-based human eval, with an
    inference-aware judge definition (per 2604.14829). Reference datasets:
    ACI-BENCH (207 full dialogue-note pairs, arXiv:2306.02022) and MTS-Dialog
    (1.7k pairs, via MEDIQA-Chat 2023 Task A). "MEDCON" is NOT an established
    MEDIQA metric — verified absent from the overview paper; do not cite.
    Remaining = team DECISION (which of these to adopt), not research.
  - *Update (2026-09-12, implementation):* the deterministic subset is IMPLEMENTED
    (`module-c/medic/eval_harness.py`): per-view field recall + explicit omission
    check (new evidence: arXiv:2608.31016, LLM judges verify presence not absence —
    found in the 2026-09-11 /last30days validation run) + provenance-integrity
    (fabrications=0) + determinism, with per-view coverage contracts. ROUGE/
    BERTScore rows apply only if/when the phase-2 LLM narrative lane is added.
- [x] **Bilingual rendering engine** — **DECIDED 2026-09-16 (doc/21 §C-F).** v1 lane = **deterministic label dictionary + verbatim values** (no MT); clinical text is rendered, never machine-translated as the source of truth. **IndicTrans2** core models are frozen (last revision May 2025; GitHub push 2025-10-03) and **do not support Hinglish/Romanized code-mixed input**; **IndicTrans3-beta** and **Bodhan AI Indic-Translate** (Gemma 4 E4B, ~7.94B params) add code-mixed handling but are **not CPU-benchmarked and too large for the kiosk**. Full-narrative Hindi MT lane is **DEFERRED** (gate: CPU p95 within dwell budget + Hinglish support); the deterministic lane ships as the fallback. Bhashini remains blocked-risk. Read-back ownership resolved: Module C owns the content (a canon view), Module A owns the interaction/confirmation capture.
  - *Update (2026-09-16, Module 3 deep sweep):* **IndicTrans2 core models are effectively frozen** (last revision May 2025; no change in the 6-month window) and **do NOT support Hinglish / Romanized code-mixed input** — which is the actual patient-language reality in Indian OPDs. Size is fine for the kiosk (distilled En-Indic 200M = ~750MB fp32 / ~335MB int8) and Devanagari is well covered. Newer options to evaluate instead: **IndicTrans3-beta (Gemma-based)** and **Bodhan AI Indic-Translate (Sept 2026)**, which does add Romanized/code-mixed handling. Re-pick the offline translation lane against these before locking Module C rendering.

## Modules A+B implementation questions (from the 2026-09-16 build, doc/23)

- [ ] **AB-D2 — kiosk vs edge placement of LLM structuring.** Code exists both ways (kiosk J2 runtime + the edge is available); the decision is pending a measured combined-profile benchmark. Owner: Eng. Blocks: build freeze.
- [ ] **AB-D3 — B scheduling window** (queue-time before the interview vs after read-back). Owner: Eng + clinical.
- [ ] **AB-D4 — shared LLM residency policy** (load-on-demand + idle eviction implemented as the default; confirm). Owner: Eng.
- [ ] **AB-D5 — kiosk RAM target (4 vs 8 GB)** — **blocks procurement.** 8 GB recommended for a combined A+B kiosk; 4 GB is a reduced profile where `A_NLU` degrades. Owner: Eng + procurement.
- [ ] **Module A real model bindings** — `media/adapters.py` ships interfaces + offline doubles; whisper.cpp / Silero / sherpa / llama.cpp bindings are not implemented and refuse to run unattended (honest, not silent). Owner: Module A lead.
- [ ] **Red-flag clinician sign-off** — RF-1..RF-4 are the demo list (each hit reports `signed=False`); the 8 production candidates are inactive placeholders. Clinical sign-off activates/escalation-gates them (doc/23, research log 2026-09-16). Owner: Clinical.
- [ ] **Combined-profile benchmark (ASR + OCR + LLM peak on real kiosk CPU)** — unmeasured; gates AB-D2/D4 and the 4-vs-8 GB sizing. Owner: Eng.
- [x] **`medib` defects** — **FIXED 2026-09-16** (`any_verify` status + dead `vote_*`/router thresholds); regression tests in `module-b/tests/test_fixes.py`. Remaining Module B work is M0 data + B8, not defects.
- [x] **Red-flag rules externalized + sign-off gate** — `module-a/media/redflags.spec.json` (12 rules; RF-1..RF-4 active/unsigned; RF-5..RF-12 empty+inactive) + `media/rules.py` loader/merge. A clinician activates a candidate by signing a spec, no code change. Test: `test_clinician_can_activate_a_candidate_without_code`.
- [x] **Reference ranges externalized + strict gate** — `module-c/medic/ranges.py` + `ranges.example.json`; `MergerConfig.from_range_table(...)` and `strict_ranges=True` **refuse to flag against an unsigned table**. Tests in `module-c/tests/test_ranges.py`.
- [x] **ASR/TTS real runtime path** — **two paths now exist.** In-process: `FasterWhisperASR` (offline whisper, CPU int8) + `SystemTTS` (OS voice) + `MicrophoneRecorder`, driven by `media/voice.py`. External-binary: `SubprocessASR`/`SubprocessTTS` (+ `WhisperCppASR`/`SherpaTTS`). Round trip verified live on synthesized audio (2026-09-16). **Still open:** Hindi/Hinglish accuracy on real OPD audio (unvalidated), and a Hindi TTS voice on the deployment image (this host has only en-US voices).
- [x] **Combined A+B benchmark harness** — `kiosk/benchmark.py` (per-stage p50/p95 + peak RSS). Measured **2026-09-16** on a dev host (NOT kiosk-class): real 2-page Module B p50 3.35 s / p95 5.33 s, peak RSS ~397 MB, `B_OCR` = 2 leases. Kiosk-class numbers still must be taken on real hardware for AB-D2..D5.
- [x] **A↔B preemption contract** — implemented: additive `medib.pipeline.run(page_guard=...)` holds a scheduler lease per page; kiosk `Encounter` wires it. Existing Module B tests unaffected.
- [x] **Module A → Module C contract** — `media` emits `medikiosk-history-bundle/1` and round-trips through `medic.contracts.load_history` (test-verified).
- **Verification (2026-09-16):** repo-wide `pytest` = 90 passed; `python -m kiosk.cli --demo` works on 8 GB and (degraded) 4 GB.

## Module D questions (from the 2026-09-16 Module D design, doc/22)

- [ ] **`dataEraseAt` duty for an originating HIP** — does ABDM require a HIP that created the record to erase it, or only an HIU holding a fetched copy? Blocks the erasure design lock (doc/22 D-K-08 / §D-B.5).
- [ ] **Consent-artefact field/version freeze + primary NHA Fidelius spec URL** — re-verify the primary NHA page (the algorithm was confirmed this session only via the community mirror + two independent implementations). Blocks the crypto/consent implementation freeze (doc/22 D-K-09).
- [ ] **§16 country-allowlist notification** — still un-notified; India-only is the operative rule (doc/22 D-K-13).
- [ ] **Final Health Data Retention numbers** — HDR policy draft; Module D targets 7-yr audit with per-purpose clocks (doc/22 D-K-14).
- [ ] **INPS publication status** — v7.0.0 is preview-only ("Local Development build", version-history page = TBD); blocks promoting INPS from the deferred slot to the structured-summary carrier (doc/22 D-K-01).
- [ ] **External-confirmation tracker (16 blockers)** — see doc/22 Appendix B for the full list with owners + lead times.

## Innovation Candidates (proposed 2026-09-11 — pending team ratification)

Context: the 4-module decomposition (A–D) is prescribed by the PS, not itself innovative —
competing SIH26047 teams share it. These candidates are checked against the prior-art scan in
`doc/10-positioning-evidence.md` §2. Recommendation: pick at most two for the submission;
the rest are phase-2 backlog.

**Top picks (recommended for the submission):**
- [x] **Repeat-visit delta summaries** — first visit builds the baseline; return visits capture
and display "what changed since last time" instead of re-asking everything. Directly attacks
the PS's named harm (repeated questioning across visits). No public-OPD product does
visit-to-visit continuity where patients are quasi-re-registered each time.
  - *Update (2026-09-11 night):* **designed + demo-implemented** — see `doc/15-innovation-features.md`
    §1 and guided demo 3 in the prototype.
  - *Update (2026-09-16, doc/21 §C-J):* **HistoryBundle per-visit carry/delta schema RESOLVED at the
    design level** — additive v2 (`medikiosk-history-bundle/2`) with `carriedFrom` provenance, verbatim
    carry, delta block and an explicit `to_v1()` projection; cross-visit conflicts retain both values
    (`needs_review`). **Remaining:** the clinician-approved stable-field list (BLOCKED-CLIN; owner
    Clinical lead) and Module A's v2 capture flow.
- [x] **Attendant/proxy mode with provenance tags** — capture family-member statements separately
from patient self-report, tagged "stated by attendant" vs "stated by patient". Matches Indian
OPD reality (elderly arrive with family who answer for them). Not found in any intake product
surveyed (Phreesia, scribes, Yolo all assume one respondent).
  - *Update (2026-09-11 night):* **designed + demo-implemented** — see doc 15 §2 and guided
    demo 3 (Ramesh's son). Reducer-level subjective guardrail included. Remaining
    product-track work: relation confirmation against registration data.

**Strong seconds (phase-2 or if capacity allows):**
- [x] **Body-map touch entry** — tap-where-it-hurts diagram + pain scale as the conversation
starter; zero literacy / zero voice / zero language required. Checklists exist; visual-first
body map as *primary* input for Hindi/rural users is the differentiator.
  - *Update (2026-09-11 night):* **designed + demo-implemented** — opening `bodymap` turn in
    the prototype (front/back figure, 8 regions → complaint vocabulary). Remaining
    product-track work: region-set comprehension test with low-literacy users.
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

### Module 3 research closure notes (2026-09-11 completion pass, doc/15 §8)

- [x] Module 3 (Module C) research is COMPLETE except team decisions + NRCeS
  confirmation (see research log 2026-09-11 completion entry).
- [ ] NirogStreet live status — site down ("temporarily unavailable") as of
  2026-09-11. Do not cite as active competition until it recovers.
- [ ] "MEDCON" metric — verified ABSENT from the MEDIQA-Chat 2023 overview paper.
  Do not cite; use "medical concept recall" (UMASS_BioNLP) if a concept metric is needed.

## Innovation watch (from 2026-09-11 `/last30days` run — research log, raw file in `~/Documents/Last30Days/`)

- [ ] **DAINA/MiiHealth watch** — phone-call pre-visit intake with specialty protocols (seed Aug
2026) is the closest Module A prior art. Track their protocol catalogue; our answer stays
kiosk + documents + AYUSH + ABDM. Add a DAINA row to doc 10 §2 before the finale.
- [ ] **NHA open-source ambient voice-to-text EoI (Feb 2026)** — read the actual EoI text on
abdm.gov.in; if the scope covers OPD history capture, cite it in the submission as a
procurement tailwind for the offline open-source Module A stack.
- [x] **Scan & Register as Module D entry point** — **DESIGNED 2026-09-16 (doc/22 §D-C.2).**
  Scan & Register is DECIDED as the preferred session entry (ABHA QR token handoff), with
  manual/QR ABHA capture as fallback and a no-ABHA path as last resort. Cross-verified live:
  **25 crore** OPD registrations, ~4 lakh/day, 30,800 facilities (Aug 2026, PIB/NHA). Remaining:
  the kiosk-side integration surface for non-hospital software (doc/22 D-K-10).
- [ ] **Specialty-protocol intake tracks** — DAINA-style specialty question sets mapped onto
our ROS architecture (ortho/cards first). Phase-2 candidate.
- [ ] **Pilot metric set from Mount Sinai** — completion rate (their 80%), SUS-style usability,
physician concordance (their 88-96%), zero-incident safety log. Adopt as the Phase-1
measurement plan in doc 10 §5.2 / doc 11 §8.

## General methodology follow-ups (2026-09-16, docs 30-32)

Derived from the general CPU-AI / system-design methodology pass. These are "should the project adopt
this pattern?" questions, not research gaps.

- [ ] **Adopt the CPU benchmark harness as a shared contract** (doc 30 §6.2). Decide the standard:
  pinned physical cores, warmups discarded, p50/p95 + peak RSS, F16 quality baseline, and explicit
  kernel-path/execution-provider verification. `doc/20` Sec B-B already specifies this for Module B;
  the question is whether to make it the project-wide contract for every engine threshold.
- [ ] **Tiered inference + calibrated confidence** (doc 30 §4.2, doc 32 §4.1). RouteNLP/UCCI-style
  cascades cut cost with measured quality held (see `doc/32` Sec 3.5). Decide whether the Module C
  phase-2 LLM lane adopts a calibrated-confidence escalation rule (and whether confidence is
  decomposed/banded, not a single softmax number).
- [ ] **Run a lightweight ATAM over `doc/19`** (doc 31 §6.1/6.7, doc 32 §6.6) before ratification.
  The named tradeoff points are model size vs latency vs RAM, caching vs freshness, rules vs ML in
  critical logic, and edge centralisation vs kiosk autonomy. Utility tree + sensitivity/tradeoff
  points would strengthen the blueprint's D1-D8 sign-off.
- [ ] **Three version planes for models/prompts/config** (doc 32 §1.5). If the kiosk ever ships OTA
  model or prompt updates, decide whether firmware/model/config are versioned independently with
  health-triggered auto-rollback.
- [ ] **Measurable-exit-criteria format as the gate acceptance standard** (doc 32 §6.7). Decide
  whether every `doc/19` gate item must be written as metric + threshold + population + measurement
  method + owner.
- [ ] **Sustained (full-day) thermal/throughput testing as a kiosk acceptance requirement**
  (doc 30 §3.2, doc 32 §5.3). Ties to the hardware-grounding finding that real Indian kiosks ship
  CPU/iGPU only - burst benchmarks hide throttle; a full-day run at target cadence is the honest test.
- [ ] **Confirm the outbox/inbox + DLQ shape in `doc/20` B-C has no gaps** vs the general pattern
  (doc 32 §2.3): `SELECT ... FOR UPDATE SKIP LOCKED`, publish-first-then-stamp, unique-constrained
  inbox dedupe in the same transaction, retention pruning, DLQ replay, and lag/DLQ monitoring.
- [ ] **Retrieval lane choice if any RAG is added** (doc 32 §4.2, e.g. specialty-protocol content):
  sqlite-vec + FTS5 hybrid with precomputed build-time embeddings is the proposed default; confirm
  before building.

---

## Fanout synthesis 2026-09-17 — sorted action list (read this first; supersedes scattered notes above, nothing deleted)

**How to read:** SETTLED = stop debating. FIX-NOW = small edits that remove confusion. BLOCKED = needs data/people/authorities. Owners in brackets.

### SETTLED (do not re-open)
- 8 GB combined kiosk; 4 GB = reduced profile. B after read-back. OPConsultRecord-preliminary/6.5.0 + INPS deferred. Deterministic C + label-dict bilingual + MCFP-1. Hospital=Fiduciary/HIP, M2-only. Engine exclusions hold. [Eng/Clinical]

### FIX-NOW — docs (confusion source #1)
- [ ] 07:113 stale verdict contradicts in-tree any_verify fix — reconcile. [Module B lead]
- [ ] DPDP date form: G.S.R.846(E) 13-Nov-2025; PIB 14-Nov-2025 (portal upload 14th). Fix any "14 Nov only" lines. [Module D lead]
- [ ] HDM Cl.26 cite as "April-2022 revised draft, Cl.26.6". CDSCO cite final 21-Jul-2026 guidance (Doc No. CDSCO/MD/GD/MDSW/01/2026). [Module D lead]
- [ ] NHA EoI citable date Sep-7-2026 (Feb unverified). NirogStreet → "status unverified Sep 2026". Never cite rohit-h11 metrics / MEDCON / PATAST. [Submission owner]
- [ ] doc/11 §7: fix 22-lang overclaim + demo-vs-real wording; sharpen §6 differentiator (offline + NRCeS-pinned + provenance + app-enforced attestation + AYUSH). [Submission owner]

### FIX-NOW — code (confusion source #2)
- [ ] Pin Det to mobile + capture elapse_list + wire engine_type A/B. [Module B lead]
- [ ] contracts._from_run_summary: map real verify (not phantom _verify); include line-level verify in merge gate. [Module B/C leads]
- [ ] amended divergence (meta vs Composition.status); Composition.type → SNOMED 419891008; medic sections → SNOMED 12-set + 404684003; author += Device; persist RedFlagHit.signed; reconcile media vs kiosk term lists. [Module B/C leads]
- [ ] B8 key += consent_ref; set max-attempts (proposed 10, 5s×2/15min cap/24h TTL/breaker-pause) + DLQ RACI (IT/clinical/DPO) + inbox dedupe. Mint one session_id per run; add dedupe + retain-both conflict flags. [Module B/D leads]
- [ ] Vendoring: requirements.lock + models.manifest (SHA-256) + local paths + network-off CI + SBOM/NOTICE + MLDS registration. HEIC decoder decision + corrupt/PDF/dark paths. [Module B lead]

### BLOCKED — needs data / people / authorities
- [ ] M0 collection: sites + IEC SOPs + ≥280 pages + field-CER harness upgrade. [Eng + Clinical]
- [ ] Clinical sign-off: RF-1..12 terms/thresholds + Se/Sp targets + eval set; signed range table (sex/population rows); stable-field list; completeness floor. [Clinical lead]
- [ ] M1 kiosk-class benchmark (combined peak, thermal soak) → closes AB-D2/D4/D5. [Eng]
- [ ] External 16 (doc/22 App.B): ask INPS + CDSCO first (long leads), freeze artefact/crypto with NHA second, batch NRCeS modelling questions in one enquiry. [Module D lead]

---

# 20 — Module B Production Design (gap closure: B-A … B-F)

> **Status:** Design for team ratification, 2026-09-16. Research/design only — **no code was
> written**. Sections mirror the six assigned gaps. Every item is **DECIDED** (with rationale)
> or **EXPLICITLY DEFERRED** (with the condition that unblocks it). Nothing is left "TBD".
>
> **Read with:** doc/13 (deep-dive), doc/14 (CPU research), doc/16 (regulatory), doc/17
> (implementation plan + M0–M4), doc/19 (production blueprint + invariants), and the actual
> code in `module-b/medib/`.
>
> **Non-negotiable constraints this design must fit (restated):** offline-first (models/data in
> the image, no runtime network); CPU/iGPU only, ~4–8 GB kiosk RAM, **no CUDA**; India data
> residency, no third-party cloud OCR on any PHI path; never fabricate; verify-default for
> handwriting/low-confidence; never silently resolve conflicts; heavy stages never co-run with
> ASR on one kiosk.

## Evidence rules used in this doc

- A load-bearing claim carries a source (URL or `file:line`) and a verification date.
- `[verified YYYY-MM-DD]` = fetched this session; `[KB]` = already sourced in the knowledge base
  with its own date; `[uncertain]` = not independently confirmed — treat as unproven.
- Vendor/maintainer claims are labelled as such.

## Decision status legend

| Tag | Meaning |
|---|---|
| **DECIDED** | Ratify as-is; rationale given. |
| **DEFERRED** | Not decided now; the named condition unblocks it. |
| **BLOCKED-M0** | The value/choice is a measurement, not a judgement; M0 produces it. |

---

## B-A. The M0 evaluation set (the gate everything else depends on)

**Why this is first.** There is no public real-Indic-medical-handwriting corpus.
MIRAGE's dataset is *simulated* (743,118 records written by 1,133 doctors reading simulated
records) and its best fine-tuned result is 82% F1 on medication names+dosages only, with the
authors stating it is "in no way deployable" [KB, doc/13 §2.1]. The synthetic pages in
`module-b/tools/` overstate quality by construction (`make_synthetic_pages.py:1-5`). Every
Module B threshold and the engine decision itself are therefore blocked on a consented,
field-annotated, real-OPD eval set.

### B-A.1 Sampling frame — **DECIDED**

Two-stage stratified sample: hospitals → pages, with strata chosen so the hard cases are not
swamped by easy ones.

**Strata (all Hindi/English + Hinglish; regional scripts phase-2):**

| Stratum | Document type | Script | Print/hand | Minimum pages |
|---|---|---|---|---|
| S1 | Prescription | English | Handwritten | 60 |
| S2 | Prescription | Hindi (Devanagari) | Handwritten | 40 |
| S3 | Prescription | English | Printed | 40 |
| S4 | Lab report | English | Printed (tabulated) | 60 |
| S5 | Discharge summary | English | Printed | 30 |
| S6 | Advice / referral note | EN or HI | Printed | 30 |
| S7 | Poor-quality capture (any) | — | skew/glare/low-DPI | 20 |

**Total minimum: 280 pages** (doc/17 set ≥200 as a floor; this supersedes it upward for the
handwriting and quality strata).

**Statistical basis (state this so the CI is auditable).** The primary sampling unit is the
**page**; the metric of interest is a proportion (catastrophic-error rate) and a mean (field
CER). For a proportion, the 95% half-width is `E = 1.96·√(p(1−p)/n)`:

- worst case `p=0.5`: n=280 → E ≈ ±5.9 pp; n=200 → E ≈ ±6.9 pp;
- expected `p≈0.10`: n=280 → E ≈ ±3.5 pp.

Field-level CER is clustered (fields within pages), so we report **page-level** CER distributions
and a **cluster-robust** mean/variance (bootstrap by page, not by field). Per-stratum estimates
have wider intervals and are reported as such; strata are not combined into one headline number
without weighting.

**Hospitals:** ≥2 public OPD sites of different type (e.g. an AIIMS-class tertiary OPD and one
district/AYUSH facility) so the sample is not site-idiosyncratic. Mark `[uncertain]`: the exact
site list is a team/partner decision.

### B-A.2 Ground-truth schema — **DECIDED**

Per-page JSON + per-field rows; the annotation file is the contract between annotators, QA,
and `medib/eval_harness.py`.

```
page : {
  image_id, source_site, doc_type (prescription|lab|discharge|advice|other),
  script (latin|devanagari|mixed), capture (print|hand|mixed),
  quality_grade (0=clean .. 3=barely legible), dpi, skew_deg,
  consent_ref, annotator_ids[], adjudicator_id
  fields : [ {
     field_id, field_type (med_name|dose|freq|duration|lab_name|lab_value|lab_unit|
                 lab_ref_range|diagnosis|date|patient_name|other),
     raw_string,                        # exactly what is written, character-for-character
     normalized_value,                  # machine-normalized (e.g. "500 mg", ISO date)
     bbox : [x1,y1,x2,y2],              # required for every field (RAPTOR+ grounding rule)
     legibility (0=clear .. 3=unreadable),
     is_clinical (bool),                # drives clinician adjudication
     notes
  } ],
  full_text                            # reading-order concatenation, for page CER
}
```

Bounding boxes are mandatory because the published grounding evidence (RAPTOR+
`[KB, ocr_asr_rnd.md]`: 96.1% reading vs 60.6% strict-grounding) and the project's own
"every value has a bbox" rule both depend on them, and because `medib/confidence.py:21-26`
emits bboxes to the review payload.

Normalization cases that must be annotated explicitly (they are the failure modes that matter):
dose forms (`mg`/`एमजी`), frequencies (OD/BD/TDS/`दिन में तीन बार`), decimal vs Devanagari
numerals, and drug abbreviations. This is a *field-level* protocol by design (RealDocBench
`[KB, doc/13 §2.3]`: page-level similarity scores decorrelate from field accuracy).

### B-A.3 Annotation, QA, inter-annotator agreement — **DECIDED**

- **Two independent annotators per page** (double annotation), then **adjudication**.
- Language-appropriate annotators (Devanagari proficiency required for S2).
- **Clinical fields** (med names/doses, lab values, diagnoses) are adjudicated by a clinician;
  non-clinical text by a senior annotator.
- **IAA:** categorical fields → **Krippendorff's α**; string fields → normalized
  **character-level agreement** (`1 − CER`). **Acceptance: α ≥ 0.80** and string agreement
  ≥ 0.90 on a 10% QA sample; below that, retrain/re-brief annotators before continuing.
- Tooling: a bounding-box-capable annotation tool is required (INCEpTION, Label Studio, or
  doccano with an image/PDF plugin). Mark `[uncertain]`: tool selection is an M0-setup task;
  whichever is chosen must export the schema above.
- **Gold set vs dev set:** hold out 20% as a frozen gold set never used for threshold tuning;
  tune on the other 80% and report on gold (prevents threshold overfitting — the KB already
  warns thresholds must not be guessed, doc/17 §7.1).

### B-A.4 Consent, ethics, de-identification, governance — **DECIDED**

- **Path:** hospital **Institutional Ethics Committee (IEC)** approval before any collection,
  under the **ICMR National Ethical Guidelines (2017)** framework (`[uncertain]` — the ICMR
  guideline is the named national standard but was not re-fetched this session; confirm the
  current edition and the site's IEC SOP).
- **Consent:** separate, itemized, purpose-specific study consent (not the kiosk's service
  notice). DPDP Act 2023 + **DPDP Rules 2025** apply because the data is personal data
  "collected offline and later digitized" [KB, doc/13 §4].
- **De-identification:** before leaving the collection device, mask/remove direct identifiers
  (patient name, ABHA/Aadhaar, phone, address, hospital UHID) while **preserving** the clinical
  text that is the object of study. Retain a site-side re-identification key only if the IEC
  requires follow-up; otherwise destroy it. `[uncertain]`: there is no India-specific published
  de-id standard found this pass — we adopt a HIPAA-Safe-Harbor-style identifier list as the
  working standard and state that explicitly in the protocol.
- **Storage/residency:** eval data stored **in India**, encrypted at rest (AES-256), access
  RBAC + audit, no cloud sync. No PHI on any vendor ops tier (doc/19 §3 Zone C).
- **Retention/destruction:** defined retention clock in the protocol; crypto-erasure (destroy
  key) at end of study; destruction certificate retained. Retention length is an IEC-set value
  (proposed default: study end + 12 months).

### B-A.5 Cold-start strategy (before real scans exist) — **DECIDED**

Public datasets are used for **method validation only**; they cannot establish real-OPD
accuracy and must never be cited as such.

- **MIRAGE public subset** — `chaithanyakota/100-handwritten-medical-records`, 100 records,
  ~38.6 MB, last updated >1 year ago `[verified 2026-09-16, huggingface.co]`.
  **License is `cc-by-nd-4.0` (Attribution–NoDerivatives)** `[verified 2026-09-16]`. This is a
  material constraint: **no derivative works may be distributed.** Consequences (DECIDED):
  use it only to wire and sanity-check harness/eval code; **do not fine-tune on it and do not
  redistribute any modified/derived artifact** built from it without written permission.
- **ClinOCR-Bench** — 384 images, 6 subsets, template-aware split, MIT, HF
  `ClinOCR-Bench/ClinOCR-Bench` [KB, doc/13 §2.2]. The **Handwriting subset is font-synthetic**,
  so it does not test real clinician handwriting; US-clinical-doc origin, not Indic. Use for
  pipeline/robustness checks only.
- **What these cannot prove (state in the submission):** Hindi/Devanagari real-scan accuracy,
  real handwriting robustness, real OPD quality distribution, or any production threshold.

### B-A.6 Acceptance thresholds M0 feeds back into `medib/config.py` — **BLOCKED-M0**

M0 produces the measurements; the thresholds are then *derived*, not chosen. Mapping (see the
full threshold table in Appendix A):

| Metric | Instrument | Feeds |
|---|---|---|
| Field CER (per field type) + page CER | `eval_harness.cer` (exists) | engine go/no-go; structurer quality |
| Catastrophic rate (`CER > 0.5` on a field) | `eval_harness` (`catastrophic` flag, line 89) | safety gate + which fields are verify-always |
| p50/p95 latency per page and **per stage** | `RapidOCROutput.elapse_list` (det/cls/rec) + wall clock | dwell-time budget; engine A/B |
| Peak RSS | `eval_harness.peak_rss_mb` (psutil / Win32) | kiosk memory budget |
| Per-field confidence vs correctness calibration | OCR line scores vs GT | `field_conf_threshold`, `vote_bonus_agree`, `vote_penalty_disagree` |
| Router signal distributions (avg line conf, column alignment) | `router.classify` signals + GT page type | `handwriting_if_avg_line_conf_below`, `table_if_col_alignment_score_above` |

**M0 exit criteria (unchanged in spirit from doc/17, now instrumented):** ≥280 annotated pages
on the schema above; per-stratum counts met; IAA α ≥ 0.80; harness reports field-CER,
catastrophic-rate, p50/p95 (page + stage), peak RSS; DPDP/IEC consent flow documented and
audited; gold set frozen.

### B-A.7 M0 execution plan (runnable by a different team)

1. **Setup (wk 1).** IEC submission; pick annotation tool; generate the JSON schema; brief
   annotators; freeze normalization rules (dose/frequency/Devanagari numerals).
2. **Pilot (wk 1–2).** Annotate 20 pages double-blind; compute IAA; calibrate rules + schema;
   revise. Do not proceed until α ≥ 0.80.
3. **Collection (wk 2–6).** Recruit sequentially at ≥2 sites until each stratum minimum is met;
   log a reason for every excluded page (unsupported file, no consent).
4. **De-identify (wk 2–6, on-device).** Run the de-id pass before the page leaves the site;
   log it in `page` metadata.
5. **Annotate + adjudicate (wk 3–7).** Double annotation; adjudication; clinical adjudication
   for clinical fields.
6. **Freeze (wk 7).** Split gold (20%, never tuned on) vs dev; hash and seal.
7. **Benchmark (wk 7–9).** Run the doc/14 §5 / B-B protocol on the real kiosk CPU; produce the
   M0 report; derive Appendix A thresholds.
8. **Ratify (wk 9).** Team signs the derived thresholds; write them into `config.py` (a code
   change, out of scope for this session) and record them in the decisions log.

---

## B-B. Engine decision — finalize or explicitly defer

### B-B.1 What is decided, and what stays open — **DECIDED**

- **Primary stays PP-OCRv5-mobile multilingual (Devanagari-capable) via RapidOCR / ONNX Runtime
  CPU.** Confirmed supported: RapidOCR model list shows `devanagari` + `model_type: mobile` +
  `PP-OCRv5`, supported from `rapidocr>=3.5.0`, engine `onnxruntime`/`openvino`/`paddle`
  `[verified 2026-09-16, rapidai.github.io/RapidOCRDocs/main/model_list/]`. Upstream weights:
  `PaddlePaddle/devanagari_PP-OCRv5_mobile_rec` `[verified 2026-09-16, huggingface.co]`.
  The code already pins this explicitly (`engines.py:48-55`: `LangRec.DEVANAGARI`,
  `OCRVersion.PPOCRV5`, `ModelType.MOBILE`) — this is necessary because RapidOCR ≥ 3.9.0
  defaults to **PP-OCRv6** models that are not Devanagari
  `[verified 2026-09-16, RapidOCR usage docs]`.
- **Fallback stays Tesseract 5 `hin+eng`.**
- **Phase-2 VLM lane: DEFERRED (default defer).** Unblocked by: PaddleOCR-VL-1.6-GGUF Q4/Q8 via
  llama.cpp CPU measured at **p95 ≤ the dwell-time budget on the router's hard-minority pages**
  on the real kiosk. If it passes → add as router lane 2; else it remains out of v1.
- **Exact RapidOCR version pin:** DEFERRED to after the B-B.3 benchmark; process is DECIDED
  (pin a version + pin model file SHA-256 from RapidOCR's `default_models.yaml`). Floor is
  `>=3.5.0` (Devanagari support).

### B-B.2 Resolving the RapidOCR speed discrepancy — **DECIDED protocol (BLOCKED-M0 for numbers)**

The discrepancy is real and documented: GitHub issue **#514** (2025-07-24) reports the
detection stage at 101–210 ms vs PaddleOCR's own ONNX path at 30–59 ms on identical **PP-OCRv4
server** models (2–3×) `[verified 2026-09-16, github.com/RapidAI/RapidOCR/issues/514]`.
The maintainer did not confirm a root cause; the reporter concluded the difference is in
RapidOCR's `TextDetector`, not ONNX. A later thread (#669, 2026-05) again shows ONNX slower than
Paddle on one image (1.31 s vs 0.80 s), and the maintainer's advice was to use the **OpenVINO**
engine `[verified 2026-09-16]`. Caveat that must be stated: **#514 measured large PP-OCRv4
*server* models, not the PP-OCRv5-mobile models we ship** — so it does not decide our case.

**Measurement protocol (settles it for our models):**

1. Isolate **stage timing** using RapidOCR's own `RapidOCROutput.elapse_list` = `[det, cls, rec]`
   seconds `[verified 2026-09-16, RapidOCR usage docs]` plus wall-clock `elapse` — no source
   patching needed (contrast issue #514, which added manual markers).
2. A/B **`EngineType.ONNXRUNTIME` vs `EngineType.OPENVINO`** (both official; `rapidocr` hosts
   both, and `rapidocr-openvino` is deprecated in favour of the `engine_type` param
   `[verified 2026-09-16]`), with the **same** Devanagari PP-OCRv5-mobile models and the
   orientation classifier disabled unless it is needed.
3. Threads pinned to physical cores; ≥3 warm-up runs discarded; ≥30 measured pages spanning
   resolutions; report **p50/p95 per stage and end-to-end, plus peak RSS**.
4. Report the det:rec time ratio for our models and compare against the #514 ratio; if the det
   stage dominates as in #514, prefer OpenVINO and/or evaluate PP-OCRv6-tiny for the det stage
   with a multilingual rec swap (doc/14 §4a upgrade note).
5. Do not adopt any forum number (e.g. the "200 ms/page" claim) as evidence.

### B-B.3 Real Hindi accuracy measurement — **BLOCKED-M0**

There is no published CPU accuracy for the Devanagari PP-OCRv5-mobile rec model on real Hindi
scans (ICON-2024's PaddleOCR-Hindi 56% predates it; its env couldn't run current PaddleOCR per
arXiv:2606.29213). Measure on M0: **field CER + catastrophic rate on S2 (Hindi handwritten)
and S3 (Hindi printed)** specifically, with Tesseract `hin` as the floor comparison. The
reference implementation already saw conf 0.94–0.96 on *synthetic* Devanagari
(research log 2026-09-11) — synthetic, so non-generalizing.

### B-B.4 Exclusion rationale (recorded so these are not revisited) — **DECIDED**

| Candidate | Exclusion reason | Source |
|---|---|---|
| DeepSeek-OCR(-2) | Indic catastrophic: median CER 100%, 89% repetition loops on real Devanagari prints; no CPU benchmark | arXiv:2606.29213 [KB, doc/14 §3] |
| surya / marker | Weights **OpenRAIL-M** with a <$5M-revenue commercial clause — procurement risk for a hospital product; no x86-CPU latency published (only Apple-Silicon) | [KB, doc/13 §3.2, doc/14] |
| HunyuanOCR-1.5 | Tencent community license (territorial, AUP-bound), **not OSI**; no CPU latency | [KB, doc/14 §3] |
| GraniteDocling-258M | English-only (no Devanagari); CPU reports minutes/page | [KB, doc/14 §2] |
| Qwen3-VL-8B (local) | CPU 69.4 s/img + 10.8 GiB RAM | arXiv:2509.03615 [KB, doc/14 §2] |
| dots.ocr / MonkeyOCR / MinerU2.5 / olmOCR / Unlimited-OCR / GLM-OCR | GPU-first, no credible CPU benchmark | [KB, doc/14 §3] |
| Cloud OCR (Google Document AI etc.) | Offline + residency + ~$3,600/mo at volume | [KB, doc/13 §5] |

**Exclusion rule (DECIDED):** a candidate may only be re-opened if (a) a maintainer publishes
x86-CPU latency+RAM **and** (b) it has Indic script support validated on real Indic scans.
`[uncertain]`: these exclusions rest on evidence collected 2026-09-11 and earlier; re-verify
before any re-opening.

---

## B-C. B8 — ABDM sync design (the largest Module B gap)

B8 is not implemented (`module-b/README.md:47`; doc/19 §4). This section designs it. No code.

### B-C.1 Ownership boundaries — **DECIDED**

| Tier | Owns |
|---|---|
| **Kiosk** | Capture, OCR, structuring, verify flagging, **encrypted transient queue**. No HAPI/Java. No ABDM credentials. |
| **Hospital edge node** | FHIR validation (HAPI/matchbox), queue drain, ABDM API calls under **hospital HFR/HIP keys**, retry/backoff, dead-letter, audit trail. Holds validated FHIR + audit (T2). |
| **Hospital HIP / HIS** | System of record; owns the care-context and the ABHA linkage; consent artefact copy of record. |
| **Vendor ops (Zone C)** | **No PHI.** Aggregate health/latency metrics only. |

Rationale: matches doc/19 §3 topology and doc/16 §2 HIP posture (hospital = HIP; kiosk = part of
the hospital's ABDM-compliant software). This also means Module B never talks to ABDM directly.

### B-C.2 Queue schema and semantics — **DECIDED**

One queue item per emission, in SQLCipher on the kiosk, drained by the edge node:

```
queue_item {
  item_id            # ULID/uuid, kiosk-generated
  session_id         # doc/19 §5: D<date>-<token>-<HFR-ID>, no PHI
  idempotency_key    # sha256(session_id + artifact_kind + content_hash)  <-- dedupe key
  content_hash       # sha256 of the canonical emission payload
  artifact_kind      # health_document_record | prescription_record | diagnostic_report_record
  ig_version         # pinned NRCeS IG version, recorded in the bundle (doc/19 §10)
  emitter_version
  consent_ref        # consent artefact id under which this push is made (B-C.5)
  payload_path       # encrypted blob ref (not the bundle inline)
  state              # queued | inflight | acked | failed | dead_letter
  attempts, next_attempt_at, backoff_secs
  created_at, last_error, acked_at
}
```

- **Idempotency:** `idempotency_key` is sent with the ABDM request; the edge node also dedupes
  on it before send. Replays after LAN loss are safe (doc/19 §8 "duplicate delivery").
- **Retry/backoff:** exponential with jitter, capped (e.g. 1 s → 2 → 4 … cap 15 min), max
  attempts then → `dead_letter`. Retryable = network/5xx/429; non-retryable = 4xx validation
  errors → dead-letter immediately.
- **Ack semantics:** `acked` only on a positive ABDM/HIE-CM acknowledgement. Local write is not
  an ack.
- **Dead-letter:** retained encrypted with the error; surfaced in ops; a human can re-drive after
  fixing the cause. Never silently dropped (invariant 7: never block care, but also never lose).
- **Ordering:** monotonic per `session_id`; server-side reconciliation on clock skew (doc/19 §8).

### B-C.3 Artifact mapping per document type + author/attester — **DECIDED (M2)**

Machine-verified profile facts `[verified 2026-09-16, NRCeS IG v6.5.0 HealthDocumentRecord]`:
`Composition.attester` is **0..\*** (must-support; `mode` 1..1 required;
`personal|professional|legal|official`); `Composition.author` is **1..\***;
`Composition.type` is fixed to SNOMED `419891008` "Record artifact";
`Composition.section.entry` is **1..\*** and references **DocumentReference** only.
This confirms the KB's earlier attester finding and constrains what HealthDocumentRecord can
carry.

| Source document | M2 emission | Author | Attester |
|---|---|---|---|
| Patient-carried prescription scan (raw) | **HealthDocumentRecord** (type SNOMED 419891008) wrapping **DocumentReference** (raw image) | Hospital Organization (HFR) | none until physician attestation |
| Patient-carried lab report scan (raw) | **HealthDocumentRecord** → DocumentReference (raw image) | Hospital Organization | none until attested |
| Discharge summary scan | **HealthDocumentRecord** → DocumentReference | Hospital Organization | none |
| Advice/referral note | **HealthDocumentRecord** → DocumentReference | Hospital Organization | none |
| Structured extraction (meds/labs/dx) | **Held edge-local** for the physician review UI in M2 | — | — |
| Structured meds, after physician attestation | **PrescriptionRecord**, authored by the hospital practitioner `[DEFERRED to M3]` | Practitioner (hospital) | physician, `mode=professional` |
| Structured labs, after attestation | **DiagnosticReportRecord** `[DEFERRED to M3]` | hospital lab/practitioner | physician |

**Rationale for DEFERRING structured-record push:** emitting a `PrescriptionRecord` authored by
the kiosk would assert a clinician authored a prescription the kiosk merely read. The honest M2
shape is the raw scan (a Record artifact) plus a machine-generated extraction document as an
additional `DocumentReference`; structured FHIR resources are pushed only under attested,
hospital-authored records (M3). This is the "emit only data-backed sections / never invent
authorship" posture from doc/19 §4.

**DECIDED (M2):** DocumentReference may carry an `attachment.data` base64 payload (per doc/13
§1 the DocumentReference profile makes `attachment.data` must-support 1..1), but raw-image
persistence remains DPDP-transient by default; persist only on explicit patient choice or
policy. `[uncertain]`: the exact `contentType` list on the profile was not re-enumerated this
session; confirm before implementation.

### B-C.4 Store-and-forward across failures — **DECIDED**

| Failure | Behaviour |
|---|---|
| Kiosk↔edge LAN loss | Kiosk keeps processing and queuing offline; drains on reconnect. |
| Edge node outage | Kiosks continue capture; queue persists encrypted; drain later (doc/19 §8). |
| ABDM gateway outage | Items stay `queued`/`failed`, backoff; no data loss; ops alert on backlog depth. |
| Validation failure | Item → `dead_letter` with validator errors; **never auto-mutate** to make it pass; surfaced for human correction. |
| Power loss mid-drain | SQLCipher WAL recovery; `inflight` items re-driven; idempotency prevents duplicates. |

### B-C.5 Erasure semantics (`dataEraseAt`) — **DECIDED (framework), `[uncertain]` on ABDM wording**

`dataEraseAt` is a field of the consent request `permission` object; the consent artefact also
carries `hiTypes`, `dateRange`, `accessMode`, and `frequency`
`[verified 2026-09-16, ABDM sandbox consent docs]`. The ABDM consent framework requires the HIP
to **save a copy of the consent artefact** on GRANTED/REVOKED/EXPIRED notification and to
**track expiry** — "any data request on an expired consent artefact must not be done"
`[verified 2026-09-16, community ABDM docs mirror]`.

**Design decision:**
- **Kiosk T1:** queue item + transient canon deleted on sync + session end; crypto-erase (destroy
  key) on session terminate. `dataEraseAt` does not apply to T1 (already gone).
- **Edge T2:** store the consent artefact copy and its `dataEraseAt`; at that instant, erase the
  **HIU-side copy** fetched under that consent (crypto-erase) and mark the artefact expired. The
  hospital's own record (T3, the system of record) is **not** erased by `dataEraseAt` — it is the
  provider's legal record.
- **Meaning of "deleted":** crypto-erasure (key destruction) is the mechanism at every tier;
  log the erasure event; audit log is retained (consent-manager standard, doc/19 §6).
- `[uncertain]` — **needs confirmation:** the precise ABDM definition of what `dataEraseAt`
  obliges *for a HIP that is also the originator* (vs an HIU holding a fetched copy). Confirm
  with NHA/NRCeS before locking Module D/B erasure code. This does not block the M2 raw-scan
  push design.

### B-C.6 Where validation happens, and on failure — **DECIDED**

- **Validator:** **HAPI FHIR or matchbox with the `ndhm.in` IG package** — not `fhir.resources`
  (it is a model library; from v7 it has no R4 sub-package and cannot be the R4 profile
  validator — doc/19 §4/§10).
- **Package is real and installable:** `ndhm.in` publishes on the FHIR package registry
  (`registry.fhir.org/package/ndhm.in|3.0.1`; current release `6.5.0`; preview `7.0.0`)
  `[verified 2026-09-16]`.
- **Where:** edge node (Java/HAPI), never the thin kiosk.
- **On failure:** quarantine to `dead_letter`, expose validator messages to ops; **no silent
  auto-fix**, no invented codes; a human (or a deterministic remap the team signs off) corrects
  and re-drives. The current `fhir.resources` R4B validation in `fhir_emitter.py:167-175` is a
  structural smoke check only and is explicitly not profile validation (`module-b/README.md:45`).

### B-C.7 B8 implementation boundary (for the eventual build) — **DECIDED**

B8 = edge-side: consent-artefact store + `dataEraseAt` clock + queue drainer + HAPI-matchbox
validator + ABDM client under hospital keys + idempotency + DLQ + audit. Kiosk-side: queue
writer + idempotency key + content hash only. This split preserves the "kiosk runs alone" rule.

---

## B-D. Lab and diagnostic coding bindings (still unresolved)

### B-D.1 What the NRCeS profiles actually bind — **DECIDED (by primary source)**

From the NRCeS IG `[verified 2026-09-16]`:

- **`DiagnosticReportLab`**: `DiagnosticReport.code` is **1..1**, binding
  `LOINCDiagnosticReportCodes` (**preferred**) — the report/panel name; `DiagnosticReport.result`
  is **1..\*** (Observation references); `conclusionCode` 0..\* example-bound to
  SNOMEDCTClinicalFindings.
- **`Observation` (lab)**: `Observation.code` is **1..1**, binding `LOINCCodes` (**example**);
  and the profile slices `Observation.code.coding` **closed by system**, with
  `system` fixed to `http://loinc.org` — i.e. **lab observation codes are LOINC**.
- NRCeS publishes a **"Guide for using LOINC in ABDM FHIR Resources"** PDF
  (`nrces.in/download/files/pdf/Guide for using LOINC in ABDM FHIR Resources.pdf`)
  `[verified 2026-09-16, listed on nrces.in/resources]`.

### B-D.2 LOINC vs NRCeS lab value sets — **DECIDED**

NRCeS now publishes **Common Lab Codes for India (CLCI)**: "a curated subset of LOINC
representing the most commonly performed laboratory tests and measurements in India ... a
suggestive mapping between commonly used Indian laboratory test names and internationally
recognized LOINC codes." Distributed as a single CSV `common_lab_codes_for_india.csv` with four
fields — **General Name, LOINC Code, FSN, Long Common Name** — and the current release includes
**1,473** tests `[verified 2026-09-16, nrces.in/faqs + nrces.in/services/national-releases]`.
CLCI was developed with the voluntary LOINC India Working Group and launched alongside the
Bharat Health Terminology Service (BHTS) `[verified 2026-09-16, NRCeS news + press]`.

**Binding decision:** the structurer's lab dictionary is **CLCI-first** (map the Indian test
name via the CLCI "General Name" column to its LOINC code), then fall back to the broader LOINC
release for tests outside CLCI. Emit the resolved LOINC coding on `Observation.code`; if a test
cannot be mapped, emit `code.text` only (never invent a code) and flag for review. CLCI is
"suggestive", so unmapped/ambiguous names keep the free-text path (doc/17 M2 "never block").

**License/process:** LOINC is a licensed standard of the Regenstrief Institute; CLCI inherits
LOINC terms, and the CLCI package license must be read and observed. `[uncertain]` — the exact
LOINC redistribution terms for bundling codes inside a commercial kiosk were **not** fetched
this session; confirm with NRCeS/Regenstrief before shipping. Not a build blocker; a release
gate.

### B-D.3 SNOMED CT / CDCI medication path — **DECIDED (path), process pending**

- **Value set:** `ndhm-medicine-codes` "covers: Clinical Drugs from SNOMED CT International
  Edition, Clinical Drugs and Branded Medicines (Real Clinical Drugs) from **Common Drug Codes
  for India (National Extension)**" `[verified 2026-09-16, nrces.in ValueSet pages]`.
- **CDCI is real and distributed two ways** `[verified 2026-09-16, nrces.in/services/
  national-releases]`:
  1. **Terminology Integrated Package** — integrates with SNOMED CT, delivered as the **India
     Drug Extension for SNOMED CT** via **MLDS** (latest release 2026-08-31).
  2. **Flat Files Package** — TSV files usable **without** the full terminology, under the terms
     in its bundled `License.txt` (Substance 27,499; Generic 9,051; Brand 71,302; Product Name
     52,202; Supplier 6,383; Drug Form 416 per the 2024 release notes `[KB/verified 2026-09-16]`).
- **Decision:** for v1, use the **CDCI Flat Files Package** as the drug dictionary bundled into
  the image (no full SNOMED integration required to map a drug name→CDCI code), and also
  register for the **Terminology Integrated Package via MLDS** because the ABDM value set expects
  SNOMED-coded clinical drugs. Med-name normalization (medspaCy, `structurer.py` rules) maps
  extracted strings to CDCI/SNOMED entries; unmapped → free-text + verify.
- **MLDS obligations (from NRCeS FAQ / doc/16 §3):** Affiliate License registration at
  `mlds.ihtsdotools.org/#/landing/IN`; free for use **within India**; the software must be
  **sublicensed to end users**; **usage reporting** per the declared period; deployment outside
  India needs a separate International Affiliate License. Budget: zero rupees; process: register
  before shipping.
- **New asset found:** **India AYUSH Extension** for SNOMED CT (release 2026-06-29) and the
  **Drug Information Service Bundle (DISB v1.25)** `[verified 2026-09-16, nrces.in]` — DISB may
  be useful for structured drug info; AYUSH Extension is relevant to the AYUSH/AYUSH-coded
  content roadmap (Module A/C), note for later.

---

## B-E. Physician review workflow (B7 is a JSON payload with no UI)

Today B7 emits `physician_review.json` from `pipeline.py:139-141` with per-field
`{field, value, confidence, verify, reason, bbox}` (`confidence.py:21-26`). No UI exists.

### B-E.1 Review surface — **DECIDED**

- **Left pane:** the page image with **overlaid bounding boxes**; a box's colour encodes state
  (`verify` = amber, clean = neutral, conflicted = red). Every field the machine produced is
  clickable and maps to its box (`bbox` already carried).
- **Right pane:** the structured list (meds / labs / diagnoses), each row showing the raw string,
  the normalized value, confidence, and **why** it is flagged (`reason` from the gate: low
  confidence, handwriting verify-default, or engine disagreement).
- **Header:** page type, engine(s) used, watchdog ladder traversed (`ladder`), and a page-level
  banner if the page is verify-default.
- **Actions per field:** *Confirm*, *Correct* (edit + mandatory reason), *Reject* (drop from the
  canon, keep the original in the audit trail), and *Mark unreadable* (→ manual-entry). A
  **page-level attest** button is enabled only when no unresolved `verify` field remains.

### B-E.2 What "correct"/"reject" do to the canon and the bundle — **DECIDED**

- **Correct** writes a new canon value with `state=corrected_by_clinician`,
  `by=clinician:<id>`, and a link to the machine's original value. The **machine uncertainty is
  never cleared by the edit itself** — the field's provenance retains the original
  low-confidence/disagreement record (invariant 4). The flag resolves because a *clinician*
  addressed it, not because the string changed.
- **Reject** removes the field from the rendered/emitted set but keeps an audit record of the
  rejected machine value and the reason.
- **Patient edits vs clinician edits are different classes.** Patient corrections (the existing
  correction loop in the demo) mark `needs_review` and **can never** clear a machine
  verify-flag (invariant 4). Only a clinician attestation flips a field/bundle to attested.
- **Emission effect:** only after page-level physician attestation does B6 emit an attested
  artifact (and, per B-C.3, only then can a `PrescriptionRecord`/`DiagnosticReportRecord` be
  authored by the hospital). Until then the bundle is `preliminary`.

**Known defect to fix during the build (found this session, no code changed):**
`fhir_emitter.build_bundle` reads `verify.get("any_verify")` (`fhir_emitter.py:47,72`) but the
pipeline's merged dict stores the value as a top-level `any_verify` sibling of `verify`
(`pipeline.py:118-121`). Result: the Composition/DocumentReference status is effectively always
`final`, defeating the preliminary/attested distinction and, by extension, the attestation gate
for Module B. This must be fixed and covered by a test before B8/ABDM work, because the ABDM
push must never send an unattested record as `final`.

### B-E.3 Audit trail — **DECIDED**

Append-only, per field:

```
correction_event {
  event_id, session_id, artifact_id, field_id,
  action        # confirm | correct | reject | mark_unreadable | attest
  actor         # clinician:<id> | patient:<session> | system
  before        # machine value + confidence + gate reason + bbox
  after         # new value (or null)
  reason        # required for correct/reject
  at            # timestamp
  prev_hash, hash   # chained for tamper-evidence
}
```

Retention: 7-year immutable audit per doc/19 §6, shipped off-box, no PHI in vendor logs
(test-enforced). Corrections feed back into the eval stream as clinically-adjudicated labels —
useful, but **only with the appropriate consent** for secondary use.

---

## B-F. Model and image operations

### B-F.1 Model vendoring plan — **DECIDED**

RapidOCR downloads models from **ModelScope** by default (`model_dir` URLs such as
`https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/onnx/PP-OCRv5/rec/devanagari_PP-OCRv5_rec_mobile.onnx`)
and RapidOCR has official offline support `[verified 2026-09-16, RapidOCR default_models.yaml +
offline-model docs]`:

1. **Build-time prefetch, not runtime download.** Use `rapidocr download_models --config
   config.yaml` (added in `rapidocr>=3.7.0`; default config added in `>=3.8.2`) to pull the exact
   configured models into `rapidocr/models/` during image build
   `[verified 2026-09-16, RapidOCR usage docs]`.
2. **Pin by hash.** RapidOCR's `default_models.yaml` pins SHA-256 per file; record the hashes
   for `devanagari_PP-OCRv5_rec_mobile` + the det model + any cls model in the repo, and verify
   at build time.
3. **Force local paths.** In production, pass explicit local paths
   (`Det.model_path`, `Rec.model_path` / `Rec.model_dir`, `Rec.rec_keys_path`) so no code path
   can reach the network `[verified 2026-09-16, offline-model docs]`.
4. **Runtime network is a build-time test:** the CI image check must run the pipeline with
   outbound network disabled (fail the build if any download is attempted).
5. **India-downloadability `[uncertain]`:** ModelScope is a China-hosted CDN; no evidence of
   India blocking was found this session, and the mirrors are not official. Mitigations: do the
   prefetch at build time on a machine that can reach ModelScope; if that is ever blocked, the
   upstream Devanagari weights are published by PaddleOCR on HuggingFace
   (`PaddlePaddle/devanagari_PP-OCRv5_mobile_rec` `[verified 2026-09-16]`) and can be converted
   to ONNX. A third-party HF mirror of RapidOCR files exists (`watts-ai/RapidOCR`) but only for
   Latin torch files — **do not rely on it** `[verified 2026-09-16]`.

### B-F.2 Licence and version pinning — **DECIDED (process)**

- Pin `rapidocr` to an exact version after the B-B.2 benchmark; floor `>=3.5.0` for Devanagari
  PP-OCRv5 support `[verified 2026-09-16, RapidOCR model list]`. Note the default-model change:
  `>=3.9.0` defaults to PP-OCRv6 (non-Devanagari), so **explicit model config is mandatory** at
  any version `[verified 2026-09-16, usage docs]`.
- Pin `onnxruntime` (or `openvino`) to an exact version for reproducibility.
- Record licences in an SBOM: `rapidocr` Apache-2.0; PP-OCR weights Apache-2.0 (PaddleOCR);
  Tesseract + `tessdata` Apache-2.0; `fhir.resources` BSD-3; HAPI/matchbox Apache-2.0; CDCI
  Flat Files under its `License.txt`; LOINC/CLCI under Regenstrief/NRCeS terms.
- **Release gate:** no dependency or licence change ships without re-running the eval harness
  (doc/19 §12 model/IG change control).

### B-F.3 Upload quality policy — **DECIDED**

| Input | Behaviour |
|---|---|
| Undecodable / corrupt file | Reject with a plain-language message; **never** fake extraction; do not queue. |
| Very dark / blank photo | Detect (mean luminance / contrast); prompt retake; allow "continue without scan". |
| HEIC | Convert to RGB at intake (Pillow + a HEIC decoder) or reject with a retake prompt if no decoder is bundled; `[uncertain]` decoder choice/licence to be pinned. |
| Oversized scan | Downscale to ≤2200 px on the long edge (already in `intake.py:71-73`) to bound CPU. |
| Skew / glare | Deskew is an M1 item (`intake.py:77` notes it is not done); phase-1 tolerant, phase-2 PP-DocLayout-based. |
| Unsupported PDF | Flatten/rasterize to images at a bounded DPI, else reject. |
| Sensitive filename | Keep the existing masking (demo verified: `s•••-scan.png`); it is a **display** policy only — the raw name is never rendered to the screen. **DECIDED:** retain the feature but treat it as UX hygiene, not a security control. |

**Invariant:** a failed upload never blocks the patient and never produces a fabricated field
(Module B's version of doc/19 invariant 7).

### B-F.4 Multi-document session semantics — **DECIDED**

- **One session = one `session_id`** (`D<date>-<token>-<HFR-ID>`, no PHI) spanning all pages
  (doc/19 §5).
- **Ordering:** pages ordered by capture sequence (monotonic), not by document date (document
  dates are frequently absent/unreadable — never invent one; the KB's "date not on document"
  honesty rule from Module C applies here).
- **Merge:** merge structured lists across pages (existing `pipeline.run` does this at
  `pipeline.py:112-121`), with **per-item provenance** (which page/bbox each item came from) so
  the review UI can show the source.
- **Conflicts:** if two pages disagree (e.g. two different doses for the same drug), **retain
  both** + a review flag — never silently resolve (invariant 3; the Module C merger already
  follows this pattern and Module B must match it).
- **Page-class conflicts:** a single session may mix prescriptions and lab reports; route each
  page independently and emit the per-type artifacts from B-C.3.
- **Deduplication:** identical med lines across pages within a session dedupe on
  normalized(name+dose+freq); differing values are kept as a conflict.

---

## Appendix A — Every threshold in `medib/config.py`, and its derivation

Current values are placeholders (`config.py:1-2`). None is validated. Target state after M0:

| Config field | Current (placeholder) | Derivation method | Blocker |
|---|---|---|---|
| `handwriting_if_avg_line_conf_below` | 0.55 | On M0 GT page labels, choose the avg-line-conf operating point maximising Youden's J (or F1) for handwritten vs printed | M0 |
| `table_if_col_alignment_score_above` | 0.60 | On M0 lab-vs-prose pages, pick the column-alignment threshold at max F1 | M0 |
| `field_conf_threshold` | 0.80 | Calibration curve P(correct \| conf ≥ t); choose t so auto-accepted fields meet the team's target precision (proposed ≥0.95), trading physician workload | M0 |
| `vote_bonus_agree` | 0.15 | From M0 dual-engine subset: set bonus so P(correct \| agree) is separable; fit, don't guess | M0 |
| `vote_penalty_disagree` | 0.25 | Same subset: set penalty so disagreement reliably routes to verify | M0 |
| `fallback_on` | `engine_error, low_field_confidence, empty_result` | `low_field_confidence` uses `field_conf_threshold`; trigger list is DECIDED, the numeric trigger is M0 | partly M0 |
| `ocr_lang` | `hi` | **DECIDED** — Devanagari PP-OCRv5 mobile (reads Latin/digits too) | — |
| `tesseract_langs` | `hin+eng` | **DECIDED** | — |
| `persist_raw_scan_default` | `False` | **DECIDED** — DPDP transient-by-default (doc/19 §0 inv.5) | — |
| `llm_url` / `llm_model` | `None` / `qwen3` | **DECIDED** — rules engine is the default; LLM adapter is phase-2 and must keep temperature 0 + schema + evidence-spans | — |

**Rule:** no placeholder number may ship. Each numeric threshold must cite the M0 run and the
derivation above, and be clinician/team signed (doc/19 D8).

## Appendix B — Evidence register (fetched 2026-09-16 unless noted)

- NRCeS IG v6.5.0 `HealthDocumentRecord` (type fixed SNOMED 419891008; author 1..*; attester
  0..*; section.entry 1..* DocumentReference) — `nrces.in/ndhm/fhir/r4/6.5.0/StructureDefinition-HealthDocumentRecord.html`.
- NRCeS `DiagnosticReportLab` (DiagnosticReport.code 1..1 LOINCDiagnosticReportCodes preferred;
  result 1..*) and `Observation` (code 1..1 LOINCCodes example; coding sliced closed by system
  `http://loinc.org`) — `nrces.in/ndhm/fhir/r4/.../StructureDefinition-DiagnosticReportLab.html`.
- NRCeS Resources / National Releases — CLCI (LOINC subset), CDCI (Integrated via MLDS + Flat
  Files under License.txt), India AYUSH Extension, DISB, LOINC guide — `nrces.in/resources`,
  `nrces.in/services/national-releases`.
- NRCeS FAQ — CLCI CSV fields, 1,473 tests, released with BHTS — `nrces.in/faqs`,
  `nrces.in/news`.
- `ndhm.in` package registry — `registry.fhir.org/package/ndhm.in|3.0.1`; release 6.5.0;
  preview 7.0.0 (QA generated 2026-02-13) — `nrces.in/preview/ndhm/fhir/r4/downloads.html`,
  `nrces.in/ndhm/fhir/r4/qa.html`.
- RapidOCR — model list (Devanagari PP-OCRv5 mobile from `>=3.5.0`), usage (default PP-OCRv6
  from 3.9.0; `elapse_list` per-stage timing; `download_models` from 3.7.0), offline-model docs
  (`model_path`/`model_dir`/`rec_keys_path`), default_models.yaml (ModelScope URLs, SHA-256) —
  `rapidai.github.io/RapidOCRDocs/...`, `github.com/RapidAI/RapidOCR`, PyPI (latest 3.9.2).
- RapidOCR issue #514 (2025-07-24) + discussion #515; thread #669 (2026-05) —
  `github.com/RapidAI/RapidOCR/issues/514`.
- Devanagari weights on HF — `huggingface.co/PaddlePaddle/devanagari_PP-OCRv5_mobile_rec`.
- MIRAGE public subset — `huggingface.co/datasets/chaithanyakota/100-handwritten-medical-records`
  (100 records, ~38.6 MB, **cc-by-nd-4.0**); MIRAGE paper arXiv:2410.09729v2.
- ABDM consent artefact (`permission.dataEraseAt`, `hiTypes`, GRANTED/REVOKED/EXPIRED; HIP must
  store the artefact and track expiry) — `kiranma72.github.io/abdm-docs/3-milestone2/
  understanding-consents/`.
- DPDP Rules 2025 notified **14 November 2025** (PIB press release 14 Nov 2025; MeitY published
  14.11.2025; corrigendum 16.12.2025; ~18-month compliance runway) — `pib.gov.in/PressReleasePage.aspx?PRID=2190014`,
  `meity.gov.in` — resolves the KB's 13-vs-14 Nov conflict in favour of **14 Nov 2025**.

## Appendix C — What this doc did NOT resolve

- Exact M0 site list and ethics-committee SOPs (team/partner).
- `[uncertain]` ABDM `dataEraseAt` obligation for a HIP that is the originator (B-C.5).
- `[uncertain]` LOINC/CLCI redistribution terms for a commercial kiosk (B-D.2).
- `[uncertain]` NRCeS DocumentReference `contentType` set (B-C.3).
- `[uncertain]` HEIC decoder choice/licence (B-F.3).
- The numeric threshold values themselves — all BLOCKED-M0 (Appendix A).

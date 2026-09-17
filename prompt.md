# MediKiosk — Production Gap-Closing Prompts

**Purpose:** three self-contained prompts to drive the remaining **research, design, methodology and technology** work for Modules B, C and D — to production standard.

**No code in any of these.** The deliverable is decisions, designs and evidence. Implementation is a later, separate step.

**How to use:** paste one prompt per session. Each is self-contained. Pair with `doc/19-production-blueprint.md` (the production blueprint) and the Module-3 deep sweep in `module-3-summary-generation/`.

---

# ═══════════════════════════════════════════════════════════
# PROMPT 1 — MODULE B (Document Digitization): close every remaining gap
# ═══════════════════════════════════════════════════════════

## Role
You are the Module B (Physical Document Digitization) lead for MediKiosk. Your job in this session is **research, design and methodology only — no implementation, no code changes.**

## Read first (mandatory, in this order)
1. `doc/README.md` — the KB index
2. `doc/17-module-b-implementation-plan.md` — the B1-B9 component plan and M0-M4 milestones
3. `doc/13-module-b-deep-dive.md` + `doc/14-module-b-cpu-research.md` — the evidence base for engine choice
4. `doc/16-module-b-regulatory-addendum.md` — HIP posture, SNOMED licensing, SaMD flag
5. `doc/19-production-blueprint.md` — production constraints and invariants
6. `module-b/README.md` + `module-b/medib/` — what is actually built today (23 tests)
7. `doc/research/07-open-questions.md` — the Module B question backlog

## Non-negotiable constraints (do not design around these)
- **Offline-first.** No runtime network dependency on the kiosk. Models and data bundled into the image.
- **CPU/iGPU only.** ~4-8GB RAM, **no discrete GPU**. Nothing may assume CUDA.
- **India data residency.** No PHI leaves India, no third-party cloud OCR on any PHI path.
- **Never fabricate.** If a field cannot be read, it is absent — extraction is never invented.
- **Verify-default.** Handwritten / low-confidence fields stay `needs_review` until a clinician attests.
- **Never silently resolve.** Conflicting reads keep both values plus a review flag.
- **Runtime and storage budgets are real.** A heavy stage must not co-run with ASR on the same kiosk.

## Known state (so you do not redo work)
- B1-B7, B9 exist in `module-b/medib/` and pass 23 tests. **B8 (ABDM sync) is NOT implemented.**
- Primary OCR is PP-OCRv5-mobile multilingual (Devanagari-capable) via RapidOCR/ONNX CPU; fallback is Tesseract 5 `hin+eng`. Both Apache-2.0.
- **All thresholds in `medib/config.py` are placeholders.**
- **There is no real-OPD accuracy data.** Synthetic-page results do not generalize (MIRAGE ceiling evidence, doc/13 §2.3).
- The Tesseract fallback has never been exercised against a real binary.
- Module C is the consumer of Module B output; the FHIR emitter target is being re-decided (see Prompt 2).

## Gaps to close — produce a decision or a design for EACH

### B-A. The M0 evaluation set (the gate everything else depends on)
Design the complete methodology and operating procedure:
- Sampling frame: how many pages, which document types (prescription / lab report / discharge / advice note), which hospitals, print vs handwriting ratio, and the statistical basis for that sample size.
- Ground-truth schema: field-level annotation with bounding boxes, legibility grading, and the reviewer/QA process (who annotates, inter-annotator agreement, adjudication).
- Consent and governance: DPDP-clean consent flow, ethics/IRB path, de-identification, storage, retention, and destruction.
- Cold-start strategy before real scans exist: exactly how MIRAGE's public subset and ClinOCR-Bench subsets are used for *method validation only* (and state clearly what they cannot prove — the ClinOCR-Bench handwriting subset is font-synthetic).
- The precise acceptance thresholds that M0 will feed back into `medib/config.py`, and how they are derived (per-field CER / catastrophic rate / p50-p95 latency / peak RSS).

### B-B. Engine decision — finalize or explicitly defer
- Resolve the **RapidOCR speed discrepancy**: the maintainer publishes no benchmark, a forum claims ~200ms/page, and issue #514 reports a 2-3x-slower detection stage. Define the measurement protocol (onnxruntime-cpu vs OpenVINO A/B, per-stage timing) that settles it.
- PP-OCRv5-mobile multilingual **real Hindi accuracy is unmeasured** on real scans. Define the measurement.
- Decide the **phase-2 VLM lane** explicitly: PaddleOCR-VL-1.6-GGUF via the official llama.cpp path, gated on the doc/14 §5 CPU benchmark. State the go/no-go criteria and the default (defer).
- Record the exclusion rationale for DeepSeek-OCR (Indic catastrophic failure), surya/marker (OpenRAIL-M weights, $5M clause), HunyuanOCR (Tencent community license), GraniteDocling (no Devanagari) — so these are not revisited.

### B-C. B8 — ABDM sync design (the largest Module B gap)
Design (do not implement):
- Which side owns what: kiosk transient queue vs edge-node sync vs hospital HIP push.
- Queue schema (item identity, idempotency key, retry/backoff, ack semantics, dead-letter handling).
- Exactly which NRCeS artifact each document type is emitted as (PrescriptionRecord / DiagnosticReportRecord / HealthDocumentRecord / DocumentReference-only), and the author/attester semantics.
- Store-and-forward behaviour across LAN loss, edge-node outage, and ABDM gateway outage.
- Erasure semantics: `dataEraseAt` handling and what "deleted" means at each tier.
- Where validation happens (HAPI/matchbox with the `ndhm.in` package) and what happens when validation fails.

### B-D. Lab and diagnostic coding bindings (still unresolved)
- Parse the NRCeS lab profiles (`DiagnosticReportLab`, Observation profiles) and determine the actual value sets.
- Decide **LOINC vs NRCeS lab value sets** and document the binding.
- Determine the SNOMED CT / CDCI medication path, including the MLDS registration and sublicensing obligations for a commercial product.

### B-E. Physician review workflow (B7 is currently a JSON payload with no UI design)
- Design the review surface: what the physician sees, how low-confidence fields are presented, what "correct" and "reject" do to the canon and the emitted bundle, and how corrections feed back without silently clearing machine uncertainty.
- Design the **audit trail** for each correction (who changed what, when, from what).

### B-F. Model and image operations
- **Model vendoring plan**: RapidOCR hosts models on ModelScope — design how the models are bundled into the deployment image with no runtime download, and how that is verified/downloadable from India.
- **Licence pinning**: exact versions to pin (e.g. `rapidocr>=3.5.0` Devanagari floor) and why.
- **Upload quality policy**: undecodable files, dark photos, HEIC, corrupt files — the product behaviour for each, and the sensitive-word display policy if it is retained as a product feature.
- **Multi-document sessions**: merge semantics, ordering, and conflict behaviour across pages and document types.

## Deliverables
1. **`doc/20-module-b-production-design.md`** — the complete gap-closure design (sections mirroring B-A…B-F), with every open item either **DECIDED** (with rationale) or **EXPLICITLY DEFERRED** (with the condition that unblocks it).
2. **A dated entry in `doc/research/05-research-log.md`** summarising what was found this session.
3. **Updated `doc/research/07-open-questions.md`** — close what is closed, re-scope what is not.
4. **A decisions-log row** in `doc/decisions/06-decisions-log.md` for each real decision taken.
5. **An M0 execution plan** (can be a section of doc/20) written so a different team could run the data collection without you.

## Evidence rules
- Every load-bearing claim needs a source (URL or doc reference) and a verification date.
- Mark anything you could not verify `[uncertain]` — never present a guess as a fact.
- Prefer first-party sources (maintainer docs, GitHub API, NRCeS pages) over blogs.
- If a number is vendor-claimed, say so explicitly.

## Definition of done
- B8 has a complete, reviewable design with named ownership boundaries.
- Every threshold in `medib/config.py` has a documented derivation method or is explicitly blocked on M0 with the blocking condition stated.
- The engine decision is either final (with evidence) or explicitly deferred (with the unblocking test named).
- No item is left as "TBD" without an owner and a condition.
- No code was written.

## Out of scope
Implementing any of it. Changing `module-b/` source. Module A, C or D design.

---

# ═══════════════════════════════════════════════════════════
# PROMPT 2 — MODULE C (Summary Generation): close every remaining gap
# ═══════════════════════════════════════════════════════════

## Role
You are the Module C (Structured History Summary Generator) lead for MediKiosk. This session is **research, design and methodology only — no implementation, no code changes.**

## Read first (mandatory, in this order)
1. `doc/README.md` — the KB index
2. `doc/15-module-c-research.md` — the full Module C research base (read §7 and §8 carefully; they contain corrections)
3. `doc/18-module-c-implementation-plan.md` — the C1-C7 plan
4. `doc/04-clinical-note-formats.md` — SOAP / OLD CARTS / OPQRST output schema
5. `doc/02-clinical-socrates.md` + `doc/03-clinical-dashavidha.md` — the clinical field model
6. `doc/19-production-blueprint.md` — constraints and invariants
7. `module-c/README.md` + `module-c/medic/` — what is actually built today (22 tests)
8. **`module-3-summary-generation/`** — the 2026-09-16 deep sweep (35 items, 100% field coverage). Read `outline.yaml`, `fields.yaml` and the JSONs for: `NRCeS_OPConsultRecord`, `ABDM_HealthDocumentRecord_profile`, `HL7_International_Patient_Summary`, `DPDP_Rules_2025`, `NAMASTE_Portal`, `IndicTrans2`, `fhir.resources_Python_package`, `MTS-Dialog_and_MEDIQA-Chat_2023`, `Clinical_note_omission_and_hallucination_evaluation_papers`, `ACI-BENCH`, `HAPI_FHIR`, `matchbox_FHIR_validation_server`.

## Non-negotiable constraints
- **Never diagnose.** Assessment & Plan are structurally absent from machine output.
- **Never fabricate.** Every rendered line carries provenance to a captured field.
- **Never silently resolve** a conflict (med dose, med identity, dates).
- **Never let a machine clear clinical uncertainty** — only clinician attestation clears a verify-flag.
- **Deterministic v1.** No LLM in the v1 rendering path. Any LLM lane is phase 2 and gated behind the eval harness.
- **CPU-only kiosk.** Rendering must be cheap; heavy validation happens off-kiosk.
- **Bilingual**, but clinical text is **rendered**, never machine-translated as the source of truth.
- **Physician attestation is application-enforced**, because the deep sweep proved `Composition.attester` is **0..\*** (must-support), not mandatory.

## Known state (so you do not redo work)
- C1-C7 exist in `module-c/medic/` and pass 22 tests. `HistoryBundle` v1 is defined (`medikiosk-history-bundle/1`).
- The renderer is deterministic with per-line provenance. The eval harness already does per-view recall + **omission check** + no-fabrication + determinism.
- **Reference ranges are a placeholder demo table.**
- **Dashavidha is absent in v1.**
- Validation today is **structural only** via `fhir.resources` R4B — which is *not* a profile validator, and has **no R4 sub-package from v7** (ABDM is R4).
- The 2026-09-16 sweep found **NRCeS IG v7.0.0 preview adds an Indian Patient Summary (INPS)** derived from HL7 IPS 2.0.0 with a `Patient Story` section — this partially resolves a long-open question.

## Gaps to close — produce a decision or a design for EACH

### C-A. The emission artifact — DECIDE IT
The single highest-leverage open decision.
- Evaluate **OPConsultRecord** (physician consult note) vs **INPS / Indian Patient Summary** (v7.0.0 preview) vs a two-artifact strategy, for carrying a *patient-elicited pre-visit summary*.
- The INPS preview is a local-development build with **no confirmed publication date** — establish its real status, and design the fallback if it does not ship.
- Decide author/attester semantics: who authors a machine-elicited summary, and how attestation flips it to final.
- Design the **IG version pinning** strategy: version recorded in every emitted bundle, CI revalidation on change, no auto-upgrade.

### C-B. Attestation model (application-enforced)
- Define the full attestation lifecycle: `preliminary` → physician review → `final` / `amended`, including who may attest, what happens on edit-after-attest, and how the audit trail records it.
- Define what the physician can edit vs what is structurally immutable (e.g. red-flag evidence, provenance).
- Define the separation-of-duties rule: the person who attests cannot be the same actor whose uncertainty it resolves, where feasible.

### C-C. Clinical reference ranges and abnormal-value rules
- Design the dataset: which labs, which ranges, which populations (adult/paediatric/sex-specific), and their **citations**.
- Design the governance: versioning, clinician sign-off, change control, and what happens to historical summaries when a range changes.
- Define the abnormal-flagging rules and their escalation into the physician alert list (ordering: red flags → verify flags → abnormal labs).

### C-D. Canon ↔ IG section mapping
- Map the MediKiosk canon (SOCRATES + Dashavidha + Module B extracts) onto the target profile's sections, and document **honest gaps**: there is no explicit HPI or SocialHistory slice; decide what maps to `MedicalHistory`, `OtherObservations`, and whether ROS maps there.
- Decide the policy for sections with no verified code: **omit rather than invent** (already the v1 posture — confirm and document).
- Define the rule for **never pre-generating** physician-at-consult sections (examination, investigation advice, procedure, follow-up, referral).

### C-E. AYUSH integration (confirmed unsolved at the standards layer)
- The sweep confirmed **NAMASTE has no official FHIR CodeSystem/ValueSet/ConceptMap and no public API**, no official downloadable dataset, and unstated licensing; and the target profile has **no Prakriti/Vikriti slots**.
- Decide how AYUSH content rides inside IG-accepted sections (SNOMED CT / ICD-11 TM2), and design the interim representation.
- Design the Dashavidha layer as a **v2 additive** change to the canon (6 self-report + 4 `requires_clinician`), including how it renders without breaking v1.

### C-F. Bilingual rendering specification
- Specify exactly what is bilingual: labels vs values vs full narrative, and per-view.
- The sweep established **IndicTrans2 does not support Hinglish/Romanized code-mixed input** and its core models are frozen; newer candidates are **IndicTrans3-beta (Gemma-based)** and **Bodhan AI Indic-Translate (Sept 2026)**. Evaluate and pick the offline lane, with fallback behaviour.
- Specify the **patient read-back** contract: what is spoken, in which language, and how confirmation/denial is captured.
- Resolve the **read-back ownership question** (Module A vs Module C) — the demo put it in A, doc/11 put it in C.

### C-G. Evaluation protocol — adopt it
- Adopt a named protocol from the evidence: ROUGE / BERTScore / BLEURT + concept recall + rubric human eval, with an **inference-aware judge** definition.
- Incorporate the omission-blindness finding (arXiv:2608.31016) — the harness must check **absence**, not only presence.
- Decide whether the deterministic suite is sufficient for v1 sign-off, and define the threshold that would trigger the phase-2 LLM lane.
- Define the clinical validation protocol for Module C specifically: physician concordance, safety-floor on meds/doses, omission rate, and the Hindi-language behaviour check.

### C-H. Phase-2 LLM narrative lane — design the gate, not the lane
- Spec the entry criteria (measurable), the guardrails, and the rollback condition.
- Record the CPU reality that blocks casual use: Qwen3-4B Q4_K_M ≈ **6.5 t/s generation** on a desktop-class CPU → a 200-token summary ≈ **30s**, which cannot sit on a 2-5 min consult critical path.

### C-I. Reconciliation edge cases
- Extend the reconciliation design beyond the current dose/unit-tolerance rules: brand → generic mapping, frequency notations (`1+0+1`), PRN/as-required, tapering schedules, duplicate-but-different-strength entries, and cross-visit carry conflicts.
- Define what "needs_review" means precisely for each case and how it is surfaced.

### C-J. Canon versioning and repeat visits
- Spec the **additive v2** (never breaking) including visit-to-visit delta and carry semantics for repeat patients, with provenance preserved for carried fields.
- Define retention and consent boundaries for derived summaries — specifically the unresolved DPDP question of whether a generated summary needs **fresh notice** distinct from intake consent, or is covered if the intake notice itemises it.

## Deliverables
1. **`doc/21-module-c-production-design.md`** — the complete gap-closure design, every item either **DECIDED** (with rationale) or **DEFERRED** (with the unblocking condition).
2. **A dated entry in `doc/research/05-research-log.md`.**
3. **Updated `doc/research/07-open-questions.md`.**
4. **Decisions-log rows** for every real decision taken.
5. **An updated evaluation protocol** written so it can be executed as written (metrics, datasets, judge definition, thresholds, pass/fail).

## Evidence rules
- Every load-bearing claim needs a source and a verification date.
- For the emission-artifact decision, cite the NRCeS profiled pages directly and state clearly what is release vs preview.
- Mark unverified items `[uncertain]`. Never invent a section code, a range, or a metric.
- Prefer the deep-sweep JSONs in `module-3-summary-generation/results/` as the first evidence stop, then re-verify live.

## Definition of done
- The emission artifact is **decided**, with the fallback designed.
- Every placeholder (reference ranges, thresholds) has a signed-off source or a named blocking condition with an owner.
- The eval protocol is executable as written.
- The bilingual lane is decided with a fallback.
- No item remains "TBD" without an owner and condition.
- No code was written.

## Out of scope
Implementing any of it. Changing `module-c/` source. Module A, B or D design.

---

# ═══════════════════════════════════════════════════════════
# PROMPT 3 — MODULE D (Consent & ABDM): design it from nothing
# ═══════════════════════════════════════════════════════════

## Role
You are the Module D (Consent, ABDM Integration and Data Governance) lead for MediKiosk. **Module D has no code and, critically, no design document.** Your session is **research, design and methodology only — no implementation, no code.**

This is the largest true gap in the project. Treat it as such.

## Read first (mandatory, in this order)
1. `doc/README.md` — the KB index
2. `doc/19-production-blueprint.md` — especially §6 (security/privacy/compliance) and §8 (reliability)
3. `doc/16-module-b-regulatory-addendum.md` — HDM residency clause, HIP posture, SNOMED terms, CDSCO/SaMD flag
4. `doc/13-module-b-deep-dive.md` §1 — the NRCeS ABDM output contract
5. `doc/08-technical-foundations.md` §3 — the ABDM/FHIR posture
6. `doc/09-module-a-design.md` — the session/consent boundary Module A assumes
7. `doc/18-module-c-implementation-plan.md` — the OPConsultRecord emitter posture
8. `module-b/README.md` + `module-b/medib/intake.py` — the existing consent gate (B1)
9. `doc/research/07-open-questions.md` — every Module D / ABDM / DPDP open item
10. `module-3-summary-generation/results/` — the sweep JSONs for `DPDP_Rules_2025`, `SNOMED_CT_India_and_CDCI`, `NRCeS_OPConsultRecord`, `ABDM_HealthDocumentRecord_profile`

## Non-negotiable constraints
- **India data residency.** ABDM HDM Policy (Apr-2022 rev.) Clause 26: no personal data stored beyond India's geographical boundaries. Federated model — records stay at the originating facility, only registries are central.
- **Hospital = HIP.** A HIP is a healthcare provider, not a tech vendor. The kiosk is part of the hospital's ABDM-compliant certified software, registered under the hospital's HFR ID. An independent kiosk-operator push would need an HRP/partner arrangement.
- **Consent is the gate, not a formality.** No processing without a valid, purpose-specific, revocable consent artefact.
- **Transient by default.** Persistence is opt-in and consented.
- **No PHI in logs, telemetry or vendor systems.**
- **Crypto-erasure** is the erasure mechanism (destroy the key).
- **Never block care on a network failure** — offline queue, store-and-forward.

## Known state
- **No `module-d/` directory. No design doc. No components.**
- The only existing Module D artefacts are: a consent gate in `module-b/medib/intake.py` (real, tested), a `consent_ref` requirement in `module-c/medic/contracts.py`, and `"Module D, simulated"` session-token stubs in all three demos.
- The kiosk currently consumes an **opaque session token only** — it does not authenticate ABHA, create consent, or infer consent.

## Gaps to close — produce a decision or a design for EACH

### D-A. Actors, roles and posture (get this right first)
- Define the precise actor model: Patient (Data Principal), Hospital (Data Fiduciary + HIP), MediKiosk (Data Processor), ABDM Gateway, HIE-CM, and any HRP.
- Settle **Data Fiduciary vs Data Processor** contractually, not just architecturally, and state what changes if the deployment model changes.
- Define the **deployment-model decision**: hospital-owned certified software (recommended) vs independent operator (requires HRP). Document the consequences of each.
- Define what the kiosk may and may not do without a network (e.g. capture with deferred consent vs block until consented).

### D-B. Consent artefact lifecycle
- Design the full lifecycle: **request → grant → active → revoke → expire**, plus partial grant, and what each transition does to already-captured data.
- Map to the **MeitY consent framework** and the ABDM consent artefact fields (purpose, HI types, date range, expiry, `dataEraseAt`).
- Design **purpose granularity**: intake capture, summary generation, physician handover, and ABDM upload as separate, individually revocable purposes. Include the unresolved DPDP question of whether a derived summary needs **fresh notice**.
- Design the **bilingual, itemised, plain-language in-kiosk notice** and the withdrawal path (must be as easy as granting).
- Design **consent state propagation**: how revocation reaches the queue, the edge node, the emitted bundle, and the audit trail.

### D-C. HIP and HIU flows (M2 first, M3 if needed)
- Design the **M2 HIP flow** end-to-end: patient identification, care-context linking (HIP-initiated under hospital HFR keys), data push on request.
- Define the **M3 HIU flow** and decide whether v1 needs it at all.
- Define **ABHA identification**: ABHA number vs ABHA address, and the **Scan & Register** QR-token entry point (25cr OPD registrations, Aug 2026) as the preferred session start.
- Define the **session identity** contract handed to Module A/C — the opaque token model and what it may contain.

### D-D. Sync, queue and offline behaviour (the reliability core)
- Design the offline queue: item schema, **idempotency keys**, retry with backoff, ack semantics, dead-letter handling, and duplicate suppression.
- Define behaviour across: LAN loss, edge-node outage, ABDM gateway outage, and mid-transfer connection cut.
- Define the **reconciliation rule** between what the kiosk captured and what the hospital ultimately holds.
- Define the hard rule for what is **never** queued (e.g. anything beyond the consented purpose).

### D-E. Cryptography and exchange security
- Specify at-rest encryption per tier (kiosk SQLCipher AES-256; edge node DB/disk).
- Specify in-transit: TLS 1.2+, hospital PKI where available.
- Specify **Fidelius-compatible E2EE** for ABDM data exchange: ECDH Curve25519 + AES-256-GCM, the nonce-XOR-to-IV derivation, HKDF-SHA256 key derivation, and where the keypair lives.
- Design **key management**: generation, storage (HSM/keystore, never env vars or images), rotation, and destruction as the erasure mechanism.

### D-F. DPDP compliance mapping
Produce a clause-by-clause implementation mapping covering at minimum: itemised notice, consent granularity and withdrawal, purpose limitation, data minimisation, retention and erasure, breach notification (72h) with a pre-drafted template, data principal rights, children's data if applicable, cross-border transfer, and the Consent Manager relationship (registered third party — design so one can be substituted).
Include the audit-trail requirement: append-only, immutable, off-box, **7-year retention** per the Consent Manager standard, and who may read it.

### D-G. Emission artifacts and ownership
- Decide, jointly with the Module C decision, **which ABDM artifact carries the pre-visit summary** (the deep sweep surfaced **INPS** as a new candidate, plus the existing OPConsultRecord / HealthDocumentRecord options).
- Define who authors and who attests each emitted artifact, and the `attester` semantics — noting the sweep's finding that `attester` is **0..\*** in the profile, so attestation must be enforced in the application.
- Define the retention/erasure semantics per artifact type.

### D-H. ABDM sandbox and certification path
- Produce a concrete certification roadmap: HFR registration → HIP onboarding → sandbox application keys → ABHA auth → care-context linking (with the required test cases) → data push → HAPI validation.
- Define the **milestone gates** and exit criteria, aligned with the blueprint's phases P2/P4.
- Identify every external dependency with a named owner and a lead time.

### D-I. Operations, audit and key lifecycle
- Design the audit log: schema, immutability, shipping, retention, access control.
- Design break-glass / emergency access (who, when, what is recorded).
- Define the operational runbooks Module D owns: consent anomaly, sync stall, gateway outage, erasure request, breach response.

### D-J. Threat model for the consent and exchange path
Enumerate and design mitigations for at least: consent replay/forgery, token theft, rogue edge node, insider PHI browsing, downgrade of consent scope, queue tampering at rest, man-in-the-middle on the hospital LAN, key compromise, and a stolen kiosk disk.

### D-K. NRCeS / external confirmations to queue
Consolidate every question that must be answered by an external authority (NRCeS, NHA, the hospital) into a tracked list with the specific question, the owning body, and what design decision is blocked on it. At minimum: the INPS publication status and fitness for a patient-elicited summary; whether a preliminary OPConsultRecord authored by patient+device is acceptable; planned-Encounter usage; HealthDocumentRecord scope; MedicationStatement vs MedicationRequest; IG v6.5.0 vs v7.0.0; and the CDSCO/SaMD wording boundary.

## Deliverables
1. **`doc/22-module-d-production-design.md`** — the complete Module D design (sections mirroring D-A…D-K). This is the project's largest missing document; make it implementation-ready in structure while containing **no code**.
2. **A component breakdown** (D1…Dn) analogous to Module B's B1-B9 and Module C's C1-C7, with each component's responsibility, inputs, outputs, failure behaviour and dependencies.
3. **A DPDP compliance mapping table** usable directly by counsel.
4. **The external-confirmation tracker** (D-K) as a standalone checklist.
5. **A dated entry in `doc/research/05-research-log.md`.**
6. **Updated `doc/research/07-open-questions.md`.**
7. **Decisions-log rows** for every real decision taken.

## Evidence rules
- Every regulatory claim needs a primary source (the guidance PDF, the IG page, the gazette) and a verification date.
- Distinguish clearly between **release** and **preview/draft** specifications.
- Mark anything unverifiable `[uncertain]`; never invent an API field, a clause number or a certification requirement.
- Where a claim came from the deep sweep, re-verify it live before relying on it, and say so.

## Definition of done
- Module D has a component breakdown equivalent in rigour to B and C.
- The Data Fiduciary/Processor posture and deployment model are decided.
- Consent lifecycle, sync/queue and crypto designs are complete enough to implement without further design sessions.
- The DPDP mapping is counsel-usable.
- Every external blocker is on the tracker with an owner and a lead time.
- No code was written.

## Out of scope
Implementing any of it. Changing `module-b/` or `module-c/` source. Module A design. Any ABDM sandbox account creation or real credentials.

---

# Shared rules (apply to all three prompts)

**KB discipline.** Read before building; update after discovering. Append dated findings to `doc/research/05-research-log.md`. Log every real decision with its "why" in `doc/decisions/06-decisions-log.md`. Cycle unresolved items through `doc/research/07-open-questions.md`. Add new docs to the index table in `doc/README.md`.

**Honesty over completeness.** An explicit "blocked on X" beats a confident guess. The project's credibility rests on every claim being traceable.

**Respect the invariants.** The seven invariants in `doc/19-production-blueprint.md` §0 are not design preferences — a design that violates one is rejected regardless of other merits.

**Production means the three gates.** Engineering, clinical validation, and regulatory. Where a gap cannot be closed by research alone, say so and name the gate it belongs to.

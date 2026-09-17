# 19 — MediKiosk Production Blueprint

> **Status:** Draft for team ratification (2026-09-16). This supersedes the demo/SIH framing.
> **Scope:** how to build, validate, certify and operate MediKiosk as a production system, not a prototype.
> **Read with:** doc/01 (problem), doc/09 (Module A design), doc/13–17 (Module B), doc/15 + doc/18 (Module C), doc/16 (regulatory), doc/19 assumes all of those.

---

## 0. What "production" and "bulletproof" actually mean here

Engineering quality alone does **not** make a clinical system bulletproof. Three independent gates must all pass, and they are usually serialised in cost and time:

| Gate | What it proves | Who signs it | Can engineering alone satisfy it? |
|---|---|---|---|
| **1. Engineering** | The system does what it says, survives failure, leaks nothing | Your team | Yes |
| **2. Clinical validation** | The output is safe and useful on real Indian OPD patients, measured | Clinician investigators + ethics committee | **No** |
| **3. Regulatory** | The intended use is legally permitted to run | CDSCO / NRCeS / hospital IRB | **No** |

**Bulletproof = all three gates passed, with evidence on file.** The blueprint below is organised so that gate 1 also *produces the evidence* gates 2 and 3 require.

### The invariants (never violate, in any release)
1. **Never diagnose.** No assessment, no differential, no treatment suggestion, ever, in any output or UI string.
2. **Never fabricate.** Every rendered clinical line carries provenance to a captured input. Uncaptured = absent, not inferred.
3. **Never silently resolve a conflict.** Contradictory data (dose mismatch, med disagreement) is surfaced to the physician, both values retained.
4. **Never let a machine clear a clinical uncertainty.** Patient confirmation does not clear a machine verify-flag; only a clinician attestation does.
5. **Never store PHI beyond policy.** Transient by default; persistent only with explicit, itemised, revocable consent.
6. **Never phone home.** No PHI leaves India, ever. No third-party analytics on any PHI path.
7. **Never block care on a failure.** Any component failure degrades to a safe, usable fallback, never to a dead kiosk.

### Non-goals (state these publicly, they protect you)
- Not a diagnostic device. Not triage autonomy. Not an EHR/HIS replacement. Not a billing system. Not a telemedicine platform.

---

## 1. Product boundary

**In scope (production v1):**
- Patient-facing OPD kiosk capturing structured history (voice + touch) and digitising patient-carried paper
- Deterministic red-flag detection with a human-acknowledged escalation
- One-page physician summary on the consult screen + bilingual patient read-back
- NRCeS-conformant FHIR emission and ABDM push under hospital HIP keys
- On-premise deployment; offline-tolerant; India-resident

**Explicitly out of scope for v1:** diagnosis, treatment advice, prescription generation, acuity queue reordering beyond red flags, 22-language coverage (v1 = Hindi + English + Hinglish), remote/tele health delivery.

**Environments:** `dev` (laptop) → `staging` (hospital-like edge node + ABDM *sandbox*) → `prod` (hospital LAN, real ABHA). Never share credentials or data across these.

---

## 2. Assumptions and decisions that need sign-off

These branch the architecture. Flagged so they are decided *before* build, not discovered mid-build.

| # | Decision | Options | Recommendation | Owner |
|---|---|---|---|---|
| D1 | Deployment topology | (a) standalone kiosk, (b) thin kiosk + **hospital edge node**, (c) central cloud | **(b)** — satisfies residency, amortises compute, enables HIS integration | Eng + hospital IT |
| D2 | Who owns the hospital backend | (a) our own edge stack, (b) deploy into the hospital's existing HIS | **(a) first, (b) as integration target** — hospitals will not let you reprovision their HIS | Eng |
| D3 | Regulatory pathway | (a) administrative intake only (lowest band), (b) clinical documentation (higher), (c) full SaMD | **(a) with the red-flag layer demoted to "alert, never advice"** and intended-use wording drafted by counsel | Regulatory + clinical |
| D4 | ABDM certification target | M1 / M2 (HIP) / M3 (HIU) | **M2 first** (hospital = HIP owns records), M3 when cross-hospital pull is needed | Eng + hospital |
| D5 | Canon schema versioning | (a) mutate v1, (b) additive v2 alongside v1 | **(b)** — additive only, never breaking | Eng |
| D6 | Transactional store | SQLCipher/encrypted SQLite (edge) vs Postgres | **SQLCipher on kiosk** (queue only, transient) + **PostgreSQL on edge node** (HAPI JPA) | Eng |
| D7 | Bilingual strategy | (a) translate the note, (b) render separately from canon | **(b)** — render, never machine-translate clinical text | Clinical + Eng |
| D8 | Reference ranges / thresholds | placeholder now | **clinician-signed dataset, versioned, cited** before any production release | Clinical |

---

## 3. Deployment architecture

### Topology (three tiers)

```
┌─ KIOSK (thin) ─────────────┐      ┌─ HOSPITAL EDGE NODE ──────────────┐      ┌─ HOSPITAL SYSTEMS ─┐
│ touchscreen + mic + camera │      │ (1 per 10-20 kiosks, on-prem)     │      │ HIS / EMR          │
│ ARM/i3-class, ~4-8GB, no   │◄────►│ CPU inference tier + HAPI FHIR    │◄────►│ ABDM gateway (HIP) │
│ dGPU                       │ LAN  │ server + PostgreSQL + eval/ops    │ LAN  │ ABHA / HIE-CM      │
│ - VAD/ASR (whisper.cpp)    │      │ - OCR primary/fallback (if local) │      │ Auditor / admin    │
│ - touch FSM, red flags     │      │ - structurer (llama.cpp/Qwen3)    │      │                    │
│ - encrypted transient queue│      │ - FHIR validation, ABDM sync      │      │                    │
│ - NO HAPI, NO Java         │      │ - central logs/metrics/backup     │      │                    │
└────────────────────────────┘      └───────────────────────────────────┘      └────────────────────┘
         100% offline-capable                  degrades, never blocks                authority for consent
```

**Why this shape:** the kiosk must run *alone* when the LAN is down (so ASR, FSM, red flags, and history capture are all local). The edge node hosts the heavy, non-real-time work (Java validation, model serving, sync). The hospital system remains the system of record and the HIP.

### Network zones
- **Zone A (kiosk LAN):** kiosk ↔ edge node only. No internet from kiosks, ever.
- **Zone B (hospital core):** edge node ↔ HIS ↔ ABDM gateway. Firewalled, outbound-only to the ABDM gateway.
- **Zone C (vendor ops):** *no PHI*. Metrics/health telemetry only, aggregate, no patient identifiers.

### Deployment profiles
| Profile | Target | Hardware | Notes |
|---|---|---|---|
| **P-Small** (single clinic) | < 500 patients/day | 1 combined node (kiosk + edge) | Cheapest; still Zone-A-isolated |
| **P-Hospital** (recommended v1) | 2,000-10,000/day | N thin kiosks + 1 edge node (16-32GB RAM) | Matches AIIMS-class OPD |
| **P-Multi-site** | Hospital group | Per-site edge + central ops (no PHI) | Later; needs federated identity |

---

## 4. Module production specifications

### Module A — Conversational history **(not built; highest remaining risk)**
| Component | Spec | Status |
|---|---|---|
| A1 VAD + audio front-end | Silero VAD (~2MB, MIT) + WebRTC APM; physical acoustic treatment is the dominant WER lever, not model choice | To build |
| A2 ASR adapter | Pluggable; `whisper.cpp` INT8 baseline (MIT) via a bake-off gate; IndicConformer/Qwen3-ASR phase-2 | To build |
| A3 Dialogue FSM | Deterministic slot machine owns state (`pytransitions`), LLM only fills slots | To build |
| A4 Slot schema | SOCRATES + Dashavidha v2 (6 self-report + 4 `requires_clinician`); `not_elicited` is a first-class state | Spec'd (doc/09) |
| A5 Red-flag classifier | **Deterministic rules only**, never an LLM; versioned rule set, clinician-signed, evidence-tagged | Rules designed (12) |
| A6 HistoryBundle producer | Emits `medikiosk-history-bundle/1` (consumer already exists in `medic/contracts.py`) | To build |
| A7 Local TTS | `sherpa-onnx` + per-voice-licensed Hindi voice; auto-speak primed by the Start gesture | To build |
| A8 Store + resume | Encrypted SQLCipher + WAL, session resume after power loss | To build |

**Rule for A:** never run ASR + OCR + LLM concurrently on a ~4GB kiosk. Serial scheduler with a memory watchdog and a degradation ladder.

### Module B — Document digitisation **(built; gaps below)**
Existing: `module-b/medib` (B1-B9, 23 tests). Gaps:
- **B8 ABDM sync — not implemented.** This is the main Module B production work.
- **Thresholds are placeholders** (`medib/config.py`) pending the M0 real-scan eval set.
- **No real-OPD accuracy data.** Synthetic scores do not generalise (MIRAGE ceiling evidence).
- **Tesseract fallback never exercised live** (binary absent on dev machine).
Production additions: M0 consented eval set, per-field GT with bboxes, threshold re-derivation, model vendoring (ModelScope → bundle into image, no runtime download), dark/undecodable-file handling, and the correction loop promoted from demo to product.

### Module C — Summary generation **(built; gaps below)**
Existing: `module-c/medic` (C1-C7, 22 tests). Gaps:
- **Attestation must be enforced in-app.** The deep sweep proved `Composition.attester` is 0..\* (must-support), so the profile does not guarantee physician sign-off. Emitter writes `status=preliminary`; attestation flips to `final`.
- **Emission target may shift to INPS.** NRCeS IG v7.0.0 preview introduces an *Indian Patient Summary* (from HL7 IPS 2.0.0, with a Patient Story section) — a better fit for a patient-elicited pre-visit summary than OPConsultRecord. Decide before locking the emitter.
- **Reference ranges are placeholders** — clinician-signed dataset required (D8).
- **Dashavidha layer absent in v1** — roadmap item, not a v1 blocker.
- **Validation is structural only** (`fhir.resources` R4B). Real NRCeS profile validation needs HAPI/matchbox + the `ndhm.in` package. Note `fhir.resources` has **no R4 sub-package** from v7 — it cannot be the R4 profile validator.

### Module D — Consent + ABDM **(no code, no design doc — biggest build gap)**
To build: ABHA auth and Scan-&-Register session entry; consent artefact lifecycle (request / grant / revoke / expire); HIP-initiated care-context linking under hospital HFR keys; offline queue + store-and-forward sync with idempotency; Fidelius-compatible E2EE for exchange; retention/erasure enforcement; DPDP audit trail.

---

## 5. Data architecture

### The canon (store once, render many)
`HistoryBundle` is the single source of truth for everything Module C renders.
- **v1 exists** (`medic/contracts.py`, schema string `medikiosk-history-bundle/1`): slot states (`captured` / `needs_review` / `not_answered` / `not_elicited`), per-slot provenance (patient vs proxy; voice vs touch), red flags, session and consent refs.
- **v2 is additive** (never breaking): Dashavidha layer, `requires_clinician` scope, repeat-visit carry/delta, attendant relation.
- **Rule:** no module may render directly from raw transcripts or raw scans. All rendering goes through the canon.

### Storage tiers
| Tier | Store | Contents | Encryption | Retention |
|---|---|---|---|---|
| T1 Kiosk transient | SQLCipher + WAL | in-session canon, unsynced queue | SQLCipher (AES-256) | deleted on sync + session end |
| T2 Edge node | PostgreSQL (HAPI JPA) | validated FHIR, audit log | DB + disk encryption | per hospital policy + DPDP |
| T3 Hospital HIS | hospital-owned | system of record | hospital standard | hospital policy |
| T4 Vendor ops | metrics DB | aggregates, **no PHI** | at-rest | 13 months |

### Identifiers and traceability
- `session_id` = `D<date>-<token>-<HFR-ID>` (no PHI in the ID).
- Every canon field: `{value, state, by, source, confidence?, provenance_ref}`.
- Every rendered line: back-reference to canon field-id (this is what makes the no-fabrication invariant *verifiable*).
- Every emission: content hash + IG version + emitter version, recorded.

---

## 6. Security, privacy and compliance

### DPDP Rules 2025 mapping
| Obligation | Implementation |
|---|---|
| Itemised, standalone, plain-language notice | In-kiosk bilingual notice; explicitly names history capture, **summary generation**, physician handover and ABDM upload as separate purposes |
| Consent granularity + easy withdrawal | Per-purpose toggles; withdrawal path as easy as grant; withdrawal propagates to retention/erasure |
| Purpose limitation | Canon fields tagged with the purpose they were collected under; ABDM push limited to consented HI types |
| Data minimisation | Transient by default; only attested output persists |
| Retention + erasure | Per-purpose retention clock; crypto-erasure (destroy key) as the erasure mechanism |
| Breach notification (72h) | Pre-drafted template + audit trail sufficient to scope a breach |
| Data Fiduciary vs Processor | **Hospital = Fiduciary; MediKiosk = Processor.** Get this in the contract, not just the design |
| Consent Manager | Not built (registered Consent Manager is a third party); design so a CM can be substituted |

### ABDM / HIP posture
- **Hospital = HIP** (a healthcare provider). The kiosk is part of the hospital's ABDM-compliant certified software, registered under the hospital's HFR ID.
- Kiosk alone cannot push: an independent kiosk-operator push would require an HRP/partner arrangement.
- Residency: ABDM HDM Policy (Apr-2022 rev.) Clause 26 — "No personal data shall be stored beyond the geographical boundaries of India." Federated model: records stay at the originating facility; only registries are central.

### Cryptography
- At rest: AES-256-GCM (SQLCipher on kiosk; DB/disk encryption on edge).
- In transit: TLS 1.2+ only, hospital-PKI where available.
- Exchange: Fidelius-compatible (ECDH Curve25519 + AES-256-GCM) for ABDM data flow.
- Keys: never in env vars or images; HSM/keystore or a managed secret store.
- **No PHI in logs, ever.** Log scrubbing enforced by test.

### Access control and audit
- RBAC: patient (own session only), kiosk-operator (device, no PHI browsing), physician (attest, view), admin (aggregates only), engineer (break-glass, alerted, time-boxed).
- Every PHI read/write is an immutable audit event: actor, purpose, resource, timestamp, session.
- Audit log is append-only, shipped off-box, 7-year retention (Consent Manager standard).

### Threat model (minimum set to design against)
Tampered kiosk hardware · stolen kiosk disk · shoulder-surfing at the screen · rogue LAN device · poisoned document upload (adversarial text in a scanned page attempting to steer the structurer) · model/prompt injection via patient speech · insider PHI browsing · supply-chain compromise of a model or ONNX runtime · lost edge node.

---

## 7. Clinical safety architecture

| Control | Design |
|---|---|
| **Never diagnose** | A/P structurally absent from machine output; section code omitted rather than invented; locked physician-only in UI |
| **Red flags** | Deterministic, versioned, clinician-signed rules. Any hit: full-screen escalation + staff acknowledgement gate + priority handoff. Rules are auditable and shown with matched evidence |
| **Attestation gate** | **Application-enforced** (profile does not enforce it). No emission is `final` without a physician attestation; UI cannot bypass |
| **Verify-default** | Handwritten/low-confidence fields are `needs_review` and visually flagged; the physician sees *why* |
| **No silent resolution** | Conflicts retain both values + a review flag |
| **Low literacy** | Spoken read-back in the patient's language so the patient can verify captured history without reading |
| **SaMD posture** | Intended use = administrative intake + data aggregation. The red-flag layer is worded as an **alert to staff**, never clinical advice. Get counsel sign-off on wording before release (D3) |
| **Safety case** | Maintained document: every hazard → control → test → residual risk. Required for gate 2 and gate 3 |
| **Incident process** | Defined severity ladder, 72h breach path, patient-notification path, post-mortem with CAPA |

---

## 8. Reliability and resilience

| Failure | Behaviour |
|---|---|
| LAN down | Kiosk fully functional offline; queue encrypted locally; auto-sync on reconnect |
| Power loss mid-session | WAL recovery; session resumes, no partial canon promoted |
| OOM during ASR | Degrade: smaller model → touch-only fallback; never a dead kiosk |
| OCR engine crash | Fallback engine; then verify-default with no extraction rather than fabricated extraction |
| Edge node down | Kiosks continue capturing; sync backlog drains later |
| Duplicate delivery | Idempotency keys on every sync item; server dedupes |
| Clock skew / ordering | Monotonic event ordering per session; server-side reconciliation |
| Model output malformed | Schema validation gate rejects; falls back to deterministic rules |
| Disk full | Oldest synced transient data evicted first; hard stop before corruption |

**Budget targets (must be measured, not assumed):** kiosk availability ≥ 99.5% of OPD hours · zero data loss on power cut · sync backlog drains within one OPD shift · p95 page-processing ≤ 5s · session completion ≥ 80% (benchmark: published intake deployments).

**Backup/DR:** edge node → nightly encrypted backup to hospital-owned storage; documented restore RTO ≤ 4h, RPO ≤ 15min. DR test quarterly, evidence retained.

---

## 9. Performance and capacity

**Sizing (must be re-derived from real data at M0, not trusted from this doc):**
- ~240 sessions/kiosk/day at 2.5 min/session → 4,000 patients/day ≈ **17 kiosks**; 10,000/day ≈ **42 kiosks**.
- Per-module budget: A (ASR+FSM) is the CPU hog; B (OCR) is bursty and must not co-run with A; C (deterministic render) is milliseconds and never the bottleneck.
- Memory: serial scheduler, one heavy stage at a time, watchdog between stages. On a 4GB kiosk, ASR + OCR + LLM **cannot** co-reside.
- LLM lane caution: measured Qwen3-4B Q4_K_M ≈ 6.5 t/s generation on a desktop-class CPU → a 200-token summary ≈ 30s. It must never sit on the consult critical path; that is why v1 has no LLM in Module C.

---

## 10. Interoperability

| Concern | Position |
|---|---|
| Base standard | FHIR R4 (ABDM is R4; note `fhir.resources` has no R4 sub-package from v7) |
| Profiles | NRCeS ABDM IG v6.5.0 today; v7.0.0 preview adds INPS. **Pin the IG version and record it in every emitted bundle** |
| Emission targets | OPConsultRecord (physician note) and/or INPS (patient summary — decision D6/§4) |
| Code systems | SNOMED CT (India affiliate licence — free in-country, sublicense + usage reporting required); CDCI for drugs; LOINC per NRCeS lab profiles (bindings still to be confirmed) |
| AYUSH coding | **Unresolved at the standards layer.** NAMASTE has no official FHIR CodeSystem/ValueSet/API and OPConsultRecord has no Prakriti/Vikriti slots → AYUSH content must ride inside IG-accepted sections using SNOMED CT / ICD-11 TM2 |
| Validation | HAPI FHIR or matchbox with the `ndhm.in` package — **not** `fhir.resources`, which is a model library, not a profile validator |
| IG upgrade process | Owned, calendared: pin version → revalidate fixtures in CI → re-certify → record. Never auto-upgrade |

---

## 11. Quality and validation

### Test pyramid
- **Unit** (existing: 23 B + 22 C) — logic, reconciliation, emitter shape
- **Contract** — canon schema, FHIR profiles, API schemas (fail the build on drift)
- **Golden-file** — rendered summaries vs signed fixtures; any diff requires clinical review
- **Eval harness** — per-view field recall + **explicit omission check** + provenance integrity (fabrications = 0) + determinism (existing in `medic/eval_harness.py`)
- **Integration** — ABDM sandbox end-to-end, consent grant → push → pull
- **Resilience** — power-cut, LAN-drop, disk-full, malformed-input chaos tests
- **Security** — PHI-in-logs scan, dependency/licence scan, secret scan, pen test pre-release
- **Browser/device** — real kiosk hardware, Hindi voice, mic, touch

### Clinical validation (gate 2 — cannot be engineered)
Protocol: real consented OPD patients, field-level ground truth, physician concordance vs the summary, **safety-floor on meds/doses**, omission measurement (not just presence), SUS-style usability, completion rate, zero-incident safety log. Reference metrics from published intake deployments (completion ~80%, concordance 88-96%). Ethics committee approval and DPDP-clean consent collection are prerequisites.

### Release gates
No release to `prod` without: all CI green · eval harness thresholds met · clinical sign-off on any threshold/range change · regulatory wording unchanged or re-approved · DR test current · audit/PHI-log scan clean.

---

## 12. Observability and operations

- **Metrics (no PHI):** session start/complete/abandon, per-stage latency p50/p95, ASR/OCR confidence distributions, red-flag hit rate, attestation rate, sync backlog depth, error rates, resource peaks.
- **Logs:** structured, scrubbed, correlated by `session_id`; PHI never logged (test-enforced).
- **Audit:** immutable, append-only, off-box, 7-year.
- **Alerting:** kiosk down during OPD hours; sync backlog > threshold; error-rate spike; disk/memory pressure; validation failures; consent anomalies.
- **Runbooks:** kiosk swap, edge restart, sync stall, ABDM outage, breach response, restore-from-backup.
- **Model/IG change control:** every model or IG change is a release event with revalidation, not a hotfix.

---

## 13. Delivery plan

Honest timeline. Production with clinical + regulatory gates is a **multi-quarter** effort, not a sprint.

| Phase | Duration | Deliverable | Exit criteria |
|---|---|---|---|
| **P0 Foundations** | 4-6 wks | Ratify D1-D8; canon v1 freeze; CI; threat model; **M0 consented eval set** | Decisions signed; eval set collected under DPDP-clean consent |
| **P1 Module hardening** | 8-12 wks | Module A built (ASR bake-off → FSM → HistoryBundle); B thresholds re-derived from M0; C attestation gate + emitter target decided | A end-to-end on real audio; B/C thresholds evidenced |
| **P2 Integration + ABDM sandbox** | 8-10 wks | Module D (consent, HIP linking, sync, queue); HAPI validation green; sandbox end-to-end | Consent → capture → summary → push → pull works in sandbox |
| **P3 Clinical validation pilot** | 12-16 wks | Real-OPD pilot, ethics-approved; concordance + safety metrics | Published internal validation report; safety log clean |
| **P4 Regulatory + certification** | parallel 12-24 wks | Intended-use sign-off; ABDM M2 (then M3) certification; SNOMED licensing; SaMD position | Certificates on file |
| **P5 Production rollout** | 8 wks | P-Hospital profile: kiosks + edge node, runbooks, training, support | DR tested; runbooks exercised; go-live sign-off |

**Team (minimum viable):** 1 clinical lead (part-time), 1 regulatory/compliance, 2 backend, 1 ML/ASR, 1 frontend/kiosk, 1 QA/validation, 1 DevOps/security, 1 product. ~8-9 people.

**Cost drivers (must be quoted, not guessed):** kiosk hardware per unit, edge node, clinical validation study, certification effort, SNOMED/terminology licensing (free in-India but process cost), counsel. Do not publish a unit cost until vendor quotes are in hand.

---

## 14. Risk register (top 10)

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Module A never reaches usable Hindi/Hinglish accuracy in OPD noise | Fatal | Acoustic treatment first (noise is the dominant lever); ASR bake-off gate; touch-only fallback always available |
| R2 | Module D / ABDM certification slips | Blocks production | Start M2 in parallel with P1; sandbox-first development |
| R3 | CDSCO classifies the red-flag layer as SaMD | Blocks/reshapes launch | Intended-use wording as "staff alert", counsel sign-off, deterministic rules, no advice |
| R4 | No real-OPD eval data | Thresholds unfounded | M0 is a P0 deliverable, not a later task |
| R5 | Hospital refuses edge-node deployment | Blocks topology | Offer P-Small combined profile; integrate into existing HIS as fallback |
| R6 | PHI leak (logs, telemetry, stolen device) | Existential | Zone isolation, no PHI in logs (test-enforced), encryption at rest, break-glass audit |
| R7 | IG version churn invalidates emitter | Rework | Pin version, record in bundle, CI revalidation, owned upgrade process |
| R8 | LLM lane hallucinates in production | Clinical harm | v1 has no LLM in Module C; phase-2 lane gated behind eval harness |
| R9 | Thresholds/ranges wrong (placeholder shipped) | Clinical harm | D8: clinician-signed, versioned ranges before any production release |
| R10 | Competitor ships fast cloud equivalent | Commercial | Compete on offline + residency + NRCeS conformance + attestation + provenance, not on speed |

---

## 15. Definition of done

A production release is done when **all** of the following hold, with evidence on file:

1. All seven invariants (§0) enforced and tested, including a PHI-in-logs scan and a fabrications = 0 eval run.
2. Modules A, B, C, D implemented and integrated; no stubbed component on any clinical path.
3. Real-OPD eval set collected; all thresholds and reference ranges re-derived and clinician-signed.
4. ABDM sandbox end-to-end green; certification (M2 minimum) obtained.
5. Intended-use wording and SaMD position signed off by counsel and clinical lead.
6. DPDP mapping implemented per §6, including retention, erasure and breach runbooks.
7. Resilience suite passing: power-cut, LAN-drop, disk-full, malformed-input, duplicate-sync.
8. DR tested with evidence (RTO ≤ 4h, RPO ≤ 15min).
9. Operational runbooks written and rehearsed; alerting live; on-call defined.
10. Clinical validation report signed by the investigator; safety log clean.
11. Cost model based on vendor quotes, not estimates.
12. Knowledge base updated (decisions logged, open questions cycled).

---

## Appendix — What already exists vs what this blueprint adds

| Asset | State |
|---|---|
| `module-b/medib` (B1-B9) | Built, 23 tests; B8 ABDM sync missing; thresholds placeholder |
| `module-c/medic` (C1-C7) | Built, 22 tests; attestation gate + emitter target pending; ranges placeholder |
| Module A | Design only (doc/09). **No code.** |
| Module D | **No code, no design doc.** |
| Demos (A/B/C) | Built and verified — useful as UX reference, **not** production code |
| Evidence base | doc/10, 13, 14, 15, 16, 17, 18 + `module-3-summary-generation/` (35-item deep sweep) |

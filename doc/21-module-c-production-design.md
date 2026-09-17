# 21 — Module C Production Design (gap closure: C-A … C-J)

> **Status:** Design for team ratification, 2026-09-16. Research/design only — **no code was
> written.** Sections mirror the ten assigned gaps. Every item is **DECIDED** (with rationale)
> or **EXPLICITLY DEFERRED** (with the condition that unblocks it and an owner). No "TBD"
> without an owner and a condition.
>
> **Read with:** doc/15 (Module C research, §7/§8 contain corrections), doc/18 (C1–C7 plan),
> doc/04 (SOAP/OLD CARTS schema), doc/02 + doc/03 (clinical field model), doc/19 (production
> blueprint + invariants), doc/20 (Module B production design, for cross-module consistency),
> the code in `module-c/medic/`, and the 2026-09-16 Module-3 deep sweep in
> `module-3-summary-generation/`.
>
> **Non-negotiable constraints this design must fit (restated):** never diagnose (Assessment &
> Plan structurally absent from machine output); never fabricate (every rendered line carries
> provenance to a captured field); never silently resolve a conflict; only clinician attestation
> clears a verify-flag; deterministic v1 (no LLM in the rendering path); CPU-only kiosk
> (rendering must be cheap; heavy validation off-kiosk); bilingual but clinical text is
> **rendered, never machine-translated as the source of truth**; physician attestation is
> application-enforced because `Composition.attester` is **0..\*** (must-support).

## Evidence rules used in this doc

- A load-bearing claim carries a source (URL or `file:line`) and a verification date.
- `[verified YYYY-MM-DD]` = fetched this session; `[sweep YYYY-MM-DD, <file>]` = already
  sourced in the 2026-09-16 deep sweep (re-cited, not re-fetched); `[KB, doc/x §y]` = already
  sourced in the knowledge base with its own date; `[uncertain]` = not independently confirmed.
- **Release vs preview is stated explicitly** wherever NRCeS is cited.
- `fhir.resources` is a model library, **not** a profile validator: its "valid" means
  structural Pydantic validity only. NRCeS conformance requires HAPI/matchbox with the
  `ndhm.in` package.

## Decision status legend

| Tag | Meaning |
|---|---|
| **DECIDED** | Ratify as-is; rationale given. |
| **DEFERRED** | Not decided now; the named condition + owner unblocks it. |
| **BLOCKED-CLIN** | The value is a clinical judgement requiring sign-off; design is decided, the number is not. |

---

## C-A. The emission artifact — **DECIDED**

### C-A.1 The decision

**Two artifacts, pinned to the NRCeS IG release `ndhm.in#6.5.0`.**

1. **Structured pre-visit summary → `OPConsultRecord`, emitted as a FHIR R4 document Bundle**
   (Composition first entry), `status=preliminary` until physician attestation flips it to
   `final`. This is the v1 carrier for the patient-elicited history summary.
2. **Raw/legacy scans → `HealthDocumentRecord`**, wrapping `DocumentReference` entries (the
   Module B output) — the named national contract for patient-carried unstructured documents,
   which has no structured-section slots and therefore cannot carry the summary itself.

**INPS is DEFERRED as the structured-summary carrier** until it becomes a *published* release
(condition + owner in C-A.2), with a designed fallback if it never ships.

### C-A.2 Why (release vs preview, cited)

| Fact | Release/preview | Source |
|---|---|---|
| IG v6.5.0 is **the current published version**; `OPConsultRecord` official URL `.../OPConsultRecord`; page states "Draft as of 2020-09-17"; generated 2025-05-08 | **Release** | `[verified 2026-09-16, nrces.in/ndhm/fhir/r4/index.html]`, `[verified 2026-09-16, nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html]` |
| v6.5.0 build announced 09 May 2025 | **Release** | `[verified 2026-09-16, nrces.in/news]` |
| v7.0.0 is an "**Local Development build**", generated 2026-07-15, adding **INPS** (Indian Patient Summary), ImmunizationRecord, WellnessRecord | **Preview — not published** | `[verified 2026-09-16, nrces.in/preview/ndhm/fhir/r4/inps-general-guidance.html]` |
| IG publication/version history page returns **"TBD"** (no confirmed v7.0.0 publication date) | — | `[verified 2026-09-16, nrces.in/preview/ndhm/fhir/r4/history.html]` |
| **No NRCeS news entry announces a v7.0.0 publication** (news runs v6.5.0 May-2025 → terminology releases through 2026-08-31) | — | `[verified 2026-09-16, nrces.in/news]` |
| `OPConsultRecord` mandatory: status/type/subject(Patient)/encounter/date/author/title; `type` fixed SNOMED **371530004**; `section` 1..\* sliced (Unordered, Open At End); **`attester` 0..\*** (mode 1..1); author 1..\* (Device\|RelatedPerson\|Patient\|Practitioner\|PractitionerRole\|Organization) | **Release** | `[verified 2026-09-16, StructureDefinition-OPConsultRecord.html]` |
| `OPConsultRecord`'s 12 fixed section codes (incl. OtherObservations **404684003**, MedicalHistory **371529009**, Medications **721912009**, FamilyHistory **422432008**, InvestigationAdvice **721963009**, FollowUp **390906007**, Procedure **371525003**, Referral **306206005**, DocumentReference **371530004**); unchanged in v7.0.0 preview | Both (3 re-verified live: ChiefComplaints 422843007, PhysicalExamination 425044008, Allergies 722446000) | `[sweep 2026-09-16, NRCeS_OPConsultRecord.json]`; live confirmations `[verified 2026-09-16, StructureDefinition-OPConsultRecord.html]` |
| INPS mandatory sections = **Problems, Allergies and Intolerances, Medication Summary**; recommended = Immunizations, Diagnostic Results, History of Procedures, Medical Devices; optional incl. **Patient Story, Social History, Plan of Care, Vital Signs**; derived from **HL7 IPS 2.0.0** with dual ABDM+IPS conformance via `imposeProfile` | **Preview** | `[verified 2026-09-16, inps-general-guidance.html]` |

**Rationale for OPConsultRecord-over-INPS as the v1 carrier.** INPS is semantically the better
container (it has Patient Story, Social History and an explicit patient-facing purpose), but in
practice it fails three v1 gates: (a) it is **preview-only with no publication date** — an
emitter that pins it cannot claim conformant `final` output today; (b) its **mandatory
Problems section is defined as "active or current" problems** — a history-taking kiosk that by
invariant never diagnoses cannot honestly populate an active-problem list (it can only state
absence via `emptyReason`, which is legal but makes the mandatory section semantically hollow);
(c) **dual conformance via `imposeProfile`** makes local validation harder and couples us to
two evolving packages. OPConsultRecord is a *release*, its 12 codes are stable across both
versions, and its `author`/`attester` model already encodes exactly the attestation the
product requires. The one unavoidable cost — OPConsultRecord is typed as a *clinical
consultation report* and has no HPI/ROS/Social/AYUSH sections — is handled honestly in C-D
(map to OtherObservations/MedicalHistory, omit rather than invent) rather than by overclaiming.

### C-A.3 Fallback if INPS does not ship (designed now)

The fallback is **already the v1 design**, so it needs no re-work: OPConsultRecord remains the
carrier, and the content INPS would have carried in richer sections rides as follows —
pre-visit narrative, patient's own words and what-matters-most → **OtherObservations (404684003)
+ the Composition narrative text**; social history → **OtherObservations / MedicalHistory
text**; plan-of-care and patient-story → **not machine-generated at all** (physician-only, per
the never-diagnose/never-pre-generate rule). The INPS lane is a *future upgrade*, not a
dependency. **Condition to open the INPS lane:** NRCeS publishes v7.0.0 as a non-preview
release (the history page stops returning "TBD" and/or the news page announces it) **and** an
M3 HAPI/matchbox validation run shows our bundle validates against `ndhm.in#7.0.0` with the
mandatory Problems section satisfiable by explicit `emptyReason`/"no active problem" statements.
**Owner:** Module C lead (monitor) + Module D lead (NRCeS/NHA confirmation channel).

### C-A.4 Author / attester semantics — **DECIDED**

| Element | Value | Why |
|---|---|---|
| `status` | `preliminary` at emission; `final` only after physician attestation; `amended` after any post-attest edit (C-B) | Application-enforced; the profile does not guarantee it |
| `author` | `[Organization/<hospital-HFR>, Device/<kiosk-emitter>]` | The hospital is the responsible HIP/system of record; the kiosk device is the honest producing agent. The **patient is the source, not the author** — they answered questions, they did not author a clinical document. Both reference types are permitted by the release profile. `[verified 2026-09-16, StructureDefinition-OPConsultRecord.html]` |
| `subject` | `Patient/<ABHA-ref>` from the HistoryBundle `patient_ref` | Existing emitter behaviour; keep |
| `encounter` | `Encounter/<session_id>` **and the Encounter resource must be present in the Bundle** | The profile is **encounter 1..1**; the current emitter references an Encounter it never emits — a real M3 conformance gap (C-D.4) |
| `attester` | empty at emission; on attestation append `{mode:"professional", party: Practitioner|PractitionerRole/<physician>, time}` | `attester` is 0..\*; the app enforces it |
| `title` | "MediKiosk pre-consultation history summary (patient-elicited, unattested)" until attestation; drop "(unattested)" on `final` | Makes the document's provenance legible on the physician screen and downstream |
| `type` | fixed SNOMED 371530004 | Mandatory fixed value; unavoidable — mitigated by title + `status` |

**Author/attester rule:** the machine (kiosk) and the patient can **never** author or attest a
*clinical* claim as if a clinician had; only a licensed clinician may occupy `attester`. The
`author=Device` entry is explicitly *not* a clinical attestation.

### C-A.5 IG version-pinning strategy — **DECIDED**

1. **Pin** `ndhm.in#6.5.0` (release). Never auto-upgrade.
2. **Record the pin in every emitted bundle**: `Bundle.meta.tag` and/or `Composition.meta.tag`
   carry `{system:"https://nrces.in/ndhm/fhir/r4", code:"ndhm.in#6.5.0", display:"NRCeS ABDM FHIR IG <version>"}`,
   plus an emitter-version tag. This makes "which contract was this validated against"
   answerable from the artifact alone (doc/19 §5, §10).
3. **CI revalidation on any change**: the vendored `ndhm.in` package and the emitter fixtures
   are re-validated by HAPI/matchbox on every build; a pin change is a release event with
   revalidation, not a hotfix (doc/19 §12).
4. **Upgrade process is owned and calendared**: pin → revalidate fixtures → re-certify →
   record. No upgrade without a passing validation run and a signed decision row.

---

## C-B. Attestation model (application-enforced) — **DECIDED**

Because `attester` is 0..\* `[verified 2026-09-16, StructureDefinition-OPConsultRecord.html;
sweep 2026-09-16, NRCeS_OPConsultRecord.json]`, the profile does not guarantee sign-off. The
application is the gate.

### C-B.1 Lifecycle

| State | Meaning | Transition |
|---|---|---|
| `preliminary` | Machine-produced, patient-elicited, not yet physician-reviewed | Emitted this way; `attester` empty |
| `under_review` | (Application state, not FHIR) physician has the summary open | Optional UI state; no FHIR status change |
| `final` | Every verify-flagged field has an explicit physician disposition; `attester` populated (`mode=professional`); app flips status | Only reachable through the attestation action |
| `amended` | A post-`final` edit occurred; `attester` history retained; re-attestation required | Any edit after `final` re-opens the record |

### C-B.2 Who may attest

- A **licensed clinician** acting under the hospital (Practitioner / PractitionerRole). The
  kiosk operator (non-clinician) may not attest. The patient or proxy may never attest.
- **Separation of duties (where feasible):** the attester is a different human from both (a)
  the patient/proxy who supplied the content and (b) the kiosk operator. The machine is the
  origin of the uncertainty, so clinician attestation is by construction different from the
  actor whose uncertainty it resolves. In single-physician facilities the same clinician may
  both treat and attest (infeasible to separate); the rule then binds the *operator ≠
  attester* and records it.

### C-B.3 Editable vs structurally immutable

| Editable by the physician (round-trips into the canon) | Structurally immutable |
|---|---|
| Med name/dose/frequency/duration, lab value, complaint wording, corrections to any rendered line | Red-flag rule hits and their matched evidence; per-line provenance to canon field ids; machine confidence values; the **original machine value** (kept alongside the correction in the audit trail); the consent/session references |

`apply_physician_edit` already round-trips a correction into the canon and clears the item's
verify flag (`module-c/medic/merger.py:326-346`); the design adds the audit record and the
rule that the original machine value is never overwritten in the trail.

### C-B.4 Edit-after-attest

Any edit after `final` sets `amended`, clears the affected attester entry's "current" status,
and requires re-attestation. The prior `final` is retained in the audit trail with its content
hash. The bundle is re-hashed and re-validated before the new `final`.

### C-B.5 Audit trail — **DECIDED**

Append-only, cryptographically chained (each record hashes the previous), off-box, **7-year
retention** (doc/19 §6, Consent-Manager standard). Per record: actor identity + role, timestamp,
session id, resource/field id, prior value, new value, disposition (accept/correct/reject),
attestation status change, emitter/IG version. Read access is RBAC-limited; the trail contains
no PHI beyond the field values already in the record, and is never rendered to the patient.

---

## C-C. Clinical reference ranges and abnormal-value rules

**Today:** `REFERENCE_RANGES` in `module-c/medic/config.py` is a 7-entry placeholder demo table
(`config.py:12-21`) and the source comment says so. It must not ship.

### C-C.1 The dataset design — **DECIDED (schema); values BLOCKED-CLIN**

The primary source of a reference range is **the patient's own lab report**. NABL/ISO 15189
makes reference intervals a laboratory responsibility and requires them on the report: NABL 112A
defines a reference interval and ISO 15189:2022 requires reports to contain reference intervals
`[verified 2026-09-16, nabl-india.org — NABL 112A (18-Dec-2024, ISO 15189:2022), and J Lab Physicians 2026 review doi:10.25259/jlp_316_2025]`.

Therefore:

1. **Document-derived range (primary):** if Module B extracted a reference range from the lab
   report, use it and carry its provenance (`B:lab:<n>` + page/bbox). This is the most honest
   range — it is the one the reporting lab actually used.
2. **Clinician-signed fallback table (secondary):** only used when the report carries no range.
   Same schema as `REFERENCE_RANGES` but populated from a **named, cited, clinician-signed**
   source, versioned (see C-C.2).
3. **No range anywhere → do not flag.** Never infer a range and never judge a value against a
   guessed range (`_abnormality` already returns `""` for unknown tests,
   `module-c/medic/merger.py:239-256`; keep this rule).

**Lab scope (v1):** a closed, named panel of common analytes for which Module B can extract
name+value+unit and NRCeS/C-DAC publish a code — i.e. the intersection of the Module B
extraction schema and **CLCI (Common Lab Codes for India)**, NRCeS's curated LOINC subset,
released 2026-06-29 `[verified 2026-09-16, nrces.in/news]`. Binding CLCI-first / LOINC-fallback
is already the Module B decision (doc/20 §B-D) and Module C must not diverge from it.

**Populations:** v1 = **adult (≥18)**. Sex-specific columns are **required** for analytes where
sex materially changes the interval; the schema must carry `sex` so a range cannot be silently
applied to the wrong population. **Paediatric ranges are OUT of v1 scope** (DEFERRED, see
C-C.5) — the kiosk does not claim paediatric coverage.

### C-C.2 Governance — **DECIDED**

- **Versioning:** the fallback table is a versioned artifact (`range_set_version`). The summary
  and the emitted bundle record the version *and* the specific range used per lab line.
- **Sign-off:** every range row carries `{value, low, high, unit, population, source_citation,
  signed_by (clinician), signed_on}`. No row without a citation ships (doc/19 D8).
- **Change control:** a range change is a release event with re-run of the eval harness and a
  signed decision row — not a hotfix.
- **Historical summaries:** existing/stored summaries are **not** re-rendered when a range
  changes; a change affects only summaries generated after the new `range_set_version`. If a
  value previously normal becomes abnormal under a new range, the new summary flags it and the
  audit trail notes the version change.
- **Owner of the fallback table and its citations:** Clinical lead (named as owner; the
  specific ranges are **BLOCKED-CLIN** on a clinician producing and signing a cited table
  against the v1 adult panel).

### C-C.3 Abnormal-flagging rules and escalation order — **DECIDED**

- A value is flagged only when a range is known (on-report or signed table) and the unit
  matches; unit mismatch → never judge (existing rule, `merger.py:250-251`).
- The physician alert list is severity-ordered **red flags → verify flags → abnormal labs**
  (existing `_compile_alerts`, `merger.py:289-323`; confirmed as the target order in
  doc/19 §7). This order is DECIDED and must be preserved by every new reconciliation rule in
  C-I.
- **Critical-value tier: DEFERRED.** v1 does not distinguish "critical" from "abnormal" because
  critical-value thresholds are themselves clinician judgement (BLOCKED-CLIN). When a
  clinician-signed critical-value list exists, critical labs move to the **top** of the alert
  list (above red flags? no — immediately after red flags, before generic verify/abnormal).
  **Owner:** Clinical lead. **Condition:** signed critical-value list for the v1 panel.

### C-C.4 Escalation into the physician alert list — **DECIDED**

An abnormal lab on a verify-flagged (handwriting/low-confidence) read is emitted as
`severity=verify` (not `abnormal`), preserving the Module B verify-default (existing behavior,
`merger.py:311-320`); the value is shown with `[verify]` so the physician knows the read itself
is uncertain. Only verified reads can be `severity=abnormal`. This prevents a mis-read lab
value from being presented as a confirmed abnormal finding.

### C-C.5 Deferred

- **Paediatric reference ranges** — DEFERRED. **Condition:** an explicit product decision to
  support paediatric patients plus a clinician-signed paediatric table. **Owner:** Clinical
  lead.
- **Critical-value thresholds** — DEFERRED-BLOCKED-CLIN (C-C.3).
- **Actual fallback range values** — BLOCKED-CLIN, owner Clinical lead, condition = signed
  cited table (C-C.2).

---

## C-D. Canon ↔ IG section mapping — **DECIDED**

### C-D.1 Mapping table (MediKiosk canon → OPConsultRecord release v6.5.0)

| Canon source (HistoryBundle / Module B) | OPConsultRecord slice (fixed SNOMED code) | Target resource | Notes |
|---|---|---|---|
| Complaint (patient's own words) | **ChiefComplaints** 422843007 | Condition (patient-reported, unconfirmed) | Patient's words verbatim; never coded as a diagnosis |
| SOCRATES 8 slots + ROS + ICE | **OtherObservations** 404684003 | Observation (status `preliminary`) | The honest HPI/ROS/ICE home; section code now taken from the verified 12-code set `[sweep 2026-09-16]` instead of being omitted |
| PMH (patient) + document diagnoses | **MedicalHistory** 371529009 | Condition | Document-derived conditions stay `verificationStatus=unconfirmed` |
| Allergies | **Allergies** 722446000 | AllergyIntolerance | |
| Patient-stated + document medications (merged canon) | **Medications** 721912009 | MedicationRequest (`status=draft`, `intent=proposal`) or MedicationStatement for "currently takes" | Attestation does not turn the kiosk into the prescriber; the kiosk read is a proposal/statement, not an order |
| Family history | **FamilyHistory** 422432008 | FamilyMemberHistory / Condition (v1 uses Condition text, doc/18) | |
| Social history | **MedicalHistory** or **OtherObservations** (no dedicated slice) | Observation/Condition text | **Honest gap** — recorded as text, not force-coded |
| Module B labs | **MedicalHistory** / OtherObservations for results, or a DiagnosticReport reference | Observation | C4 gives the draft; the *ordered/test* side belongs to the physician (InvestigationAdvice, below) |
| Module B raw scans | **DocumentReference** 371530004 | DocumentReference (or an embedded HealthDocumentRecord artifact) | Raw documents, not summary content |
| **Physician-at-consult** (examination, investigation advice, procedure, follow-up, referral) | 425044008 / 721963009 / 371525003 / 390906007 / 306206005 | — | **NEVER pre-generated.** Structural, not policy |
| Assessment & Plan | none | — | Structurally absent from machine output (no section emitted; renderer locks A/P — `renderer.py:151-153`) |

### C-D.2 The honest gaps (documented, not hidden)

- **No HPI slice.** SOCRATES/ROS content maps to **OtherObservations (404684003)**; we say so in
  the bundle narrative. We do **not** invent an HPI section code.
- **No SocialHistory slice.** Social history rides as text inside MedicalHistory/OtherObservations.
- **No Prakriti/Vikriti slice.** AYUSH constitutional content has no home (C-E).
- **No explicit "patient-elicited" marker.** The profile's `type` is fixed to a clinical
  consultation report; we mitigate with `status=preliminary`, the title, and narrative — but
  this is an unavoidable semantic mismatch and is stated, not glossed. `[uncertain]` whether
  NRCeS would prefer a HealthDocumentRecord wrapper for an unattested patient-elicited document;
  queued for NRCeS confirmation (C-A.3 / Appendix C).

### C-D.3 Omit rather than invent — **CONFIRMED**

v1's posture (doc/18 §2.5) is ratified: a section is emitted **only** when data exists; a
section with no verified code is omitted rather than assigned an unverified code; absent data is
never rendered as a finding. `[uncertain]` the 9 section codes not re-verified live this session
rest on the deep sweep `[sweep 2026-09-16, NRCeS_OPConsultRecord.json]`; **M3 machine validation
against `ndhm.in#6.5.0` is the closing gate** (C-D.4).

### C-D.4 Rule for never pre-generating physician-at-consult sections — **DECIDED**

PhysicalExamination, InvestigationAdvice, Procedure, FollowUp, Referral are **structurally not
emitted** by the machine. Assessment and Plan are **not emitted as sections at all**. This is
enforced in the emitter (sections are built only from captured canon data;
`module-c/medic/fhir_emitter.py:96-271`) and in the renderer (A/P are static physician-only
lines; `renderer.py:151-153`). A test must fail if any of these sections ever appears in a
machine-produced bundle.

### C-D.5 M3 conformance gap to fix before claiming ABDM conformance — **DECIDED (fix required)**

The current emitter references `Patient/...` and `Encounter/...` but does **not** emit those
resources, and the OPConsultRecord profile is **encounter 1..1**
`[verified 2026-09-16, StructureDefinition-OPConsultRecord.html]`. Before any ABDM push, the
emitter must emit the referenced `Patient`, `Encounter`, `Practitioner`/`PractitionerRole` and
`Organization` resources with their NRCeS `meta.profile`. This is an **M3 exit criterion**, not
a design ambiguity. `[uncertain]` the exact `Encounter` status/class bindings — confirm against
`ndhm.in#6.5.0` at M3. **Owner:** Module C lead (emitter) + Module D lead (validation harness).

---

## C-E. AYUSH integration — **DECIDED (v1); Dashavidha v2 DEFERRED (design given)**

### C-E.1 The standards-layer reality (confirmed)

- NAMASTE is the Ministry of Ayush terminology/code portal (2,895 NAMC codes; SAT groups;
  1,941 ASU codes mapped into **WHO ICD-11 Chapter 26 Module 2 (TM2)**, released on the WHO
  browser Feb 2025) `[sweep 2026-09-16, NAMASTE_Portal.json]`.
- NAMASTE has **no official FHIR CodeSystem/ValueSet/ConceptMap, no public API, no downloadable
  dataset, and unstated licensing** `[sweep 2026-09-16, NAMASTE_Portal.json]`.
- NRCeS publishes an **India AYUSH Extension** for SNOMED CT (released 2026-06-29; Ayurveda
  concepts translated to Sanskrit, Siddha to Tamil, Unani to Urdu; covers body structure,
  finding, disorder, etc.) `[verified 2026-09-16, nrces.in/news]` — the FHIR-facing, coded route
  (available to Affiliate Licensees via MLDS) `[sweep 2026-09-16, SNOMED_CT_India_and_CDCI.json]`.
- `OPConsultRecord` has **no Prakriti/Vikriti slots** `[verified 2026-09-16, StructureDefinition-OPConsultRecord.html]`.

### C-E.2 How AYUSH content rides inside IG-accepted sections — **DECIDED (v1)**

1. **Morbidity/disease content** (e.g. a prior practitioner's ASU diagnosis the patient carries)
   rides as a **Condition** inside ChiefComplaints/MedicalHistory with
   `verificationStatus=unconfirmed` and provenance = "patient-reported / from papers". The kiosk
   **never diagnoses**; it only reflects what the patient or their documents state.
2. **Coding:** a code is asserted **only** when an externally verified mapping exists —
   ICD-11 TM2 or the SNOMED CT India AYUSH Extension (via MLDS). Otherwise the entry is
   **free text + a verify flag**, never a fabricated code. Since the AYUSH Extension has no
   public endpoint, a **local subset is embedded** (bounded, release-pinned), consistent with
   the SNOMED/CDCI subsetting approach in doc/20 §B-D and the offline constraint.
3. **Constitutional assessment (Prakriti, Vikriti, Sara, Samhanana, ...)** has no slot in
   OPConsultRecord and **cannot ride as an IG-coded resource in v1**. It is captured (v2 schema)
   and rendered as **narrative text in OtherObservations**, clearly labelled as a
   patient-reported constitutional assessment, not a diagnosis.
4. **Interim representation is documented in the bundle narrative**, so a downstream reader
   knows AYUSH content is patient-reported and not profile-coded.

### C-E.3 Dashavidha layer as additive v2 (design; implementation DEFERRED)

`doc/03` defines 10 parameters. The v2 canon adds `dashavidha` as a **structurally additive**
block (never breaks v1 — see C-J). Split:

- **6 self-report parameters** (capturable at the kiosk without a clinician):
  Prakriti (baseline constitution), Satmya (adaptability), Sattva (mental fortitude, self-rated),
  Ahara Shakti (digestive capacity), Vyayama Shakti (exercise tolerance), Vaya (age/life-stage).
- **4 `requires_clinician` parameters** (elicitation is physician-led; the kiosk may only carry
  a prior clinician's statement or leave `not_elicited`): Vikriti (current vitiation), Sara
  (tissue vitality), Samhanana (compactness), Pramana (measurements).

**Render-without-breaking-v1:** the `dashavidha` block renders as an **optional extra section**
in SOAP's Subjective and in the read-back when present; when absent, v1 output is byte-identical.
`requires_clinician` entries render as `not_elicited (clinician)` in the physician view and are
never shown as captured. `[uncertain]` the exact CCRAS PAS item set — it is an open question
(doc/07) and is explicitly **not** fabricated.

**DEFERRED condition to implement Dashavidha v2:** Module A ships the v2 capture flow (10
parameters with the 6/4 split) **and** the CCRAS PAS item set is sourced and clinician-approved.
**Owner:** Module A lead (capture) + Clinical lead (item set) + Module C lead (render). Until
then, v2 exists only as this schema design.

### C-E.4 NAMASTE licensing — `[uncertain]`

Reuse terms for the NAMASTE code lists are not stated on the portal `[sweep 2026-09-16,
NAMASTE_Portal.json]`. We therefore **do not embed NAMASTE codes** in v1; we use ICD-11 TM2 /
the SNOMED AYUSH Extension (licensed route) and free text otherwise. **Open item for Module D /
counsel** (Appendix C).

---

## C-F. Bilingual rendering specification — **DECIDED**

### C-F.1 What is bilingual, per view — **DECIDED**

| View | Labels | Values | Notes |
|---|---|---|---|
| SOAP (physician) | English only | Verbatim (patient's words kept; Hindi/Hinglish retained as spoken) | The physician view is not translated |
| OLD CARTS (documentation) | English only | Verbatim | Re-organized, not translated |
| Patient read-back (en) | English labels | Verbatim | For English-comfortable patients |
| Patient read-back (hi) | **Hindi (Devanagari) labels** | **Verbatim** (Hindi/Hinglish in the patient's own words; no machine translation) | Values are the patient's own words — translating them would break the read-back's purpose |
| FHIR bundle narrative | English | Verbatim + `Composition.language` | `language` declares the document language |
| Dosage instructions | **Hindi labels/terms** where a licensed Hindi synonym exists (India Patient Instructions Language Extension for SNOMED CT, released 2026-08-31) | Verbatim dose strings | `[verified 2026-09-16, nrces.in/news]` |

**The lane is a deterministic label dictionary + verbatim values, not a translation engine.**
This is already implemented (`renderer.py:24-33, 208-254`) and is the invariant: clinical text is
**rendered, never machine-translated as the source of truth**.

### C-F.2 The translation-lane decision — **DECIDED (fallback included)**

- **v1 lane = deterministic dictionary / verbatim (no MT).** This is DECIDED, not provisional.
- **No machine translation may produce a clinical value in any version.** If a future lane
  translates, it may only translate *labels/prompts/fixed instructional text*, and every
  clinical value stays verbatim from the canon.
- **Evaluation of the MT candidates (for a future fully-Hindi narrative lane), recorded so it
  is not re-litigated:**
  - **IndicTrans2** (MIT; distilled En-Indic 200M ≈ 750 MB fp32 / ≈ 335 MB int8, CPU via
    CTranslate2) — fits the budget and covers Devanagari, but its **core models are frozen
    (last model revision May 2025; last GitHub push 2025-10-03)** and it **does not support
    Hinglish/Romanized code-mixed input**, which is the real patient-language register
    `[sweep 2026-09-16, IndicTrans2.json]`.
  - **IndicTrans3-beta** (Gemma-3 based; vLLM-oriented, 15+7 languages) and **Bodhan AI
    Indic-Translate** (Sept 2026, Gemma 4 E4B, **7.94B params**, adds Romanized/code-mixed
    handling) `[sweep 2026-09-16, IndicTrans2.json]`. The Bodhan model adds the missing Hinglish
    capability but is **far too large for the CPU-only kiosk** and is not CPU-benchmarked.
  - **Decision:** none of these is adopted for v1. A future full-narrative Hindi lane is
    **DEFERRED**, gated on (a) a CPU benchmark on the edge node showing p95 within the dwell
    budget, and (b) code-mixed/Hinglish support (or an upstream step that forces native-script
    input). **Fallback if no candidate passes:** the deterministic lane ships indefinitely —
    Hindi labels + verbatim values — which is a complete, safe product, not a degraded one.
    **Owner:** Module C lead (benchmark) + Module A lead (native-script transcription upstream).
- **Bhashini remains blocked-risk (doc/09)** and is not used.

### C-F.3 Patient read-back contract — **DECIDED**

- **What is spoken:** the deterministic read-back lines for the patient's language (labels in
  Hindi, values verbatim), delivered via the kiosk TTS with the `hi-IN` voice (doc/12 voice
  handling; doc/19 A7).
- **Which language:** the session language; Hindi/Hinglish patients hear the Hindi-label
  read-back (speaking the Devanagari line, never the Roman line — doc/12 decision).
- **How confirmation/denial is captured:** the patient confirms/denies **per group** (complaint
  + symptom slots, allergies, medicines, habits); the result is written into the canon as a
  **patient-confirmation provenance record** — it does **not** clear a machine verify-flag
  (invariant 4). Denials route the item to `needs_review` with the patient's stated correction,
  never silently delete content.

### C-F.4 Read-back ownership (Module A vs Module C) — **DECIDED**

- **Module C owns the read-back *content***: it is a render of the store-once canon
  (`render_readback`), so the read-back stays consistent with every other view.
- **Module A owns the read-back *interaction***: A is the only module that has the session,
  the microphone, the patient still at the kiosk, and the dialogue FSM. A delivers the spoken
  read-back and captures confirm/deny, then writes the confirmation back into the HistoryBundle
  before handing off to C.
- Rationale: doc/11 put read-back in C and the demo put it in A; both are partly right, and
  splitting content (C) from delivery (A) removes the ambiguity without duplicating the canon
  or the voice pipeline. This resolves the long-open question in doc/15 §5.2.

---

## C-G. Evaluation protocol — **ADOPTED (executable as written)**

Named protocol: **“MediKiosk Module C Fidelity Protocol (MCFP-1)”** — the deterministic
subset of the MEDIQA-Chat 2023 protocol `[sweep 2026-09-16,
MTS-Dialog_and_MEDIQA-Chat_2023.json]` plus the omission-restructuring method from OmissionBench
`[sweep 2026-09-16, Clinical_note_omission_and_hallucination_evaluation_papers.json]` and an
inference-aware judge definition (Augnito five-tier taxonomy + safety floor)
`[sweep 2026-09-16, Clinical_note_omission_and_hallucination_evaluation_papers.json]`.

### C-G.1 Metrics

**Layer 1 — deterministic suite (v1 sign-off gate; already implemented in
`module-c/medic/eval_harness.py`):**

| Metric | Definition | Pass |
|---|---|---|
| Per-view field recall | captured canon fields represented in the view / total captured within the view's coverage contract | **1.00 on every view** |
| Omission count | captured canon fields missing from the view (explicit absence testing) | **0** |
| Fabrications | rendered lines whose provenance does not resolve to a canon field id | **0** |
| Determinism | rendering twice yields byte-identical output | **true** |
| NRCeS profile validation | HAPI/matchbox with vendored `ndhm.in#6.5.0` over the gold fixture set | **0 errors** (M3; structural `fhir.resources` is a pre-gate only) |

**Layer 2 — concept/clinical (reference-anchored):**

| Metric | Definition | Anchor |
|---|---|---|
| Critical-concept recall | recall of a clinician-authored critical-fact list, **bound to SNOMED CT / CDCI / ICD-11 TM2 (not UMLS,** which is licence-unsuitable for an Indian commercial product) — the UMASS_BioNLP "medical concept recall" idea / ACI-BENCH MEDCON concept | **1.00 on the safety floor** (see C-G.3) |
| Safety-floor on meds/doses | (a) rendered medications/doses unsupported by any canon field; (b) omitted/changed medication dose present in the canon | **(a) 0; (b) 0** |
| Physician concordance | physician agreement that the summary reflects the written/reference history | **≥ 88%** (lower bound of the published intake-concordance band 88–96%, doc/19 §11) |
| Blinded preference | ground-truth vs kiosk summary, blinded, random order (MEDIQA-Chat method) | reported, not a gate in v1 |
| Section routing accuracy | correct OPConsultRecord slice for each fact | reported; target BLOCKED-CLIN |
| Hindi-language behaviour | a bilingual clinician back-translates each rendered Hindi read-back line; meaning preservation | **≥ 95%** of lines preserve meaning; **0 meaning-flips** (e.g. a leading "no"/"नहीं" never dropped) |

**Layer 3 — LLM-only metrics (apply only if/when the phase-2 lane exists):** ROUGE-1/2/L,
BERTScore, BLEURT, aggregate score as defined by MEDIQA-Chat 2023, with published 2023 numbers
as comparability anchors (WangLab Task-B ROUGE-1 0.6141; GersteinLab ROUGE-1 0.4011 /
BERTScore 0.7058 / BLEURT 0.5421) `[sweep 2026-09-16, MTS-Dialog_and_MEDIQA-Chat_2023.json]`.
These are **not** v1 gates (there is no free text to score).

### C-G.2 Judge definition (inference-aware) — **DECIDED**

Any LLM-assisted evaluation or lane uses this judge definition, not a lexical-faithfulness judge:

1. **Enumerate-then-check (omission side):** enumerate the facts the *canon* establishes (from
   HistoryBundle slots + Module B extracts — **not** from the generated summary), then return a
   closed present/partial/absent verdict per fact, and decide on the verdicts
   `[sweep 2026-09-16, omission paper: judges verify presence not absence; paired 0.50–0.63 on
   omissions vs 0.79–0.94 on added content]`.
2. **Per-section coverage, not per-note:** score coverage per OPConsultRecord slice, because
   "restatement-trace" omissions (a fact moved to another heading) defeat whole-note checks
   `[sweep 2026-09-16, omission paper]`.
3. **Inference-aware commission check (fabrication side):** classify each claim into the Augnito
   five tiers (direct statement / paraphrase / trade-generic equivalence / clinical inference /
   speculative overreach or contradiction) and count only the last tier, while retaining a hard
   safety floor on unsupported medications, doses, procedures and contradictions
   `[sweep 2026-09-16, Augnito arXiv:2604.14829]`. A lexical judge inflates hallucination to
   35.2% against a 10.4% human baseline; the inference-aware judge drops to 9.1%.
4. **Deterministic-first:** in v1 the strongest judge is not an LLM at all — it is provenance
   resolution (a rendered line whose `src` does not resolve is a fabrication by construction).
   LLM judging is only for the phase-2 lane.

### C-G.3 Datasets — **DECIDED**

| Purpose | Dataset | Use |
|---|---|---|
| Harness mechanics + rubric calibration (English) | **ACI-BENCH** (207 pairs; CC BY 4.0 data) `[sweep 2026-09-16, ACI-BENCH.json]` and **MTS-Dialog** (1,701 pairs; CC BY 4.0) `[sweep 2026-09-16, MTS-Dialog…json]` | Method validation only. Honest limitation: these are dialogue→note, US-English, synthetic role-play; they do **not** exercise the bundle→summary pipeline, Hindi, or AYUSH. |
| Omission-method validation | **OmissionBench** (CC BY 4.0 data; MIT harness; cloud judges) `[sweep 2026-09-16, omission paper]` | Adopt the enumerate-then-check method; re-run with a **local judge** (never a cloud API — offline/residency). |
| Real clinical validation (India) | **MC-1** — a locally-curated, consented Indic OPD eval set (see C-G.4) | The only source of real product metrics; ethics + DPDP-clean consent are prerequisites. |

Vendor for offline use: ACI-BENCH/MTS-Dialog/OmissionBench data are CC BY 4.0 and vendorable;
their metric harnesses are re-implemented locally (no cloud dependency).

### C-G.4 MC-1 clinical evaluation set — **DECIDED (methodology); collection DEFERRED**

- **Unit:** one consented kiosk session = HistoryBundle + Module B DocumentSide + the physician's
  reference history + a clinician-authored critical-fact list.
- **Size / statistical basis:** reuse doc/20 §B-A.1's proportion math. n=280 → 95% CI half-width
  ±5.9 pp worst case (p=0.5), ±3.5 pp at p≈0.10; n=200 → ±6.9 pp. Target **n≥280 sessions**
  across ≥2 public OPD sites, stratified by presenting system and language (English / Hindi /
  Hinglish). `[uncertain]` the exact site list (team/partner decision).
- **Ground truth:** physician-authored reference history (not the kiosk's own output), plus a
  clinician critical-fact list for the safety floor.
- **Ethics/consent:** site Institutional Ethics Committee approval (ICMR 2017 framework) plus
  DPDP-clean, itemised study consent, exactly as doc/20 §B-A.4.
- **Collection condition to unblock:** ethics approval + signed site agreements.
  **Owner:** Clinical lead (protocol/IEC) + Module C lead (harness).

### C-G.5 Executable runbook (so a different team can run it)

1. **Vendor the packages offline:** `fhir.resources` (pinned), the `ndhm.in#6.5.0` package, the
   HAPI/matchbox validator, and the CC BY 4.0 eval corpora. Freeze the network.
2. **Structural pre-gate:** run `python -m medic.cli --out out/` on the gold fixtures (this
   executes the C6 harness and writes `out/eval.json`; `eval_harness` has no module entry point,
   so it is run **through the CLI**, not as `python -m medic.eval_harness`); assert the Layer-1
   values in `out/eval.json` (per-view recall, omissions, fabrications, determinism) pass.
3. **Profile gate (M3):** POST each emitted Bundle to the local HAPI/matchbox `$validate` with
   `ig=ndhm.in#6.5.0`; assert **zero errors**; store the `OperationOutcome`.
4. **Regression gate:** any emitter/renderer/canon change re-runs steps 2–3 in CI; a diff in a
   golden fixture requires clinical review (doc/19 §11).
5. **Clinical study (MC-1):** collect n≥280 consented sessions; two clinicians independently
   score concordance, the critical-fact list, omissions per section, the safety floor and the
   blinded preference; a bilingual clinician back-translates the Hindi read-back. Compute
   Layer-2 metrics; **pass = C-G.1 gate values**, **fail = any safety-floor breach or a
   concordance below 88%**.
6. **Report:** publish an internal validation report with per-stratum intervals (page/session as
   the unit; bootstrap by session), not a single headline number.

### C-G.6 Is the deterministic suite sufficient for v1 sign-off? — **DECIDED**

**Yes for engineering sign-off, no for clinical sign-off.** The deterministic suite proves
fidelity-by-construction (no fabrication, no omission) and is necessary but not sufficient: it
cannot prove the summary is *clinically useful*. v1 clinical sign-off therefore requires
**both** the Layer-1/Layer-3 engineering gates **and** the MC-1 clinician gates.

### C-G.7 Trigger for the phase-2 LLM lane — **DECIDED**

The lane opens only when, on MC-1, the deterministic summary's **physician-rated completeness /
usefulness** falls below the pre-registered floor **while** Layer-1 fidelity stays perfect — i.e.
the failure is *expressiveness, not fidelity*. Pre-registered floor: **≥ 90% of cases rated
"adequate/complete" on the completeness rubric** (suggested default; **BLOCKED-CLIN** — the
clinical lead sets and signs the final threshold). **Owner:** Clinical lead + Module C lead.

---

## C-H. Phase-2 LLM narrative lane — gate DECIDED, lane DEFERRED

### C-H.1 CPU reality (the reason it cannot be casual) — **recorded**

Qwen3-4B Q4_K_M measured **6.50 t/s generation** on a 16-core x86-64 CPU (pp512 2064.8 t/s;
`[sweep 2026-09-16, Qwen3_small_models.json]`). A 200-token summary is therefore **≈ 30 s of
pure generation**, on top of ASR and OCR, on a 2–5 minute consult path with a ~4 GB kiosk
(doc/19 §9). The 4B Q4_K_M file is 2.50 GB / ~3 GB RAM; Qwen3-1.7B Q4_K_M ≈ 1.13 GB
`[sweep 2026-09-16, Qwen3_small_models.json]`. Conclusion: **the lane must never sit on the
consult critical path**, and must not co-run with ASR/OCR.

### C-H.2 Entry criteria (measurable) — **DECIDED**

All must hold:

1. C-G.7 trigger fired (physician completeness below the signed floor, fidelity perfect).
2. A model+quantization CPU benchmark on real kiosk/edge hardware shows p95 generation for a
   bounded (≤200-token) narrative within the **background** budget (i.e. it runs off the
   critical path — edge node or post-handoff batch).
3. The candidate passes MCFP-1 with the C-G.2 inference-aware judge: **fabrications = 0**
   (every narrative line still resolves to a canon field id), **omissions = 0** on the critical
   fact list, safety floor clean.
4. Legal/regulatory: the chosen weights are permissively licensed (Apache-2.0 Qwen3 is the
   current candidate `[sweep 2026-09-16, Qwen3_small_models.json]`) and the intended-use wording
   is unchanged.

### C-H.3 Guardrails — **DECIDED**

- The LLM may only **polish/rephrase** canon facts into narrative; it may **not** add facts,
  infer diagnoses, or emit any line without provenance. Any line whose provenance does not
  resolve is dropped before render (fail-closed).
- Temperature 0 + a bounded prompt + a grammar/schema constraint; thinking/reasoning mode
  disabled (reasoning traces hurt note fidelity, doc/18 §2.1).
- The deterministic renderer remains the default and the fallback; the LLM lane is an
  **additive view**, never a replacement, and never touches the FHIR emitter.

### C-H.4 Rollback condition — **DECIDED**

Any fabrication, safety-floor breach, or regression in the deterministic suite on any release
**reverts the lane to deterministic-only** until re-validated. The lane is feature-flagged off by
default; enabling it is a signed release event.

**Owner:** Module C lead (implementation) + Clinical lead (entry criteria). **Status: DEFERRED**
(the lane itself is not built; the gate is decided).

---

## C-I. Reconciliation edge cases — **DECIDED**

Extends the existing dose/unit-tolerance rules (`merger.py:31-48, 152-220`). Every case below
either merges only with positive evidence or retains both values + `needs_review` (invariant 3).

| Case | Behaviour | Surfaced as |
|---|---|---|
| **Brand → generic** (e.g. "Ecosprin" vs "Aspirin") | Map via the CDCI Flat Files (name→generic) only when the mapping table confirms the pair; if brand and generic both present at the same strength, merge with provenance `patient+document`; if strength differs or no mapping, keep both | If unmapped or strength differs: `verify` alert "possible duplicate (brand/generic) — confirm" |
| **Frequency notation `1+0+1`** | Preserve verbatim; normalise to a structured frequency only if it matches the clinician-signed closed dictionary (OD/BD/TDS/QID/HS/SOS + the `x+y+z` morning/afternoon/night convention); otherwise keep verbatim | Unrecognised notation: `verify` alert "frequency as written — confirm" |
| **PRN / SOS (as-required)** | Keep as SOS **with its stated indication**; never convert an SOS to a scheduled frequency | Missing indication: `verify` alert; present: rendered as "as required for <indication>" |
| **Tapering schedules** | Keep the full multi-step schedule verbatim in one entry; never collapse to a single dose; always flag | Always `verify` (safety) |
| **Duplicate, different strength** (same drug, two doses) | Retain BOTH doses + `needs_review` (existing conflict rule) | `verify` alert "dose differs: …" (existing) |
| **Cross-visit carry conflict** (a carried prior med contradicts a current statement) | Keep both; the carried entry keeps `carriedFrom` prior-visit provenance; never let "carried" override "current" | `verify` alert "prior visit says X, this visit says Y — confirm" |

**Definition of `needs_review` (precise, for every case):** a canon item that a human clinician
must explicitly disposition before the record can become `final`. It appears in the physician
alert list with its reason; it clears **only** by clinician attestation/edit (never by patient
confirmation — invariant 4); while any verify-flagged item lacks a disposition, the Composition
stays `preliminary` and cannot be attested to `final` (C-B.1). The emitted resource carries the
flag in-band (e.g. `MedicationRequest.status=draft` + a note "needs physician verification",
existing `fhir_emitter.py:292-300`).

**Mapping data dependency:** brand↔generic mapping needs the CDCI Flat Files Package; its
bundled `License.txt` must be read before embedding `[uncertain]`, inherited from doc/20 §B-F.2 /
Appendix C. **Owner:** Module D lead (licence) + Module C lead (merger).

---

## C-J. Canon versioning and repeat visits — **DECIDED**

### C-J.1 Additive v2 (never breaking) — **DECIDED**

- v2 schema string `medikiosk-history-bundle/2` is a **superset** of v1: it adds `dashavidha`,
  `visit.carried_from`, `visit.delta`, `respondent.relation` confirmation and `confirmation`
  provenance records. No v1 field changes meaning.
- The loader accepts a **major-compatible** set of schema strings and provides an explicit
  **`to_v1()` projection** for consumers that only understand v1; a v1-only consumer must
  **reject** a v2 bundle loudly rather than silently drop unknown fields. This is the additive
  rule: new optional fields, explicit projection, no silent reinterpretation.
- The emitted FHIR bundle records the canon version it was rendered from (`Bundle.meta.tag`),
  so a summary is always traceable to its canon schema version.

### C-J.2 Repeat-visit delta and carry semantics — **DECIDED**

Uses the demo-verified design (doc/15-innovation-features §1; decisions 2026-09-11 night):

- **Carry = verbatim copy with `carriedFrom: <prior session/field-id>` provenance.** The
  patient's prior words stay `by: patient`; a "same" confirmation is recorded **separately** as
  the confirmer (never misattributed as a new statement, and never counted as proxy speech).
- **Delta = fields changed since the prior visit.** The renderer emits "changed since last visit"
  vs "unchanged (carried)" with provenance to both the prior and current field ids.
- **Conflicts** follow C-I (cross-visit carry conflict).
- **Stable-field list:** which fields are safe to carry vs re-elicit every visit is a
  **clinician-approved list** (BLOCKED-CLIN). Until signed, carry is limited to factual fields
  (medications, allergies, PMH) and never to subjective states (severity, worry, expectations),
  matching the existing proxy-subjective guardrail.
- **Owner:** Clinical lead (stable-field list) + Module A lead (v2 capture) + Module C lead.

### C-J.3 Retention and consent boundaries for derived summaries — **DECIDED**

The DPDP Rules 2025 require a standalone, plain-language, **itemised** notice naming the personal
data processed and every specified purpose, and a generated summary is itself personal data and
separate processing `[sweep 2026-09-16, DPDP_Rules_2025.json]`. Decision:

1. **Itemise at intake — no reliance on vagueness.** The in-kiosk notice (Module D) must
   explicitly name **summary generation, storage, physician handover and (if applicable) ABDM
   upload** as separate, individually revocable purposes. If the notice itemises them, the
   summary is **covered by intake consent** and no separate fresh notice is required.
2. **Fallback if the intake notice did not itemise a purpose:** obtain **fresh, purpose-specific
   consent** at the summary-generation step before processing for that purpose. The design must
   therefore support a mid-session, per-purpose consent (Module D builds this).
3. **Retention:** the derived summary inherits the intake retention clock for the purposes it
   was collected under; erasure is **crypto-erasure** (key destruction) at the tier that holds
   it; the hospital record (its legal record) is not erased by a patient consent withdrawal
   where another law requires retention (doc/19 §6; doc/20 §B-C.5). Per-purpose retention clocks
   are stored on the summary.
4. **Legal confirmation** of the "covered if itemised" reading is queued for counsel (Module D),
   but the **design decision above does not depend on it**: we itemise regardless, so the safe
   path is taken either way.

**Status:** design DECIDED; Module D owns the notice/consent plumbing; the legal sign-off is a
Module D/counsel item (Appendix C).

---

## How this design respects the 7 invariants (doc/19 §0)

| Invariant | Where enforced in this design |
|---|---|
| 1. Never diagnose | A/P structurally absent (C-D.4); AYUSH carries patient-reported content only (C-E.2) |
| 2. Never fabricate | Per-line provenance + eval fabrications=0 (C-G.1); omit-don't-invent (C-D.3); no invented ranges (C-C.1) |
| 3. Never silently resolve | C-I retains both values + `needs_review` for every conflict |
| 4. Never let a machine clear uncertainty | Patient read-back confirmation does not clear verify (C-F.3); only clinician disposition clears (C-B) |
| 5. Never store PHI beyond policy | Purpose-itemised consent + per-purpose retention + crypto-erasure (C-J.3) |
| 6. Never phone home | Offline lane only; no cloud judge or MT as source of truth (C-F, C-G) |
| 7. Never block care on failure | Deterministic renderer + deterministic fallback; any LLM lane feature-flagged (C-H.4) |

---

## Appendix A — Decision register (summary)

| ID | Decision | Status | Owner |
|---|---|---|---|
| C-A1 | Two-artifact emission (OPConsultRecord + HealthDocumentRecord), pinned `ndhm.in#6.5.0` | DECIDED | Module C lead |
| C-A2 | INPS as future structured-summary carrier | DEFERRED (NRCeS publishes v7.0.0 release + M3 validation) | Module C + D leads |
| C-A3 | Author = hospital Organization + kiosk Device; patient = source, not author | DECIDED | Module C lead |
| C-A4 | Attestation flips preliminary→final; app-enforced | DECIDED | Module C lead |
| C-A5 | IG version recorded in every bundle; no auto-upgrade; CI revalidation | DECIDED | Module C lead |
| C-B1 | Attestation lifecycle + separation of duties + 7-yr chained audit | DECIDED | Module C lead |
| C-C1 | Range source = patient's report (primary) → clinician-signed fallback → else no flag | DECIDED | Module C lead |
| C-C2 | Fallback range values (adult panel, sex-specific where material) | BLOCKED-CLIN | Clinical lead |
| C-C3 | Severity order red-flag → verify → abnormal; critical tier | DECIDED / tier DEFERRED-BLOCKED-CLIN | Clinical lead |
| C-D1 | Canon→IG map incl. OtherObservations 404684003; omit-don't-invent | DECIDED | Module C lead |
| C-D2 | Never pre-generate physician-at-consult sections or A/P | DECIDED | Module C lead |
| C-D3 | Emit referenced Patient/Encounter/Practitioner/Organization for M3 | DECIDED (M3 exit criterion) | Module C + D leads |
| C-E1 | AYUSH rides in existing sections, coded only via ICD-11 TM2 / SNOMED AYUSH Extension, else free text | DECIDED | Module C + Clinical lead |
| C-E2 | Dashavidha v2 additive (6 self-report + 4 `requires_clinician`) | DEFERRED (v2 capture + PAS item set) | Module A + Clinical leads |
| C-F1 | Bilingual = deterministic dictionary labels + verbatim values | DECIDED | Module C lead |
| C-F2 | Full-narrative MT lane | DEFERRED (CPU benchmark + Hinglish support) | Module C + A leads |
| C-F3 | Read-back: C owns content, A owns interaction; confirmation doesn't clear verify | DECIDED | Module C + A leads |
| C-G1 | MCFP-1 protocol adopted; deterministic suite = engineering sign-off | DECIDED | Module C lead |
| C-G2 | MC-1 real-OPD clinical set (n≥280) | DEFERRED (ethics + site agreements) | Clinical lead |
| C-G3 | LLM-lane trigger = completeness below signed floor with perfect fidelity | DECIDED (floor BLOCKED-CLIN) | Clinical + Module C leads |
| C-H1 | Phase-2 LLM lane gate/guardrails/rollback | DECIDED (lane DEFERRED) | Module C + Clinical leads |
| C-I1 | Reconciliation edge-case semantics | DECIDED | Module C lead |
| C-J1 | Additive v2 + explicit `to_v1()` projection | DECIDED | Module C lead |
| C-J2 | Repeat-visit carry/delta; stable-field list | DECIDED / list BLOCKED-CLIN | Clinical + A + C leads |
| C-J3 | Summary purpose itemised at intake; fallback fresh consent; crypto-erasure | DECIDED (legal confirmation Module D) | Module D lead |

## Appendix B — Evidence register (fetched 2026-09-16 unless noted)

- NRCeS IG for ABDM v6.5.0 = **current published release**, generated 2025-05-08 —
  `nrces.in/ndhm/fhir/r4/index.html`.
- NRCeS `OPConsultRecord` v6.5.0 profile: mandatory status/type/subject(Patient)/encounter/date/
  author/title; `type` fixed SNOMED 371530004; `attester` **0..\***; `author` 1..\*; `section`
  1..\* Unordered/Open-At-End; live-confirmed section codes ChiefComplaints 422843007,
  PhysicalExamination 425044008, Allergies 722446000 —
  `nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html`.
- NRCeS IG v7.0.0 = **preview "Local Development build"**, generated 2026-07-15; INPS derived
  from HL7 IPS 2.0.0, dual ABDM+IPS conformance via `imposeProfile`; mandatory Problems/
  Allergies/Medications; optional Patient Story/Social History/Plan of Care —
  `nrces.in/preview/ndhm/fhir/r4/inps-general-guidance.html`.
- NRCeS version history returns **"TBD"** — `nrces.in/preview/ndhm/fhir/r4/history.html`.
- NRCeS news: v6.5.0 build 2025-05-09; India AYUSH Extension and CLCI 2026-06-29; CDCI/DISB and
  India Patient Instructions Language Extension 2026-08-31; BHTS 2026-06-29 —
  `nrces.in/news`.
- Module-3 deep sweep JSONs (2026-09-16): `NRCeS_OPConsultRecord`, `ABDM_HealthDocumentRecord_profile`,
  `HL7_International_Patient_Summary`, `DPDP_Rules_2025`, `NAMASTE_Portal`, `IndicTrans2`,
  `fhir.resources_Python_package`, `MTS-Dialog_and_MEDIQA-Chat_2023`,
  `Clinical_note_omission_and_hallucination_evaluation_papers`, `ACI-BENCH`, `HAPI_FHIR`,
  `matchbox_FHIR_validation_server`, `Qwen3_small_models`, `SNOMED_CT_India_and_CDCI` —
  `module-3-summary-generation/results/`.
- NABL 112A (18-Dec-2024, ISO 15189:2022) reference-interval definition and reporting duty;
  J Lab Physicians 2026 review — `nabl-india.org` (NABL 112A PDF), `doi:10.25259/jlp_316_2025`.
- Module B production design (cross-module consistency) — `doc/20-module-b-production-design.md`.

## Appendix C — What this doc did NOT resolve (DEFERRED items, each with an owner)

| Item | Condition to unblock | Owner |
|---|---|---|
| INPS as the structured-summary carrier | NRCeS publishes v7.0.0 as a non-preview release + M3 validation green | Module C + D leads |
| `[uncertain]` whether NRCeS would prefer a HealthDocumentRecord wrapper for an unattested patient-elicited document | NRCeS/NHA confirmation | Module D lead |
| Fallback reference-range values + critical-value thresholds + paediatric ranges + stable-field list + completeness floor | Clinician-signed source / judgement | Clinical lead |
| Dashavidha v2 implementation | Module A v2 capture + sourced CCRAS PAS item set | Module A + Clinical leads |
| Full-narrative Hindi MT lane | CPU benchmark within dwell budget + Hinglish/code-mixed support | Module C + A leads |
| MC-1 real-OPD clinical set | IEC approval + signed site agreements | Clinical lead |
| NAMASTE reuse licence | Ministry of Ayush / counsel clarification | Module D lead |
| CDCI Flat Files `License.txt` terms | Read the bundled file before embedding | Module D lead |
| Summary-notice legal reading ("covered if itemised") | Counsel confirmation (design already takes the safe path) | Module D lead |

---

## Appendix — KB updates required

> **DO NOT apply these edits from this session** — parallel agents are writing other docs.
> These are the exact proposed texts for the knowledge-base owner to apply.

### 1. `doc/research/05-research-log.md` — dated entry to append

```markdown
## 2026-09-16 - Module C Production Design (doc/21: C-A…C-J gap closure)

**What was done:** Module C lead session. Research/design only, no code. Re-verified the NRCeS
release-vs-preview question live, then closed or formally deferred all ten Module C gaps
(C-A…C-J) in a new doc/21. Read the 2026-09-16 Module-3 deep sweep as the first evidence stop,
then re-fetched first-party NRCeS pages.

**Key findings (verified this session unless noted):**
- **NRCeS FHIR IG for ABDM v6.5.0 is the current published release** (generated 2025-05-08;
  news build 2025-05-09); **v7.0.0 is a preview "Local Development build"** (generated
  2026-07-15) and the IG version-history page returns **"TBD"** — no confirmed publication date.
  INPS (Indian Patient Summary, from HL7 IPS 2.0.0) exists only in v7.0.0 preview.
- `OPConsultRecord` v6.5.0 live-confirmed: mandatory status/type/subject/encounter/date/author/
  title; type fixed SNOMED 371530004; **`attester` is 0..\*** (application-enforced
  attestation); author 1..\*.
- **Emission-artifact decision (C-A):** two artifacts pinned to release `ndhm.in#6.5.0` —
  structured pre-visit summary as OPConsultRecord (`status=preliminary` until attestation) +
  raw scans as HealthDocumentRecord; **INPS deferred** (condition + fallback designed).
- **Bilingual decision (C-F):** deterministic label dictionary + verbatim values; clinical text
  is never machine-translated as source of truth. IndicTrans2 core models are frozen (2025-05)
  and lack Hinglish; newer IndicTrans3-beta/Bodhan are not CPU-proven. Full-narrative MT lane
  deferred with a deterministic fallback.
- **Eval protocol (C-G):** MCFP-1 adopted — deterministic suite (per-view recall 1.0, omissions 0,
  fabrications 0, determinism) + concept recall bound to SNOMED/CDCI/ICD-11 TM2 (not UMLS) +
  inference-aware judge + per-section omission checks; real-OPD clinical set MC-1 (n>=280)
  designed, collection gated on ethics.
- **Reference ranges (C-C):** primary source is the reference interval printed on the patient's
  own NABL/ISO 15189-compliant report; the kiosk fallback table is BLOCKED-CLIN, owner Clinical
  lead. Never flag without a known range.
- NABL 112A (ISO 15189:2022) defines the biological reference interval and requires labs to
  report reference intervals — the governance anchor for C-C.

**Sources:** `nrces.in/ndhm/fhir/r4/index.html`, `nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html`,
`nrces.in/preview/ndhm/fhir/r4/inps-general-guidance.html`, `nrces.in/preview/ndhm/fhir/r4/history.html`,
`nrces.in/news`, `nabl-india.org` (NABL 112A), and the 2026-09-16 `module-3-summary-generation/results/` JSONs.
**Full design:** `doc/21-module-c-production-design.md`.
```

### 2. `doc/research/07-open-questions.md` — edits (quote current text → replacement)

**Edit 2a — close the emission-artifact question.** Current bullet (lines 90-93):

```markdown
- [ ] **Which NRCeS/ABDM artifact carries the kiosk-generated pre-consultation summary?** OPConsultRecord = the doctor's consult note; HealthDocumentRecord = patient-uploaded records. Neither is a patient-elicited pre-visit history summary. Decide the emission shape (and author/attester semantics) before Module C/D integration design. US Core's "Mediated Submission / PATAST" patient-asserted-note pattern is the international precedent — verify with NRCeS whether an equivalent exists or is needed.
```

Replacement:

```markdown
- [x] **Which NRCeS/ABDM artifact carries the kiosk-generated pre-consultation summary?** — **CLOSED 2026-09-16 (doc/21 §C-A).** **Decision:** two artifacts pinned to the NRCeS IG **release ndhm.in#6.5.0** — structured pre-visit summary as **OPConsultRecord** (`status=preliminary` until physician attestation flips it to `final`), raw scans as **HealthDocumentRecord**. **INPS (v7.0.0 preview) is deferred** as the structured-summary carrier until NRCeS publishes v7.0.0 as a non-preview release and M3 validation passes; fallback if it never ships is the v1 design itself (content rides in OtherObservations/MedicalHistory/narrative). Author = hospital Organization + kiosk Device (patient is the source, not the author). The "PATAST / Mediated Submission" reference remains **unsourced — dropped**. Remaining NRCeS-facing sub-item: `[uncertain]` whether NRCeS would prefer a HealthDocumentRecord wrapper for an unattested patient-elicited document (owned by Module D, doc/21 Appendix C).
```

**Edit 2b — close the evaluation-protocol question.** Current bullet (line 94):

```markdown
- [~] **Module C evaluation protocol** — hallucination measurement for clinical summaries is methodology-dependent (35% naive vs 9% inference-aware per arXiv:2604.14829). Name the judge protocol (rubric, safety floor on meds/doses, Hindi-language behavior) before quoting any accuracy number.
```

Replacement:

```markdown
- [x] **Module C evaluation protocol** — **ADOPTED 2026-09-16 as MCFP-1 (doc/21 §C-G).** Named protocol = deterministic suite (per-view field recall = 1.0, omissions = 0, fabrications = 0, determinism) + concept recall bound to **SNOMED CT / CDCI / ICD-11 TM2 (not UMLS** — licence-unsuitable) + **inference-aware judge** (Augnito five-tier taxonomy + safety floor; a lexical judge inflates hallucination 35.2% vs a 10.4% human baseline) + **per-section omission checks** (enumerate facts from the canon, not the summary — arXiv:2608.31016). ROUGE/BERTScore/BLEURT apply only to the phase-2 LLM lane. Real-OPD clinical set **MC-1** (n>=280) designed; collection gated on ethics + site agreements (Clinical lead).
```

**Edit 2c — close the bilingual-rendering question.** Current bullet (line 109):

```markdown
- [ ] **Bilingual rendering engine** — IndicTrans2 (MIT, CT2 CPU path) exists for EN↔22 Indic; Bhashini remains blocked-risk per doc/09. Decide offline translation lane for the patient-language summary.
```

Replacement:

```markdown
- [x] **Bilingual rendering engine** — **DECIDED 2026-09-16 (doc/21 §C-F).** v1 lane = **deterministic label dictionary + verbatim values** (no MT); clinical text is rendered, never machine-translated as the source of truth. **IndicTrans2** core models are frozen (last revision May 2025; GitHub push 2025-10-03) and **do not support Hinglish/Romanized code-mixed input**; **IndicTrans3-beta** and **Bodhan AI Indic-Translate** (Gemma 4 E4B, ~7.94B params) add code-mixed handling but are **not CPU-benchmarked and too large for the kiosk**. Full-narrative Hindi MT lane is **DEFERRED** (gate: CPU p95 within dwell budget + Hinglish support); the deterministic lane ships as the fallback. Bhashini remains blocked-risk. Read-back ownership resolved: Module C owns the content (a canon view), Module A owns the interaction/confirmation capture.
```

**Edit 2d — re-scope the repeat-visit carry item (Innovation Candidates).** Current text (lines 124-126):

```markdown
  - *Update (2026-09-11 night):* **designed + demo-implemented** — see `doc/15-innovation-features.md`
    §1 and guided demo 3 in the prototype. Remaining product-track work: HistoryBundle
    versioning per visit (Module C/D contract) + clinician-approved stable-field list.
```

Replacement:

```markdown
  - *Update (2026-09-11 night):* **designed + demo-implemented** — see `doc/15-innovation-features.md`
    §1 and guided demo 3 in the prototype.
  - *Update (2026-09-16, doc/21 §C-J):* **HistoryBundle per-visit carry/delta schema RESOLVED at the
    design level** — additive v2 (`medikiosk-history-bundle/2`) with `carriedFrom` provenance, verbatim
    carry, delta block and an explicit `to_v1()` projection; cross-visit conflicts retain both values
    (`needs_review`). **Remaining:** the clinician-approved stable-field list (BLOCKED-CLIN; owner
    Clinical lead) and Module A's v2 capture flow.
```

**Edit 2e — re-scope the FHIR-serialized HistoryBundle sub-item** (within the HistoryBundle bullet, lines 22-24). Current text:

```markdown
    team ratification, Dashavidha layer (v2), FHIR serialization of the canon (the OPConsultRecord emitter
    covers the physician-facing side; a FHIR-serialized HistoryBundle for Module D
    exchange is still open).
```

Replacement:

```markdown
    team ratification, Dashavidha layer (v2), FHIR serialization of the canon (the OPConsultRecord emitter
    covers the physician-facing side; doc/21 §C-J/§C-A govern canon versioning and the emission shape).
    A **FHIR-serialized HistoryBundle for Module D exchange is transferred to Module D** (doc/22) — it is a
    Module D contract, not a Module C deliverable.
```

### 3. `doc/decisions/06-decisions-log.md` — decisions-log rows to append

```markdown
## Decisions confirmed 2026-09-16 (Module C production design — doc/21)

> Module C lead session; research/design only, no code. Full rationale in
> `doc/21-module-c-production-design.md`. Product-track Module C decisions (the demo rows
> above remain demo-scope). DEFERRED rows state their unblocking condition + owner.

| Decision | Choice | Why |
|---|---|---|
| Emission artifact (C-A) | **Two artifacts pinned to NRCeS IG release `ndhm.in#6.5.0`**: structured pre-visit summary as **OPConsultRecord** (`status=preliminary` until physician attestation), raw scans as **HealthDocumentRecord**. **INPS deferred** | v6.5.0 is the current published release (generated 2025-05-08; news build 2025-05-09); v7.0.0 is a preview "Local Development build" (2026-07-15) and the version-history page returns "TBD". OPConsultRecord's 12 codes are stable across both; INPS's mandatory Problems section ("active/current") is a poor fit for a never-diagnose kiosk and requires dual ABDM+IPS conformance. Fallback if INPS never ships is the v1 design itself. [verified 2026-09-16, nrces.in] |
| Author/attester + attestation lifecycle (C-A/C-B) | `author = [Organization(hospital HFR), Device(kiosk)]`; patient is the source, not the author; `attester` empty until physician attestation flips `preliminary`→`final`; any post-final edit → `amended` + re-attestation; only clinician disposition clears a verify-flag | `Composition.attester` is **0..\*** (must-support), so the profile does not guarantee sign-off — the app enforces it. Author types are permitted by the release profile. [verified 2026-09-16, StructureDefinition-OPConsultRecord.html] |
| IG version pinning (C-A) | **Pin `ndhm.in#6.5.0`; record the pin + emitter version in every bundle; CI revalidates fixtures; no auto-upgrade** | Emitted artifacts must be traceable to the contract they were validated against; upgrades are release events (doc/19 §10/§12). |
| Canon→IG section mapping (C-D) | Map HPI/ROS/ICE to **OtherObservations 404684003**; PMH→MedicalHistory 371529009; AYUSH/patient-reported conditions→ChiefComplaints/MedicalHistory as unconfirmed; **never pre-generate** PhysicalExamination/InvestigationAdvice/Procedure/FollowUp/Referral or A/P; omit rather than invent a code | The 12 fixed codes are verified (3 live, 9 via the 2026-09-16 deep sweep) and unchanged in v7.0.0; the profile has no HPI/ROS/Social/AYUSH slices, so the gap is documented, not force-coded. |
| M3 emitter conformance fix (C-D) | **Emit the referenced Patient, Encounter, Practitioner/PractitionerRole and Organization resources with NRCeS `meta.profile`** before any ABDM push | OPConsultRecord is `encounter` 1..1; the current emitter references an Encounter it never emits. M3 exit criterion. [verified 2026-09-16, StructureDefinition-OPConsultRecord.html] |
| Reference ranges (C-C) | **Primary = the reference interval printed on the patient's NABL/ISO 15189-compliant report; fallback = clinician-signed, cited, versioned table; no range → do not flag; abnormal on a verify-flagged read stays `verify`** | Reference intervals are a laboratory/ISO 15189 responsibility and are reported on the report (NABL 112A). Shipping a guessed table is fabrication. Numbers **BLOCKED-CLIN** (owner Clinical lead). [verified 2026-09-16, nabl-india.org] |
| AYUSH integration (C-E) | Conditions ride as patient-reported/from-papers **Condition** entries; code only via **ICD-11 TM2 / SNOMED CT India AYUSH Extension** (local subset), else free text + verify; NAMASTE codes **not embedded** (unstated licence). Dashavidha = **additive v2** (6 self-report + 4 `requires_clinician`), rendered optionally without breaking v1 | NAMASTE has no official FHIR artifacts/API/dataset and unstated licensing; OPConsultRecord has no Prakriti/Vikriti slot. Ellicit-never-diagnose means AYUSH content is patient-reported only. [sweep 2026-09-16; verified 2026-09-16, nrces.in/news] |
| Bilingual lane (C-F) | **Deterministic label dictionary + verbatim values; clinical text never machine-translated as source of truth.** Read-back: C owns content, A owns interaction; patient confirmation does not clear a verify-flag. Full-narrative MT lane **DEFERRED** | IndicTrans2 is frozen (2025-05) and lacks Hinglish; IndicTrans3-beta/Bodhan are not CPU-proven (Bodhan ~7.94B params). The deterministic lane is the safe fallback. [sweep 2026-09-16, IndicTrans2.json] |
| Eval protocol (C-G) | **MCFP-1 adopted:** deterministic suite (recall 1.0, omissions 0, fabrications 0, determinism) + concept recall bound to SNOMED/CDCI/ICD-11 TM2 (not UMLS) + inference-aware judge (Augnito tiers + safety floor) + per-section omission checks; ROUGE/BERTScore/BLEURT only for the phase-2 lane; MC-1 real-OPD set n>=280 | Answers the omission-blindness finding (arXiv:2608.31016) and the 35%/9% hallucination-measurement dispute (arXiv:2604.14829); the deterministic suite is engineering sign-off, MC-1 is clinical sign-off. [sweep 2026-09-16] |
| Phase-2 LLM lane gate (C-H) | **Gate DECIDED, lane DEFERRED.** Opens only if the deterministic summary's completeness falls below the signed floor while fidelity is perfect, AND a CPU benchmark fits the background budget, AND the lane keeps fabrications=0/omissions=0; guardrails = polish-only, provenance-required, thinking disabled; rollback = any fabrication/safety breach | Qwen3-4B Q4_K_M ≈ 6.5 t/s (a 200-token summary ≈ 30 s) cannot sit on a 2–5 min consult path; the deterministic renderer stays the default and fallback. [sweep 2026-09-16, Qwen3_small_models.json] |
| Reconciliation edge cases (C-I) | Brand→generic (map only with CDCI evidence), `1+0+1` (normalise only via signed dictionary), PRN/SOS (keep indication), tapering (verbatim, always verify), duplicate-different-strength + cross-visit carry conflicts (retain both + `needs_review`). `needs_review` = human clinician disposition required; never cleared by patient confirmation | Invariant 3 (never silently resolve) extended to the real notations and Indian prescribing patterns; the alert order (red-flag → verify → abnormal) is preserved. |
| Canon versioning + repeat visits (C-J) | **Additive v2** `medikiosk-history-bundle/2` (`carriedFrom`, delta, dashavidha, confirmation records) with explicit `to_v1()` projection; carry = verbatim + provenance; stable-field list clinician-approved. Summary purposes (generation, storage, handover, ABDM upload) **itemised at intake**; fallback = fresh per-purpose consent; crypto-erasure per tier | Additive-only honors doc/19 D5; DPDP Rule 3 requires itemised notice naming the purpose, and a summary is separate processing — so itemise rather than rely on a vague consent. [sweep 2026-09-16, DPDP_Rules_2025.json] |
```

### 4. `doc/README.md` — index row to add

Insert after the `doc/20` row (line 31):

```markdown
| [21-module-c-production-design.md](21-module-c-production-design.md) | **Module C production design (gap closure):** emission artifact C-A (two-artifact OPConsultRecord + HealthDocumentRecord pinned to ndhm.in#6.5.0; INPS deferred), attestation lifecycle C-B, reference-range governance C-C, canon↔IG section map C-D, AYUSH/Dashavidha C-E, bilingual lane C-F, executable eval protocol MCFP-1 C-G, phase-2 LLM gate C-H, reconciliation edge cases C-I, canon v2 + repeat-visit/DPDP C-J, plus the KB-updates appendix | Design (2026-09-16) — every item DECIDED or explicitly DEFERRED with owner; no code |
```

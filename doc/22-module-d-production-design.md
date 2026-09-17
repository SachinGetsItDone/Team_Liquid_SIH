# 22 — Module D Production Design (Consent, ABDM Integration and Data Governance)

> **Status:** Design for team ratification, 2026-09-16. Research/design/methodology only —
> **no code was written**. This is the project's largest true gap (doc/19 §4: "no code, no
> design doc"). Sections mirror the eleven assigned gaps D-A … D-K. Every item is **DECIDED**
> (rationale + primary source + verification date) or **EXPLICITLY DEFERRED** (unblocking
> condition + owner). Nothing is left "TBD" without an owner and a condition.
>
> **Read with:** doc/19 (production blueprint + 7 invariants), doc/16 (regulatory addendum:
> HDM residency, HIP posture, SNOMED/CDCI, CDSCO), doc/13 §1 (NRCeS output contract),
> doc/08 §3 (ABDM/consent posture), doc/09 (Module A session/consent boundary), doc/18 +
> doc/20 (Module C emitter posture, Module B sync), `module-b/medib/intake.py` (the existing
> B1 consent gate), doc/15 (innovation), and the 2026-09-16 deep-sweep JSONs in
> `module-3-summary-generation/results/`.
>
> **Non-negotiable constraints this design must fit (restated):** India data residency (ABDM
> HDM Policy Apr-2022 rev. Clause 26); **Hospital = HIP** (kiosk is part of the hospital's
> ABDM-compliant certified software under its HFR ID); **consent is the gate**, not a
> formality; **transient by default**, persistence opt-in and consented; **no PHI in logs,
> telemetry or vendor systems**; **crypto-erasure = destroy the key**; **never block care on
> network failure** (offline queue, store-and-forward).

## Evidence rules used in this doc

- A load-bearing claim carries a source (URL or `file:line`) and a verification date.
- `[verified 2026-09-16]` = fetched/re-verified **live this session**; `[KB]` = already sourced
  in the knowledge base with its own date; `[sweep]` = from the 2026-09-16 deep sweep, **not
  independently re-fetched** this session; `[uncertain]` = not independently confirmed.
- Where a claim originated in the deep sweep, this doc says whether it was re-verified live.
- Vendor/maintainer claims are labelled as such. No API field, clause number or certification
  requirement is invented.

## Decision status legend

| Tag | Meaning |
|---|---|
| **DECIDED** | Ratify as-is; rationale + source given. |
| **DEFERRED** | Not decided now; the named condition + owner unblocks it. |
| **BLOCKED-EXT** | The choice waits on an external authority answer; tracked in D-K / Appendix B. |

## Verification note on the deep sweep (read this first)

The four sweep JSONs (`DPDP_Rules_2025`, `SNOMED_CT_India_and_CDCI`, `NRCeS_OPConsultRecord`,
`ABDM_HealthDocumentRecord_profile`) were **re-read** this session and their Module-D-relevant
load-bearing facts were **re-verified live** where possible:

- **Fidelius E2EE primitive set — re-verified live.** ECDH on Curve25519 (Weierstrass form) +
  **HKDF-SHA256** key derivation (salt = first 20 bytes of XOR'd nonces) + **AES-256-GCM**
  (IV = last 12 bytes of XOR'd nonces), ephemeral per-exchange keypairs
  `[verified 2026-09-16, community ABDM docs mirror kiranma72.github.io/abdm-docs (M2 encryption
  implementation guidelines + M3 getting-health-record) and two independent implementations:
  github.com/eka-care/abdm-ecdh, github.com/prashantbsr/abdm-fidelius-dart]`. The primary NHA
  hosting of this page was **not** fetched directly this session — the algorithm is confirmed by
  the mirror plus two independent interoperable implementations, so it is treated as reliable but
  the NHA primary URL is on the D-K tracker for a one-line confirmation.
- **ABDM consent-artefact fields — re-verified live** (`purpose`, `hiTypes`, `dateRange`,
  `dataEraseAt`, `accessMode`, `frequency`, `consentId`, `careContexts`, CM signature)
  `[verified 2026-09-16, community ABDM docs mirror, "Understanding Consents"]`.
- **Scan & Register / 25 crore OPD registrations — re-verified live**
  `[verified 2026-09-16, PIB/NHA press covered by TOI 2026-08-08, ET HealthWorld 2026-08-08]`.
- **ABHA Number vs ABHA Address — re-verified live** `[verified 2026-09-16, abdm.gov.in/FAQ +
  PIB ABHA explainer]`.
- **DPDP Rule/Act clause facts — from [sweep]** (the sweep itself is dated 2026-09-16 and cites
  gazette/PIB/MeitY); not re-fetched independently this session. Treated as sourced, flagged
  where the exact rule number matters.
- **NRCeS profile facts (attester 0..\*, INPS preview, section codes)** — from `[sweep]` and
  already logged in doc/18 + doc/20; the INPS **publication status** remains the top external
  blocker (D-K).

---

## 0. What Module D is today, and what this doc adds

**Known state (from `prompt.md` + doc/19 §4/Appendix):**

| Artifact | State |
|---|---|
| `module-d/` | **Does not exist.** |
| Module D design doc | **Did not exist** until this doc. |
| Consent gate | Real, tested: `module-b/medib/intake.py` (B1) requires a `ConsentArtefact` before extraction; `ITEMIZED_NOTICE` is bilingual-ready. **Not modified by this session.** |
| `consent_ref` | Required field in the Module C contract (`module-c/medic/contracts.py`). |
| Session token | The kiosk consumes an **opaque session token only**; it does not authenticate ABHA, create consent, or infer consent (doc/09 §1). `"Module D, simulated"` stubs exist in all three demos. |

**What Module D must become (production):** the consent-and-exchange tier that (a) identifies the
patient, (b) issues and governs the consent that gates all processing, (c) owns the ABDM HIP
flows and the offline queue, (d) enforces crypto and key lifecycle, (e) enforces retention and
erasure, and (f) produces the audit evidence the DPDP/ABDM regime requires. It sits between the
hospital (system of record) and Modules A/B/C (capture, digitisation, summary).

**Design principle (DECIDED):** Module D is a **gate + exchange** layer, never a data store of
record. It holds consent, crypto and queue state; the clinical canon lives in Modules A/B/C and
the hospital's record (T3). This keeps every module's data-minimisation story defensible.

---

## D-A. Actors, roles and posture (get this right first)

### D-A.1 Actor model — **DECIDED**

| Actor | DPDP role | ABDM role | What it can and cannot do |
|---|---|---|---|
| **Patient** | Data Principal | ABHA holder | Grants/revokes/expires consent; owns the records; may nominate (§14). |
| **Hospital** | **Data Fiduciary** | **HIP** (creates/stores/shares) | Determines purpose and means; system of record; owns HFR ID and ABDM keys; the compliance owner. |
| **MediKiosk (vendor)** | **Data Processor** | Part of the hospital's ABDM-compliant certified software | Processes only on the fiduciary's documented instructions; provides the kiosk + edge software; **no independent ABDM push**. |
| **ABDM Gateway** | n/a | HIE-CM backbone | Routes consent + data between HIP and HIU; NHA-hosted. |
| **HIE-CM (Consent Manager)** | n/a (ABDM's consent manager) | Consent Manager & Gateway | Issues/stores ABDM consent artefacts; not the DPDP-registered Consent Manager unless separately registered. |
| **HIU** | Data Fiduciary (when consuming) | HIU | Only fetches under a consent artefact; deletes on `dataEraseAt`. |
| **HRP** | n/a | Health Repository Provider | Storage-infrastructure partner role; **only needed if the kiosk operator ever pushes independently** (not our v1). |

Basis: DPDP role split is stated in the sweep ("the hospital that determines purpose and means
is the Data Fiduciary and the kiosk vendor is typically a Data Processor" `[sweep]`); ABDM
HIP definition and the "a technology vendor operating a kiosk is not itself a HIP" finding are
from doc/16 §2 (`[KB]`, NHA HIP/HIU Guidelines).

### D-A.2 Data Fiduciary vs Data Processor — settled contractually, not just architecturally — **DECIDED**

- **Hospital = Data Fiduciary. MediKiosk = Data Processor.** The hospital determines the
  purposes (history capture, document digitisation, summary generation, physician handover,
  ABDM upload) and the means (which kiosks, which retention).
- **Contractual requirement (must be in the DPA / vendor agreement before any production
  deployment):** a DPDP-compliant Data Processing Agreement naming (a) purposes, (b) the
  processor's security obligations, (c) breach-notification flow to the fiduciary, (d) the
  prohibition on independent use or secondary processing, (e) sub-processor rules, (f) deletion
  on termination. Section 8(1) makes the fiduciary responsible for processing done on its
  behalf `[sweep, DPDP Act §8(1)]`.
- **What changes if the deployment model changes:** if MediKiosk ever operated independently
  (own the patient relationship and decide purpose), it would become a **Data Fiduciary** and
  would need its own notice/consent/DPO/breach apparatus and an HRP/partner arrangement — a
  categorically larger obligation (D-A.3).

### D-A.3 Deployment model — **DECIDED: hospital-owned certified software**

**Recommended and decided for v1: (b) hospital-owned ABDM-compliant certified software under
the hospital's HFR ID.** The kiosk software is certified as part of the hospital's stack;
care-context linking and data push happen under the hospital's HFR/HIP keys; the hospital is
the fiduciary.

| Model | Posture | Consequences |
|---|---|---|
| **(a) Hospital-owned certified software (CHOSEN)** | Hospital = HIP + Fiduciary; vendor = Processor | Requires HFR registration → HIP onboarding → certification; vendor holds no ABDM production keys; residency and DPDP posture inherited from the hospital. |
| **(b) Independent kiosk operator** | Operator must become HIP or partner with an HRP | Requires BOTH the operator's own DPDP fiduciary apparatus (notice/consent/DPO) AND an HRP/partner arrangement for storage; not viable for v1. Documented here so it is a conscious rejection, not an oversight. |

Basis: doc/16 §2 + doc/19 §4/§6 (`[KB]`); HIP/HIU Guidelines: HIP = a healthcare provider, not
a tech vendor.

### D-A.4 What the kiosk may and may not do offline — **DECIDED**

| Situation | Behaviour |
|---|---|
| Network down, patient present | **Capture proceeds** under the in-kiosk itemised DPDP notice + consent (the fiduciary's notice). Nothing is blocked; the interaction is complete offline. |
| Network down, ABDM upload purpose | ABDM upload is a **separate purpose**. If not yet granted, the item is held in the encrypted queue as `pending_consent`, **not sent**; if the ABHA/consent grant needs the network, the kiosk records a `consent_pending_online` state and offers the patient a completion/QR handoff path. |
| Network down, consent **revocation** | Recorded locally with a monotonic timestamp and queued; enforcement (stop further sync) is immediate locally; propagation to edge/gateway is store-and-forward. |
| Kiosk offline entirely during OPD | Full capture + summary generation works; only the ABDM exchange is deferred (invariant 7). |

**Hard rule (DECIDED):** the kiosk **never infers consent**, **never** processes beyond the
granted purpose, and **never** queues anything outside a consented purpose (D-D.5).

---

## D-B. Consent artefact lifecycle

### D-B.1 State machine — **DECIDED**

```
                 request
   (none) ───────────────► REQUESTED ──grant──► ACTIVE ──partial-revoke──► PARTIAL
                              │                  │                            │
                              ├──deny───► DENIED │                            │
                              │                  ├──revoke──────────────────► REVOKED
                              └──timeout► EXPIRED ◄──expire──────────────────┘
                                                 (expiry clock from permission.dateRange / consent expiry)
```

| Transition | Trigger | Effect on already-captured data |
|---|---|---|
| request → grant | Patient accepts the ABDM consent artefact and/or the kiosk notice | Capture/processing permitted **only** for the granted purposes. |
| active → partial | Patient revokes one purpose (e.g. ABDM upload) but keeps others (intake/summary) | Revoked purpose is enforced immediately; data already produced under it is subject to erasure for that purpose; other purposes continue. |
| → revoke | Patient withdraws (must be as easy as granting) | All processing under the revoked purposes stops; queued un-sent items for those purposes are purged (crypto-erase); sent items follow the ABDM `dataEraseAt`/HIU-deletion rules and the fiduciary's retention obligations (D-B.5, D-I). |
| → expire | `dateRange.to` / consent expiry passes | Same as revoke for the expired purpose; the kiosk/edge keeps an expiry timer and **rejects any request on an expired artefact** `[verified 2026-09-16, ABDM mirror: "Any data request on expired consent artefact must not be done"]`. |
| → deny / timeout | Patient declines, or no response | The associated purpose never becomes active; nothing is sent; data captured under the base intake notice only is handled per the intake purpose. |

### D-B.2 Artefact fields mapped to MeitY + ABDM — **DECIDED**

ABDM consent is based on **MeitY's electronic consent framework (DEPA v1.1)**
`[KB, HDM Policy Ch.11 + HIP/HIU Guidelines; MeitY Consent-Tech-Framework v1.1 at dla.gov.in]`.
The ABDM consent artefact request/response carries all of the following `[verified 2026-09-16,
ABDM mirror "Understanding Consents"]`:

| Field | Meaning | MediKiosk use |
|---|---|---|
| `requestId` / `consentId` | Consent request and artefact identifiers | Stored as the consent of record; the `consent_ref` carried into the canon. |
| `purpose` (`code`, `text`, `refUri`) | Purpose-of-use (HL7 v3 PurposeOfUse subset, e.g. `CAREMGT` care management) | Mapped from the kiosk's itemised purposes to ABDM purpose codes. |
| `patient.id` | ABHA address of the principal | Routing identity. |
| `hiTypes[]` | Health-info types (Prescription, DiagnosticReport, OPConsultation, DischargeSummary, ImmunizationRecord, HealthDocumentRecord, WellnessRecord) | Restricts the push to consented types (purpose limitation). |
| `permission.accessMode` | VIEW / STORE | We request the least needed access mode. |
| `permission.dateRange` (`from`,`to`) | Data window | Bounds what may be requested/sent. |
| `permission.dataEraseAt` | Erasure deadline for the recipient's copy | Drives the edge-side erasure clock (D-I/§D-B.5). |
| `permission.frequency` (`unit`,`value`,`repeats`) | Recurrence | Default: single-use. |
| `careContexts[]` (`patientReference`, `careContextReference`) | Care-context linkage | Set by HIP-initiated linking (D-C.2). |
| `hip.id` / `hiu.id` | Provider / user | Hospital HFR-linked HIP; HIU when/todo. |
| `consentManager.id` | CM identity | The ABDM HIE-CM (NHA) for v1. |
| `signature` | CM signature (W3C) | Verified on receipt; never trusted unverified. |

**Note (DECIDED):** the ABDM consent artefact is a practical consent mechanism but **is not
automatically a DPDP Rule 3 notice** `[sweep, DPDP JSON standards_compliance]`. The kiosk
therefore must satisfy **both**: the fiduciary's itemised DPDP notice (D-B.4) **and** the ABDM
consent artefact for ABDM flows. The two are reconciled, never assumed identical.

### D-B.3 Purpose granularity — **DECIDED**

Four **individually selectable and revocable** purposes:

| # | Purpose | Covers | Default on/off |
|---|---|---|---|
| P1 | **Intake capture** | Voice+touch history, document scanning, in-session processing | On (required for service) |
| P2 | **Summary generation** | Building the structured pre-visit summary from captured data | On (itemised at intake — see derived-summary decision) |
| P3 | **Physician handover** | Showing the summary to the treating doctor / HIS | On |
| P4 | **ABDM upload** | Push of consented HI types under an ABDM consent artefact | **Off by default / separately granted** |

**Derived-summary freshness — the unresolved DPDP question, now DECIDED:** the sweep establishes
that a generated summary **is** personal data and **is** separate processing (Act §2(t)/§2(x)),
so it is lawful only if the intake notice actually itemised (i) creating a summary, (ii)
storing it, (iii) showing it to the physician, and (iv) any ABDM upload — otherwise fresh notice
and consent are required `[sweep, DPDP JSON relevance_to_module_c]`. **Decision: itemise P2/P3/P4
explicitly in the intake notice, so no separate fresh-notice step is needed at summary time; and
the design must keep the capability to issue a fresh notice if the purpose set ever changes**
(versioned notice). This is the safe design the sweep recommends and is defensible to counsel.
`[uncertain]`: no regulator ruling exists on "compatible purpose"; legal review is scheduled
(D-K / Appendix B).

### D-B.4 Bilingual, itemised, plain-language notice + withdrawal — **DECIDED**

- **Content:** extend the existing `module-b/medib/intake.py:19-29` `ITEMIZED_NOTICE` into the
  Module D notice: purpose (per P1–P4), data collected itemised (voice transcript, document
  images, extracted meds/labs/diagnoses, generated summary), what is **not** collected (raw
  audio beyond transcription unless P2/persistence consented, Aadhaar number, anything not on
  the paper or in the conversation), rights (withdraw as easily as grant; correction; erasure;
  grievance; nominate), retention period + criteria, DPO/fiduciary contact, and the Board-complaint
  link — matching DPDP Rule 3's required elements `[sweep, DPDP Rule 3]`.
- **Language:** English or any of the 22 Eighth Schedule languages; v1 ships **Hindi + English**,
  audio-guided for low literacy `[sweep, Rule 3 + Act §6]`. The statutory floor is all 22; v1
  ships 2 with a documented roadmap (this is a scope cut, stated honestly).
- **Withdrawal path:** a first-class action at the kiosk and (post-session) via the hospital
  channel; **withdrawing is no harder than granting** (Act §6 / Rule 3)
  `[sweep, KSK / EY guidance]`. Audio-confirmed.
- **Evidence:** every notice display records `{notice_version, language, timestamp, ack}` — the
  consent record pattern already begun in `intake.py:32-41`.

### D-B.5 What each transition does to already-captured data — **DECIDED**

| Data tier | On revoke/expire of a purpose |
|---|---|
| **T1 kiosk transient** (canon, unsynced queue) | Purge the affected items; crypto-erase the item key. The un-sent item simply disappears (no recipient copy exists). |
| **T2 edge node** (validated FHIR, audit) | Delete the affected **HIU-side copies** on `dataEraseAt`; retain the consent artefact record + the immutable audit event (the evidence that the right thing happened is itself required). |
| **T3 hospital record** | **Not erased** by the kiosk's consent withdrawal where a medico-legal retention duty applies — it is the provider's record; the hospital's retention policy + ABDM Health Data Retention policy govern. This distinction is the sweep's "erasure vs continuity of care" caution `[sweep, PMC/Intercept legal guidance]`. |
| **Erasure mechanism** | Crypto-erasure (destroy the key) at every tier (invariant; doc/19 §6). "Deleted" = key destruction, logged. |

`[uncertain]` (tracked): whether ABDM's `dataEraseAt` obliges a **HIP that is the originator**
(the hospital) to erase its own record, or only an **HIU holding a fetched copy**. Same finding
as doc/20 §B-C.5. Queued to NHA/NRCeS (D-K).

---

## D-C. HIP and HIU flows (M2 first, M3 if needed)

### D-C.1 ABHA identification — **DECIDED**

- **Identity anchor = ABHA.** `ABHA Number` = 14-digit random unique ID (strong identity);
  `ABHA Address` = human-readable `name@abdm` (consent + data-sharing handle). One number may
  have multiple addresses `[verified 2026-09-16, abdm.gov.in/FAQ + PIB ABHA explainer]`.
- **Design consequence (DECIDED):** use **ABHA Number for registration/verification** (M1) and
  **ABHA Address for care-context linking + consent routing** (M2/M3) — this matches the ABDM
  role of each identifier `[verified 2026-09-16]`.
- **Authentication modes:** Aadhaar-OTP and Mobile-OTP; QR-based sharing (ABHA Number QR / HIP
  QR) avoids the OTP step entirely `[verified 2026-09-16, ABDM sandbox integration doc]`. Aadhaar
  is **voluntary** — the kiosk must offer non-Aadhaar paths `[verified 2026-09-16, abdm.gov.in/FAQ]`.
- **No inferring identity:** the kiosk never creates/uses ABHA without the patient's explicit
  linking action; a patient who declines ABHA can still use the intake path under the fiduciary
  notice (service not blocked) — Module A's "opaque token" boundary preserved.

### D-C.2 Scan & Register as the preferred session start — **DECIDED**

- **Scan & Register** (formerly Scan & Share) is an ABHA-based OPD registration service:
  patient scans the facility's QR with any ABDM-enabled PHR app, consents, and shares their
  ABHA profile; **25 crore OPD registrations** had been completed by Aug 2026, **~4 lakh/day**,
  live at **30,800 facilities** (24,323 public / 6,481 private) across 36 states/UTs and 756
  districts `[verified 2026-09-16, TOI 2026-08-08 "QR code, no queue: 25 crore OPD
  registrations go digital" + ET HealthWorld 2026-08-08 + PIB/NHA statement]`.
- **Decision:** the kiosk's **preferred session entry** is the Scan & Register token handoff
  (patient already identified + consented to share profile for registration), with manual ABHA
  capture/verification as fallback and a no-ABHA path as last resort. This reuses the existing
  national registration rail instead of inventing a parallel one, and gives Module D a clean
  `session_id` entry point.
- **v1 practicality:** a hospital may not yet expose the Scan & Register callback to a third-party
  kiosk; so this is **DECIDED as target**, with manual/QR capture as the shipped fallback
  (DEFERRED-when the hospital's integration is ready — tracked, D-K). `[uncertain]`: exact
  kiosk-side integration surface for Scan & Register is not documented publicly for non-hospital
  software; confirm with the hospital/NHA.

### D-C.3 M2 HIP flow end-to-end — **DECIDED (v1 scope)**

1. **Identify** patient (Scan & Register or ABHA capture) → link ABHA to the patient/session.
2. **Create a care context** after the encounter: `careContextReference` per session linked to
   the ABHA address. The **kiosk** creates the clinical content; the **hospital HIP** owns and
   links the care context under its HFR/HIP keys `[KB, doc/16 §2; verified 2026-09-16 ABDM
   integration docs: "Ensure you can support sharing of all five major report types"]`.
3. **Care-context linking is HIP-initiated** by the hospital (OTP / demographic / direct-auth
   methods under hospital keys) `[KB, doc/16 §2]`; the sweep+docs confirm the HIP must respond
   to discovery requests and save the consent artefact.
4. **Data push on consent:** on a valid consent artefact, the HIP encrypts the requested FHIR
   R4 document bundle (Fidelius, D-E) and pushes to the HIU's data-push URL with the
   transaction id `[verified 2026-09-16, ABDM mirror "Getting Health Records"]`.
5. **Audit** every discovery/consent/data event (D-I).

**Ownership (DECIDED):** kiosk = capture + transient queue + content hash + idempotency key
(**no HAPI/Java, no ABDM keys**); edge node = validation + queue drain + ABDM calls under
hospital keys; hospital HIS = system of record. (Same boundary as doc/20 §B-C.1 — consistency.)

### D-C.4 M3 HIU flow — **DECIDED: NOT in v1**

**Decision: v1 is M2-only (HIP). M3 (fetching a patient's history from other facilities) is
DEFERRED** until the hospital wants cross-facility pull. Rationale: the kiosk's value is
capturing and sharing this encounter's history; M3 adds an inbound data-fetch rate and a
larger HIU deletion obligation without serving the pre-visit-capture use case. When needed, M3
is an additive HIU module (consent request → decrypt → display → delete on `dataEraseAt`), with
no change to the capture path.

### D-C.5 Session identity contract handed to Modules A/B/C — **DECIDED (no PHI)**

The opaque session token is the only thing Module D hands to A/B/C. It may contain:

| Allowed in the token | Forbidden |
|---|---|
| `session_id` = `D<date>-<token>-<HFR-ID>` (no PHI, doc/19 §5) | Patient name |
| `consent_ref` (artefact id) + granted purpose set (P1–P4) | ABHA number/address |
| `language_allowlist` (v1: `hi`,`en`) | Aadhaar / any identifier |
| `retention_mode` (`transient` / `persisted`) | Clinical content |
| `expiry` / `dataEraseAt` (if ABDM-linked) | Anything that identifies the patient |
| `notice_version` acknowledged | — |

Modules A/B/C **must not** authenticate ABHA, create/infer consent, or read PHI-bearing fields
from the token (Module A requirement 1, doc/09 §4). The token is a capability handle, not a
record. **Module D owns all identity resolution; A/B/C see only the token.**

---

## D-D. Sync, queue and offline behaviour (the reliability core)

### D-D.1 Ownership across tiers — **DECIDED**

| Tier | Owns |
|---|---|
| **Kiosk** | Capture, ephemeral consent state, **encrypted transient queue**; no HAPI/Java; no ABDM keys. |
| **Edge node** | HAPI/matchbox validation, consent-artefact store, erasure clock, queue drainer, ABDM client under hospital keys, retry/backoff, DLQ, audit shipping. |
| **Hospital HIP/HIS** | System of record, care-context ownership, ABDM keys. |
| **Vendor ops (Zone C)** | **No PHI.** Aggregate health/latency metrics only (doc/19 §3). |

### D-D.2 Queue item schema — **DECIDED**

```
queue_item {
  item_id            # ULID, kiosk-generated
  session_id         # D<date>-<token>-<HFR-ID>  (no PHI)
  idempotency_key    # sha256(session_id + purpose + artifact_kind + content_hash)
  content_hash       # sha256 of canonical emission payload
  purpose            # P1..P4  (the only purpose under which this item may exist)
  artifact_kind      # consent_notify | care_context_link | health_document_record |
                     # prescription_record | diagnostic_report_record | erasure_request
  consent_ref        # consent artefact id (or 'pending_consent')
  ig_version         # pinned NRCeS IG version recorded in the bundle
  emitter_version
  payload_path       # encrypted blob ref (never the FHIR inline)
  state              # pending_consent | queued | inflight | acked | failed | dead_letter
  attempts, next_attempt_at, backoff_secs
  created_at, last_error, acked_at
}
```

### D-D.3 Idempotency, retry, ack, dead-letter — **DECIDED**

- **Idempotency key** = `sha256(session_id + purpose + artifact_kind + content_hash)`; sent with
  the ABDM request; the edge also dedupes before send. Replays after LAN loss/power cut are safe
  (doc/19 §8 "duplicate delivery").
- **Retry:** exponential backoff with jitter (1 s → 2 → 4 … cap 15 min), max attempts then
  `dead_letter`. Retryable = network/5xx/429; non-retryable = 4xx validation → dead-letter
  immediately.
- **Ack:** `acked` **only** on a positive ABDM/HIE-CM ack. A local write is not an ack.
- **Dead-letter:** retained encrypted with the error; surfaced in ops; human re-drives after
  fixing the cause. **Never silently dropped, never auto-mutated to pass**
  (doc/19 invariants 1–3; same posture as doc/20 §B-C.2).
- **Ordering:** monotonic per `session_id`; server-side reconciliation on clock skew.

### D-D.4 Behaviour across failure modes — **DECIDED**

| Failure | Behaviour |
|---|---|
| Kiosk↔edge LAN loss | Kiosk fully functional; queue persists encrypted; drains on reconnect. |
| Edge node outage | Kiosks keep capturing; queue persists; drains later. |
| ABDM gateway outage | Items stay `queued`/`failed` with backoff; **no data loss, no fabricated success**; ops alerts on backlog depth. |
| Mid-transfer cut | `inflight` re-driven; idempotency prevents duplicates. |
| Power loss | SQLCipher WAL recovery; no partial canon promotes. |
| Validation failure | `dead_letter` + validator errors; human fixes; never auto-fix. |
| Consent revoked mid-flight | In-flight items for that purpose are aborted/purged; already-acked items follow erasure rules. |

### D-D.5 Hard rule: what is never queued — **DECIDED**

Never queued, under any circumstance:

1. Anything beyond the **granted purpose** (invariant: consent is the gate).
2. Anything the patient has **not** acknowledged in the itemised notice.
3. Any item whose `consent_ref` is `pending_consent` for the **ABDM** purpose (capture may
   proceed; the **upload** may not).
4. PHI in any log, metric, error string, or vendor system (invariant 6; test-enforced).

### D-D.6 Reconciliation between kiosk and hospital — **DECIDED**

The hospital record (T3) is authoritative. Module D's job is to guarantee **delivery evidence**:
for each queued item, either an ABDM ack + a matching hospital care-context/record reference, or
a dead-letter with a reason. A periodic reconciliation report (per shift) lists items that are
`acked` vs `dead_letter` vs `pending`, so "what the kiosk captured" and "what the hospital holds"
can be compared without exposing PHI to vendor ops (aggregate counts only).

---

## D-E. Cryptography and exchange security

### D-E.1 At rest — **DECIDED**

| Tier | Mechanism |
|---|---|
| **T1 kiosk** | **SQLCipher (AES-256)** + WAL for the transient canon and queue (doc/19 §5 T1; same as Module A). |
| **T2 edge node** | PostgreSQL with **DB + disk encryption (AES-256)**; audit store encrypted; keys externalised (below). |
| **T3 hospital** | Hospital standard. |
| **T4 vendor ops** | Metrics only — **no PHI**; encrypted at rest. |

### D-E.2 In transit — **DECIDED**

TLS 1.2+ minimum (favour 1.3), hospital PKI where available; certificate pinning on kiosk→edge;
ABDM gateway calls signed per the gateway spec (JWT) `[verified 2026-09-16, OpenMalo developer
guide + ABDM docs]`.

### D-E.3 Exchange E2EE — Fidelius-compatible — **DECIDED**

For ABDM health-data exchange, implement the ABDM ECDH scheme (Fidelius-compatible); the
algorithm was **re-verified live this session**:

| Step | Algorithm | Detail |
|---|---|---|
| Key agreement | **ECDH, Curve25519 (Weierstrass form)** | Matches the Java/BouncyCastle reference; not standard Montgomery X25519. |
| Per-exchange keys | **Ephemeral keypair + 32-byte nonce each side** | New keypair + nonce for every data-exchange session. |
| Key derivation | **HKDF-SHA256** | Salt = **first 20 bytes** of the XOR of the two nonces. |
| Encryption | **AES-256-GCM** | IV = **last 12 bytes** of the XOR of the two nonces. |
| Public-key encoding | base64 uncompressed EC point (65 bytes, `04` prefix) **or** X.509 SubjectPublicKeyInfo DER | Both accepted by Fidelius; send base64 uncompressed by default. |

Source: `[verified 2026-09-16, community ABDM docs mirror (M2/M3 encryption guidelines) +
github.com/eka-care/abdm-ecdh + github.com/prashantbsr/abdm-fidelius-dart]`. Primary NHA spec
URL not fetched directly — flagged in D-K.

**Keypair lifetime (DECIDED):** HIP (sender) keys are **truly ephemeral** (generate → encrypt →
transmit → discard private key). HIU (receiver) keys are **short-lived** (held until the encrypted
response arrives; stored in the keystore, never on disk in plaintext). Where the kiosk is the
*data originator but the hospital is the HIP*, the **edge node** performs the Fidelius encryption
under hospital keys; the kiosk never holds ABDM key material.

### D-E.4 Key management and destruction — **DECIDED**

- **Generation/storage:** keys live in an **HSM / OS keystore / managed secret store** — **never**
  environment variables, source, or the deployed image (doc/19 §6). Kiosk disk key sealed to the
  device (TPM/keystore where available).
- **Rotation:** device keys rotated per policy and on incident/device replacement; ABDM
  long-term HIP keys managed by the hospital; per-exchange Fidelius keys are single-use by design.
- **Destruction = erasure:** destroying the key is the erasure mechanism (crypto-erasure) at every
  tier; the destruction event is logged with the artefact/consent reference, not the PHI.
- **Separation:** the auditor/ops role cannot read health data; key custodianship and audit
  review are separate duties (D-J insider-browsing mitigation).

---

## D-F. DPDP compliance mapping (counsel-usable)

This is the clause-by-clause implementation map. It cites the **DPDP Act 2023 sections** and
**DPDP Rules 2025 rules** established in the sweep `[sweep]`; where a rule number matters and was
not independently re-fetched, it is marked. Each row names **where Module D enforces it**, so a
reviewer can trace every obligation to a component (Appendix A) and a test.

| # | Obligation (Act/Rule) | Module D implementation | Enforced by | Status / evidence |
|---|---|---|---|---|
| 1 | **Itemised, standalone, plain-language notice** — Rule 3 | Bilingual (v1 hi/en) itemised notice, four separate purposes, data list + non-collection list, rights, retention, DPO contact, Board-complaint link; rendered standalone before processing | D2 | DECIDED; extends `intake.py:19-29` |
| 2 | **Free, specific, informed, unambiguous consent; limited to necessary data** — §6 | Clear affirmative action per purpose; no bundling; only data needed for that purpose is processed | D2, D4 | DECIDED |
| 3 | **Consent granularity + withdrawal as easy as granting** — §6/Rule 3 | P1–P4 toggles; withdrawal at kiosk + hospital channel; audio-confirmed; same effort as grant | D2, D3, D4 | DECIDED |
| 4 | **Purpose limitation** — §6/§8 | Every canon field/purpose tag; ABDM push limited to consented `hiTypes`; queue item carries `purpose` | D4, D6 | DECIDED |
| 5 | **Data minimisation** — §6/§8 | Transient by default; only attested/consented output persists; raw audio not retained unless consented | D9, + Module A/B/C | DECIDED (doc/19 inv. 5) |
| 6 | **Retention + erasure** — §8(6)/Rule 8 | Per-purpose retention clock; erase on withdrawal/purpose served unless law requires; crypto-erasure; ≥48 h pre-erasure notice where applicable | D9, D11 | DECIDED; exact clocks BLOCKED-EXT (D-K) |
| 7 | **Processing logs/traffic data retained ≥1 year** — Rule 8 | Audit store retains ≥1 year (Module D targets 7 years; see #14) | D10 | DECIDED |
| 8 | **Breach notification** — §8(5)/Rule 7 | Pre-drafted template; affected principals notified "without delay"; preliminary intimation to the Board without delay; **detailed report within 72 h**; offline-capable evidence capture | D10, D12 | DECIDED (template drafted in D-I) |
| 9 | **Data Principal rights** — §11–§14 | Access, correction, erasure, grievance (≤90 days), nomination; published process; DPO contact | D9, D10, D12 | DECIDED |
| 10 | **Children's data** — §9 + Rule 12/Fourth Schedule | Verifiable parental consent; no behavioural monitoring/targeted ads to children; narrow clinical-establishment exemption applied only for health services | D2 | DECIDED; `[uncertain]` Fourth Schedule scope — legal review (D-K) |
| 11 | **Cross-border transfer** — §16 | **India-only** processing + storage; HDM Policy Clause 26; no non-Indian cloud on any PHI path | all | DECIDED (doc/16 §1; country allowlist un-notified) |
| 12 | **Consent Manager relationship** — Rule 4 | Design so a DPDP-registered Consent Manager can be substituted; v1 uses the ABDM HIE-CM; CM must retain consent records **≥7 years**, act fiduciary to the principal, be data-blind | D3, D8 | DECIDED (adapter boundary); CM not built |
| 13 | **Data Fiduciary/Processor** — §8(1) | Hospital = Fiduciary; MediKiosk = Processor; DPA before production | D-A.2 | DECIDED |
| 14 | **Audit trail: append-only, immutable, off-box, 7-year** | Chained (prev_hash) immutable audit, shipped off-box; target 7-year retention | D10 | DECIDED (see note below) |
| 15 | **Security safeguards / no PHI in logs** — §8(4) | Encryption at rest/in transit, RBAC, PHI-in-logs test, no PHI to vendor ops | D7, D11, D10 | DECIDED; exact security-safeguard rule number `[uncertain]` |
| 16 | **Grievance redressal ≤90 days** — §13/Rule | Published channel + SLA; DPO contact in notice | D12 | DECIDED |

**Note on row 14 (7-year audit retention).** The prompt's "7-year per the Consent Manager
standard" maps to **DPDP Rule 4's consent-record retention floor for Consent Managers**
`[sweep, DPDP JSON: "retain consent records at least 7 years"]`, not to a kiosk/ABDM audit rule.
Separately, ABDM's Health Data Retention policy is **draft**; the consultation paper discusses
**in-patient ~10 years / out-patient ~5 years** `[KB, HDM consultation paper]`. Decision: Module D
retains audit evidence **7 years** (aligned to the CM floor + medico-legal practice) and stores
the **retention period in the consent/notice record per purpose**, so it can be adjusted when the
HDR policy is finalised. `[uncertain]` exact medical-record retention — BLOCKED-EXT (D-K).

**Counsel note:** rows 1–16 are the implementation map; the legal characterisation that remains
open is the "compatible purpose" question in D-B.3, the `[uncertain]` Fourth Schedule scope, and
the exact retention numbers. These are legal-review items, not engineering blockers.

---

## D-G. Emission artifacts and ownership

### D-G.1 Which artifact carries the pre-visit summary — **DECIDED (jointly with Module C)**

| Content | Artifact | Owner |
|---|---|---|
| Raw patient-carried scan | **HealthDocumentRecord** (type SNOMED `419891008`), section entries = **DocumentReference** (inline base64 must-support) | Hospital Organization (HFR) |
| Structured pre-visit history summary | **OPConsultRecord** (type SNOMED `371530004`) now; **INPS** when v7.0.0 publishes | Hospital / physician (attested) |
| Structured meds (after attestation) | PrescriptionRecord — hospital-authored, DEFERRED to M3 (doc/20 §B-C.3) | Hospital practitioner |
| Structured labs (after attestation) | DiagnosticReportRecord — DEFERRED to M3 | Hospital lab |

Rationale: the sweep established that HealthDocumentRecord's `section.entry` is bound
**exclusively to DocumentReference** and it has **no structured sections**, so it cannot carry
the structured summary; OPConsultRecord is the verified structured carrier; **INPS** (v7.0.0
preview, HL7 IPS 2.0.0-derived, with a `Patient Story` section) is the better long-term home but
is **preview-only** `[sweep, NRCeS_OPConsultRecord + ABDM_HealthDocumentRecord_profile]`.
**This doc aligns with Module C's emitter posture** (doc/18 §4, doc/20): pin to `ndhm.in#6.5.0`,
build a version switch, never auto-upgrade.

### D-G.2 Author / attester semantics — **DECIDED**

- `Composition.attester` is **0..\*** (must-support), **not mandatory** `[sweep, proven; re-affirmed
  doc/18/20]`. Therefore **application-enforced attestation** is the only reliable gate: the
  emitter writes `status=preliminary`; a physician attestation (`mode=professional`) flips it to
  `final`/`amended`.
- **Who authors what:** the hospital (Practitioner/Organization) authors emitted clinical records;
  a machine-elicited preliminary summary is authored by the hospital Organization with
  `status=preliminary` and is **not** `final` until attested. The kiosk/device is **never** the
  author of a clinician record (would assert false authorship — doc/20 §B-C.3).
- **Invariant 4:** neither patient confirmation nor a patient edit clears a machine verify-flag;
  only clinician attestation does.
- `[uncertain]`: whether NRCeS accepts a **preliminary OPConsultRecord authored by patient+device**
  is unverified — D-K blocker. Until answered, use the hospital-Org-authored preliminary shape.

### D-G.3 Retention/erasure per artifact — **DECIDED**

| Artifact | Retention | Erasure |
|---|---|---|
| Consent artefact | ≥7 years (CM floor) | Never erased early — it is the evidence |
| Audit event | 7 years (D-F note) | Never erased early |
| HealthDocumentRecord / OPConsultRecord (T2) | Consent period + hospital policy | Erase HIU-side copies on `dataEraseAt`; T3 per hospital retention |
| Kiosk transient (T1) | session | Crypto-erase at session end/sync |

---

## D-H. ABDM sandbox and certification path

### D-H.1 Certification roadmap — **DECIDED (sequence), dates BLOCKED-EXT**

```
HFR registration (hospital) ──► HIP onboarding ──► Sandbox keys (bridge ID/secret)
   ──► M1: ABHA create/verify/QR (D-C.1)
   ──► M2: care-context linking (HIP-initiated) + consent artefact handling + encrypted FHIR push
   ──► HAPI/matchbox validation with ndhm.in package (edge node)
   ──► Functional testing by an NHA-empanelled agency
   ──► Security audit (WASA/Safe-to-Host, CERT-IN/STQC-empanelled)
   ──► NHA committee review ──► Production credentials ──► go-live
```

Steps verified live `[verified 2026-09-16, ABDM sandbox docs (community mirror) + Nirmitee/
Codingclave/Qualysec 2026 guides]`:

- **Sandbox registration** → bridge ID + secret; **~3-4 days** to a few weeks.
- **Milestones:** M1 = ABHA identity; **M2 = HIP services** (care context, consent artefacts,
  encrypted FHIR sharing); M3 = HIU. Each is sequential and test-case-gated.
- **Sandbox exit:** (1) functional + non-functional testing by an NHA-empanelled agency (named
  agencies include **FIME India, Suma Soft, Tata Communications**; chargeable); (2) security audit
  / **Safe-to-Host** from a **CERT-IN or STQC**-empanelled agency; (3) NHA committee review;
  (4) production access. The partnering **HIP must be registered on HFR** (`facility.abdm.gov.in`).
- **Representative lead times** (vendor/secondary guides, labelled as such): M1 2-4 wks, M2 4-12
  wks, functional testing 2-4 wks, WASA 3-6 wks, committee 1-3 wks; **total 5-10 months** for a
  greenfield M1-M3 `[vendor-claimed, Nirmitee/Codingclave 2026]`. Treat as planning ranges, not
  commitments; re-quote with the chosen agency (D-K).
- **Certification attaches to the software, not the hospital** `[vendor guide, Qualysec 2026]` —
  which means MediKiosk's ABDM-compliant software needs certification, then is deployed by the
  hospital. This is exactly the "kiosk is part of the hospital's certified software" posture
  (doc/16 §2).

### D-H.2 Milestone gates aligned to the blueprint — **DECIDED**

| Blueprint phase | Module D gate | Exit criteria |
|---|---|---|
| **P2 Integration + sandbox** | Consent lifecycle + HIP linking + queue + validation | Consent → capture → summary → **encrypted push → acknowledged delivery** works in sandbox; HAPI validation green |
| **P4 Regulatory + certification** | Functional testing + WASA + NHA review | Functional report + Safe-to-Host + production credentials on file; M2 certified (M3 deferred) |

**Owner:** Regulatory/compliance lead + hospital IT (HFR/HIP). Eng owns sandbox integration.

### D-H.3 External dependencies — see Appendix B

Every item that needs an external authority (NHA, NRCeS, the hospital, a testing agency) is on
the standalone tracker with an owning body, the design decision it blocks, and a lead time.

---

## D-I. Operations, audit and key lifecycle

### D-I.1 Audit log — **DECIDED**

- **Schema:** `{event_id, at, actor, role, purpose, action, resource_type, resource_ref (no PHI),
  session_id, consent_ref, ip/device, before_hash, prev_hash, hash}`.
- **Immutability:** append-only; **hash-chained** (each event carries `prev_hash`); tamper-evident
  (the same pattern as doc/20 §B-E.3).
- **Shipping:** off-box to the edge/hospital audit store; **no PHI in the event** (only refs);
  vendor ops sees aggregate counts only.
- **Retention:** **7 years** target (D-F row 14); at least the 1-year log floor regardless.
- **Access control:** audit readers are a distinct role from clinical viewers and key custodians;
  reads of the audit log are themselves audited (D-J insider mitigation).

### D-I.2 Break-glass / emergency access — **DECIDED**

- **Who:** a named, on-duty clinician or the hospital DPO only.
- **When:** a documented clinical emergency; DPDP §7(f) medical-emergency ground may apply to
  disclosure, but **not** as a blanket bypass of security.
- **What is recorded:** actor, reason, time-box, session, resources accessed. Break-glass is
  **alerted** (not silent), time-boxed, and reviewed after the fact. Vendor/engineer access is
  always break-glass + alerted (doc/19 §6 RBAC).

### D-I.3 Runbooks Module D owns — **DECIDED (to be written in P2)**

| Runbook | Trigger | First action |
|---|---|---|
| Consent anomaly | Purpose/consent mismatch, unexpected grant/revoke pattern | Freeze affected queue items; audit trace; DPO notify if PHI exposure possible |
| Sync stall | Backlog depth > threshold | Check edge→gateway path; do **not** clear the queue; escalate |
| Gateway outage | ABDM 5xx/timeouts | Backoff continues; patient flow unaffected; backlog alert |
| Erasure request | Patient withdraws / `dataEraseAt` | Execute D-B.5/D-G.3; log destruction; confirm |
| Breach response | PHI exposure suspected | D-I.4 breach flow |
| Kiosk swap / disk loss | Device replacement/stolen | Device-key destruction; re-provision; review queue |

### D-I.4 Breach response — **DECIDED (template pre-drafted)**

- **Detect + scope from the audit trail** (which consent/session/resources; the audit log is
  built to make breach-scoping possible — doc/19 §6).
- **Notify affected Data Principals "without delay"** and give the Board **preliminary intimation
  without delay**, with a **detailed report within 72 hours** (or a longer period the Board
  allows) `[sweep, DPDP Rule 7]`.
- **Template (drafted here, to be completed with counsel):** incident id, date/time, nature,
  categories + approximate number of principals, likely consequences, measures taken/applied,
  DPO contact, Board reference. Stored offline-capable so a breach discovered offline still
  starts the clock correctly.
- **Post-mortem + CAPA**, severity ladder per doc/19 §7.

---

## D-J. Threat model for the consent and exchange path

Minimum set, with mitigations (extends doc/19 §6 + doc/20 appendices). **All are DECIDED
mitigations**; none is a deferral.

| # | Threat | Mitigation |
|---|---|---|
| T1 | **Consent replay / forgery** | Verify the CM `signature` on every artefact; bind artefact to `requestId`/`consentId`/patient; reject expired/revoked; idempotency keys stop replay duplication. |
| T2 | **Token theft** (session token) | Opaque token contains no PHI; short TTL; bound to device/session; invalid after session end; no offline reuse beyond the session. |
| T3 | **Rogue edge node** | Mutual TLS within Zone A; edge identity enrolled by the hospital; kiosk pins the edge cert; rogue device cannot join without hospital PKI enrolment. |
| T4 | **Insider PHI browsing** | RBAC separation (clinical viewer ≠ auditor ≠ key custodian); every PHI read is an immutable audit event; break-glass alerted; least privilege. |
| T5 | **Downgrade of consent scope** | Consent state machine is server-side of record at the edge; the kiosk cannot widen scope; scope changes require a new artefact; `purpose` is on every queue item. |
| T6 | **Queue tampering at rest** | SQLCipher AES-256; key in keystore/TPM; hash-chained item metadata; content hash verified on drain; any mismatch → dead-letter + alert. |
| T7 | **MITM on hospital LAN** | TLS 1.2+ + certificate pinning kiosk→edge; no kiosks on the internet (Zone A isolation, doc/19 §3). |
| T8 | **Key compromise** | Keys in HSM/keystore, never env/image; Fidelius keys ephemeral (so a stolen session key decrypts one exchange at most); rotation + revocation; crypto-erasure on destruction. |
| T9 | **Stolen kiosk disk** | Full at-rest encryption with key sealed to the device/TPM; without the key the disk is inert; device-key destruction on swap; no PHI persisted by default. |
| T10 | **Poisoned document / prompt injection** (cross-module) | Module B treats scanned text as untrusted data, never instructions; Module D never executes instructions from payloads; schema validation + deterministic rules (doc/19 §6, doc/20). |
| T11 | **Replayed erasure / false erasure proof** | Erasure events are hash-chained and logged with the artefact ref; independent audit review; false proof detectable by chain mismatch. |
| T12 | **Vendor-ops PHI leak** | Zone C receives aggregates only; PHI-in-logs test in CI as a release gate (invariant 6). |

---

## D-K. NRCeS / external confirmations to queue

Consolidated every external-authority question, with the body, the design decision blocked, and
the lead time. **The standalone checklist is Appendix B; the count is 16 blockers.** None of
these blocks starting P0/P2 sandbox work in parallel; each names the gate where it must be
resolved.

| ID | Question | Owning body | Blocks | Lead time |
|---|---|---|---|---|
| D-K-01 | **INPS publication status** and fitness as the carrier for a patient-elicited pre-visit summary | NRCeS | Emission-artifact final lock (D-G.1) | 1-2 emails/quarters |
| D-K-02 | Is a **preliminary OPConsultRecord authored by patient+device** acceptable, or must the author be the hospital? | NRCeS | Author semantics (D-G.2) | 2-4 wks |
| D-K-03 | **Planned Encounter** usage — is a planned/no-encounter OPConsultRecord acceptable pre-consult? | NRCeS | OPConsultRecord mandatory `encounter` (1..1) | 2-4 wks |
| D-K-04 | **HealthDocumentRecord scope** — does the raw-scan path + a machine extraction doc fit its DocumentReference-only section? | NRCeS | M2 raw-scan emission (D-G.1) | 2-4 wks |
| D-K-05 | **MedicationStatement vs MedicationRequest** in the OPConsultRecord Medications slice | NRCeS | Module B/C medication emission | 2-4 wks |
| D-K-06 | **IG v6.5.0 vs v7.0.0** — confirm v6.5.0 remains current-published and the v7.0.0 timeline | NRCeS | IG pin + version switch | 1-2 wks |
| D-K-07 | **CDSCO/SaMD wording boundary** for the red-flag layer (intended-use sign-off) | CDSCO + counsel | Release-gate wording (doc/19 D3) | 4-8 wks |
| D-K-08 | **`dataEraseAt` duty for a HIP that is the originator** vs an HIU holding a copy | NHA/NRCeS | Erasure design lock (D-B.5) | 2-4 wks |
| D-K-09 | **Exact consent-artefact field set/version** + the primary NHA URL for the Fidelius spec (re-verify) | NHA | Crypto + consent implementation freeze | 1-2 wks |
| D-K-10 | **Scan & Register kiosk integration surface** for non-hospital software | Hospital + NHA | Session-entry target (D-C.2) | 2-6 wks |
| D-K-11 | **HFR registration + HIP onboarding** — who owns it and when (hospital) | Hospital IT | Certification start (D-H) | 2-4 wks |
| D-K-12 | **DPDP Consent Manager substitution** — registered CM + interoperability standard | MeitY/DPB | CM adapter boundary (D-F row 12) | post-13-Nov-2026 |
| D-K-13 | **Country-allowlist / §16 notification** status | MeitY | Cross-border posture (D-F row 11) | un-notified |
| D-K-14 | **Medical-record retention** number (HDR policy) vs 7-yr audit | NHA/MoHFW | Retention clocks (D-F note) | policy-dependent |
| D-K-15 | **Fourth Schedule / Rule 12 children's-data exemption** exact scope | MeitY/counsel | Children's-data design (D-F row 10) | 4-8 wks |
| D-K-16 | **Empanelled functional-testing + WASA agencies** engagement + quote | NHA list | Certification cost/timeline (D-H) | 2-4 wks |

---

## Appendix A — Component breakdown D1–D12

Each component: responsibility, inputs, outputs, failure behaviour, dependencies. This is the
implementation-ready decomposition (analogous to B1–B9 and C1–C7). **No code.**

| # | Component | Responsibility | Inputs | Outputs | Failure behaviour | Depends on |
|---|---|---|---|---|---|---|
| **D1** | **Identity & Session Entry** | ABHA create/verify/QR + Scan & Register handoff; mint opaque session token | Patient interaction; ABHA/QR; hospital HFR ID | `session_id` token (no PHI); ABHA linkage record | No network → manual capture/QR fallback; service not blocked | Hospital HFR; ABDM M1 APIs |
| **D2** | **Notice & Consent Capture** | Render bilingual itemised notice; capture per-purpose consent + ack evidence | Notice template; purpose set; language; patient action | Consent record `{version, language, purposes, ack, ts}` | TTS/display failure → text + icon fallback; never proceed without ack | D1; notice registry |
| **D3** | **Consent Artefact Store & State Machine** | Own request→grant→active→partial→revoke→expire; store artefacts | Consent records; ABDM CM notifications | Consent state; `consent_ref` | CM unavailable → local pending state; enforcement local; propagate later | D8; edge consent store |
| **D4** | **Consent Propagation & Enforcement** | Gate every downstream op on purpose; propagate revoke to queue/edge/bundle/audit | Consent state; queue items; emission requests | Allow/deny decisions; revocation events | Any doubt → deny + flag (fail-closed for exchange, fail-open for care) | D3 |
| **D5** | **Care-Context Linking (HIP)** | Create + link care contexts under hospital HFR keys | Encounter; ABHA address; hospital keys | `careContexts[]`; linkage records | Network loss → queue linkage; retry | D1; hospital keys; D8 |
| **D6** | **Sync Queue & Store-and-Forward** | Encrypted queue, idempotency, backoff, ack, DLQ | Emissions; consent state | Delivery evidence; DLQ entries | Outage → persist + retry; never drop; never fabricate ack | D4; D7; edge |
| **D7** | **Crypto Service** | At-rest AES-256, TLS, Fidelius E2EE (ECDH Curve25519 + HKDF-SHA256 + AES-256-GCM) | Plaintext payloads; peer key material + nonces | Ciphertext; verified decryption | Crypto failure → **do not send** (never plaintext fallback) | D11 |
| **D8** | **ABDM Gateway Client** | All gateway calls (discovery, consent notify, data push) under hospital keys | Queue items; consent artefacts | Gateway responses; acks | Gateway/5xx → backoff; 4xx → DLQ; never auto-fix | D6; D7; hospital keys |
| **D9** | **Erasure & Retention Engine** | Retention clocks; `dataEraseAt`; crypto-erase; pre-erasure notice | Consent state; artefact inventory; policy | Erasure events; destruction proof | Clock/lock failure → alert + halt (never silently retain) | D3; D11; D10 |
| **D10** | **Audit & Evidence Service** | Append-only hash-chained audit; shipping; 7-yr; breach evidence | All events (refs, no PHI) | Audit records; breach-scope reports | Shipping failure → buffer encrypted; never lose | All |
| **D11** | **Key Lifecycle Manager** | Key gen/store (HSM/keystore), rotation, destruction | Device/hospital identity | Managed keys; destruction events | Keystore unavailable → crypto ops halted (fail-closed) | HSM/TPM/hospital PKI |
| **D12** | **Ops, Runbooks & Breach Response** | Alerting, runbooks, break-glass, breach template + flow | Metrics; alerts; incident reports | Runbook actions; breach notifications | Comms failure → offline-capable breach clock + manual escalation | D10; hospital ops |

**Interfaces:** `consent_ref` (D3→D4→D6), `session_id` (D1→A/B/C), queue items (D6→D8),
crypto payloads (D7↔D8), erasure events (D9→D10). Module D exposes only the **opaque token** to
A/B/C; no other cross-module PHI-bearing interface exists.

---

## Appendix B — External-confirmation tracker (standalone checklist)

Use this as the tracking issue set. Status values: `OPEN` / `ASKED` / `ANSWERED` / `N/A`.

- [ ] **D-K-01** INPS publication status + fitness as pre-visit summary carrier — owner: NRCeS — gate: D-G.1 — lead 1-2 quarters — status OPEN
- [ ] **D-K-02** Acceptable author for a preliminary patient+device OPConsultRecord — owner: NRCeS — gate: D-G.2 — lead 2-4 wks — status OPEN
- [ ] **D-K-03** Planned/no-Encounter OPConsultRecord acceptability — owner: NRCeS — gate: OPConsultRecord `encounter` 1..1 — lead 2-4 wks — status OPEN
- [ ] **D-K-04** HealthDocumentRecord scope for raw scans + machine extraction — owner: NRCeS — gate: D-G.1 — lead 2-4 wks — status OPEN
- [ ] **D-K-05** MedicationStatement vs MedicationRequest binding — owner: NRCeS — gate: medication emission — lead 2-4 wks — status OPEN
- [ ] **D-K-06** v6.5.0 current-published vs v7.0.0 timeline — owner: NRCeS — gate: IG pin — lead 1-2 wks — status OPEN
- [ ] **D-K-07** CDSCO/SaMD intended-use wording boundary (red-flag layer) — owner: CDSCO + counsel — gate: release wording — lead 4-8 wks — status OPEN
- [ ] **D-K-08** `dataEraseAt` duty for the originating HIP — owner: NHA/NRCeS — gate: erasure design — lead 2-4 wks — status OPEN
- [ ] **D-K-09** Consent-artefact field/version freeze + NHA primary Fidelius spec URL — owner: NHA — gate: crypto/consent freeze — lead 1-2 wks — status OPEN
- [ ] **D-K-10** Scan & Register kiosk integration surface — owner: Hospital + NHA — gate: session entry — lead 2-6 wks — status OPEN
- [ ] **D-K-11** HFR registration + HIP onboarding ownership/date — owner: Hospital IT — gate: certification start — lead 2-4 wks — status OPEN
- [ ] **D-K-12** DPDP Consent Manager substitution + interoperability standard — owner: MeitY/DPB — gate: CM adapter — lead post-13-Nov-2026 — status OPEN
- [ ] **D-K-13** §16 country-allowlist notification status — owner: MeitY — gate: cross-border posture — lead un-notified — status OPEN
- [ ] **D-K-14** Final medical-record retention (HDR policy) vs 7-yr audit — owner: NHA/MoHFW — gate: retention clocks — lead policy-dependent — status OPEN
- [ ] **D-K-15** Fourth Schedule / Rule 12 children's-data exemption scope — owner: MeitY/counsel — gate: children's-data design — lead 4-8 wks — status OPEN
- [ ] **D-K-16** Empanelled functional-testing + WASA agencies engagement/quote — owner: NHA list — gate: certification cost/timeline — lead 2-4 wks — status OPEN

**Count: 16 external blockers**, each with an owner and a lead time.

---

## Appendix C — Evidence register (fetched/re-verified 2026-09-16 unless noted)

- **Fidelius E2EE** — ECDH Curve25519 (Weierstrass) + HKDF-SHA256 (salt = first 20 bytes of XOR'd
  nonces) + AES-256-GCM (IV = last 12 bytes of XOR'd nonces); ephemeral keypairs:
  community ABDM docs mirror `kiranma72.github.io/abdm-docs` (M2 "packaging-health-data/
  encryption-decryption", M2 "encryption-decryption/implementation-guidelines", M3
  "getting-health-record"); independent implementations `github.com/eka-care/abdm-ecdh`,
  `github.com/prashantbsr/abdm-fidelius-dart`. *Primary NHA URL not fetched directly.*
- **ABDM consent artefact** — `purpose`, `hiTypes`, `permission.{accessMode, dateRange,
  dataEraseAt, frequency}`, `careContexts`, `consentManager`, CM W3C `signature`; HIP must store
  the artefact and track expiry; expired artefact must not be used: mirror
  `kiranma72.github.io/abdm-docs/3-milestone2/understanding-consents/`.
- **MeitY consent framework** — ABDM consent based on MeitY Consent-Tech-Framework v1.1
  (`dla.gov.in`), per ABDM HDM Policy Ch.11 + HIP/HIU Guidelines `[KB, doc/16]`.
- **Data residency + federated model** — ABDM HDM Policy (Apr-2022 rev.) Clause 26; HIE-CM
  consent/records flow; HIU deletion obligation: abdm.gov.in HDM Policy PDF + HIP/HIU Guidelines
  `[KB, doc/16 §1-2; re-confirmed live via abdm.gov.in PDF search results]`.
- **Scan & Register / 25 crore** — TOI 2026-08-08, ET HealthWorld 2026-08-08, PIB/NHA statement
  (30,800 facilities; 24,323 public/6,481 private; ~4 lakh/day).
- **ABHA Number vs Address** — abdm.gov.in/FAQ + PIB ABHA explainer (14-digit number;
  `name@abdm` address; one number ↔ multiple addresses).
- **ABDM milestones + sandbox exit** — sandbox docs (community mirror): M1 ABHA, M2 HIP, M3 HIU;
  functional testing by empanelled agency, WASA/Safe-to-Host by CERT-IN/STQC, NHA committee,
  production keys; HFR registration required. Lead-time/cost figures are vendor-claimed
  (Nirmitee, Codingclave, Qualysec 2026) and labelled as such.
- **DPDP Act 2023 + Rules 2025** — `[sweep, DPDP_Rules_2025.json]`: G.S.R. 846(E) notified
  13 Nov 2025; phases 13 Nov 2025 / 13 Nov 2026 / 13 May 2027; Rule 3 notice; Rule 4 CM (7-yr
  consent records); Rule 7 breach (immediate + 72 h); Rule 8 retention; §6 consent; §7(f)/(g)
  legitimate uses; §8 fiduciary; §9/Rule 12 Fourth Schedule children; §11-14 rights; §16
  cross-border; penalties to ₹250 cr. Sources: PIB PRID 2190014; MeitY; egazette; EY/KPMG guides.
- **NRCeS profiles** — `[sweep]` NRCeS_OPConsultRecord.json (type `371530004`; 12 section codes;
  attester 0..\*; v6.5.0 published 2025-05-08, v7.0.0 preview 2026-07-15 with INPS from HL7 IPS
  2.0.0), ABDM_HealthDocumentRecord_profile.json (type/section `419891008`; `section.entry` 1..\*
  DocumentReference only); doc/18 §4 + doc/20 §B-C (already logged).
- **Existing code** — `module-b/medib/intake.py` (consent gate + `ITEMIZED_NOTICE`),
  `module-c/medic/contracts.py` (`consent_ref`), `module-b/README.md:47` (B8 not implemented).

## Appendix D — What this doc did NOT resolve (all tracked)

- Every external-authority answer in Appendix B (16 items) — `OPEN`.
- The exact ABDM `dataEraseAt` originator duty, consent-artefact version freeze, and NHA primary
  Fidelius URL (D-K-08/09).
- The §16 country-allowlist and Fourth Schedule children's-data scope (D-K-13/15).
- Final medical-record retention numbers (D-K-14) — the 7-yr audit target is a design choice
  aligned to the CM floor, adjustable when the HDR policy is finalised.
- M3 (HIU) implementation — consciously DEFERRED (D-C.4).
- The DPDP-registered Consent Manager itself — not built; only the substitution boundary is
  designed (D-F row 12).

## Appendix E — KB updates required (proposed text; **do not apply in this session**)

> The following text is proposed for the shared KB. This session created/edited **only**
> `doc/22-module-d-production-design.md`; a separate integration session should apply these.

### E.1 `doc/research/05-research-log.md` — append this dated entry

```markdown
---

## 2026-09-16 — Module D (Consent, ABDM & Data Governance) production design

**What was done:** Executed PROMPT 3. Module D had no code and no design doc; produced
`doc/22-module-d-production-design.md` (D-A…D-K + components D1–D12 + a counsel-usable DPDP
mapping + a 16-item external-confirmation tracker). Research/design only — **no code written**,
no other file edited.

**Key findings / decisions:**
- **Posture DECIDED:** Hospital = Data Fiduciary + HIP; MediKiosk = Data Processor; deployment =
  hospital-owned ABDM-compliant certified software under the hospital's HFR ID (independent-kiosk
  model rejected for v1 — would need HRP + a fiduciary apparatus).
- **Consent lifecycle DECIDED:** request→grant→active→partial→revoke→expire; four individually
  revocable purposes (intake, summary generation, physician handover, ABDM upload); derived
  summary is covered by itemising P2/P3/P4 at intake (no separate fresh notice needed) —
  reconciled with the deep-sweep's DPDP finding.
- **Offline rule DECIDED:** capture proceeds offline under the fiduciary notice; **nothing is
  queued outside a consented purpose**; ABDM upload waits for the ABDM consent artefact.
- **Crypto DECIDED:** at-rest SQLCipher AES-256; TLS 1.2+; Fidelius-compatible E2EE
  (ECDH Curve25519 Weierstrass + HKDF-SHA256 + AES-256-GCM; salt = first 20 bytes / IV = last 12
  bytes of XOR'd nonces; ephemeral keys); keys in HSM/keystore; crypto-erasure = key destruction.
- **Re-verified live 2026-09-16:** Fidelius primitives (mirror + 2 independent implementations);
  ABDM consent-artefact fields; Scan & Register **25 crore** OPD registrations (Aug 2026);
  ABHA Number vs Address; ABDM M1/M2/M3 + sandbox-exit gates. `[uncertain]` items labelled.
- **16 external blockers** tracked (INPS status; preliminary patient-authored OPConsultRecord;
  planned Encounter; HealthDocumentRecord scope; MedicationStatement vs Request; IG v6.5.0 vs
  v7.0.0; CDSCO wording; `dataEraseAt` originator duty; consent-artefact version + primary
  Fidelius URL; Scan & Register kiosk surface; HFR/HIP onboarding; CM substitution; §16 allowlist;
  HDR retention; Fourth Schedule; testing/WASA agencies).
- **Error correction:** the prompt's "7-year audit retention per the Consent Manager standard"
  is DPDP **Rule 4**'s Consent-Manager consent-record floor, not a kiosk/ABDM audit rule; ABDM's
  Health Data Retention policy is draft (consultation discusses IP ~10y / OP ~5y). Module D
  targets 7-yr audit with per-purpose clocks, adjustable when HDR is finalised.

**Sources:** doc/22 Appendix C; deep-sweep JSONs (DPDP_Rules_2025, NRCeS_OPConsultRecord,
ABDM_HealthDocumentRecord_profile, SNOMED_CT_India_and_CDCI); ABDM sandbox docs mirror; PIB/TOI
Scan & Register; eka-care/abdm-ecdh; abdm.gov.in FAQ.
```

### E.2 `doc/research/07-open-questions.md` — proposed edits

**Edit 1 — the "ABDM sandbox docs - Module D compliance" bullet (Technical/Module Questions).**
Current:
```
- [ ] ABDM sandbox docs - Module D compliance (FHIR APIs, consent flow).
```
Replacement:
```
- [x] ABDM sandbox docs - Module D compliance (FHIR APIs, consent flow). **RESOLVED 2026-09-16
  (doc/22 §D-C, §D-H).** M1/M2/M3 sequence, consent-artefact fields (`purpose`, `hiTypes`,
  `dateRange`, `dataEraseAt`), care-context linking, encrypted data push, and the sandbox-exit
  gates (functional testing → WASA/Safe-to-Host → NHA committee) are documented. Remaining are
  external-authority answers only — see doc/22 Appendix B (16 tracked blockers).
```

**Edit 2 — the "DPDP legal read" bullet.**
Current:
```
- [ ] **DPDP legal read** - (a) doc/08's "health data = sensitive personal data" is the old IT-Act SPDI framing; DPDP 2023 applies uniform obligations - confirm the delta; (b) is the kiosk operator a Data Fiduciary or a Data Processor for the hospital (depends on deployment model)? DPDP Rules 2025 notified 13 Nov 2025, full compliance due 13 May 2027 (EY/PIB, see research log 2026-09-11).
```
Replacement:
```
- [x] **DPDP legal read** - **RESOLVED 2026-09-16 (doc/22 §D-A, §D-F).** (a) DPDP 2023 applies
  uniform obligations with **no separate "sensitive personal data" category** (delta from the
  old IT-Act SPDI framing confirmed; deep sweep + DPDP JSON). (b) **Hospital = Data Fiduciary;
  MediKiosk = Data Processor**; contractually settled via a required DPA. Deployment model
  DECIDED: hospital-owned ABDM-compliant certified software under the hospital HFR ID. Legal
  review remains only for the "compatible purpose" question and Fourth Schedule scope (doc/22
  D-K-15).
```

**Edit 3 — the "Scan & Register as Module D entry point" bullet (Innovation watch).**
Current:
```
- [ ] **Scan & Register as Module D entry point** — 25cr OPD registrations via ABHA QR token
(Aug 2026). Design the kiosk session to start from that token instead of a fresh login.
```
Replacement:
```
- [x] **Scan & Register as Module D entry point** — **DESIGNED 2026-09-16 (doc/22 §D-C.2).**
  Scan & Register is DECIDED as the preferred session entry (ABHA QR token handoff), with
  manual/QR ABHA capture as fallback and a no-ABHA path as last resort. Cross-verified live:
  **25 crore** OPD registrations, ~4 lakh/day, 30,800 facilities (Aug 2026, PIB/NHA). Remaining:
  the kiosk-side integration surface for non-hospital software (doc/22 D-K-10).
```

**Edit 4 — the "HIP posture for kiosk-scanned documents" bullet (Module B questions).**
Append an update line:
```
  - *Update (2026-09-16, doc/22 §D-A):* **deployment model DECIDED** — hospital-owned certified
    software under the hospital's HFR/HIP keys (the independent-kiosk/HRP route is rejected for
    v1). Data Fiduciary = hospital; MediKiosk = processor. This closes the remaining team design
    decision that doc/16 §2 left open.
```

**Edit 5 — the "Which NRCeS/ABDM artifact carries the pre-consultation summary?" bullet
(Module C research pass additions).** Append an update line:
```
  - *Update (2026-09-16, Module D design — doc/22 §D-G):* **aligned with Module C.** Raw scans →
    HealthDocumentRecord (DocumentReference-only); structured summary → OPConsultRecord
    (`371530004`) now, **INPS** when v7.0.0 publishes (still preview-only). Application-enforced
    attestation is mandatory (`attester` is 0..*). INPS publication status is the top external
    blocker (doc/22 D-K-01).
```

**Edit 6 — add new Module D open items at the end of the Module B section (or a new "Module D
questions" subsection).** Proposed:
```
## Module D questions (from the 2026-09-16 Module D design, doc/22)

- [ ] **`dataEraseAt` duty for an originating HIP** — does ABDM require a HIP that created the
  record to erase it, or only an HIU holding a fetched copy? Blocks the erasure design lock
  (doc/22 D-K-08 / §D-B.5).
- [ ] **Consent-artefact field/version freeze + primary NHA Fidelius spec URL** — re-verify the
  primary NHA page (the algorithm was confirmed this session only via the community mirror + two
  independent implementations). Blocks the crypto/consent implementation freeze (doc/22 D-K-09).
- [ ] **§16 country-allowlist notification** — still un-notified; India-only is the operative
  rule (doc/22 D-K-13).
- [ ] **Final Health Data Retention numbers** — HDR policy draft; Module D targets 7-yr audit
  with per-purpose clocks (doc/22 D-K-14).
```

### E.3 `doc/decisions/06-decisions-log.md` — proposed rows

> Add one row per real decision, in a new dated section.

```markdown
## Decisions confirmed 2026-09-16 (Module D production design — doc/22)

> Module D lead session; research/design only, no code. Full rationale in
> `doc/22-module-d-production-design.md`. Anything marked DEFERRED states its unblocking
> condition + owner. External blockers (16) are tracked in doc/22 D-K / Appendix B.

| Decision | Choice | Why |
|---|---|---|
| Data Fiduciary / Processor + deployment model | **Hospital = Data Fiduciary + HIP; MediKiosk = Data Processor; deployment = hospital-owned ABDM-compliant certified software under the hospital's HFR ID.** Independent-kiosk route (needs its own fiduciary apparatus + HRP) rejected for v1; the processor role is fixed contractually via a required DPA | Matches ABDM HIP definition (a HIP is a provider, not a tech vendor) and DPDP §8(1); keeps MediKiosk out of owning the patient relationship and out of holding production ABDM keys |
| Consent lifecycle | **request→grant→active→partial→revoke→expire**, with four individually revocable purposes (P1 intake, P2 summary generation, P3 physician handover, P4 ABDM upload). Partial grant supported; withdrawal as easy as grant | Consent is the gate (invariant); ABDM consent artefacts are granular and revocable per HDM Policy/MeitY framework; the four purposes map cleanly to the kiosk's data flows |
| Derived-summary notice | **Itemise P2/P3/P4 explicitly in the intake notice** so summary creation/storage/display/upload are covered without a separate fresh notice; notice is versioned so a fresh notice can be issued if the purpose set changes | The deep sweep established a summary is personal data and separate processing, lawful only if itemised; itemising at intake is the safe counsel-defensible design (`[uncertain]` "compatible purpose" still needs legal review) |
| Offline consent behaviour | **Capture proceeds offline under the fiduciary notice; never block care. Nothing is queued beyond a granted purpose; ABDM upload waits for the ABDM consent artefact** (item held `pending_consent`, not sent) | Invariant 7 (never block care) + the consent gate; decouples the clinical interaction from network availability without weakening consent |
| Crypto posture | **At rest: SQLCipher AES-256 (kiosk) + DB/disk AES-256 (edge). In transit: TLS 1.2+. Exchange: Fidelius-compatible E2EE — ECDH Curve25519 (Weierstrass) + HKDF-SHA256 (salt = first 20 bytes of XOR'd nonces) + AES-256-GCM (IV = last 12 bytes). Keys in HSM/keystore; crypto-erasure = key destruction** | Re-verified live 2026-09-16 from the ABDM docs mirror + two independent implementations; matches the ABDM encryption mandate and the project's crypto-erasure invariant |
| Session identity contract | **The kiosk receives only an opaque, PHI-free session token** (`session_id`, `consent_ref`, purpose set, language allow-list, retention mode, expiry, notice version); no ABHA/PHI in the token | Module A requirement 1 (doc/09 §4): Module D owns identity + consent; A/B/C must not authenticate ABHA or infer consent |
| ABDM artifact ownership | **Raw scans → HealthDocumentRecord (DocumentReference-only); structured summary → OPConsultRecord (`371530004`) now, INPS when published; structured meds/labs after attestation are hospital-authored (DEFERRED to M3). Application-enforced attestation** (`attester` is 0..*). The kiosk/device is never the author of a clinician record | Machine-verified profile facts; emitting a kiosk-authored clinical record would assert false authorship (same reasoning as doc/20 §B-C.3) |
| Core scope | **v1 = M2 HIP only; M3 (HIU) DEFERRED** until cross-facility pull is needed | The kiosk's value is capturing/sharing this encounter; M3 adds inbound-fetch + deletion obligations without serving the pre-visit-capture use case; additive later |
| Audit + retention | **Append-only, hash-chained, off-box audit with a 7-year target; ≥1-year log floor; per-purpose retention clocks; no PHI in audit events (refs only)** | Aligns to DPDP Rule 4's Consent-Manager consent-record floor (7 yr) + medico-legal practice; the 1-yr floor is Rule 8; adjustable when the HDR policy is finalised |
| Consent Manager | **Design a substitution boundary so a DPDP-registered Consent Manager can replace the ABDM HIE-CM; v1 uses the ABDM HIE-CM and builds no CM** | Rule 4 CM registration begins 13 Nov 2026; designing the boundary avoids rework while not building a regulated intermediary now |
| Vertical/scope | **No PHI in logs/telemetry/vendor systems (7-yr evidence, breach-scoped from audit); India-only processing/storage (HDM Clause 26)** | Invariants 5/6; DPDP §16 allowlist un-notified, so India-only is the operative stance |
```

### E.4 `doc/README.md` — proposed index row

Insert after the doc/21 row (or after doc/20 if doc/21 not yet indexed):

```markdown
| [22-module-d-production-design.md](22-module-d-production-design.md) | **Module D production design (gap closure):** actors + Data Fiduciary/Processor + deployment model, consent lifecycle (request→grant→active→partial→revoke→expire), HIP/HIU flows + Scan & Register entry, offline queue/sync, Fidelius crypto + key lifecycle, counsel-usable DPDP clause mapping, emission/attestation ownership, ABDM sandbox certification roadmap, ops/audit/threat model, components D1–D12, and a 16-item external-confirmation tracker | Design (2026-09-16) — every item DECIDED or explicitly DEFERRED; no code |
```

---

*Module D production design prepared 2026-09-16. Research/design only — no code was written; the
only file created or edited by this session is this document. Prepared for team ratification;
the posture/deployment decisions in §D-A and the crypto/consent decisions in §D-B/§D-E are the
load-bearing ones to sign first.*

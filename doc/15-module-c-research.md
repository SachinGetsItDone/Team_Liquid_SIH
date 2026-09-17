# Module C Research — Structured History Summary Generator (2026-09-11)

> **Purpose:** research-only pass for Module C (Structured History Summary Generator).
> Output findings only — no architecture recommendations, no code, no component picks.
> Every claim sourced via live fetches; KB-contradicting assumptions (e.g., 4–6GB VRAM) corrected per grounded hardware profile (`doc/09 §1`: CPU/iGPU-only kiosk, ~4GB RAM, no dGPU).

---

## 1. Module Responsibilities (from KB `doc/01, 04, 08 §5, 09, 11`)

- **Inputs**: (a) signed `HistoryBundle` from Module A — patient utterances, normalized SOCRATES/Dashavidha fields, slot confidence/provenance, red flags, session/consent refs; (b) FHIR-structured extracts from Module B — `DocumentBundle` with `MedicationRequest` (SNOMED/CDCI), `Observation` (labs), `Condition` (diagnoses), `DocumentReference` (raw scans).
- **Function**: synthesize both streams into **one** structured, physician-ready, editable, bilingual summary; **store underlying fields once** (unified SOCRATES+Dashavidha ontology → FHIR/JSON canon) and **render many** (SOAP, OLD CARTS, bilingual read-back); chronological timeline of prior records; abnormal values + red flags highlighted; **never diagnoses** — Assessment & Plan are physician-only drafts.
- **Outputs**: one-page physician-facing summary on doctor's consultation screen; FHIR bundle to HIS/ABDM (via Module D); patient spoken confirmation (read-back — demo puts this in Module A, `doc/11` mentions it in C — ambiguity flagged below).
- **Connections**: consumes A + B → hands to D (ABDM/FHIR push); physician edits/confirms (`attester` slot).

**Open scope questions (KB not explicit):**
1. Does Module C own the patient read-back UI, or is it Module A's? (Demo: A does read-back; `doc/11` MVP text puts it in C.)
2. HistoryBundle schema undefined: ontology, serialization, API contract, confidence schema, session-retention, consent boundary (`doc/07` open question).
3. Render target formats v1: SOAP only? OPConsultRecord? Both?
4. Rendering runs on kiosk (CPU-only) or room-server?
5. Bilingual rendering requirements (Devanagari + English per field? full narrative?).
6. Dashavidha parameters in the unified canon — self-reportable 6 + 4 `requires_clinician` slots?
7. NAMASTE/ICD-11 AYUSH diagnosis codes in OPConsultRecord sections (profile lacks explicit AYUSH sections).

---

## 2. Prior Art — Deployed Products / Pilots / Research Prototypes

| System | What it does | Who / Status | How it differs from Module C |
|--------|--------------|--------------|------------------------------|
| **Phreesia** (US) | Pre-visit admin intake (forms, insurance, payments), kiosk/mobile | ~4,700 orgs, ~180M visits, production | Administrative only — no deep clinical HPI, no document digitization, no ABDM/FHIR national record push, English-first |
| **Augnito Omni / EkaScribe / Sunoh.ai** | Ambient AI scribe: doctor-patient dialogue → clinical note | Doctors (India + global), production | Doctor-side, **during** visit — doctor still spends 2 min eliciting; MediKiosk moves elicitation **before** visit, patient-driven |
| **Eka Care** | Patient-side PHR + records analyser (OCR prescriptions/labs → FHIR), ABDM-integrated | 140M+ records, ABDM-compliant, production | App-first, cloud; no unassisted kiosk interview, no pre-consultation handoff to doctor screen |
| **Yolo HealthATM / Clinics on Cloud** | 60+ vital parameters + teleconsult | 500+ units with state govts, production | Measures body, not story — no history elicitation, no document digitization pipeline |
| **NirogStreet Vaidya Tool** | AYUSH SaaS: patient records, prescriptions, follow-ups | Practitioner-side, production | No patient-facing voice intake, no structured Dashavidha capture, no document digitization |
| **eSanjeevani** | National telemedicine (47+ crore consults) | Citizens, production | Remote consultation delivery; doesn't solve in-person OPD history capture |
| **rohit-h11/medikiosk-sih-26047** (competing SIH team) | `/api/v1/summary`: "30-second FHIR summaries & doctor Q&A assistant" + pgvector RAG for cross-visit Q&A | 43 commits, 0 stars, active dev | **Closest direct competitor for Module C**. Cloud-first (Supabase US, Groq Llama-3.3-70B, Sarvam AI). Claims CCRAS PAS "government-standardized" (KB: PAS item set copyrighted/restricted). NAMASTE/ICD-11 mapping for AYUSH. **Differentiation must come from**: physician-editable attestation flow, OPConsultRecord-conformant emission (theirs: "FHIR-shaped" — not necessarily NRCeS-profile-validated), provenance/confidence per field, offline capability |
| **After-Visit Summary (AVS)** | US EHR standard (Meaningful Use): patient-facing post-visit summary | All major US EHRs (Epic, athenahealth, etc.), mandated | Patient-facing, **post-visit**; established prior art — 736 PMC papers (1998–2026), recent AI-generation studies (e.g., "Readability of AI-Generated Patient Visit Summaries in Orthopedic Surgery", J Med Internet Res 2026) |
| **International Patient Summary (IPS)** | HL7 FHIR IG (STU 2, v2.0.1): cross-border summary care record | HL7 International, STU ballot | Composition-based Bundle with standard sections: allergies, medications, problems, immunizations, procedures, diagnostic results, vital signs, past history, social history, pregnancy, functional status. Pre-existing standard for "summary document" — prior art for concept of computable summary |

### Research Prototypes (papers)
- **g-AMIE** (Google DeepMind, arXiv) — LLM agent conducting patient interviews + drafting notes; evaluated on note quality vs physicians.
- **MEDCOD / Note2Chat** (arXiv:2111.09381) — deterministic dialogue manager + LLM NLU for history-taking; converged pattern cited in `doc/09 §4`.
- **Abridge / Nuance DAX / Ambience** — commercial ambient scribes with published note-quality evaluations (US, doctor-side).

---

## 3. Standards, Regulations, Government Frameworks

| Standard / Regulation | Relevance to Module C | Key Constraints / Citations |
|----------------------|----------------------|------------------------------|
| **NRCeS FHIR IG for ABDM v6.5.0** — `OPConsultRecord` | **Canonical output contract** for physician-facing consult summary in ABDM | Composition profile: type=371530004 (Clinical consultation report), mandatory status/type/subject/encounter/date/author/title; attester (mode required); 12 SNOMED-sliced sections (ChiefComplaints→Condition, PhysicalExam→Observation, Allergies→AllergyIntolerance, MedicalHistory, Medications, FamilyHistory, InvestigationAdvice, OtherObservations, Procedure, DocumentReference, FollowUp, Referral). Emitted as Bundle.type=document. [Source: fetched `https://nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html`] |
| **ABDM FHIR R4 Profiles** (HealthDocumentRecord, PrescriptionRecord, DiagnosticReportRecord, DocumentBundle) | Module B outputs feed into C's bundle; C must emit valid DocumentBundle + OPConsultRecord | NRCeS IG defines all profiles; validation via HAPI FHIR [source: doc/13 §1] |
| **DPDP Act 2023 + Rules 2025** (notified 13 Nov 2025, full compliance 13 May 2027) | Summary is derived personal data; purpose limitation, notice, consent, retention apply | Notice in 22 Eighth Schedule languages (audio-guided for low-literacy); purpose = this consultation; data minimization; breach 72h; data fiduciary vs processor posture for kiosk operator unresolved [source: doc/13 §4, EY/PIB] |
| **SNOMED CT India** (NRCeS member) + **CDCI** (Common Drug Codes for India, National Extension) | Medication coding target for MedicationRequest | ndhm-medicine-codes ValueSet example-bound to SNOMED CT Intl clinical drugs + CDCI [source: doc/13 §1] |
| **NAMASTE Portal** (AYUSH morbidity codes) | AYUSH diagnosis coding — ICD-11 + NAMASTE extension | Competitor cites this; official status needs verification; OPConsultRecord lacks explicit AYUSH sections |
| **HL7 FHIR IPS (International Patient Summary)** | Prior art for computable summary document standard | STU 2, v2.0.1; Composition-based Bundle with standard clinical sections [source: `http://hl7.org/fhir/uv/ips/`] |

---

## 4. Open-Source Tools / Libraries / Frameworks (Report Only — No Recommendation)

| Tool / Library | Language | License | Maintenance | Purpose |
|----------------|----------|---------|-------------|---------|
| **HAPI FHIR** | Java | Apache-2.0 | Very active (Smile Digital Health, updated 2026-09-11) | Full FHIR R4/R5 implementation: parser, validator, JPA server, client, terminology. Public test server. [Source: `https://hapifhir.io/`] |
| **fhir.resources** (Firely Team) | Python | BSD-3-Clause (verify) | Active (Firely) | Pydantic models for FHIR R4/R5; serialization, validation. [Source: GitHub `FirelyTeam/fhir.resources`] |
| **smart-on-fhir / fhirclient** | JavaScript/TypeScript | Apache-2.0 | Active (354★, 801 commits) | SMART-on-FHIR client for browser/Node; OAuth, FHIR REST. [Source: `https://github.com/smart-on-fhir/client-js`] |
| **health-data-standards** | Ruby | Apache-2.0 | MITRE, active | Clinical quality measures, HQMF, FHIR; used in CMS eCQM tooling. |
| **matchbox** | Go | Apache-2.0 | Active | FHIR IG / profile validation engine (used by HL7 tooling). |
| **fhirpath.js / fhirpath** | JavaScript / Python | MIT / Apache-2.0 | Active | FHIRPath expression evaluation for validation/querying. |
| **FHIR Narrative Generation** | Various | Various | HAPI includes narrative generators; Liquid templates used in some IGs (e.g., IPS); no single standard renderer library identified. |
| **fhirpy** | Python | MIT | Lower activity | Older Python FHIR client; less maintained than fhir.resources. |

---

## 5. Unresolved / Flagged Items

1. **HistoryBundle contract** — ontology, serialization, API, confidence schema, retention, consent boundary all undefined (`doc/07` open question).
2. **Patient read-back ownership** — demo puts in Module A; `doc/11` MVP text puts in Module C.
3. **OPConsultRecord ↔ MediKiosk canon mapping** — which sections map to SOCRATES/Dashavidha fields? (e.g., no explicit "HPI" or "SocialHistory" section slice in OPConsultRecord; "MedicalHistory" may subsume PMH+Social; "OtherObservations" likely ROS).
4. **AYUSH in OPConsultRecord** — profile has no AYUSH-specific sections (Prakriti, Vikriti, etc.). Competitor maps to NAMASTE/ICD-11; official NRCeS AYUSH profiles unverified.
5. **Rendering tier** — kiosk (CPU-only 4GB) vs room-server for summary generation? Doc/09 puts summary in Module C (post-handoff), but demo renders on kiosk browser.
6. **DPDP for derived summaries** — does a generated summary constitute "processed data" requiring fresh notice/consent distinct from intake consent? Unresolved in legal read.
7. **NAMASTE/ICD-11 licensing** — AYUSH morbidity code terms for commercial product unverified.
8. **Competitor divergence** — rohit-h11 uses cloud LLMs (Groq Llama-70B), US-hosted Supabase, Sarvam AI; our offline-first India-residency constraint fundamentally changes the stack.
9. **OPConsultRecord `attester` workflow** — physician attestation mode (`professional`) and party reference must be wired into Module C → D handoff; demo simulates "locked Assessment & Plan — physician only" but real attestation flow undefined.
10. **Bilingual rendering spec** — Devanagari + English per field? Full narrative in both? No KB decision.

---

## 6. Source Register (Fetched 2026-09-11)

- NRCeS FHIR IG ABDM v6.5.0: `https://nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html` (full profile, section slices, fixed SNOMED codes)
- HAPI FHIR: `https://hapifhir.io/` (Apache-2.0, active, validation/JPA/client)
- IPS (International Patient Summary): `http://hl7.org/fhir/uv/ips/` (HL7 STU 2)
- rohit-h11/medikiosk-sih-26047: `https://github.com/rohit-h11/medikiosk-sih-26047` (43 commits, summary API, CCRAS PAS claim, NAMASTE/ICD-11, cloud stack)
- PMC "after-visit summary": `https://pmc.ncbi.nlm.nih.gov/search/?term=%22after-visit+summary%22` (736 results, 1998–2026, incl. AI-generated summary studies 2026)
- smart-on-fhir client-js: `https://github.com/smart-on-fhir/client-js` (Apache-2.0, 354★)
- doc/13-module-b-deep-dive.md (NRCeS output contract, MIRAGE accuracy ceilings, ABDM profiles)
- doc/09-module-a-design.md (HistoryBundle spec, interview sequence, hardware grounding)
- doc/07-open-questions.md (HistoryBundle, CCRAS PAS, NAMASTE, SNOMED India terms, HIP posture)
- doc/10-positioning-evidence.md (competitor scan, Phreesia, Augnito, Eka Care, eSanjeevani, NirogStreet)

---

## 7. Verification Pass 2 (2026-09-11, night session — live re-fetch of key claims)

Purpose: re-verify the load-bearing claims of §1–§6 with fresh live fetches (constraint:
every claim re-sourced). **Corrections found are listed first; they supersede §1–§6 where
they conflict.**

### 7a. Corrections to this doc

1. **DPDP Rules 2025 notification date = 14 November 2025** (not 13 Nov as §3 says).
   Official PIB explainer PDF (Nov 2025): "The Government of India notified the Digital
   Personal Data Protection Rules, 2025 on 14 November 2025… The Rules introduce an
   eighteen-month period for phased compliance" → compliance horizon ≈ **14 May 2027**
   (§3's "13 May 2027" is off by one day; "18-month phased" is the citable phrasing).
   Same doc lists the seven principles (consent & transparency, purpose limitation, data
   minimisation, accuracy, storage limitation, security safeguards, accountability) and
   the Data Fiduciary / Data Principal / Data Processor / Consent Manager roles.
   [Source: `https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf` (PIB, 17 Nov 2025); draft-consultation context: `https://www.pib.gov.in/PressReleasePage.aspx?PRID=2148944`]
2. **fhir.resources maintainer/repo wrong in §4**: the package is **nazrulworld/fhir.resources**
   (Md Nazrul Islam), not FirelyTeam. GitHub 534★, last push 2026-07-03, license shows
   NOASSERTION on GitHub but **BSD on PyPI** (v8.3.0, 2026-07-03). **Single maintainer**
   (bus-factor caveat). Critical for ABDM work: **from v7.0.0 there is no FHIR R4
   sub-package** (default = R5, previous = R4B/STU3 sub-packages) — ABDM profiles are
   FHIR R4, so R4B-overlap ≠ R4 conformance and needs explicit checking.
   [Sources: `https://api.github.com/repos/nazrulworld/fhir.resources`; `https://pypi.org/project/fhir.resources/`]
3. **"US Core Mediated Submission / PATAST" (quoted in doc/07) is UNVERIFIED.** US Core
   IG pages (hl7.org/fhir/us/core/) contain no "patient authored"/PATAST guidance that
   could be located this session (candidate pages 404 or lack the term). Treat the
   patient-asserted-note international-precedent claim as **unsourced until found**; do
   not cite to judges. (Open question updated in doc/07.)

### 7b. Claims re-verified live (no change)

- **NRCeS OPConsultRecord v6.5.0** — re-fetched full profile page: Composition with fixed
  type SNOMED 371530004 "Clinical consultation report"; mandatory status/type/subject/
  encounter/date/author/title; attester.mode ∈ {personal, professional, legal, official};
  SNOMED-coded section slices verified: ChiefComplaints (422843007)→Condition,
  PhysicalExamination (425044008)→Observation, Allergies (722446000)→AllergyIntolerance,
  MedicalHistory, … [Source: `https://nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html`]
- **Competing repo rohit-h11/medikiosk-sih-26047** — README read in full via raw fetch +
  GitHub API metadata: created 2026-08-29, last push 2026-09-06, Python, **no license
  file**, 0★, 16 open issues. Stack confirmed: FastAPI + React/Vite, Supabase (DB+pgvector
  RAG), Groq Llama-3.3-70B (SOCRATES engine), Sarvam AI (Saaras ASR, Bulbul v3 TTS),
  IndicConformer/IndicWhisper + IndicTrans2 + Bhashini, `/api/v1/summary` = "30-second
  FHIR-shaped summaries", NAMASTE/ICD-11 AYUSH mapping, CCRAS PAS battery, AES-256,
  consent-hash audit trail. **Cloud-first, no offline story, no license.**
  [Sources: `https://raw.githubusercontent.com/rohit-h11/medikiosk-sih-26047/main/README.md`; `https://api.github.com/repos/rohit-h11/medikiosk-sih-26047`]
- **Eka Care** — live site (2026-09-11): 33K+ clinics/hospitals, 90K+ doctors, 20Mn+ ABHA
  created, **140Mn+ records managed**, 1Mn+ EkaScribe sessions, 8Mn+ MedAssist
  conversations; badges: NHA Approved, ABDM Compliant, FHIR Compliant; Medical Records
  Analyser ("structured smart dashboard" from records); CDSS; Conversational Health
  Platform (patient-facing voice agents). [Source: `https://www.eka.care/`]
- **Sunoh.ai (eClinicalWorks/healow)** — 100k+ providers, doctor-side ambient scribe,
  listens during visit → progress-note draft + order capture; HIPAA (BAA); EHR sync.
  [Source: `https://sunoh.ai/`]
- **Phreesia** — 4,700+ healthcare organizations; IR page "more than 170 million patient
  visits annually"; marketplace listing "120 million visits/yr, ~1 in 10 US visits".
  Admin/revenue intake, not clinical HPI. [Sources: `https://www.phreesia.com/`; `https://ir.phreesia.com/company-overview/default.aspx`]
- **MiiHealth AI / DAINA** — $2.8M seed (Aug 2026, Phoenix AZ; led by Russell Glass
  ex-Headspace): DAINA = "Dynamic AI Intake and Navigation Agent", phone-call pre-visit
  intake in native language → structured note written into chart; platform "Mediiflow".
  Status: several clinical validation projects → scaling to deployment. US telehealth-
  first, no kiosk/documents/ABDM. [Sources: `https://www.finsmes.com/2026/08/miihealth-ai-closes-funding.html`; `https://distilinfo.com/2026/08/17/ai-patient-intake-miihealth-seed-funding/`; `https://finance.yahoo.com/healthcare/articles/miihealth-ai-closes-seed-round-214100415.html`]
- **Mount Sinai Clearstep** — NEJM Catalyst (2026) "Check Symptoms & Get Care": MSHS
  deployment of Clearstep AI self-triage; high satisfaction + clinical accuracy +
  physician concordance. [Source: `https://catalyst.nejm.org/doi/full/10.1056/CAT.25.0394`]
- **g-AMIE** — arXiv 2507.15743 "Towards physician-centered oversight of conversational
  medical AI": 60 scenarios, g-AMIE outperformed PCP groups at intake + case
  summarization + proposed dx/management for PCP review; PCP oversight of g-AMIE more
  time-efficient than standalone PCP consults. Guardrail agent blocks individualized
  medical advice. Research prototype only. [Sources: `https://arxiv.org/abs/2507.15743`; `https://research.google/blog/enabling-physician-centered-oversight-for-amie/`]
- **NAMASTE Portal** — live (Ministry of Ayush): "National Ayush Morbidity And
  Standardized Terminologies Electronic Portal"; morbidity codes for Ayurveda/Siddha/
  Unani + WHO-ICD-10 + WHO-ICD-11 tabs; standard terminology modules; dashboards: 256
  hospitals registered, 187 uploading, 1.21 crore OPD records since 2017. **Confirms
  NAMASTE is official and includes ICD-10/11 mapping** (licensing terms still
  unverified). [Source: `https://namaste.ayush.gov.in/`]
- **SNOMED CT India** — member since March 2014; NRCeS (C-DAC Pune) is the National
  Release Centre; affiliate licenses via MLDS (India landing). [Source: `https://www.snomed.org/members/india`]
- **HAPI FHIR** — Apache-2.0, Smile Digital Health, "23 years", public test server
  hapi.fhir.org, site updated 2026-09-11. [Source: `https://hapifhir.io/`]
- **HL7 IPS** — IG v2.0.1 (continuous build), HL7 International / Patient Care.
  [Source: `https://build.fhir.org/ig/HL7/fhir-ips/`]
- **IndicTrans2** — MIT, AI4Bharat, "translation models for 22 scheduled languages",
  471★, last code push 2025-10-03. [Source: `https://api.github.com/repos/AI4Bharat/IndicTrans2`]
- **arXiv 2604.14829** (SOAP hallucination eval) — confirmed: lexical-faithfulness
  regimes inflate mean hallucination rate to 35%; inference-aware evaluation drops it to
  9% with remaining cases genuine safety concerns. 12-page preprint, submitted 16 Apr
  2026 (not yet a peer-reviewed venue). [Source: `https://arxiv.org/abs/2604.14829`]

### 7c. Could NOT re-verify this session (prior-pass citations stand, flagged)

- **Augnito** — vendor domains (augnito.io / augnito.ai / omniscient.tech) are JS-only
  or transport-blocked; search engines rate-limited during this session. §2 row rests on
  the prior pass / doc/10.
- **ABDM HDM Policy Clause 26 quote** — abdm.gov.in is an SPA; the policy PDF could not
  be re-fetched this session (doc/16 §1 holds the prior-session citation — keep citing
  doc/16 until re-verified).
- **eSanjeevani cumulative consult count** — official portal is JS-rendered; count not
  re-fetched (portal + Bhashini integration endpoints verified to exist:
  `https://esanjeevani.mohfw.gov.in/`, `https://bhashini.esanjeevani.in/`).
- **Yolo HealthATM, NirogStreet, Augnito/EkaScribe volumes beyond Eka's own site** —
  not re-fetched; doc/10 prior-pass citations stand.

---
## 8. Completion Pass (2026-09-11 — closes remaining gaps from §7c + OSS + eval literature)

### 8a. OSS table corrections / completions (supersede §4 rows where noted)

1. **smart-on-fhir/client-js — license CONFIRMED Apache-2.0** (Boston Children's
   Hospital 2015, via LICENSE file — GitHub API's NOASSERTION is a detection quirk).
   TypeScript, 354★, active (pushed 2025-12-22). SMART-on-FHIR browser/Node client.
   [Sources: `https://raw.githubusercontent.com/smart-on-fhir/client-js/master/LICENSE`; `https://api.github.com/repos/smart-on-fhir/client-js`]
2. **matchbox — CORRECTION: Java, not Go.** Real project is **ahdis/matchbox**
   ("validation and mapping for FHIR", fork of HAPI JPA starter, homepage
   matchbox.health), Apache-2.0, 37★, very active (pushed 2026-09-11). FHIR
   validation/mapping server facade used in the Swiss community/Projectathons.
   [Source: `https://api.github.com/repos/ahdis/matchbox`]
3. **fhirpath — CORRECTION: split the lumped §4 row.** JS: **HL7/fhirpath.js**,
   **BSD-style license** (NLM/LHNCBC + Health Samurai, with NLM attribution clause —
   NOT MIT/Apache), v5.2.0, DSTU2/STU3/R4/R5 contexts, 189★, active (pushed
   2026-08-25). Python: **beda-software/fhirpath-py** (MIT, 76★, active, pushed
   2026-08-25) vs **nazrulworld/fhirpath** (Apache-2.0, 34★, STALE — last push
   2023-01-24). [Sources: `https://raw.githubusercontent.com/HL7/fhirpath.js/master/LICENSE.md`; `https://api.github.com/repos/HL7/fhirpath.js`; GitHub search `fhirpath language:python`]
4. **health-data-standards (Ruby/MITRE) — NOT re-verified** this pass; §4 row stands
   from pass 1 only. Flag before citing.

### 8b. Clinical note-generation benchmarks — the eval-protocol literature (new)

These directly answer doc/07's "Module C evaluation protocol" question on the
research side (which metrics exist, what they measure, what data is available):

- **ACI-BENCH** (Yim et al., arXiv:2306.02022, Jun 2023, preprint): "the largest
  dataset to date tackling AI-assisted note generation from visit dialogue" at
  publication — **207 full doctor-patient conversation ↔ clinic-note pairs**;
  benchmarked SOTA approaches of the day. [Source: `https://arxiv.org/abs/2306.02022`]
- **MEDIQA-Chat 2023** (ClinicalNLP @ ACL 2023; overview: Ben Abacha et al.,
  `2023.clinicalnlp-1.52`, pp. 503–513, DOI 10.18653/v1/2023.clinicalnlp-1.52):
  **17 teams**; Task A = short Dialogue2Note (one section + header from 20 headers,
  e.g. cc, genhx, ros, meds) on **MTS-Dialog (1.7k pairs; 1,201/100/200 split)**;
  Task B = full-note generation and Task C = Note2Dialogue augmentation, both on
  **ACI-Bench (67/20/40 split)**. Official metrics: **ROUGE, BERTScore, BLEURT +
  human evaluation** (verified by extracting the 11-page overview PDF — no MEDCON,
  no QuickUMLS, no license/DUA statement found in it).
  Task site + data/code: `https://sites.google.com/view/mediqa2023/clinicalnlp-mediqa-chat-2023`, `https://github.com/abachaa/MEDIQA-Chat-2023`.
  [Sources: `https://aclanthology.org/2023.clinicalnlp-1.52/`; overview PDF text extraction]
- Participant results (all peer-reviewed workshop papers, citable as prior art):
  **WangLab** (arXiv:2305.02220) — GPT-4 few-shot ICL notes "preferred about as
  often as human-written notes" by experts; **GersteinLab** (arXiv:2305.05001) —
  ROUGE-1 0.4011 / BERTScore 0.7058 / BLEURT 0.5421; **SummQA** (arXiv:2306.17384) —
  GPT-4 more abstractive/shorter; **Team Cadence** (2023.clinicalnlp-1.28) — Task C
  winner, BART-based, "only team to submit stable and reproducible runs to all three
  tasks"; **UMASS_BioNLP** (arXiv:2306.16931) — reports "medical concept recall" as
  an automatic metric; **Singh et al.** (2023.clinicalnlp-1.18) — industry-scale
  seq2seq note generation on **~900K encounters / 1,800 providers / 27 specialties**.
- **"MEDCON" metric: NOT verified.** The term appears nowhere in the MEDIQA-Chat
  overview PDF. Do not cite MEDCON as an established MEDIQA metric; the verified
  concept-level signal is UMASS's "medical concept recall". (Related: Nair et al.,
  2023.clinicalnlp-1.26 — multi-stage GPT-3 summarization with GPT-derived medical-
  correctness metrics; Savkov et al. 2022 "Consultation checklists" for standardised
  human eval of note generation — both in the same proceedings volume.)
- Combined with arXiv:2604.14829 (§7b: 35% lexical vs 9% inference-aware
  hallucination rates), the research-side answer is: established protocol =
  ROUGE/BERTScore/BLEURT + concept-recall + rubric-based human eval, with an
  inference-aware judge definition. Team still must NAME its protocol (open).

### 8c. Blocked items — resolved or finally flagged

- **Augnito — RESOLVED (deployed product, doctor-side).** Chrome Web Store listing:
  "Augnito" by **Augnito India Private Limited (Mumbai)**, 20,000 users, v4.2.0.0
  (Oct 2024) — "Voice powered medical reporting… 99% accuracy… make twice the
  number of medical reports". Sibling listing **"Augnito Omni — Generate EMR from
  Patient Conversations"** (new, 0 ratings) + Android app
  (com.scribetech.augnitoappprod). Doctor-side dictation + ambient EMR; no
  patient-facing pre-visit intake, no kiosk/documents/ABDM evidence.
  [Source: `https://chromewebstore.google.com/detail/augnito/loedohmkociaomkgggggnoogiahfinme`]
- **Yolo HealthATM — RE-VERIFIED with fresh numbers** (vendor site, live):
  **750+ installations, 44.7L+ tests, 2.48L+ patients registered, 30+ clients**;
  kiosk models with 25/34/60+ test parameters + mobile medical unit; **ABDM
  certificate badge** on site; govt clients (Ayodhya Nagar Nigam, UPMSCL, Arunachal
  Pradesh, Lucknow Smart City, NDMC, Indian Railways). Confirms the §2
  characterisation: measures the body (+teleconsult), no history elicitation, no
  document pipeline. [Source: `https://yolohealth.in/`]
- **eSanjeevani — platform facts confirmed, counts still prior-pass only.** C-DAC
  page: national telemedicine service (launched 16 Jun 2009), C-DAC Mohali build,
  doctor-to-doctor + patient-to-doctor, store-and-forward + real-time video,
  DICOM/TWAIN, equipment interfacing (ECG etc.).
  [Source: `https://cdac.gov.in/index.aspx?id=hi_pr_eSanjeevani`]
- **NirogStreet — SITE DOWN.** nirogstreet.com returns "WEBSITE TEMPORARILY
  UNAVAILABLE" as of 2026-09-11. AYUSH-SaaS prior-art row keeps its doc/10
  citation for what the product was, but live status is now UNCERTAIN — flag
  before citing as active competition.
- **ABDM HDM Policy Clause-26 PDF — still not re-fetchable live** (abdm.gov.in is
  an SPA; no HDM captures on web.archive.org for abdm.gov.in or ndhm.gov.in;
  search engines return junk). doc/16 §1 remains the citable source. Final flag.

---

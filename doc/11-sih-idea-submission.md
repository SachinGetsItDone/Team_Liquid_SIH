# SIH 2026 Idea Submission — MediKiosk (SIH26047)

> Draft answers for the SIH idea portal, structured to the official must-have fields.
> Every statistic here is sourced (links in `doc/10-positioning-evidence.md`); projections are
> labeled as such. PS: SIH26047 "Patient Case-Taking Software" · Ministry of Ayush / AIIA ·
> Theme: Smart Automation · Software.

---

## 1. Problem

**Who:** Patients at Indian government hospital OPDs — disproportionately elderly, rural,
low-literacy, and first-visit — and the physicians who must assess them. In AYUSH facilities,
practitioners must additionally complete Dashavidha Pariksha, the most data-intensive intake
framework in Indian medicine, inside the same window.

**Where:** High-volume public outpatient departments — tertiary and district hospitals, and the
12,500 Ayushman Arogya Mandirs (28.87 crore beneficiaries visited in a year, per Rajya Sabha PQ).

**Frequency:** Daily and at extreme scale. AIIMS New Delhi alone averages ~10,000 OPD patients/day
(AIIMS official publication); comparable apex institutions register 4,000–10,000/day.

**Severity:** India's average medical consultation is ~2.3 minutes — among the shortest of 67
countries studied (BMJ Open, 2017; 28.5M consultations reviewed). Within that window the doctor
must elicit history, examine, review disordered paper records from multiple prior providers,
diagnose, counsel, and prescribe. Yet the clinical history alone determines 76–83% of final
diagnoses (Hampton et al., BMJ 1975; confirmed by 1992/2000/2003 follow-ups). The consequence is
systematic under-elicitation: missed comorbidities, repeated questioning across visits, avoidable
diagnostic error, and Ayurvedic assessments abbreviated to the point of defeating personalized care.

**Why it persists:** The bottleneck cannot be hired away (doctor:population ratio ~1:834, and
worse in effective public-facility availability). Smartphone-first solutions structurally exclude
the actual OPD population. Nurse-led history desks hit the same human ceiling. No point-of-entry
software exists that captures structured clinical history before the consultation — the "first
mile" of ABDM remains unsolved.

## 2. Evidence

All figures are from named sources; full links in `doc/10-positioning-evidence.md`:

- **Consultation time:** Irving et al., *BMJ Open* 2017 — largest international review (67
  countries, 178 studies, 28.5M consultations): India averages ~2.3 min vs 22.5 min in Sweden;
  48 s in Bangladesh is the only shorter figure reported.
- **Diagnostic yield of history:** Hampton et al., *BMJ* 1975 (83% of outpatient diagnoses from
  history alone); follow-up studies 1992/2000/2003 (76%/79%/78%).
- **OPD load:** AIIMS official publication — ~10,000 OPD patients/day, ~35 lakh/year; corroborated
  by Hindustan Times and Free Press Journal (14–15k/day recent reporting).
- **Doctor supply:** Ministry of Health & FW, Lok Sabha answer — ratio ~1:834, on 13.86 lakh
  registered allopathic + 5.65 lakh AYUSH doctors (registration-based; effective availability lower).
- **AYUSH demand:** Rajya Sabha starred question — 28.87 crore beneficiaries at 12,500 AAMs.
- **Digital rails exist:** PIB — 90 crore ABHA accounts, 104 crore health records linked to 93
  crore ABHAs (Jul 2026); eSanjeevani has delivered 47+ crore teleconsultations.

**Assumption flagged:** the "4,000–10,000 patients/day" range for tertiary hospitals generally
(not AIIMS specifically) has no single national dataset; we anchor on the AIIMS figure. Tertiary
OPD-specific consultation-time studies were not found — the 2.3-min figure is primary-care; our
pilot includes a time-motion study to measure it directly.

## 3. SIH Theme

**Primary theme: Smart Automation** (matches the PS's official classification).

Justified by problem domain, not tech: history-taking is a structured data-capture task — the
elicitation of a defined set of clinical fields — currently performed by the scarcest, most
expensive actor in the system (the physician) inside the scarcest resource (consultation time).
It is precisely the class of task automation exists to absorb: move structured data capture from
the clinician to the patient during time that is otherwise wasted (queueing), the way ATMs moved
cash dispensing and airport kiosks moved check-in. The software automates capture and
organization; clinical judgement (assessment, plan, confirmation) remains exclusively the
physician's — automation of drudgery, not of decisions.

## 4. SDG

**Primary SDG: 3 — Good Health and Well-Being**, anchored on two targets:

- **Target 3.8 (Universal Health Coverage):** UHC's official text requires "access to *quality*
  essential health-care services." A 2.3-minute consultation cannot deliver quality regardless of
  infrastructure. MediKiosk raises the quality of every existing patient-doctor contact by
  guaranteeing the physician arrives at it with a complete, structured history — without adding
  staff. And it does so for exactly the population the digital-health revolution has bypassed:
  no smartphone, no pre-enrolment, no literacy or English requirement — every question answerable
  by voice *or* touch, with audio-guided consent.
- **Target 3.c (Health workforce):** India cannot train its way past its workforce constraint on
  any relevant timescale. MediKiosk is a workforce-leverage intervention: it returns clinical
  time to every doctor at every patient contact.

*Secondary (mention only):* SDG 10 — a shared public kiosk is the only digital-health touchpoint
that presumes no personal device, literacy, or English.

## 5. Gap Analysis

| Existing solution category | What it does | What's missing |
|---|---|---|
| Hospital registration / ORS (ors.gov.in) | Demographics, token, appointment | Zero clinical history, no documents |
| Health ATMs (Yolo — 500 units with state govts; Clinics on Cloud) | 60+ vital-parameter screening + teleconsult | Measures the body, not the story: no history elicitation, no record digitization, no HIS/ABDM push |
| AI scribes (Augnito Omni, EkaScribe, Sunoh.ai) | Convert doctor–patient dialogue into notes during the visit | Doctor-side; the doctor still spends the 2 minutes eliciting; does nothing for waiting-time capture |
| Symptom checkers (Buoy, K Health, Fabric — US) | Conversational triage → routing to a care level | End in routing, not a physician-ready structured history; app-first, English-first, subscription models |
| AYUSH practice software (NirogStreet Vaidya Tool) | Practitioner-side records, prescriptions, follow-ups | No patient-facing intake, no Dashavidha elicitation structure, no document digitization |

**The gap:** no product anywhere combines (a) patient-elicited deep clinical history (chief
complaint, HPI/SOCRATES, past, drug/allergy, family, ROS — plus Dashavidha for AYUSH), (b)
digitization of the patient's existing multilingual paper records into the same summary, and (c)
pre-consultation delivery into the hospital HIS and the ABHA-linked national record. Each
ingredient exists separately; the combination for Indian public OPDs does not. This is also the
PS's own framing — we agree with it after independent verification.

## 6. Innovation

Meaningfully better than each adjacent category on a specific axis — not "AI-powered":

1. **Accessibility:** dual-mode voice+touch interview usable by a first-time, non-literate,
   non-English-speaking patient with zero training — vs. app-based tools that presume a
   smartphone, literacy, and pre-enrolment. (Excludes no one the OPD actually serves.)
2. **Coverage:** the only intake flow that unifies conversational history, Dashavidha Pariksha
   (10 Ayurvedic assessment parameters — no software product structures this today), and
   digitization of prior paper records into one chronological, physician-ready summary.
3. **Safety by architecture:** the system elicits and structures but never diagnoses; emergency
   red-flag detection is a deterministic rule engine, not a model guess, and routes to immediate
   triage; the physician edits/confirms everything. Anti-fabrication design: unasked fields are
   marked "not elicited" rather than inferred.
4. **Scale/cost:** software-first — runs on commodity touchscreen hardware (no diagnostic
   devices), so per-site cost is an order of magnitude below diagnostic Health ATMs (~₹5
   lakh/unit list price) and it can even run on registration counters hospitals already own.

## 7. MVP / Prototype

A working demo of the full **Input → Processing → Output** chain (not a UI mockup):

- **Input:** patient selects language (Hindi/English v1) → speaks naturally or taps touchscreen
  answers through an adaptive interview (open narrative → chief complaint → SOCRATES-style HPI →
  past/drug-allergy/family history → red-flag screen); photographs prior prescriptions/lab
  reports which are digitized and organized chronologically.
- **Processing:** speech recognition → constrained extraction into the clinical-history schema
  (with confidence levels per field) → document OCR and entity extraction → summary generation
  with patient read-back confirmation; ABHA linkage and consent per DPDP 2023.
- **Output:** a one-page, physician-ready structured summary (SOAP-style + prior-records
  timeline) appearing on the doctor's consultation screen, with abnormal values and red flags
  highlighted, and a FHIR bundle pushed to the HIS/ABDM record. Patient receives spoken
  confirmation in their language.

Demo shows the end-to-end journey with real voice input and real document images, including the
AYUSH/Dashavidha second layer and a red-flag escalation case.

## 8. Impact

**Quantified primary metric (projection, to be validated in pilot):** a pre-delivered,
physician-ready history is projected to save ~1 minute of elicitation/record-scanning per
consultation. At a 4,000-patient/day hospital: **~66 clinician-hours returned daily — the
equivalent of ~8 full-time doctors, without hiring.** At AIIMS scale (10,000/day): ~165 hours/day.
Basis: 2.3-min average consultation (sourced) × plausible saving fraction (assumption — measured
directly via before/after time-motion in the pilot, which also fills the missing
tertiary-OPD-consultation-time evidence gap).

**Quality impact (stronger than time, harder to pre-quantify):** since history determines 76–83%
of diagnoses, substituting a *complete* structured history for the fragment that fits in 2.3
minutes targets the PS's stated harms — missed comorbidities, repeated questioning across visits,
diagnostic error. Pilot will measure: history completeness vs. control, red flags caught at intake
vs. in-consultation, and repeat-visit questioning rates.

**System impact:** every MediKiosk session converts paper-carrying OPD patients into
ABHA-linked longitudinal records — direct contribution to ABDM's first mile.

## 9. Scalability

- **Prototype:** lab demo of the Input→Processing→Output chain (above).
- **Local (pilot):** 2–4 kiosks, 1 hospital, Hindi+English. Natural first site: **AIIA Delhi**
  (the PS's owning institution) + one state district hospital. Falsifiable metrics: minutes saved
  (time-motion), history completeness vs. control, red-flag catch rate, patient task-completion
  rate.
- **District/City:** rollout across a district hospital cluster; add regional languages; kiosks
  placed at registration where queues already form.
- **State:** State AYUSH directorates + the 12,500 Ayushman Arogya Mandir network (existing
  footfall: 28.87 crore/year) as the deployment spine; states already procure health kiosks
  (Yolo's 500-unit state partnerships are the procurement precedent).
- **National:** per-hospital HIS integration + ABDM/FHIR rails (93 crore ABHAs already exist);
  software updates distribute centrally; multilingual coverage expands by voice-pack addition.

Growth is software-shaped: hardware is commodity, marginal cost per site is low, and the
integration surface (ABDM/FHIR) is a national standard rather than per-vendor negotiation.

## 10. Stakeholders

- **Who has the problem:** OPD patients (especially elderly, rural, low-literacy, first-visit —
  the majority of government OPD load) whose histories go unheard; OPD physicians forced to
  diagnose in ~2 minutes with disordered paper records; AYUSH practitioners who cannot complete
  Dashavidha Pariksha in the time available; hospital administrators who bear the inefficiency.
- **Who implements:** hospital IT departments (per-site HIS integration); State AYUSH/Health
  directorates (procurement and rollout); NHA/ABDM ecosystem (record linkage and consent
  framework); our team (software, training, maintenance).
- **Who benefits:** patients (a complete history actually heard, and better-quality consultation
  in the same 2 minutes); doctors (clinical time returned, structured records instead of paper
  archaeology); the health system (longitudinal ABHA-linked records, measurable OPD efficiency);
  Ministry of Ayush (Dashavidha assessment made practically completable, AYUSH data
  infrastructure); ultimately the ABDM mission (a solved first mile).

---

*Drafted 2026-09-11 from `doc/10-positioning-evidence.md` (all sources linked there). Character
counts may need trimming to portal field limits — each section is written to stand alone if the
portal splits fields.*

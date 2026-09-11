# MediKiosk — Positioning & Evidence Pack

> **Purpose:** judge-facing research for the SIH 2026 submission. Everything a judge needs to
> believe the problem is real, the solution is novel, and deployment is plausible — with every
> statistic sourced by link. No architecture content (that lives in docs 08-09).
>
> **PS identity (verified against the official catalogue):**
> SIH **26047** — "Patient Case-Taking Software" · **Ministry of Ayush**, All India Institute of
> Ayurveda (AIIA) · Theme: **Smart Automation** · Category: Software · Idea deadline: 20 Sep 2026.
> Source: [sih.gov.in catalogue](https://sih.gov.in/sih2026PS) ([mirrored record](https://github.com/ace-ify/sih-hub/blob/main/ps/SIH26047.md)).

---

## 1. Evidence Brief — the problem is real

### 1.1 OPD load at Indian public hospitals

| Claim | Number | Source |
|---|---|---|
| AIIMS New Delhi average OPD load | **~10,000 patients/day, ~35 lakh/year** | [AIIMS official publication](https://www.aiims.edu/images/pdf/notice/AIIMS%20-%20THE%20FIRST%20DIGITAL%20REVOLUTION%20IN%20HEALTH%20CARE%20(1).pdf) |
| Corroboration | "As many as 10,000 patients reach AIIMS OPD daily" | [Hindustan Times](https://www.hindustantimes.com/delhi/with-over-10-000-opd-patients-many-die-waiting-at-crowded-aiims/story-uIOPzEwsBRNEgvxQrumqoJ.html) |
| Upper bound (recent reporting) | 14,000–15,000/day at AIIMS Delhi | [Free Press Journal](https://www.freepressjournal.in/india/15000-patients-1000-surgeries-5-year-waits-the-complex-world-of-aiims-delhi) |

The problem statement's "4,000–10,000 patients/day" range for tertiary government hospitals is
consistent with the AIIMS official figure. **No single national dataset of per-hospital OPD
volumes was found — flag as an assumption if a judge probes; the AIIMS figure is the defensible anchor.**

### 1.2 Consultation time — among the shortest in the world

- The largest international review of consultation length (178 studies, 67 countries, 28.5M
  consultations) found average primary-care consultations range **from 48 seconds (Bangladesh) to
  22.5 minutes (Sweden)**; 18 countries containing ~half the world's population average **≤5 minutes**.
  [Irving et al., BMJ Open 2017](https://bmjopen.bmj.com/content/7/10/e017902); [BMJ news summary](https://www.bmj.com/content/359/bmj.j5172).
- **India's average: ~2.3 minutes** ([Prothom Alo reporting the study](https://en.prothomalo.com/bangladesh/Physicians-in-Bangladesh-give-patients-48-secs));
  Indian coverage cites ~2 minutes (2015) and 1.79 minutes (2016) in some sub-measurements
  ([Medical Dialogues](https://medicaldialogues.in/doctors-in-india-see-patients-for-just-two-minutes-study)).
  The PS's "2–5 minutes" claim for tertiary OPDs is therefore *optimistic at the lower bound* — the
  best available evidence says ~2 minutes on average. Use "about two minutes" in the pitch.

### 1.3 Doctor supply — why the time pressure cannot be hired away

- India's doctor-population ratio is **~1:834** (better than the WHO 1:1,000 benchmark), *assuming*
  80% availability of **13.86 lakh registered allopathic doctors** plus **5.65 lakh AYUSH doctors**.
  Ministry of Health & Family Welfare, Lok Sabha answer ([sansad.in PDF](https://www.sansad.in/getFile/loksabhaquestions/annex/182/AU2067_PZDQxt.pdf?source=pqals));
  corroborated by [NDTV](https://www.ndtv.com/india-news/doctor-population-ratio-in-country-at-1-834-better-than-who-standards-health-minister-5025731).
- **Caveat to know before a judge raises it:** this ratio counts *registrations*, assumes 80%
  availability, and includes AYUSH practitioners. Effective availability in public facilities is
  lower. This strengthens the case (time per doctor is even scarcer) — don't overclaim the ratio itself.

### 1.4 History-taking is the highest-yield diagnostic act — and the first casualty of time pressure

- The classic study: in 80 medical outpatients, **the history alone produced the final diagnosis in
  83% of cases**; physical examination and laboratory tests each changed the diagnosis in only ~9%.
  [Hampton et al., BMJ 1975](https://www.bmj.com/content/2/5969/486).
- Follow-up studies confirmed the effect: history led to final diagnosis in **76% (1992), 79% (2000),
  78% (2003)** of cases — so the "70–80% of diagnosis is history" line in the PS is defensible, not
  marketing ([evidence review, family-medicine.org, Dec 2025](https://family-medicine.org/history-taking/)).
- Note for honesty: these studies are hospital outpatient cohorts, mostly older; no systematic review
  exists. Say "classical and repeatedly confirmed teaching" rather than "proven fact."

### 1.5 The AYUSH dimension (this PS's owner is the Ministry of Ayush)

- **28.87 crore (288.7 million) beneficiaries** visited the 12,500 Ayushman Arogya Mandirs in a year,
  as reported by States/UTs to the Ministry. Rajya Sabha starred question
  ([sansad.in PDF](https://sansad.in/getFile/annex/269/AS100_PKINTW.pdf?source=pqars)).
- Ayurvedic intake (Dashavidha Pariksha etc.) collects *more* parameters than allopathic intake —
  the PS itself states capturing this depth manually within the OPD window is "effectively impossible."

### 1.6 The digital rails already exist (feasibility context, not a claim of solution)

- **ABDM: 90 crore ABHA accounts** created ([PIB](https://pib.gov.in/PressReleasePage.aspx?PRID=2266979&reg=3&lang=1));
  by mid-2026 **104 crore health records linked to 93 crore ABHAs** ([PIB document, Jul 2026](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/jul/doc202676912801.pdf)).
- **eSanjeevani: 34+ crore teleconsultations** as of Feb 2026 per Rajya Sabha
  ([Economic Times](https://economictimes.indiatimes.com/industry/healthcare/biotech/healthcare/over-34-crore-patients-provided-consultation-through-esanjeevani-platform-rajya-sabha-told/articleshow/118149172.cms)),
  rising past **47 crore by Jul 2026** ([The News Mill, citing Defence Minister](https://thenewsmill.com/2026/07/over-47-crore-teleconsultations-completed-on-e-sanjeevani-platform-since-2019/)).
  India has already demonstrated public digital-health delivery at hundred-million scale.

### 1.7 Claims we could NOT source — flag as assumptions

1. **"4,000–10,000 OPD patients/day" as a national pattern** — only AIIMS-scale anchors found; no
   aggregated dataset. Present AIIMS as the named example, not a national statistic.
2. **OPD waiting-time hours** — no robust national figure found in this research pass. Don't quote
   one; the consultation-length data is stronger and sufficient.
3. **"2–5 minute" consultations in tertiary OPDs** — the sourced average is ~2 minutes (primary
   care). Tertiary OPD-specific time-motion studies were not found in this pass; if needed, run a
   pilot measurement ourselves (that's a strength of our pilot plan, see §5.2).

---

## 2. Prior-Art / Competitor Scan

### 2.1 Indian products & programmes

| Product / programme | What it does | Who it targets | How MediKiosk differs (or doesn't) |
|---|---|---|---|
| **Yolo Health ATM / HealthATM India** ([site](https://yolohealth.in/), [Express Healthcare](https://www.expresshealthcare.in/news/yolo-health-foundation-and-healthatm-india-to-launch-500-health-atms-in-association-with-state-governments/439589/)) | Kiosks measuring 60+ vital parameters in minutes + teleconsult; 500 ATMs announced with state govts (MP, Rajasthan, UP, Uttarakhand, Arunachal) | PHCs, public spaces | Closest *hardware* analogue. They **measure the body** (BP, sugar, BMI); they do **not** elicit a clinical history, digitize paper records, or push a structured history to the doctor's screen/ABDM. Complementary, not competing. |
| **Clinics on Cloud** ([IndiaMART](https://www.indiamart.com/proddetail/health-atm-kiosk-digital-machine-2851674287873.html)) | Health ATM / "Box Clinic" manufacturer | Clinics, corporates | Same category as Yolo — diagnostics kiosk, no history capture. |
| **Augnito Omni** ([site](https://augnito.ai/omni)) | Ambient AI scribe: converts doctor–patient dialogue into medical records | Doctors (India + global) | Works **during** the consultation, on the **doctor's** side. Doesn't help the 2-minute problem — the doctor is still eliciting. MediKiosk moves elicitation **before** the consultation, done by the patient. |
| **EkaScribe / Eka Care** ([comparison](https://patientsquare.com/in/blog/india-ai-scribe-comparison/)) | ABDM-integrated PHR + EMR + AI scribe | Doctors, patients (app) | Strong ABDM rails, but patient record-keeping and doctor-side scribing; no unassisted kiosk interview, no document digitization pipeline at point of entry. |
| **Sunoh.ai** ([site](https://sunoh.ai/)) | AI medical scribe, "100k+ providers" | US-centric doctors | Same as Augnito category; physician-side. |
| **NirogStreet Vaidya Tool** ([Financial Express](https://www.financialexpress.com/business/sme-nirogstreet-ayurveda-gets-a-tech-push-1714149/), [launch note](https://microbiozhealth.com/nirogstreet-launches-nirogstreet-vaidya-tool-to-fuel-ayurveda-healthcare-growth-in-india/)) | SaaS for Ayurveda practitioners: patient records, prescriptions, follow-ups | Ayurveda doctors | The main AYUSH-tech incumbent. Practitioner-side clinic management; no patient-facing voice intake, no structured Dashavidha capture, no document digitization. |
| **eSanjeevani** ([official](https://esanjeevani.mohfw.gov.in/)) | National telemedicine (47+ crore consults) | Citizens | Delivers the *consultation remotely*; doesn't solve history capture for in-person OPDs. Proof that national-scale digital health adoption is achievable. |
| **ORS — Online Registration System** ([ors.gov.in](https://ors.gov.in/orsportal/)) | Online OPD registration, ABHA-linked | Hospital patients | Registration/token only — zero clinical history. This is the "first mile" gap the PS names. |

### 2.2 International products

| Product | What it does | How MediKiosk differs |
|---|---|---|
| **Phreesia** (US) ([site](https://www.phreesia.com/), [review citing 4,700+ orgs, ~180M visits](https://ai-health-apps.com/reviews/phreesia-review/)) | Patient intake: pre-visit forms, insurance verification, payments, mobile/kiosk check-in | The closest *conceptual* analogue — and proof the intake-kiosk model works commercially. But Phreesia automates **administrative** intake in a high-income, insured, English-first system. No deep clinical HPI elicitation, no handwritten multilingual document digitization, no ABDM/FHIR national-health-record push, no AYUSH layer. |
| **Fabric Health** (US) ([site](https://www.fabrichealth.com/symptom-checker)) | Conversational AI symptom checker + triage/routing for health systems | Ends in *routing* (which care level), not in a structured physician-ready history delivered into the HIS before an in-person OPD visit. |
| **Buoy Health** (US) ([site](https://www.buoyhealth.com/multi-symptom-checker)) | Consumer AI symptom check → advice on care setting | Consumer app; requires smartphone + English literacy + pre-enrolment — exactly the barriers the PS says exclude the government-OPD population. |
| **K Health** (US) ([site](https://khealth.com/)) | AI intake feeding a telehealth membership | Smartphone-first, consumer subscription model; opposite of shared-access, assisted-entry kiosks. |
| **Ambient scribes (category)** | Nuance DAX, Abridge, Suki etc. | All physician-side documentation during the visit. (Cited only by category; see Augnito/Sunoh rows for the Indian versions.) |

### 2.3 Blunt honesty about similarity (read before writing any "world-first" line)

1. **The intake-kiosk category exists** (Phreesia: ~180M patient visits). **Health kiosks exist in
   India** (Yolo, 500 units with state govts). **AI scribes exist in India** (Augnito, EkaScribe).
   **AYUSH practice software exists** (NirogStreet). Claiming "first AI health kiosk" would be
   wrong and easily debunked.
2. What we could **not** find anywhere: a patient-facing system that (a) elicits a *deep clinical
   history* (not demographics/vitals/symptom-triage) via voice+touch for low-literacy users,
   (b) digitizes the patient's *existing paper records* into the same structured summary, and
   (c) delivers both into the hospital HIS + national ABDM record **before** the consultation.
   Each ingredient exists separately; the combination for Indian public OPDs does not.
3. **SIH-internal competition is real.** At least five other teams are publicly building for
   SIH26047: [A-941/MediKiosk "AYUSH-KOSH"](https://github.com/A-941/MediKiosk),
   [divyamc1803/MediKiosk](https://github.com/divyamc1803/MediKiosk),
   [siraj343/sih-ayush-prototype](https://github.com/siraj343/sih-ayush-prototype),
   [medickiosk.in](https://medickiosk.in/) (same-name product site), and
   rohit-h11/medikiosk-sih-26047 (found 2026-09-01, research log). Expect judges to have seen a
   similar pitch. Execution depth (evidence, clinical frameworks, ABDM/DPDP rigor, pilot design)
   is where this submission must win, not on the idea alone.

---

## 3. The One-Sentence Differentiator

> **MediKiosk converts the patient's waiting time into the doctor's clinical time: it is the only
> intake platform that captures a complete, voice-and-touch clinical history from the patient
> themselves — in their own language, including Ayurvedic Dashavidha assessment and their
> existing paper records — and delivers it to the doctor's screen and the ABHA-linked health
> record *before* the consultation begins.**

Short version (for a 10-second elevator moment): *"Everyone else checks you in, checks your
vitals, or writes notes during the visit — we take the history before you walk in, so the
doctor's two minutes are spent on medicine, not questioning."*

Why this is defensible: each clause maps to a verified gap in §2 — registration systems (ORS) do
demographics only; health ATMs (Yolo) do vitals only; scribes (Augnito/EkaScribe/Sunoh) work during
the visit; symptom checkers (Fabric/Buoy/K) end in routing, not an HIS-ready history; NirogStreet
serves the practitioner, not the patient at point of entry; none integrate document digitization +
ABDM into the same pre-consultation flow.

---

## 4. SDG & SIH Theme Justification

### SDG 3 — Good Health and Well-Being (primary)

- **Target 3.8 — Universal Health Coverage**, whose official text is *"access to quality essential
  health-care services"* ([sdgs.un.org/goals/goal3](https://sdgs.un.org/goals/goal3)). Mechanism: a
  ~2-minute consultation cannot deliver quality care no matter how many facilities exist — MediKiosk
  raises the *quality* of each existing contact without adding staff. It targets exactly the
  population the PS names (elderly, rural, low-literacy, first-visit) who cannot use app-based
  alternatives: no smartphone, no pre-enrolment, audio-guided consent, touch fallback for every
  question. This is access-through-equity-by-design, not access-through-app-stores.
- **Target 3.c — Health workforce** (*"recruitment, development, training and retention of the
  health workforce"*). Mechanism: India cannot train its way out of a 1:834 ratio fast enough;
  MediKiosk is a workforce-*leverage* intervention — it returns clinical time to every doctor,
  every patient, at scale, without replacing clinical judgement (the physician edits/confirms;
  the system never diagnoses).

Secondary (mention, don't lead): **SDG 10 (Reduced Inequalities)** — a shared public kiosk is the
only digital-health touchpoint that does not presume a personal device, literacy, or English.

### SIH theme fit — Smart Automation (Ministry of Ayush / AIIA)

- The PS is a *Smart Automation* problem statement: it asks to automate a structured data-capture
  task (history-taking + records organization) currently consuming scarce human clinical time.
- Ayush/AIIA fit is structural, not cosmetic: Dashavidha Pariksha is the *most* data-hungry intake
  framework in Indian healthcare (10 patient-assessment parameters) and the least supported by
  software today (§2.1: NirogStreet is records/billing, not structured Dashavidha elicitation).
  28.87 crore AAM beneficiaries (§1.5) define the user base the Ministry already serves.

---

## 5. Deployment Feasibility & Impact Case (non-technical)

### 5.1 Cost per kiosk (sourced bounds)

- A full diagnostic **Health ATM retails around ₹5,00,000/unit** on IndiaMART
  ([listing](https://www.indiamart.com/proddetail/health-atm-machine-smart-2849427458097.html));
  general digital kiosks span **₹18,000–₹5,00,000** depending on configuration
  ([Sai Siddhi Electronics](https://www.saisiddhielectronics.com/digital-signage-standee/digital-kiosk-price-in-india/)).
- MediKiosk is **software-first**: it needs a touchscreen, microphone, document camera/scanner and
  modest compute — *no* diagnostic devices (BP cuffs, spirometers, blood analyzers) that make Health
  ATMs expensive. **Assumption to validate with a vendor quote:** an intake kiosk lands near the low
  end of that range, an order of magnitude below a diagnostic Health ATM. The software can also run
  on hardware hospitals already own (registration counters, tablets), which no Health ATM can.

### 5.2 Pilot → scale path (each phase has a falsifiable metric)

1. **Phase 1 — Pilot (1 hospital, 2–4 kiosks, Hindi + English).** Natural first site: **AIIA Delhi
   itself** (the PS's owning department) plus one state district hospital. Measure: (a) minutes of
   doctor time saved per consultation (time-motion before/after — this also fills the §1.7 evidence
   gap ourselves), (b) history completeness vs. a no-kiosk control, (c) red-flag escalations caught,
   (d) patient abandonment/failure rate on the kiosk itself.
2. **Phase 2 — State scale.** State AYUSH directorates + district hospital clusters; the 12,500
   Ayushman Arogya Mandirs (§1.5) and existing kiosk-procurement channels (Yolo's 500-ATM state
   partnerships prove states buy kiosks) are the distribution precedent. Add regional languages.
3. **Phase 3 — National integration.** ABDM/FHIR linkage (the 93-crore-ABHA rails already exist,
   §1.6) and HIS integration per hospital. *(Open item: current NHA sandbox/integration process
   needs verification before quoting it to judges.)*

### 5.3 One measurable impact claim (show the arithmetic)

- Input A: average consultation ≈ **2 minutes** (BMJ Open 2017, §1.2).
- Input B: assumption to validate in Phase 1 — a pre-delivered, physician-ready history saves the
  doctor **~1 minute per patient** of elicitation/record-scanning.
- Arithmetic: at a 4,000-patient/day hospital, 1 minute saved × 4,000 = **~66 clinician-hours
  returned per day** — the equivalent of adding ~8 full-time doctors on 8-hour shifts, without
  hiring anyone. At AIIMS scale (10,000/day): ~165 hours/day.
- Second-order claim (stronger than time): since the history determines 70–80% of diagnoses
  (§1.4), a *complete* history where today only a partial one fits in 2 minutes means fewer missed
  comorbidities and repeated visits — the PS's stated harms. This is the impact claim to develop
  from Phase-1 measurement data.

---

## 6. Validation checklist (what this pack still needs before the finale)

| # | Gap | Action |
|---|---|---|
| 1 | National OPD-volume dataset absent | Keep AIIMS as the named anchor; avoid "all hospitals" phrasing |
| 2 | No sourced OPD wait-time figure | Don't quote one; or collect in pilot |
| 3 | Kiosk hardware quote (software-first assumption) | Get one vendor quote to convert §5.1 assumption into a number |
| 4 | NHA/ABDM sandbox process for integration | Verify current process before Phase-3 claims |
| 5 | Fellow SIH26047 teams' features | Monitor their public repos before the finale; sharpen §3 clauses accordingly |
| 6 | AIIA Delhi's own OPD volume | One RTI or phone call would give the perfect pilot-site statistic |

---

*Research pass: 2026-09-11, opencode session. All links checked at time of fetch. Web-search
tooling rate-limited mid-pass; cost and wait-time gaps were partially filled via direct fetches
(Bing/IndiaMART/vendor pages) — re-verify before printing numbers on a slide.*

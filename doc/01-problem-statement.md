# SIH 2026 - Problem Statement #47 (Distilled)

## The Two Core Problems

1. **History-taking bottleneck** - Indian public OPDs register 4,000-10,000 patients/day with 2-5 min per doctor consultation. Professions can't elicit a proper clinical history in that window.
2. **Documentation/records fragmentation** - patients carry physical, handwritten, multilingual, chronologically-disordered paper records from multiple providers. Doctors waste scarce consultation time manually scanning them.

## AYUSH Complicates It Further

Ayurvedic intake (Trividha, Ashtavidha, Dashavidha Pariksha) requires FAR more data than allopathic (Prakriti, Vikriti, Agni, Koshtha, Ahara-Vihara, Nidana, Samprapti) - impossible to capture manually in OPD time.

## The Gap

ABDM (ABHA IDs, HIE, FHIR) exists as national infrastructure, but the "first-mile" is unsolved: no patient-facing platform captures structured history and digitizes documents BEFORE the patient enters the consultation room.

## The Ask (in precise terms)

> A purpose-built, patient-facing software platform that lets patients independently record medical history through natural spoken conversation + guided touchscreen, AND digitize existing physical documents, generating a structured physician-ready history that integrates with the HIS and ABDM before consultation.

## Why Existing Solutions Fail

- **Hospital registration systems** - capture only demographics/appointments, no clinical history, no document processing.
- **Mobile apps / tele-triage chatbots** - require smartphone literacy + connectivity + pre-enrolment - excludes elderly/rural/low-literacy/first-visit patients.
- **Nurse-led triage desks** - human-limited, can't scale to 5,000+/day.
- **Generic document scanners** - digitize images but don't extract/structure/organize clinical content.

## Challenges the Solution MUST Overcome

1. **Multilingual, multi-accent** voice capture in noisy environments (Hindi, English, major regional languages).
2. **Accessibility** for low-literacy/elderly - icon-driven UI, audio prompts, zero training.
3. **Accurate clinical history structuring** - chief complaint, HPI, past history, drug/allergy, family, personal, ROS (+ Dashavidha for AYUSH).
4. **Reliable medical document digitization** - OCR of handwritten/printed prescriptions, labs, discharge summaries; extract diagnoses/meds/values.
5. **Privacy/consent/security** - DPDP Act 2023 + ABDM consent framework.

## Solution Overview (Tentatively "MediKiosk")

Four modules (from the problem statement's "expected solution" section - this is what's ASKED for, not an agreed implementation):
- **Module A** - Conversational Multimodal History Engine (voice+touch, adaptive, AYUSH mode, red-flag detection)
- **Module B** - Medical Document Digitization & Intelligence (OCR + extraction + chronological organization)
- **Module C** - Structured History Summary Generator (physician-ready, editable, bilingual)
- **Module D** - Consent, Privacy & ABDM Integration (ABHA auth, DPDP, FHIR)

## End-to-End Patient Journey

1. **Identify** - login/scan ABHA/Aadhaar, select language, consent (audio-guided)
2. **Converse** - adaptive voice+touch interview; red flags trigger priority triage
3. **Scan** - upload documents; AI digitizes, structures, timelines
4. **Summarize & Route** - generate summary, link ABHA, push to HIS
5. **Consult** - physician reviews/edits/confirms

---
*Source: `Problem__statement_47.txt` (official)*

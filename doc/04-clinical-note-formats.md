# Standard Clinical Note Formats (Output Schema Reference)

## SOAP Note (dominant format globally)

From Lawrence Weed's Problem-Oriented Medical Record (POMR). This is the primary output schema for MediKiosk **Module C**.

| Section | Contents | MediKiosk Mapping |
|---------|----------|-------------------|
| **S - Subjective** | CC + HPI + past medical/surgical + medications + allergies + family/social + ROS | Structured history from Module A (voice+touch) + Module B (documents) |
| **O - Objective** | Vitals, physical exam, labs, imaging, measurements | Digitized investigation values from Module B |
| **A - Assessment** | Diagnosis + differentials + likely etiologies | AI-generated draft - physician edits/confirms, never autonomous |
| **P - Plan** | Diagnostic workup, treatment, referrals, education, disposition | Set by physician at consultation; kiosk pre-populates draft |

## HPI Elicitation Mnemonics

| Mnemonic | Fields |
|----------|--------|
| **SOCRATES** | Site, Onset, Character, Radiation, Associations, Timing, Exacerbating/relieving, Severity |
| **OLD CARTS** | Onset, Location, Duration, Character, Aggravating/Alleviating, Radiation, Temporal pattern, Severity |
| **OPQRST** | Onset, Provocation, Quality, Region/Radiation, Severity, Timing |
| **LOCQSMAT** | Location, Onset (mechanism), Chronology, Quality, Severity, Modifying factors, Additional symptoms, Treatment |

**Key insight:** SOCRATES (elicitation) and OLD CARTS (documentation) capture overlapping data reorganized for different purposes. The MediKiosk schema should store the underlying structured fields **once** and render them differently per purpose.

## Subjective (S) Sub-Sections Detail

- **Chief Complaint (CC):** patient's own words; brief statement of reason for visit.
- **HPI:** narrative from symptom onset to present; opens with age, sex, reason for visit.
- **Past Medical/Surgical History:** with year and surgeon where possible.
- **Family History**
- **Social History:** may use HEADSS (Home, Education/Employment, Activities, Drugs, Sexuality, Suicide/depression); covers smoking/drug/alcohol/caffeine, activity level.
- **Current Medications:** name, dose, route, frequency.
- **Allergies**
- **Review of Systems (ROS):** all other pertinent positive and negative symptoms from systematic interview.
- **SAMPLE history:** Symptoms, Allergies, Medications, Past history, Last intake, Events leading to presentation.

## Objective (O) Detail

- Vital signs & measurements
- Physical examination findings (basic cardiac/respiratory + affected systems)
- Physical presentation (characterization of discomfort/pain)
- Psychological status
- Lab / diagnostic results already completed

## Assessment (A) + Plan (P) Detail

- **A:** diagnosis, differential (most likely -> least likely), likely etiologies, progress since last visit.
- **P:** diagnostic (labs/radiology), therapeutic (meds/procedures/diet), referrals, patient education, disposition (discharge/follow-up timing).
- Plan should address each item of the differential; numbered plan by severity/urgency for multiple problems.

## Example - Post-Appendectomy SOAP Note

- **S:** No chest pain or SOB. Feels better. Reports headache.
- **O:** Afebrile, P 84, R 16, BP 130/82. Lungs clear. Abdomen: BS present, mild RLQ tenderness (less than prior day), clean wounds.
- **A:** 37yo male, POD 2 post-laparoscopic appendectomy. Recovering well.
- **P:** Advance diet. Monitor labs. Cardiology f/u in 3 days for outpatient stress test. Prepare discharge.

---
*Sources: Wikipedia (SOAP note), ClinicalBridge (research 2026-09-01)*

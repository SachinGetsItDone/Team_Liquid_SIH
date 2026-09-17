# Module B Regulatory & Standards Addendum (2026-09-11, third pass)

> **Purpose:** resolves the four Module 2 open items flagged in `research/07-open-questions.md`
> after the doc/13 (deep-dive) and doc/14 (CPU) passes: ABDM data-residency citation, HIP
> posture, SNOMED-India commercial terms, SaMD/CDSCO scope. Research-only — regulatory
> *strategy* decisions remain for the team. All sources fetched 2026-09-11. No content was
> blocked or skipped during this pass.

## 1. ABDM data residency — RESOLVED (citable)

**The clause now exists in writing.** ABDM Health Data Management Policy (April 2022
revision, National Health Authority), Clause 26 (Data Protection principles):

> "No personal data shall be stored beyond the geographical boundaries of India, subject
> always to the provision of applicable laws."

Sources: [HDM Policy April-2022 PDF](https://www.medianama.com/wp-content/uploads/2022/06/Draft_HDM_Policy_April2022_e38c82eee5.pdf)
(clause 26.6, immediately before 26.7 "Empowerment of Data Principal"); covered by
[MediaNama Jun 2022](https://www.medianama.com/2022/06/223-new-health-data-management-policy/);
canonical location is the [ABDM publications page](https://abdm.gov.in/publications/policies_regulations)
(JS-rendered; the [original NDHM HDMP](https://abdm.gov.in/strapicms/uploads/health_management_policy_bac9429a79.pdf)
is the v1 ancestor).

Complementary facts from the official
[ABDM Building Blocks guide](https://abdm.gov.in/strapicms/uploads/ABDM_Building_Blocks_v8_3_External_Version_eabbc5c0f3_4_a96f40c645_5716a684de_b344369144.pdf):
federated architecture — records stay at the originating facility; ABDM stores only registry
data (ABHA/HPR/HFR) centrally. A 2026 practitioner guide
([RingSafe](https://ringsafe.in/abdm-health-data-guide/)) notes the DPDP §16 country-allowlist
is still un-notified as of mid-2026 but treats India-only residency as the operative rule.

**Action:** doc/10 §6 and doc/07 can now cite the residency requirement. MediKiosk's
local-first/offline posture satisfies it by construction.

## 2. HIP posture — largely RESOLVED (design decision remains)

From the official NHA **HIP/HIU Guidelines**
([guidelines PDF](https://abdm.gov.in/strapicms/uploads/HIP_HIU_Guidelines_f85df336ec.pdf),
[policy PDF](https://abdm.gov.in/strapicms/uploads/hip_hiu_Policy_23d3cc3da6.pdf)):

- A **HIP is "any healthcare provider who creates, stores, or distributes health information
  in the context of providing healthcare related service to a patient and agrees to share the
  same digitally with the patient using the consent framework adopted by ABDM."** All
  hospitals, diagnostic centers, clinics, public health programs, telemedicine players are
  encouraged to become HIPs. **A technology vendor operating a kiosk is not itself a HIP.**
- HIPs use **ABDM-compliant software**; compliance is certified by NHA-empaneled agencies
  ("correct capture and linking of ABHA Address, secure storage of health data, use of
  standards in data exchange"). In production, a facility must first be registered and
  approved on the **Health Facility Registry**, then apply to become a HIP
  ([Guidance Document for ABDM Compliant HMIS/LMIS](https://abdm.gov.in/strapicms/uploads/Guidance_Document_for_ABDM_Compliant_HMIS_LMIS_d066e52a6d.pdf)).
- HIP obligations: capture/validate ABHA voluntarily; link care contexts (OTP / demographic /
  direct-auth methods with per-method test cases, [community milestone docs](https://kiranma72.github.io/abdm-docs/3-milestone2/link-care-context/hip-initiated-linking/index.html));
  notify on new records. **Health Repository Providers (HRPs)** exist as a role for storage
  infrastructure partners ([Sandbox guidelines](https://abdm.gov.in/strapicms/uploads/sandbox_guidelines_b39bcce23e.pdf)).

**Directly supporting quote for our problem statement:** HIPs *"must share a digital copy of
any health report they currently provide as a physical printout and/or handwritten records to
the user via the ABDM architecture"* — the digitization obligation already exists on paper;
MediKiosk is a compliance tool for it.

**Answer to doc/07's blocking question:** the **hospital is the HIP**; the kiosk is software
inside the hospital's ABDM-compliant stack (kiosk vendor gets software certified; hospital
registers HFR → HIP; care-context linking is done under the hospital's keys). Deployment
models where the kiosk operator independently pushes records would need an HRP/partner
arrangement — a team decision, but the default posture is now sourced.

## 3. SNOMED CT India commercial terms — RESOLVED (not a blocker)

From the official [NRCeS FAQ](https://nrces.in/faqs) and
[NRCeS SNOMED page](https://www.nrces.in/standards/snomed-ct):

- **Affiliate License is required even for in-India use** — SNOMED CT is SNOMED
  International IP. But **MoH&FW has made it "freely available for all use within India"**
  (member country since 2014; [SNOMED members page](https://www.snomed.org/members/india));
  SNOMED International "does not charge Affiliate Licensees for use within Member countries."
- Process: register at [MLDS](https://mlds.ihtsdotools.org/#/landing/IN) → accept the
  Affiliate License Agreement → download release files (4-5 business days).
- **Vendor obligations:** software must be **sublicensed to end users**; **usage reporting**
  is required for the declared period. An app deployed/usable within India is covered by the
  NRCeS-issued license; **deployment outside India needs a separate International Affiliate
  License** via MLDS.

**Action:** doc/07's "SNOMED commercial terms" item resolves to: free in-country Affiliate
License + sublicense flow + usage reporting. Budget line item: zero rupees; process line
item: MLDS registration before shipping.

## 4. SaMD / CDSCO — findings; one strategic flag for the team

From the CDSCO **Guidance Document on Medical Device Software under MDR-2017**
([published guidance](https://cdsco.gov.in/opencms/export/sites/CDSCO_WEB/Pdf-documents/Guidance-document-on-Medical-Device-Software-under-MDR-2017.pdf);
a [revised draft, Oct 2025](https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadPublic_NoticesFiles/Draft%20guidance%20document%20on%20Medical%20Device%20Software%2021%2010%202025.pdf)
is in circulation):

- Software is regulated as a medical device **only if the manufacturer's intended use makes
  it one** ("intended for medical purposes" under the Drugs & Cosmetics Act + MDR-2017).
  Classification (Class A–D, Rule 4) is driven by intended use + the First Schedule.
- Standalone software (SaMD) is classified by a **significance × situation matrix**:
  - *Inform clinical management* (aggregating info; no immediate action) → lowest band
  - *Drive clinical management* — explicitly includes **"to triage or identify early signs
    of a disease"** → higher band
  - *Treatment or diagnosis* → highest band
- CDSCO maintains a dynamic classified-MDSW list; unlisted products apply for classification
  via the CDSCO MD Online portal; the risk class is confirmed by CDSCO (CLA).

**Read-out for MediKiosk:**
1. **Module B (OCR + structuring, no diagnosis, no treatment advice)** maps naturally to
   *Inform clinical management* (aggregation/normalization of existing records,
   physician-verified) — the lowest-risk band, plausibly Class A/B.
2. **The flag: Module A's red-flag escalation** — triage-like output ("identify early signs")
   sits in CDSCO's *Drive clinical management* definition, which is a higher band. The safety
   layer, not the OCR, is what most likely attracts SaMD classification. The team's intended-
   use statement wording (administrative intake + deterministic clinician-approved rules vs.
   automated triage) is therefore a regulatory-strategy decision with real consequences.
3. This remains a **non-final regulatory read** (guidance + rules are public; application to
   our exact fact pattern is not) — an expert/CDSCO confirmation is still the closing step.

## 5. Source register (all fetched 2026-09-11)

- abdm.gov.in: Sandbox guidelines, HIP/HIU Guidelines + Policy, HMIS/LMIS guidance, HFR SOP,
  Building Blocks v8.3, publications page (SPA).
- medianama.com: HDM Policy April-2022 PDF (primary clause text) + coverage.
- nrces.in: FAQs (SNOMED affiliate licensing in India), SNOMED CT page.
- snomed.org: members/india, licensing.
- cdsco.gov.in: MDSW guidance under MDR-2017 (published), Oct-2025 draft, MDR-2017 text,
  classification memo.
- ringsafe.in: 2026 ABDM compliance practitioner guide (secondary).
- kiranma72.github.io: ABDM milestone-2 linking test cases (community docs).

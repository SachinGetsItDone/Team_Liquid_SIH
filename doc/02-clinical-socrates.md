# SOCRATES - Clinical History Structuring Framework

## What It Is

SOCRATES is an 8-field mnemonic used by physicians, nurses, and emergency services to systematically explore a patient's presenting symptom (most commonly pain, but adaptable to any symptom). It is the standard for eliciting a comprehensive History of Present Illness (HPI).

## The 8 Fields

| Letter | Field | Core Probe | Clinical Purpose |
|--------|-------|-----------|------------------|
| **S** | Site | "Where is it? Can you point with one finger?" | Localises anatomy; diffuse pain -> visceral/systemic |
| **O** | Onset | "When did it start? Sudden or gradual?" | Thunderclap -> SAH; gradual -> inflammatory/degenerative |
| **C** | Character | "Sharp, dull, crushing, burning, tight, colicky?" | Often the highest-yield discriminator |
| **R** | Radiation | "Does it spread anywhere?" | Cardiac -> jaw/L arm; biliary -> right scapula |
| **A** | Associations | "What else happens with it?" | Nausea, sweat, fever, breathlessness narrow differentials |
| **T** | Timing | "Constant or intermittent? How long per episode?" | Nocturnal/episodic/progressive patterns narrow causes |
| **E** | Exacerbating/Relieving | "What makes it better or worse?" | Exertional -> ischaemia; sitting forward -> pericarditis |
| **S** | Severity | "Out of 10 - what does 10 look like for you?" | Functional impact matters as much as the number |

## The Full Interview Sequence SOCRATES Sits Within

1. Open question -> patient narrative (30-60s listening)
2. SOCRATES gap-fill + associated symptoms
3. Red-flag screens specific to presentation
4. PMH (past medical history)
5. Drugs
6. Allergies
7. Family/social (focused)
8. ICE (Ideas, Concerns, Expectations)
9. Summary back to patient

This sequence is effectively a **state machine for Module A's dialogue manager**.

## SOCRATES Adapted for Non-Pain Symptoms

| Symptom | Focus adaptations |
|---------|-------------------|
| **Cough** | Throat vs chest? Acute vs chronic? Dry, productive, barking? Day vs night, seasonal |
| **Breathlessness** | Chest tightness vs general? Gradual vs sudden? Air hunger, wheeze, orthopnoea, PND, leg swelling |
| **Headache** | Frontal/occipital/unilateral? Thunderclap? Throbbing vs band-like; nausea, photophobia, neck stiffness |
| **Palpitations** | Chest flutter? At rest vs exertion? Regular vs irregular; seconds vs hours |

## Red-Flag Detection (maps to Module A triage)

- Thunderclap headache (sudden severe)
- Acute chest pain with dyspnoea / breathlessness
- Stroke symptoms (acute focal neurology)
- High severity + concerning associations

These trigger priority triage alerts rather than routine queueing.

---
*Sources: Geeky Medics, ClinicalBridge (research 2026-09-01)*

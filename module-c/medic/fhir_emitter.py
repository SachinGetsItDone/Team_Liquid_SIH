"""C4 - FHIR emitter: NRCeS-ABDM OPConsultRecord document bundle.

The canonical physician-facing output contract (doc/15 section 3, verified
2026-09-11 from nrces.in/ndhm/fhir/r4/StructureDefinition-OPConsultRecord.html):
- Composition with fixed type SNOMED 371530004 "Clinical consultation report"
- mandatory status/type/subject/encounter/date/author/title
- attester slot (mode: professional) = the physician verification step
- SNOMED-coded section slices; emitted as Bundle.type=document
- 12 slices defined by the profile: ChiefComplaints, PhysicalExamination,
  Allergies, MedicalHistory, Medications, FamilyHistory, InvestigationAdvice,
  OtherObservations, Procedure, DocumentReference, FollowUp, Referral.
  Module C emits ONLY the sections it has captured data for; physician-at-consult
  sections (PhysicalExamination, InvestigationAdvice, Procedure, FollowUp,
  Referral) are deliberately NOT pre-generated - Assessment and Plan stay
  physician-only by design (doc/15 section 1 "never diagnoses").

Structural validation via fhir.resources (R4B models; same posture as
module-b/medib.fhir_emitter). Full NRCeS profile validation via HAPI FHIR
is the M3 milestone (Apache-2.0, doc/15 section 4).
"""
from __future__ import annotations

import datetime as _dt
import json
from pathlib import Path

NRCES_PROFILE = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord"

CODE_SYSTEM_SNOMED = "http://snomed.info/sct"
CODE_SYSTEM_LOINC = "http://loinc.org"

# Section codes. VERIFIED from the NRCeS OPConsultRecord profile (doc/15
# section 7b, fetched 2026-09-11): chief_complaints 422843007 (SNOMED),
# allergies 722446000 (SNOMED), physical_examination 425044008 (SNOMED).
# The LOINC rows are carried over from module-b's NRCeS-shaped emission
# (doc/13 section 1) or are provisional pending the M3 HAPI profile
# validation - flagged in doc/18, never cited to judges as verified.
SECTION_CODES = {
    "chief_complaints": ("422843007", "Chief complaint", CODE_SYSTEM_SNOMED),
    "allergies": ("722446000", "Allergy record", CODE_SYSTEM_SNOMED),
    "medications": ("10160-0", "History of Medication use Narrative", CODE_SYSTEM_LOINC),
    "labs": ("30954-2", "Relevant diagnostic tests/laboratory data Narrative", CODE_SYSTEM_LOINC),
    "medical_history": ("11347-0", "History of Past illness Narrative", CODE_SYSTEM_LOINC),
    "family_history": ("10157-6", "History of Family member diseases Narrative", CODE_SYSTEM_LOINC),
    "document_reference": ("42348-3", "Encounter documents", CODE_SYSTEM_LOINC),
}


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def build_opconsultrecord(case, practitioner_ref: str = "Practitioner/EXAMPLE",
                          organization_ref: str = "Organization/HOSP-EXAMPLE",
                          include_documents: bool = True) -> dict:
    """CaseSummary -> FHIR R4 document Bundle (OPConsultRecord-shaped).

    `case` is a medic.merger.CaseSummary. Resource references use the
    HistoryBundle's patient_ref so Module D links under the right ABHA."""
    h = case.history
    entries: list[dict] = []
    sections: list[dict] = []

    composition = {
        "resourceType": "Composition",
        "id": "opconsult-composition",
        "meta": {"profile": [NRCES_PROFILE], "source": "#medikiosk-module-c"},
        # preliminary until the physician attests (C5), final after
        "status": "preliminary" if case.alerts else "preliminary",
        "type": {
            "coding": [{"system": CODE_SYSTEM_SNOMED, "code": "371530004",
                        "display": "Clinical consultation report"}],
            "text": "Pre-consultation history summary (patient-elicited)",
        },
        "subject": {"reference": h.patient_ref},
        "encounter": {"reference": f"Encounter/{h.session_id}"},
        "date": _now_iso(),
        "author": [{"reference": organization_ref}],
        "title": "MediKiosk pre-consultation history summary",
        "attester": [],                      # filled by the physician attest step
        "section": sections,
    }
    entries.append({"fullUrl": "urn:uuid:composition", "resource": composition})

    # --- ChiefComplaints -> Condition (patient's own complaint, unconfirmed)
    cc = h.complaint.get("term") or h.complaint.get("free_text") or ""
    if cc:
        cond = {
            "resourceType": "Condition", "id": "cc-0",
            "clinicalStatus": {"text": "patient-reported"},
            "verificationStatus": {"text": "unconfirmed"},
            "code": {"text": cc},
            "subject": {"reference": h.patient_ref},
        }
        entries.append({"fullUrl": "urn:uuid:cc-0", "resource": cond})
        sections.append({
            "title": "Chief Complaints",
            "code": _code("chief_complaints"),
            "entry": [{"reference": "urn:uuid:cc-0"}],
        })

    # --- SOCRATES + ROS + ICE -> Observations in OtherObservations
    obs_entries = []
    for slot in h.captured_slots():
        oid = f"obs-{slot.key.replace('.', '-')}"
        obs = {
            "resourceType": "Observation", "id": oid, "status": "preliminary",
            "code": {"text": SOCRATES_TEXT.get(slot.key, slot.key)},
            "subject": {"reference": h.patient_ref},
            "valueString": slot.value,
        }
        entries.append({"fullUrl": f"urn:uuid:{oid}", "resource": obs})
        obs_entries.append({"reference": f"urn:uuid:{oid}"})
    for i, r in enumerate(h.ros):
        oid = f"ros-{i}"
        obs = {
            "resourceType": "Observation", "id": oid, "status": "preliminary",
            "code": {"text": f"ROS {r.get('system', '')}: {r.get('symptom', '')}".strip()},
            "subject": {"reference": h.patient_ref},
            "valueString": "present" if r.get("positive") else "denied",
        }
        entries.append({"fullUrl": f"urn:uuid:{oid}", "resource": obs})
        obs_entries.append({"reference": f"urn:uuid:{oid}"})
    if obs_entries:
        # Maps to the profile's "OtherObservations" slice per doc/15 section 5
        # item 3; the slice's exact code is NOT in our verified set (doc/07
        # open question), so the section code is intentionally omitted rather
        # than invented - flagged for the M3 NRCeS profile validation pass.
        sections.append({
            "title": "History of present illness (structured elicitation)",
            "entry": obs_entries,
        })

    # --- Allergies -> AllergyIntolerance
    allergy_entries = []
    for i, a in enumerate(h.allergies):
        text = a.get("text", "")
        aid = f"allergy-{i}"
        res = {
            "resourceType": "AllergyIntolerance", "id": aid,
            "clinicalStatus": {"text": "patient-reported"},
            "code": {"text": text},
            "patient": {"reference": h.patient_ref},
        }
        entries.append({"fullUrl": f"urn:uuid:{aid}", "resource": res})
        allergy_entries.append({"reference": f"urn:uuid:{aid}"})
    if allergy_entries:
        sections.append({
            "title": "Allergies", "code": _code("allergies"),
            "entry": allergy_entries,
        })

    # --- Medications -> MedicationRequest (merged canon list; draft/proposal)
    med_entries = []
    for i, m in enumerate(case.meds):
        mr = {
            "resourceType": "MedicationRequest", "id": f"med-{i}",
            "status": "draft", "intent": "proposal",
            "medicationCodeableConcept": {"text": m.name},
            "subject": {"reference": h.patient_ref},
            "authoredOn": _now_iso(),
            "dosageInstruction": [],
            "note": [{"text": _med_note(m)}],
        }
        if m.dose or m.frequency or m.duration:
            mr["dosageInstruction"].append({
                "text": " ".join(x for x in (m.dose, m.frequency, m.duration) if x)})
        entries.append({"fullUrl": f"urn:uuid:med-{i}", "resource": mr})
        med_entries.append({"reference": f"urn:uuid:med-{i}"})
    if med_entries:
        sections.append({
            "title": "Medications (patient-stated + documents; verify)",
            "code": _code("medications"),
            "entry": med_entries,
        })

    # --- PMH -> MedicalHistory (Condition resources)
    pmh_entries = []
    for i, p in enumerate(h.pmh):
        pid = f"pmh-{i}"
        res = {
            "resourceType": "Condition", "id": pid,
            "clinicalStatus": {"text": "patient-reported"},
            "verificationStatus": {"text": "unconfirmed"},
            "code": {"text": p.get("text", "")},
            "subject": {"reference": h.patient_ref},
        }
        entries.append({"fullUrl": f"urn:uuid:{pid}", "resource": res})
        pmh_entries.append({"reference": f"urn:uuid:{pid}"})
    for dx in case.dx:                      # document-derived conditions
        pid = dx["fid"].replace(":", "-")
        res = {
            "resourceType": "Condition", "id": pid,
            "clinicalStatus": {"text": "documented (from patient papers)"},
            "verificationStatus": {"text": "unconfirmed"},
            "code": {"text": dx["text"]},
            "subject": {"reference": h.patient_ref},
        }
        entries.append({"fullUrl": f"urn:uuid:{pid}", "resource": res})
        pmh_entries.append({"reference": f"urn:uuid:{pid}"})
    if pmh_entries:
        sections.append({
            "title": "Medical history (patient-stated + papers)",
            "code": _code("medical_history"),
            "entry": pmh_entries,
        })

    # --- Family + social -> FamilyHistory (social folded as text Conditions)
    fam_entries = []
    for i, f in enumerate(h.family):
        fid = f"fam-{i}"
        res = {
            "resourceType": "Condition", "id": fid,
            "clinicalStatus": {"text": "family history - patient-reported"},
            "verificationStatus": {"text": "unconfirmed"},
            "code": {"text": f.get("text", "")},
            "subject": {"reference": h.patient_ref},
        }
        entries.append({"fullUrl": f"urn:uuid:{fid}", "resource": res})
        fam_entries.append({"reference": f"urn:uuid:{fid}"})
    if fam_entries:
        sections.append({
            "title": "Family history", "code": _code("family_history"),
            "entry": fam_entries,
        })

    # --- Labs -> Observations (document-derived objective data)
    lab_entries = []
    for i, lab in enumerate(case.labs):
        oid = f"doclab-{i}"
        obs = {
            "resourceType": "Observation", "id": oid, "status": "preliminary",
            "code": {"text": lab.name},
            "subject": {"reference": h.patient_ref},
        }
        try:
            obs["valueQuantity"] = {"value": float(lab.value)}
            if lab.unit:
                obs["valueQuantity"]["unit"] = lab.unit
        except ValueError:
            obs["valueString"] = lab.value
        if lab.abnormal:
            obs["interpretation"] = [{"text": lab.abnormal}]
        entries.append({"fullUrl": f"urn:uuid:{oid}", "resource": obs})
        lab_entries.append({"reference": f"urn:uuid:{oid}"})
    if lab_entries:
        sections.append({
            "title": "Prior lab results (from patient papers)",
            "code": _code("labs"),
            "entry": lab_entries,
        })

    # --- DocumentReference: link the Module B session (no inline raw scan;
    #     raw-scan persistence is Module B's DPDP decision, not re-made here)
    if include_documents and case.documents.bundle_id:
        docref = {
            "resourceType": "DocumentReference", "id": "module-b-session",
            "status": "current",
            "type": {"text": "Digitized patient documents (Module B session)"},
            "subject": {"reference": h.patient_ref},
            "content": [{"attachment": {
                "contentType": "application/fhir+json",
                "title": case.documents.bundle_id or case.documents.session_id,
            }}],
        }
        entries.append({"fullUrl": "urn:uuid:docref-b", "resource": docref})
        sections.append({
            "title": "Patient documents (digitized)",
            "code": _code("document_reference"),
            "entry": [{"reference": "urn:uuid:docref-b"}],
        })

    return {
        "resourceType": "Bundle",
        "id": f"medikiosk-c-{h.session_id}",
        "type": "document",
        "timestamp": _now_iso(),
        "entry": entries,
    }


SOCRATES_TEXT = {
    "site": "Symptom site", "onset": "Symptom onset",
    "character": "Symptom character", "radiation": "Symptom radiation",
    "associations": "Associated symptoms", "timing": "Symptom timing",
    "exacerbating": "Exacerbating/relieving factors", "severity": "Symptom severity",
    "ice.ideas": "Patient ideas", "ice.concerns": "Patient concerns",
    "ice.expectations": "Patient expectations",
}


def _med_note(m) -> str:
    parts = []
    if m.sources:
        parts.append("source: " + ", ".join(m.sources))
    if m.reason:
        parts.append(m.reason)
    if m.verify:
        parts.append("needs physician verification")
    return "; ".join(parts) or "patient-stated"


def _code(section: str) -> dict:
    code, display, system = SECTION_CODES[section]
    return {"coding": [{"system": system, "code": code, "display": display}]}


# ------------------------------------------------------------------ validation

def validate_bundle(bundle: dict) -> list[str]:
    """Structural FHIR R4 validation via fhir.resources (R4B models overlap).
    Returns list of errors (empty = valid)."""
    try:
        from fhir.resources.R4B.bundle import Bundle
        Bundle.model_validate(bundle)
        return []
    except Exception as e:                    # noqa: BLE001
        return [str(e)]


# ----------------------------------------------------------------- attestation

def physician_attest(bundle: dict, practitioner_ref: str = "Practitioner/EXAMPLE",
                     mode: str = "professional") -> dict:
    """C5: record the physician verification into the Composition attester slot
    (the NRCeS contract's home for human attestation, doc/15 section 3)."""
    for entry in bundle.get("entry") or []:
        res = entry.get("resource") or {}
        if res.get("resourceType") == "Composition":
            res.setdefault("attester", []).append({
                "mode": mode,
                "party": {"reference": practitioner_ref},
                "time": _now_iso(),
            })
            if res.get("status") == "preliminary":
                res["status"] = "final"
    return bundle


def save_bundle(bundle: dict, out_dir: Path, name: str = "opconsultrecord.json") -> Path:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    return path

"""B6 - FHIR emitter: NRCeS-ABDM-style DocumentBundle.

Emits a FHIR R4 document Bundle per the NRCeS HealthDocumentRecord shape
(doc/13 section 1, machine-verified 2026-09-11):
- Composition (HealthDocumentRecord-style, sections: DocumentReference,
  Medications, Labs, Diagnoses) with attester slot for the physician verify step
- DocumentReference with inline base64 attachment (raw scan) when consented to persist
- MedicationRequest / Observation / Condition entries
- validation: structural FHIR R4B validation via fhir.resources (BSD-3);
  full NRCeS profile validation is M3 via HAPI (Apache-2.0)
"""
from __future__ import annotations

import base64
import datetime as _dt
import json
from pathlib import Path

NRCES_PROFILE = "https://nrces.in/ndhm/fhir/r4/StructureDefinition/HealthDocumentRecord"

SECTION_CODES = {
    "document_reference": ("42348-3", "Encounter documents"),
    "medications": ("10160-0", "History of Medication use Narrative"),
    "labs": ("30954-2", "Relevant diagnostic tests/laboratory data Narrative"),
    "diagnoses": ("11450-4", "Problem list - Reported"),
}


def _now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S+00:00")


def build_bundle(page_result: dict, image_path: Path | None,
                 patient_ref: str = "Patient/ABHA-EXAMPLE",
                 author_ref: str = "Organization/HOSP-EXAMPLE",
                 persist_raw: bool = False) -> dict:
    """page_result = pipeline.py PageResult.to_dict() output."""
    structured = page_result["structured"]
    verify = page_result["verify"]

    entries: list[dict] = []

    composition = {
        "resourceType": "Composition",
        "id": "hc-record-composition",
        "meta": {"profile": [NRCES_PROFILE], "source": "#medikiosk-module-b"},
        "status": "preliminary" if verify.get("any_verify") else "final",
        "type": {
            "coding": [{
                "system": "http://loinc.org",
                "code": "34117-2",
                "display": "History and physical note",
            }],
            "text": "Pre-consultation health document record",
        },
        "subject": {"reference": patient_ref},
        "date": _now_iso(),
        "author": [{"reference": author_ref}],
        "title": "MediKiosk pre-consultation record (Module B)",
        "attester": [],                      # filled by the physician review step (B7)
        "section": [],
    }
    entries.append({"fullUrl": "urn:uuid:composition", "resource": composition})

    # --- DocumentReference: raw scan (inline base64) when persistence consented
    if image_path is not None and persist_raw and Path(image_path).exists():
        b64 = base64.b64encode(Path(image_path).read_bytes()).decode()
        docref = {
            "resourceType": "DocumentReference",
            "id": "raw-scan",
            "status": "current",
            "docStatus": "preliminary" if verify.get("any_verify") else "final",
            "type": {"text": "Patient-carried scanned document"},
            "subject": {"reference": patient_ref},
            "content": [{"attachment": {
                "contentType": "image/png",
                "data": b64,
                "title": Path(image_path).name,
            }}],
        }
        entries.append({"fullUrl": "urn:uuid:docref", "resource": docref})
        composition["section"].append({
            "title": "Scanned document",
            "code": _code("document_reference"),
            "entry": [{"reference": "urn:uuid:docref"}],
        })

    # --- Medications -> MedicationRequest (draft, physician confirms)
    for i, med in enumerate(structured.get("medications", [])):
        mr = {
            "resourceType": "MedicationRequest",
            "id": f"med-{i}",
            "status": "draft",
            "intent": "proposal",
            "medicationCodeableConcept": {"text": med.get("name") or ""},
            "subject": {"reference": patient_ref},
            "authoredOn": _now_iso(),
            "dosageInstruction": [],
        }
        dose = med.get("dose")
        freq = med.get("frequency")
        if dose or freq:
            mr["dosageInstruction"].append({
                "text": " ".join(x for x in (dose, freq, med.get("duration")) if x)
            })
        entries.append({"fullUrl": f"urn:uuid:med-{i}", "resource": mr})
    if structured.get("medications"):
        composition["section"].append({
            "title": "Medications (from patient documents - verify)",
            "code": _code("medications"),
            "entry": [{"reference": f"urn:uuid:med-{i}"} for i in range(len(structured["medications"]))],
        })

    # --- Labs -> Observation
    for i, lab in enumerate(structured.get("labs", [])):
        obs = {
            "resourceType": "Observation",
            "id": f"lab-{i}",
            "status": "preliminary",
            "code": {"text": lab.get("name") or ""},
            "subject": {"reference": patient_ref},
        }
        if lab.get("value") is not None:
            obs["valueQuantity"] = {"value": float(lab["value"])}
            if lab.get("unit"):
                obs["valueQuantity"]["unit"] = lab["unit"]
        entries.append({"fullUrl": f"urn:uuid:lab-{i}", "resource": obs})
    if structured.get("labs"):
        composition["section"].append({
            "title": "Lab results (from patient documents - verify)",
            "code": _code("labs"),
            "entry": [{"reference": f"urn:uuid:lab-{i}"} for i in range(len(structured["labs"]))],
        })

    # --- Diagnoses -> Condition
    for i, dx in enumerate(structured.get("diagnoses", [])):
        cond = {
            "resourceType": "Condition",
            "id": f"dx-{i}",
            "clinicalStatus": {"text": "patient-reported"},
            "verificationStatus": {"text": "unconfirmed"},
            "code": {"text": dx.get("text") or ""},
            "subject": {"reference": patient_ref},
        }
        entries.append({"fullUrl": f"urn:uuid:dx-{i}", "resource": cond})
    if structured.get("diagnoses"):
        composition["section"].append({
            "title": "Reported conditions",
            "code": _code("diagnoses"),
            "entry": [{"reference": f"urn:uuid:dx-{i}"} for i in range(len(structured["diagnoses"]))],
        })

    return {
        "resourceType": "Bundle",
        "id": f"medikiosk-{page_result.get('session_id', 'session')}",
        "type": "document",
        "timestamp": _now_iso(),
        "entry": entries,
    }


def _code(section: str) -> dict:
    code, display = SECTION_CODES[section]
    return {"coding": [{"system": "http://loinc.org", "code": code, "display": display}]}


def validate_bundle(bundle: dict) -> list[str]:
    """Structural FHIR validation via fhir.resources (R4B models; R4/R4B are
    aligned for these resources). Returns list of errors (empty = valid)."""
    try:
        from fhir.resources.R4B.bundle import Bundle
        Bundle.model_validate(bundle)
        return []
    except Exception as e:                    # noqa: BLE001
        return [str(e)]


def physician_attest(bundle: dict, practitioner_ref: str = "Practitioner/EXAMPLE",
                     mode: str = "professional") -> dict:
    """B7: record the physician verification into the Composition attester slot
    (the NRCeS contract's home for human attestation, doc/13 section 1)."""
    for entry in bundle.get("entry", []):
        res = entry.get("resource", {})
        if res.get("resourceType") == "Composition":
            res.setdefault("attester", []).append({
                "mode": mode,
                "party": {"reference": practitioner_ref},
                "time": _now_iso(),
            })
            if res.get("status") == "preliminary":
                res["status"] = "final"
    return bundle


def save_bundle(bundle: dict, out_dir: Path, name: str = "bundle.json") -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / name
    path.write_text(json.dumps(bundle, indent=2, ensure_ascii=False), encoding="utf-8")
    return path

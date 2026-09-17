"""C1 - Input contracts: HistoryBundle (Module A) + DocumentBundle (Module B).

This module DEFINES the v1 HistoryBundle contract (doc/15 section 5 item 1:
"HistoryBundle contract - ontology, serialization, API, confidence schema,
retention, consent boundary all undefined"). Everything downstream (C2 merger,
C3 renderer, C4 emitter, C6 eval) reads through these loaders, so the contract
is enforced in one place.

HistoryBundle v1 shape (JSON):

    {
      "schema": "medikiosk-history-bundle/1",
      "session_id": "A230911...",
      "consent_ref": "<opaque Module D token>",
      "patient_ref": "Patient/ABHA-EXAMPLE",
      "language": "hi",                      # interview language
      "respondent": {"role": "patient" | "proxy", "relation": "son" | ...},
      "visit": {"type": "new" | "repeat", "prior_date": "2026-08-15" | null},
      "complaint": {"term": "chest pain", "free_text": "...",
                    "by": "patient" | "proxy", "voice": true, "conf": 0.9},
      "socrates": {                           # 8 slots, each:
        "site":        {"state": "captured" | "needs_review" | "not_answered" | "not_elicited",
                        "value": "chest", "by": "patient", "voice": true, "conf": 0.93},
        ...
      },
      "pmh": [{"text": "hypertension", "by": "patient"}],
      "medications": [{"name": "Amlodipine", "dose": "5 mg", "by": "patient"}],
      "allergies": [{"text": "no allergies", "by": "patient"}],
      "family": [{"text": "father - heart attack", "by": "patient"}],
      "social": [{"text": "smokes bidis", "by": "patient"}],
      "ros": [{"system": "cardio", "symptom": "breathlessness",
               "state": "captured", "positive": true, "by": "patient"}],
      "ice": {"ideas": {...slot}, "concerns": {...slot}, "expectations": {...slot}},
      "red_flags": [{"rule": "RF-2", "matched": ["chest pain", "breathlessness"]}],
      "dashavidha": {...}                     # optional second layer (not in v1 demo)
    }

Slot states are Module A's honesty contract (doc/09 section 2): captured /
needs_review / not_answered / not_elicited. Provenance per slot: "by"
(patient vs proxy respondent) and "voice" (voice-excerpt vs touch).

DocumentBundle side accepts EITHER a medib run_summary-style dict (pages with
structured + verify info - the richest form) OR a FHIR DocumentBundle (parsed
back into structured lists; verify state then defaults to "from documents -
physician verifies", the same verify-default posture as Module B).
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

HISTORY_SCHEMA = "medikiosk-history-bundle/1"

SLOT_STATES = ("captured", "needs_review", "not_answered", "not_elicited")
SOCRATES_FIELDS = ("site", "onset", "character", "radiation", "associations",
                   "timing", "exacerbating", "severity")


class ContractError(ValueError):
    """Raised when an input bundle violates the v1 contract."""


# ---------------------------------------------------------------- HistoryBundle

@dataclass
class Slot:
    """One elicited clinical slot with Module A's honesty + provenance contract."""
    key: str
    state: str = "not_elicited"
    value: str = ""
    by: str = "patient"                     # patient | proxy (respondent provenance)
    voice: bool = False                     # voice-excerpt source (Module A directive)
    conf: float | None = None

    def __post_init__(self):
        if self.state not in SLOT_STATES:
            raise ContractError(f"slot {self.key!r}: unknown state {self.state!r}")
        if self.state == "captured" and not self.value:
            raise ContractError(f"slot {self.key!r}: captured but empty value")

    @property
    def rendered(self) -> bool:
        return self.state in ("captured", "needs_review") and bool(self.value)


def _slot(key: str, raw: dict | None) -> Slot:
    raw = raw or {}
    return Slot(
        key=key,
        state=raw.get("state", "not_elicited"),
        value=str(raw.get("value", "") or ""),
        by=raw.get("by", "patient"),
        voice=bool(raw.get("voice", False)),
        conf=raw.get("conf"),
    )


@dataclass
class HistoryBundle:
    """Validated Module A output (the v1 contract, parsed)."""
    session_id: str
    consent_ref: str
    patient_ref: str
    language: str
    respondent: dict
    visit: dict
    complaint: dict
    socrates: dict[str, Slot]
    pmh: list[dict]
    medications: list[dict]
    allergies: list[dict]
    family: list[dict]
    social: list[dict]
    ros: list[dict]
    ice: dict[str, Slot]
    red_flags: list[dict]
    dashavidha: dict | None = None
    raw: dict = field(default_factory=dict, repr=False)

    @property
    def is_repeat(self) -> bool:
        return bool(self.visit.get("type") == "repeat")

    def captured_slots(self) -> list[Slot]:
        """All slots with content, in interview order (SOCRATES then ICE)."""
        out = [self.socrates[k] for k in SOCRATES_FIELDS if k in self.socrates]
        out += [self.ice[k] for k in ("ideas", "concerns", "expectations")
                if k in self.ice]
        return [s for s in out if s.rendered]

    def field_id(self, slot: Slot) -> str:
        return f"A:{slot.key}"


def load_history(raw: dict) -> HistoryBundle:
    """Validate + parse a HistoryBundle dict. Raises ContractError."""
    if not isinstance(raw, dict):
        raise ContractError("history bundle must be a JSON object")
    schema = raw.get("schema")
    if schema != HISTORY_SCHEMA:
        raise ContractError(f"unsupported history schema {schema!r} (want {HISTORY_SCHEMA!r})")
    for req in ("session_id", "consent_ref", "patient_ref"):
        if not raw.get(req):
            raise ContractError(f"missing required field {req!r}")

    socrates_raw = raw.get("socrates") or {}
    missing = [k for k in SOCRATES_FIELDS if k not in socrates_raw]
    if missing:
        raise ContractError(f"socrates missing slots: {', '.join(missing)}")

    ice_raw = raw.get("ice") or {}
    return HistoryBundle(
        session_id=raw["session_id"],
        consent_ref=raw["consent_ref"],
        patient_ref=raw.get("patient_ref", "Patient/ABHA-EXAMPLE"),
        language=raw.get("language", "en"),
        respondent=raw.get("respondent") or {"role": "patient"},
        visit=raw.get("visit") or {"type": "new"},
        complaint=raw.get("complaint") or {},
        socrates={k: _slot(k, socrates_raw.get(k)) for k in SOCRATES_FIELDS},
        pmh=list(raw.get("pmh") or []),
        medications=list(raw.get("medications") or []),
        allergies=list(raw.get("allergies") or []),
        family=list(raw.get("family") or []),
        social=list(raw.get("social") or []),
        ros=list(raw.get("ros") or []),
        ice={k: _slot(f"ice.{k}", ice_raw.get(k))
             for k in ("ideas", "concerns", "expectations")},
        red_flags=list(raw.get("red_flags") or []),
        dashavidha=raw.get("dashavidha"),
        raw=raw,
    )


# --------------------------------------------------------------- DocumentBundle

@dataclass
class DocMed:
    name: str
    dose: str = ""
    frequency: str = ""
    duration: str = ""
    verify: bool = False
    conf: float | None = None
    source_doc: str = ""


@dataclass
class DocLab:
    name: str
    value: str
    unit: str = ""
    verify: bool = False
    conf: float | None = None
    source_doc: str = ""


@dataclass
class DocDx:
    text: str
    verify: bool = False
    conf: float | None = None
    source_doc: str = ""


@dataclass
class DocumentSide:
    """Module B output, normalized for the merger (from run_summary OR bundle)."""
    session_id: str = ""
    meds: list[DocMed] = field(default_factory=list)
    labs: list[DocLab] = field(default_factory=list)
    dx: list[DocDx] = field(default_factory=list)
    has_raw_scan: bool = False
    persist_raw: bool = False
    bundle_id: str = ""

    def __len__(self) -> int:
        return len(self.meds) + len(self.labs) + len(self.dx)


def load_documents(raw: dict) -> DocumentSide:
    """Accepts either a medib run_summary-style dict or a FHIR DocumentBundle."""
    if not isinstance(raw, dict):
        raise ContractError("document side must be a JSON object")
    if raw.get("resourceType") == "Bundle":
        return _from_fhir_bundle(raw)
    if "pages" in raw or "structured" in raw:
        return _from_run_summary(raw)
    raise ContractError("document side is neither a FHIR Bundle nor a run_summary")


def _from_run_summary(raw: dict) -> DocumentSide:
    """medib pipeline.run() output: {"pages": [PageResult.to_dict()...], ...}."""
    side = DocumentSide(session_id=str(raw.get("session_id", "")),
                        bundle_id=str(raw.get("bundle", "") or ""))
    pages = raw.get("pages") or []
    merged = raw.get("structured")
    if merged:                                    # module-b merged session form
        pages = [{"structured": merged, "verify": raw.get("verify", {}), "image": "session"}]
    for page in pages:
        st = page.get("structured") or {}
        verify_fields = {(f.get("field") or ""): f for f in
                         (page.get("verify") or {}).get("fields", [])}
        img = str(page.get("image") or "doc")
        for med in st.get("medications") or []:
            side.meds.append(DocMed(
                name=str(med.get("name") or ""),
                dose=str(med.get("dose") or ""),
                frequency=str(med.get("frequency") or ""),
                duration=str(med.get("duration") or ""),
                verify=bool(med.get("_verify", False)),
                conf=med.get("_src_conf"),
                source_doc=img,
            ))
        for lab in st.get("labs") or []:
            side.labs.append(DocLab(
                name=str(lab.get("name") or ""),
                value=str(lab.get("value") or ""),
                unit=str(lab.get("unit") or ""),
                verify=bool(lab.get("_verify", False)),
                conf=lab.get("_src_conf"),
                source_doc=img,
            ))
        for dx in st.get("diagnoses") or []:
            side.dx.append(DocDx(
                text=str(dx.get("text") or ""),
                verify=bool(dx.get("_verify", False)),
                conf=dx.get("_src_conf"),
                source_doc=img,
            ))
    side.has_raw_scan = bool(pages)
    side.persist_raw = bool(raw.get("persist_raw", False))
    return side


def _from_fhir_bundle(bundle: dict) -> DocumentSide:
    """Parse a medib FHIR DocumentBundle back into structured lists.

    Document-derived fields carry no per-field verify state in the bundle, so
    they default to verify=True - the Module B verify-default posture
    (doc/13: handwriting/low-confidence fields are never silently trusted)."""
    side = DocumentSide(session_id=str(bundle.get("id", "")),
                        bundle_id=str(bundle.get("id", "")))
    for entry in bundle.get("entry") or []:
        res = entry.get("resource") or {}
        rt = res.get("resourceType")
        if rt == "MedicationRequest":
            dosage = ""
            for di in res.get("dosageInstruction") or []:
                dosage = di.get("text") or ""
            name = ((res.get("medicationCodeableConcept") or {}).get("text") or "")
            dose, freq = _split_dosage(dosage)
            side.meds.append(DocMed(name=name, dose=dose, frequency=freq,
                                    verify=True, source_doc="FHIR bundle"))
        elif rt == "Observation":
            name = ((res.get("code") or {}).get("text") or "")
            vq = res.get("valueQuantity") or {}
            side.labs.append(DocLab(name=name, value=str(vq.get("value", "")),
                                    unit=str(vq.get("unit", "")),
                                    verify=True, source_doc="FHIR bundle"))
        elif rt == "Condition":
            text = ((res.get("code") or {}).get("text") or "")
            side.dx.append(DocDx(text=text, verify=True, source_doc="FHIR bundle"))
        elif rt == "DocumentReference":
            side.has_raw_scan = True
    return side


def _split_dosage(text: str) -> tuple[str, str]:
    """'10 mg BD' -> ('10 mg', 'BD'); 'BD' -> ('', 'BD')."""
    freqs = {"OD", "BD", "TDS", "QID", "HS", "SOS"}
    parts = [p for p in (text or "").split() if p]
    for i, p in enumerate(parts):
        if p.upper() in freqs:
            return " ".join(parts[:i]) or "", " ".join(parts[i:])
    return " ".join(parts), ""


def load_json(path: Path | str) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))

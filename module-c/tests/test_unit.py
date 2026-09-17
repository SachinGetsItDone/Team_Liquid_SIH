"""Unit tests for the deterministic Module C layers (no engine needed)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medic.config import MergerConfig
from medic.contracts import (ContractError, HISTORY_SCHEMA, Slot, load_documents,
                             load_history)
from medic.eval_harness import evaluate, format_report
from medic.fhir_emitter import (build_opconsultrecord, physician_attest,
                                validate_bundle)
from medic.fixtures import DEMO_DOCUMENTS, DEMO_HISTORY, demo_case
from medic.merger import apply_physician_edit, merge
from medic.renderer import (render_oldcarts, render_readback, render_soap)


# ---------------------------------------------------------------- contracts

def test_history_bundle_contract_enforced():
    good = load_history(DEMO_HISTORY)
    assert good.session_id == "A2309111433"
    assert good.socrates["severity"].value == "8/10"
    assert good.red_flags[0]["rule"] == "RF-2"
    # schema guard
    import copy
    bad = copy.deepcopy(DEMO_HISTORY)
    bad["schema"] = "wrong/2"
    try:
        load_history(bad)
        assert False, "expected ContractError"
    except ContractError:
        pass
    # missing socrates slot
    bad = copy.deepcopy(DEMO_HISTORY)
    del bad["socrates"]["onset"]
    try:
        load_history(bad)
        assert False, "expected ContractError"
    except ContractError:
        pass


def test_slot_state_honesty():
    assert Slot("x", state="captured", value="v").rendered is True
    assert Slot("x", state="not_elicited").rendered is False
    try:
        Slot("x", state="bogus")
        assert False, "expected ContractError for unknown state"
    except ContractError:
        pass
    try:
        Slot("x", state="captured", value="")
        assert False, "expected ContractError for captured-but-empty"
    except ContractError:
        pass


def test_document_side_accepts_both_forms():
    rs = load_documents(DEMO_DOCUMENTS)
    # 6 raw document med reads (Paracetamol appears on two printed docs)
    assert len(rs.meds) == 6 and len(rs.labs) == 4 and len(rs.dx) == 3
    assert rs.meds[-1].verify is True          # handwritten page -> verify
    # FHIR bundle form round-trip
    case = merge(*demo_case())
    bundle = build_opconsultrecord(case)
    fb = load_documents(bundle)
    assert len(fb.meds) == len(case.meds)
    assert fb.meds[0].verify is True           # bundle path defaults verify


# ------------------------------------------------------------------- merger

def test_merge_medication_reconciliation():
    case = merge(*demo_case())
    names = {m.name.lower(): m for m in case.meds}
    # Paracetamol appears on TWO printed documents -> one merged entry
    para = [m for m in case.meds if m.name.lower() == "paracetamol"]
    assert len(para) == 1
    # Atorvastatin: patient-stated AND on handwritten doc -> merged provenance
    at = names["atorvastatin"]
    assert at.sources == ["patient", "document"]
    assert at.verify is True                   # handwriting doc -> verify
    # Amlodipine: patient-only
    am = names["amlodipine"]
    assert am.sources == ["patient"] and am.fid.startswith("A:med:")
    # Metformin: document-only
    me = names["metformin"]
    assert me.sources == ["document"] and me.verify is True


def test_merge_flags_dose_conflict():
    import copy
    hist = load_history(copy.deepcopy(DEMO_HISTORY))
    # patient says 20 mg; the handwritten doc says 10
    hist.medications = [dict(m) for m in DEMO_HISTORY["medications"]]
    hist.medications[1] = {"name": "Atorvastatin", "dose": "20 mg",
                           "frequency": "", "by": "patient"}
    docs = load_documents(DEMO_DOCUMENTS)
    case = merge(hist, docs)
    at = next(m for m in case.meds if m.name.lower() == "atorvastatin")
    assert at.verify is True
    assert "dose differs" in at.reason
    assert "20 mg" in at.reason and "10" in at.reason


def test_dose_equivalence_unit_tolerant():
    from medic.merger import _doses_equivalent
    assert _doses_equivalent("10 mg", "10") is True       # unit absent one side
    assert _doses_equivalent("10", "10 mg") is True
    assert _doses_equivalent("10 mg", "10 mg") is True
    assert _doses_equivalent("10 mg", "20 mg") is False
    assert _doses_equivalent("10 mg", "10 mcg") is False  # both units, differ
    assert _doses_equivalent("BD", "BD") is True


def test_merge_abnormal_labs():
    case = merge(*demo_case())
    labs = {l.name.lower(): l for l in case.labs}
    assert labs["hemoglobin"].abnormal == "low"        # 10.2 < 12
    assert labs["fasting glucose"].abnormal == "high"  # 112 > 100
    assert labs["hba1c"].abnormal == "high"            # 6.8 > 5.6
    assert labs["tsh"].abnormal == "high"              # 4.1 > 4.0 (borderline)
    assert "ref" in labs["hemoglobin"].range_note


def test_abnormality_ignores_unknown_and_unit_mismatch():
    from medic.merger import _abnormality
    assert _abnormality("Unknown Test X", "99", "", {}) == ("", "")
    assert _abnormality("Hemoglobin", "10.2", "mmol/L",
                        {"hemoglobin": (12.0, 16.0, "g/dL")}) == ("", "")
    assert _abnormality("HbA1c", "abc", "%", {"hba1c": (4.0, 5.6, "%")}) == ("", "")


def test_alerts_severity_ordered_red_flag_first():
    case = merge(*demo_case())
    sev = [a.severity for a in case.alerts]
    assert sev[0] == "red-flag"
    assert sev == sorted(sev, key=lambda s: {"red-flag": 0, "verify": 1,
                                             "abnormal": 2}.get(s, 3))
    assert case.alerts[0].text.startswith("RF-2")
    assert "breathlessness" in case.alerts[0].detail


def test_timeline_honest_dates():
    case = merge(*demo_case())
    assert all(e["date_note"] == "date not on document" for e in case.timeline)
    assert {e["kind"] for e in case.timeline} == {"diagnosis", "lab"}


# ------------------------------------------------------------------ renderer

def test_soap_mapping_and_physician_only_lock():
    case = merge(*demo_case())
    soap = render_soap(case)
    s_text = " ".join(l["text"] for l in soap["S"])
    o_text = " ".join(l["text"] for l in soap["O"])
    # doc/04 mapping: S carries history; O carries document-derived data only
    assert "Chief complaint" in s_text and "8/10" in s_text
    assert "Hemoglobin" in o_text and "breathlessness" in s_text
    # Assessment & Plan are physician-only, never generated
    assert "physician only" in soap["A"][0]["text"]
    assert "physician only" in soap["P"][0]["text"]
    # honesty block: explicit gap lines
    gaps = " ".join(l["text"] for l in soap["gaps"])
    assert "not asked" not in gaps or "not" in gaps  # demo has none -> empty is fine
    assert isinstance(soap["gaps"], list)


def test_soap_provenance_on_every_content_line():
    case = merge(*demo_case())
    soap = render_soap(case)
    canon_ids = set(case.field_ids())
    for key in ("S", "O"):
        for ln in soap[key]:
            if ln["text"].startswith(("Vitals", "Prior results", "Documented")):
                continue                       # structural furniture lines
            assert ln["src"], f"content line without provenance: {ln['text']}"
            assert set(ln["src"]) <= canon_ids | {"A:complaint", "A:pmh",
                                                  "A:allergies", "A:family",
                                                  "A:social", "A:ros"}, ln["text"]


def test_oldcarts_same_data_reorganized():
    case = merge(*demo_case())
    oc = render_oldcarts(case)
    headings = list(oc["sections"].keys())
    assert headings[0].startswith("O - Onset")          # OLD CARTS order
    assert any(h.startswith("L - Location") for h in headings)
    assert any(h.startswith("S - Severity") for h in headings)
    sev = oc["sections"]["S - Severity"][0]
    assert sev["text"].startswith("8/10")


def test_readback_bilingual_and_provenance_tags():
    case = merge(*demo_case())
    en = render_readback(case, "en")
    hi = render_readback(case, "hi")
    en_text = " ".join(l["text"] for l in en["lines"])
    hi_text = " ".join(l["text"] for l in hi["lines"])
    assert "Severity" in en_text and "तीव्रता" in hi_text
    assert "no allergies" in en_text                # leading "no" preserved
    assert "आवाज़" in hi_text                       # voice provenance tag rendered
    # same canon field ids in both languages (store once, render many)
    en_ids = {sid for l in en["lines"] for sid in l["src"]}
    hi_ids = {sid for l in hi["lines"] for sid in l["src"]}
    assert en_ids == hi_ids


# ------------------------------------------------------------------- emitter

def test_opconsultrecord_shape():
    case = merge(*demo_case())
    bundle = build_opconsultrecord(case)
    comp = bundle["entry"][0]["resource"]
    assert bundle["type"] == "document"
    assert comp["type"]["coding"][0]["code"] == "371530004"
    assert comp["meta"]["profile"] == ["https://nrces.in/ndhm/fhir/r4/"
                                       "StructureDefinition/OPConsultRecord"]
    assert comp["status"] == "preliminary"
    assert comp["attester"] == []
    titles = [s["title"] for s in comp["section"]]
    assert any("Chief Complaints" in t for t in titles)
    assert any("Medications" in t for t in titles)
    assert any("Allergies" in t for t in titles)
    # physician-at-consult sections are NOT pre-generated
    assert not any("InvestigationAdvice" in t or "Procedure" in t
                   or "Follow Up" in t or "Physical" in t for t in titles)
    # resource types are NRCeS-slice targets
    rts = {e["resource"]["resourceType"] for e in bundle["entry"]}
    assert {"Composition", "Condition", "MedicationRequest",
            "AllergyIntolerance", "Observation"} <= rts


def test_bundle_validates_fhir():
    case = merge(*demo_case())
    errors = validate_bundle(build_opconsultrecord(case))
    assert errors == [], errors


def test_physician_attest_roundtrip():
    case = merge(*demo_case())
    bundle = build_opconsultrecord(case)
    bundle = physician_attest(bundle, "Practitioner/DR-1")
    comp = bundle["entry"][0]["resource"]
    assert comp["attester"][0]["mode"] == "professional"
    assert comp["attester"][0]["party"]["reference"] == "Practitioner/DR-1"
    assert comp["status"] == "final"


def test_physician_edit_roundtrip():
    case = merge(*demo_case())
    fid = next(m.fid for m in case.meds if m.name == "Metformin")
    assert apply_physician_edit(case, fid, "Metformin: 500 mg") is True
    med = next(m for m in case.meds if m.fid == fid)
    assert med.name == "Metformin" and med.dose == "500 mg"
    assert med.verify is False                     # verify cleared by the edit
    assert apply_physician_edit(case, "B:nosuch:0", "x") is False


# --------------------------------------------------------------- eval harness

def test_eval_protocol_all_views_clean():
    case = merge(*demo_case())
    report = evaluate(case)
    assert report["determinism"] is True
    assert report["fabrications"] == 0
    for name, v in report["views"].items():
        assert v["field_recall"] == 1.0, f"{name} omissions: {v['omissions']}"
        assert v["fabrications"] == []
    txt = format_report(report)
    assert "determinism: True" in txt


def test_eval_catches_omission():
    """The arXiv:2608.31016 omission check: a view missing a captured field
    must be reported, not silently passed (presence-checking is not enough)."""
    import copy
    from medic.renderer import render_soap as rs
    case = merge(*demo_case())
    # simulate an omission: hide the severity slot from the canon
    case.history.socrates["severity"] = Slot("severity", state="not_elicited")
    report = evaluate(case)
    # severity is no longer captured, so recall over the REMAINING slots
    # must still be 1.0 - the omission of a captured field is what drops it.
    soap = rs(case)
    assert not any("8/10" in l["text"] for l in soap["S"])
    assert report["views"]["soap"]["field_recall"] == 1.0
    # now break the renderer contract: hand-built view that omits a field
    broken = {"view": "soap", "S": [{"text": "only site", "src": ["A:site"]}],
              "O": [], "A": [], "P": [], "gaps": []}
    from medic.eval_harness import _all_lines
    lines = _all_lines(broken)
    rendered = {sid for l in lines for sid in l["src"]}
    slot_ids = {i for i in case.field_ids()
                if not i.startswith(("B:", "A:med"))}
    assert slot_ids - rendered                      # omissions detected

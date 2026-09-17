"""Unit tests for the deterministic layers (no OCR engine needed)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medib.config import EngineConfig
from medib.engines import EngineResult, TextBox
from medib.voting import field_vote, Vote
from medib.confidence import gate_votes, gate_structured
from medib.router import classify
from medib.structurer import RuleBasedStructurer
from medib.intake import ConsentArtefact, ConsentMissingError, load_page, ITEMIZED_NOTICE
from medib.fhir_emitter import build_bundle, validate_bundle, physician_attest
from medib.eval_harness import cer


# ---------- intake / DPDP ----------

def test_consent_required_before_extraction():
    import pytest
    bad = ConsentArtefact(patient_ack=False)
    with pytest.raises(ConsentMissingError):
        load_page("whatever.png", bad)
    good = ConsentArtefact(patient_ack=True)
    assert good.validate() is None


def test_notice_is_itemized():
    # DPDP itemized-notice requirement (doc/13 section 4)
    assert "data_collected" in ITEMIZED_NOTICE and len(ITEMIZED_NOTICE["data_collected"]) >= 2
    assert "rights" in ITEMIZED_NOTICE and "retention" in ITEMIZED_NOTICE


# ---------- voting ----------

def _prim():
    return EngineResult("rapidocr", lines=[
        TextBox("Tab. Augmentin 625", (10, 10, 300, 40), 0.93),
        TextBox("Atorvastatin 10", (10, 60, 280, 90), 0.91),
    ])

def _fall(same_first=True):
    t2 = "Tab. Augmentin 625" if same_first else "Tab. Augmentin 625mg"
    t1 = "Atorvastotin 1O" if not same_first else "Atorvastatin 10"
    return EngineResult("tesseract", lines=[
        TextBox(t2, (12, 12, 298, 42), 0.90),
        TextBox(t1, (12, 62, 278, 92), 0.88),
    ])

def test_vote_agreement_boosts_confidence():
    votes = field_vote(_prim(), _fall())
    assert all(isinstance(v, Vote) for v in votes)
    assert votes[0].agree is True and votes[0].voted_conf > votes[0].conf

def test_vote_disagreement_flags_verify():
    votes = field_vote(_prim(), _fall(same_first=False))
    assert votes[1].agree is False
    assert votes[1].voted_conf < votes[1].conf

def test_vote_without_fallback_never_agrees():
    votes = field_vote(_prim(), None)
    assert all(v.agree is False or v.engines == ["rapidocr"] for v in votes)


# ---------- confidence gate ----------

def test_gate_verify_default_on_handwriting():
    cfg = EngineConfig()
    votes = field_vote(_prim(), _fall())
    fields = gate_votes(votes, cfg, page_is_handwritten=True)
    assert all(f.verified_needed for f in fields)
    assert "MIRAGE" in fields[0].reason

def test_gate_low_conf_flagged():
    cfg = EngineConfig(field_conf_threshold=0.95)
    res = EngineResult("rapidocr", lines=[TextBox("faint text", (0, 0, 100, 20), 0.50)])
    votes = field_vote(res, None)
    fields = gate_votes(votes, cfg, page_is_handwritten=False)
    assert fields[0].verified_needed and fields[0].conf < 0.95

def test_gate_structured_marks_low_source_conf():
    cfg = EngineConfig()
    structured = {"medications": [{"name": "X", "_src_conf": 0.42}],
                  "labs": [], "diagnoses": []}
    out = gate_structured(structured, cfg, page_is_handwritten=False)
    assert out["fields"][0]["verify"] is True


# ---------- router ----------

def test_router_printed():
    cfg = EngineConfig()
    res = EngineResult("rapidocr", lines=[
        TextBox("Test Report", (0, 0, 200, 30), 0.96),
        TextBox("Hemoglobin : 10.2 g/dL", (0, 60, 400, 90), 0.94),
        TextBox("TSH : 4.1 mIU/L", (0, 120, 300, 150), 0.95),
    ])
    out = classify(res, cfg)
    assert out["page_type"] in ("printed", "lab_table")
    assert out["signals"]["n_lines"] == 3

def test_router_handwritten_low_conf():
    cfg = EngineConfig()
    res = EngineResult("rapidocr", lines=[
        TextBox("Rx", (0, 0, 60, 30), 0.30),
        TextBox("scrawl", (0, 60, 200, 90), 0.25),
    ])
    out = classify(res, cfg)
    assert out["page_type"] == "handwritten"


# ---------- structurer ----------

def test_structurer_extracts_meds_labs_dx():
    res = EngineResult("rapidocr", lines=[
        TextBox("Tab. Amoxicillin 500mg BD x 5 days", (0, 0, 400, 30), 0.95),
        TextBox("Hemoglobin : 10.2 g/dL", (0, 40, 300, 70), 0.93),
        TextBox("Diagnosis: Acute bronchitis", (0, 80, 320, 110), 0.94),
    ])
    out = RuleBasedStructurer().structure(res)
    med = out["medications"][0]
    assert med["name"] == "Amoxicillin" and med["dose"] == "500mg" and med["frequency"] == "BD"
    assert med["duration"] == "5 days"
    lab = out["labs"][0]
    assert lab["name"] == "Hemoglobin" and lab["value"] == "10.2" and lab["unit"] == "g/dL"
    assert "bronchitis" in out["diagnoses"][0]["text"]

def test_structurer_no_hallucination_on_noise():
    for noise in ("the and for", "known case of since", "review after"):
        res = EngineResult("rapidocr", lines=[TextBox(noise, (0, 0, 100, 20), 0.9)])
        out = RuleBasedStructurer().structure(res)
        assert not out["medications"], f"{noise} produced {out['medications']}"
        assert not out["labs"] or all(l["value"] for l in out["labs"])


# ---------- FHIR ----------

def _page_result():
    return {
        "session_id": "t1",
        "structured": {
            "medications": [{"name": "Amoxicillin", "dose": "500mg", "frequency": "BD",
                             "duration": "5 days", "_src_conf": 0.95}],
            "labs": [{"name": "Hemoglobin", "value": "10.2", "unit": "g/dL", "_src_conf": 0.93}],
            "diagnoses": [{"text": "Acute bronchitis", "_src_conf": 0.94}],
        },
        "verify": {"verify_all": False, "fields": []},
        "any_verify": False,
    }

def test_bundle_valid_fhir_and_has_attester_slot():
    bundle = build_bundle(_page_result(), image_path=None, persist_raw=False)
    assert bundle["resourceType"] == "Bundle" and bundle["type"] == "document"
    assert validate_bundle(bundle) == []
    comp = bundle["entry"][0]["resource"]
    assert comp["resourceType"] == "Composition"
    assert any(s["title"].startswith("Medications") for s in comp["section"])

def test_physician_attest_fills_attester_and_finalizes():
    bundle = build_bundle(_page_result(), None, False)
    comp = bundle["entry"][0]["resource"]
    comp["status"] = "preliminary"
    bundle = physician_attest(bundle, "Practitioner/Dr-Sharma")
    att = comp["attester"][0]
    assert att["mode"] == "professional" and "Dr-Sharma" in att["party"]["reference"]
    assert comp["status"] == "final"

def test_bundle_sections_reference_entries():
    bundle = build_bundle(_page_result(), None, False)
    fullurls = {e["fullUrl"] for e in bundle["entry"]}
    for entry in bundle["entry"]:
        res = entry["resource"]
        if res["resourceType"] == "Composition":
            for section in res.get("section", []):
                for ref in section.get("entry", []):
                    assert ref["reference"] in fullurls


# ---------- eval harness ----------

def test_cer_zero_for_identical():
    assert cer("Tab. Amoxicillin", "Tab. Amoxicillin") == 0.0

def test_cer_counts_substitutions():
    assert 0.0 < cer("Atorvastatin 10", "Atorvastotin 1O") < 0.3

def test_cer_empty_reference():
    assert cer("", "abc") == 1.0

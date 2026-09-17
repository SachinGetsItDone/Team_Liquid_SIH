"""End-to-end smoke: fixtures -> run_case -> artefacts on disk."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medic.cli import run_case
from medic.fixtures import demo_case


def test_run_case_end_to_end(tmp_path):
    history, documents = demo_case()
    summary = run_case(history, documents, out_dir=tmp_path, attest=True)

    assert summary["counts"]["red_flags"] == 1
    assert summary["counts"]["meds"] >= 5
    assert summary["fhir_validation_errors"] == []
    assert summary["eval"]["fabrications"] == 0
    assert summary["eval"]["determinism"] is True
    assert summary["eval"]["field_recall_min"] == 1.0

    # artefacts written and JSON-parseable
    for name in ("soap.json", "oldcarts.json", "readback-en.json",
                 "readback-hi.json", "opconsultrecord.json", "eval.json",
                 "run_summary.json"):
        p = tmp_path / name
        assert p.exists(), name
        json.loads(p.read_text(encoding="utf-8"))

    bundle = json.loads((tmp_path / "opconsultrecord.json").read_text("utf-8"))
    comp = bundle["entry"][0]["resource"]
    assert comp["status"] == "final"                # --attest applied
    assert comp["attester"][0]["mode"] == "professional"

    soap = json.loads((tmp_path / "soap.json").read_text("utf-8"))
    assert any("8/10" in l["text"] for l in soap["S"])


def test_demo_case_is_the_shared_ramesh_case():
    history, documents = demo_case()
    assert history.complaint["term"] == "chest pain"
    assert history.red_flags[0]["rule"] == "RF-2"    # matches Module A demo 1
    assert any(m.name == "Atorvastatin" for m in documents.meds)
    assert any(l.name == "Hemoglobin" for l in documents.labs)

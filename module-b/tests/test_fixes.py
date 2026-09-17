"""Regression tests for the two audited Module B defects (2026-09-16):
1. Composition/DocumentReference status was always `final` because
   `fhir_emitter` read `verify["any_verify"]` while the pipeline stored it at
   the top level. Fixed in `pipeline.run` + covered here.
2. `vote_bonus_agree` / `vote_penalty_disagree` were dead config; `voting.py`
   hardcoded +0.15/-0.25. Wired through `field_vote(..., cfg)`.
Also covers the router's hardcoded thresholds moving into config.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from medib.config import EngineConfig
from medib.engines import EngineResult, TextBox
from medib.fhir_emitter import build_bundle
from medib.router import classify
from medib.voting import field_vote


# ------------------------------------------------------- 1. any_verify status

def _merged(any_verify: bool) -> dict:
    return {
        "session_id": "B1",
        "structured": {"medications": [{"name": "Amoxicillin", "dose": "500mg",
                                        "frequency": "BD", "duration": "5 days",
                                        "_src_conf": 0.99}],
                       "labs": [], "diagnoses": []},
        "verify": {"verify_all": any_verify, "any_verify": any_verify,
                   "fields": [{"field": "medication:0", "verify": True}] if any_verify else []},
        "any_verify": any_verify,
    }


def test_verify_forces_preliminary_status():
    bundle = build_bundle(_merged(True), None, persist_raw=False)
    comp = bundle["entry"][0]["resource"]
    assert comp["status"] == "preliminary"


def test_clean_session_is_final_status():
    bundle = build_bundle(_merged(False), None, persist_raw=False)
    comp = bundle["entry"][0]["resource"]
    assert comp["status"] == "final"


def test_pipeline_merge_places_any_verify_inside_verify(monkeypatch, tmp_path):
    from medib import pipeline as mp
    from medib.intake import ConsentArtefact

    class _Page:
        persist_raw = False

        def meta(self):
            return {"image": "x.png"}

    def fake_process_page(image_path, consent, cfg=None, persist_raw=None):
        pr = mp.PageResult(
            image_path=str(image_path), page_type="handwritten", router_signals={},
            engine="fake", ladder=["fake"], n_lines=1, elapsed_engine_s=0.0,
            structured={"medications": [], "labs": [], "diagnoses": []},
            verify={"verify_all": True, "fields": []}, review_fields=[],
            session_id="B1", any_verify=True)
        return pr, _Page()

    monkeypatch.setattr(mp, "process_page", fake_process_page)
    summary = mp.run([Path("x.png")], ConsentArtefact(patient_ack=True),
                     cfg=EngineConfig(out_dir=tmp_path))
    assert summary["pages"][0]["any_verify"] is True
    import json
    bundle = json.loads((tmp_path / "bundle.json").read_text(encoding="utf-8"))
    assert bundle["entry"][0]["resource"]["status"] == "preliminary"


# ------------------------------------------------------- 2. voting config

def _lines():
    return [TextBox("Tab Amoxicillin 500mg", (10, 10, 200, 40), 0.80)]


def test_vote_bonus_and_penalty_are_configurable():
    primary = EngineResult("rapidocr", lines=_lines())
    fallback = EngineResult("tesseract", lines=_lines())
    default = field_vote(primary, fallback)[0]
    assert default.agree and default.voted_conf == 0.95          # 0.80 + 0.15

    cfg = EngineConfig(vote_bonus_agree=0.40, vote_penalty_disagree=0.10)
    tuned = field_vote(primary, fallback, cfg)[0]
    assert tuned.voted_conf == 1.0                               # capped

    disagree = EngineResult("tesseract", lines=[TextBox("Tab Paracetamol", (10, 10, 200, 40), 0.80)])
    d = field_vote(primary, disagree, cfg)[0]
    assert not d.agree and d.voted_conf == 0.70                  # 0.80 - 0.10


def test_vote_iou_min_is_configurable():
    primary = EngineResult("rapidocr", lines=_lines())
    # same text but only ~half overlap -> no match under the default threshold
    far = EngineResult("tesseract", lines=[TextBox("Tab Amoxicillin 500mg",
                                                   (150, 10, 400, 40), 0.80)])
    assert field_vote(primary, far)[0].agree is False
    loose = EngineConfig(vote_iou_min=0.05)
    assert field_vote(primary, far, loose)[0].agree is True


# ------------------------------------------------------- 3. router thresholds

def test_router_uses_config_low_conf_cutoff():
    lines = [TextBox("text", (0, 0, 100, 20), 0.62)] * 4
    result = EngineResult("rapidocr", lines=lines)
    # default cutoff 0.60 -> nothing is low-confidence
    assert classify(result, EngineConfig())["page_type"] == "printed"
    # a stricter cutoff (0.70) makes every line "low-conf" and the avg low
    strict = EngineConfig(low_conf_cutoff=0.70,
                          handwriting_if_avg_line_conf_below=0.70)
    assert classify(result, strict)["page_type"] == "handwritten"

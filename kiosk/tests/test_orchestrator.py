"""Encounter integration tests: A -> B -> merge -> emit under the scheduler."""
from __future__ import annotations

import sys
from contextlib import nullcontext
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for _sub in ("module-a", "module-b", "module-c", "."):
    sys.path.insert(0, str(ROOT / _sub))

from kiosk.config import KioskConfig
from kiosk.orchestrator import Encounter


def _simulated_encounter(profile: KioskConfig):
    enc = Encounter(kiosk_cfg=profile)
    return enc


def test_simulated_encounter_emits_physician_bundle():
    from media.cli import DEMO_SCRIPT
    from medic.fixtures import DEMO_DOCUMENTS

    enc = _simulated_encounter(KioskConfig.eight_gb())
    result = enc.run(session_id="A-T1", consent_ref="tok", script=DEMO_SCRIPT,
                     language="rom", documents=DEMO_DOCUMENTS)

    assert result.opconsultrecord["resourceType"] == "Bundle"
    counts = result.case.counts()
    assert counts["meds"] >= 2
    assert counts["red_flags"] >= 1
    assert result.stages["by_stage"]["A_NLU"] >= 1
    assert result.degradations == []


def test_4gb_profile_degrades_but_still_produces_a_summary():
    from media.cli import DEMO_SCRIPT
    from medic.fixtures import DEMO_DOCUMENTS

    enc = _simulated_encounter(KioskConfig.four_gb())
    result = enc.run(session_id="A-T3", consent_ref="tok", script=DEMO_SCRIPT,
                     language="rom", documents=DEMO_DOCUMENTS)
    assert "A_NLU" in result.degradations          # LLM slot not affordable
    assert result.history_bundle["schema"] == "medikiosk-history-bundle/1"
    assert result.opconsultrecord["resourceType"] == "Bundle"


def test_document_pages_acquire_a_lease_each(monkeypatch):
    from media.cli import DEMO_SCRIPT

    def fake_run(image_paths, consent, cfg=None, persist_raw=None,
                 out_dir=None, page_guard=None):
        assert page_guard is not None
        for _ in image_paths:
            with page_guard():
                pass
        return {"n_pages": len(image_paths), "session_id": "B1",
                "pages": [{"image": "x",
                           "structured": {"medications": [], "labs": [],
                                          "diagnoses": []},
                           "verify": {"verify_all": False, "fields": []}}
                          for _ in image_paths],
                "bundle": None, "fhir_validation_errors": [],
                "engines_used": ["fake"], "pages_needing_verify": 0}

    monkeypatch.setattr("medib.pipeline.run", fake_run)
    from medib.intake import ConsentArtefact

    enc = _simulated_encounter(KioskConfig.eight_gb())
    result = enc.run(session_id="A-T2", consent_ref="tok", script=DEMO_SCRIPT,
                     language="rom", image_paths=[Path("a.png"), Path("b.png")],
                     consent=ConsentArtefact(patient_ack=True))
    assert result.stages["by_stage"]["B_OCR"] == 2
    assert result.document_summary["n_pages"] == 2


def test_medib_run_invokes_page_guard_per_page(monkeypatch, tmp_path):
    from medib import pipeline as mp
    from medib.config import EngineConfig
    from medib.intake import ConsentArtefact

    seen: list[str] = []

    class _Page:
        persist_raw = False

        def __init__(self, path):
            self._path = path

        def meta(self):
            return {"image": str(self._path)}

    def fake_process_page(image_path, consent, cfg=None, persist_raw=None):
        seen.append(str(image_path))
        pr = mp.PageResult(
            image_path=str(image_path), page_type="printed", router_signals={},
            engine="fake", ladder=["fake"], n_lines=1, elapsed_engine_s=0.01,
            structured={"medications": [{"name": "Amoxicillin", "dose": "500mg",
                                         "frequency": "BD", "duration": "5 days",
                                         "_src_conf": 0.99}],
                        "labs": [], "diagnoses": []},
            verify={"verify_all": False, "fields": []}, review_fields=[],
            session_id="B1", any_verify=False,
            ocr_text="Tab Amoxicillin 500mg BD x 5 days")
        return pr, _Page(image_path)

    monkeypatch.setattr(mp, "process_page", fake_process_page)
    guards: list[int] = []
    cfg = EngineConfig(out_dir=tmp_path)
    summary = mp.run([Path("a.png"), Path("b.png")],
                     ConsentArtefact(patient_ack=True), cfg=cfg,
                     page_guard=lambda: guards.append(1) or nullcontext())
    assert summary["n_pages"] == 2
    assert len(guards) == 2
    assert len(seen) == 2
    assert (tmp_path / "run_summary.json").exists()

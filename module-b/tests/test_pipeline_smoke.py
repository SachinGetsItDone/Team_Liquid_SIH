"""Smoke test: synthetic pages through the real pipeline (RapidOCR CPU).

Skipped automatically when RapidOCR models cannot be fetched or the page
fixtures are absent. Dev machine has no Tesseract binary, so the fallback
rung is exercised only in unit tests with mocked engine results."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TOOLS = Path(__file__).resolve().parents[1] / "tools" / "pages"
PAGES = sorted(TOOLS.glob("print_*.png"))


@pytest.fixture(scope="module")
def first_page_result():
    if not PAGES:
        pytest.skip("synthetic pages not generated - run tools/make_synthetic_pages.py")
    from medib.config import config_from_env
    from medib.intake import ConsentArtefact
    from medib.pipeline import process_page
    cfg = config_from_env()
    cfg.tesseract_enabled = False          # not installed on dev machine
    try:
        result, _ = process_page(PAGES[0], ConsentArtefact(patient_ack=True), cfg)
    except Exception as e:                 # noqa: BLE001 - model download may fail offline
        pytest.skip(f"RapidOCR unavailable: {e}")
    return result


def test_engine_produced_lines(first_page_result):
    assert first_page_result.engine == "rapidocr"
    assert first_page_result.n_lines > 0


def test_router_classifies_synthetic_printed(first_page_result):
    assert first_page_result.page_type in ("printed", "lab_table")


def test_watchdog_ladder_starts_with_primary(first_page_result):
    assert first_page_result.ladder[0] == "rapidocr"


def test_review_payload_structure(first_page_result):
    d = first_page_result.to_dict()
    assert "review_fields" in d and "structured" in d
    for f in d["review_fields"]:
        assert set(f) >= {"field", "value", "verify", "reason", "bbox"}


def test_end_to_end_run_emits_valid_bundle(tmp_path):
    if not PAGES:
        pytest.skip("no fixtures")
    from medib.config import config_from_env
    from medib.intake import ConsentArtefact
    from medib.pipeline import run
    cfg = config_from_env()
    cfg.tesseract_enabled = False
    try:
        summary = run(PAGES[:2], ConsentArtefact(patient_ack=True), cfg=cfg,
                      out_dir=tmp_path)
    except Exception as e:                 # noqa: BLE001
        pytest.skip(f"RapidOCR unavailable: {e}")
    assert summary["n_pages"] == 2
    assert summary["bundle"] and not summary["fhir_validation_errors"]
    assert (tmp_path / "session_manifest.json").exists()
    assert (tmp_path / "physician_review.json").exists()
    assert (tmp_path / "bundle.json").exists()

"""Benchmark harness shape test (single quick run, simulated documents)."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
for _sub in ("module-a", "module-b", "module-c", "."):
    sys.path.insert(0, str(ROOT / _sub))

from kiosk.benchmark import run_benchmark


def test_benchmark_report_shape():
    report = run_benchmark(profile="8gb", runs=1)
    assert report["profile"] == "p-hospital"
    assert report["simulated_documents"] is True
    for stage in ("A_capture", "B_documents", "merge_emit", "total"):
        assert stage in report["stages_s"]
        assert report["stages_s"][stage]["p50"] >= 0.0
    assert report["counts"]["socrates_captured"] == 8
    assert report["peak_rss_mb"] is None or report["peak_rss_mb"] > 0


def test_benchmark_4gb_reports_degradation():
    report = run_benchmark(profile="4gb", runs=1)
    assert report["profile"] == "reduced-4gb"
    assert "A_NLU" in report["degradations"]

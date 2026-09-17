"""Combined A+B profile benchmark (doc/23 section 5.1).

Measures per-stage wall time and peak RSS for a full encounter on a chosen RAM
profile, so AB-D2/D4 (compute placement, LLM residency) and the 4-vs-8 GB sizing
can be decided from numbers instead of assumptions.

    python -m kiosk.benchmark --runs 5 --out out/
    python -m kiosk.benchmark --profile 4gb --runs 5
    python -m kiosk.benchmark --images scans/*.png --runs 3

NOTE: this measures the *host* it runs on, which is not a kiosk-class machine.
It is a methodology + harness; the production numbers must be re-taken on real
kiosk hardware (doc/23 section 5.1). Simulated documents are used unless
`--images` is passed.
"""
from __future__ import annotations

import argparse
import json
import statistics
import threading
from pathlib import Path

from . import paths  # noqa: F401  (puts module-a/b/c on sys.path)


def _pct(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 4)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100) * (len(ordered) - 1)))))
    return round(ordered[idx], 4)


class _RssSampler:
    """Samples process RSS in a background thread; peak is the max seen."""

    def __init__(self, interval: float = 0.02):
        self.interval = interval
        self.peak_mb = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        try:
            import psutil  # noqa: F401
            self._available = True
        except Exception:
            self._available = False

    def _loop(self) -> None:
        import psutil
        proc = psutil.Process()
        def sample():
            nonlocal_peak = proc.memory_info().rss / (1024 * 1024)
            if nonlocal_peak > self.peak_mb:
                self.peak_mb = nonlocal_peak
        sample()
        while not self._stop.wait(self.interval):
            sample()

    def start(self) -> None:
        if not self._available:
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._thread is not None:
            self._stop.set()
            self._thread.join(1.0)


def run_benchmark(*, profile: str = "8gb", runs: int = 3, images=None,
                  out: Path | None = None) -> dict:
    from media.cli import DEMO_SCRIPT
    from medic.fixtures import DEMO_DOCUMENTS

    from .config import KioskConfig
    from .orchestrator import Encounter

    kcfg = KioskConfig.four_gb() if profile == "4gb" else KioskConfig.eight_gb()
    image_paths = [Path(p) for p in images] if images else None
    consent = None
    if image_paths:
        from medib.intake import ConsentArtefact
        consent = ConsentArtefact(patient_ack=True)

    per_run: list[dict] = []
    peak_rss = 0.0
    last_counts: dict = {}
    last_degradations: list[str] = []
    last_scheduler: dict = {}

    for i in range(runs):
        enc = Encounter(kiosk_cfg=kcfg)
        sampler = _RssSampler()
        sampler.start()
        try:
            result = enc.run(session_id=f"BENCH-{i}", consent_ref="bench-token",
                             script=DEMO_SCRIPT, language="rom",
                             image_paths=image_paths, consent=consent,
                             documents=None if image_paths else DEMO_DOCUMENTS)
        finally:
            sampler.stop()
        peak_rss = max(peak_rss, sampler.peak_mb)
        row = dict(result.timings)
        row["total"] = round(sum(result.timings.values()), 4)
        per_run.append(row)
        last_counts = result.case.counts()
        last_degradations = list(result.degradations)
        last_scheduler = result.stages

    stage_names = sorted({k for row in per_run for k in row})
    stages = {name: {
        "p50": _pct([r[name] for r in per_run if name in r], 50),
        "p95": _pct([r[name] for r in per_run if name in r], 95),
        "mean": round(statistics.fmean([r[name] for r in per_run if name in r]), 4)
        if any(name in r for r in per_run) else 0.0,
    } for name in stage_names}

    report = {
        "profile": kcfg.profile,
        "runs": runs,
        "simulated_documents": not bool(image_paths),
        "stages_s": stages,
        "peak_rss_mb": round(peak_rss, 1) if peak_rss else None,
        "counts": last_counts,
        "degradations": last_degradations,
        "scheduler": last_scheduler,
    }
    if out is not None:
        out = Path(out)
        out.mkdir(parents=True, exist_ok=True)
        (out / "benchmark.json").write_text(
            json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kiosk.benchmark",
                                     description="A+B encounter benchmark")
    parser.add_argument("--profile", choices=("8gb", "4gb"), default="8gb")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--images", nargs="*", default=None)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args(argv)
    report = run_benchmark(profile=args.profile, runs=args.runs,
                           images=args.images, out=args.out)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

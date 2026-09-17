"""J1 scheduler tests: serialisation, priority preemption, memory watchdog."""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from kiosk.scheduler import (MemoryBudgetExceeded, SingleSlotScheduler, Stage)


def test_single_slot_mutual_exclusion():
    sched = SingleSlotScheduler()
    lease = sched.acquire(Stage.A_NLU)
    assert sched.stats()["active"] == "A_NLU"

    errors = []

    def attempt():
        try:
            with sched.slot(Stage.B_OCR, timeout=0.05):
                pass
        except Exception as exc:                    # noqa: BLE001
            errors.append(type(exc))

    t = threading.Thread(target=attempt)
    t.start()
    t.join(3)
    assert TimeoutError in errors
    lease.release()
    assert sched.stats()["active"] is None


def test_a_preempts_b_at_boundary():
    sched = SingleSlotScheduler()
    order: list[str] = []
    lock = threading.Lock()
    b_held = threading.Event()
    release_b = threading.Event()

    def b_holder():
        with sched.slot(Stage.B_OCR):
            b_held.set()
            release_b.wait(3)

    tb = threading.Thread(target=b_holder)
    tb.start()
    assert b_held.wait(3)

    def worker(stage):
        with sched.slot(stage):
            with lock:
                order.append(stage.name)

    ta = threading.Thread(target=worker, args=(Stage.A_NLU,))
    ta.start()
    time.sleep(0.1)                                 # ensure A is queued first
    tb2 = threading.Thread(target=worker, args=(Stage.B_STRUCTURE,))
    tb2.start()
    time.sleep(0.1)
    release_b.set()
    for t in (ta, tb2, tb):
        t.join(3)
    assert order[0] == "A_NLU"                      # priority, not arrival
    assert order[1] == "B_STRUCTURE"


def test_redflag_bypasses_the_slot():
    sched = SingleSlotScheduler()
    with sched.slot(Stage.B_OCR):
        lease = sched.acquire(Stage.A_REDFLAG)
        assert lease.bypass
        lease.release()
    assert sched.stats()["bypass"] == 1


def test_memory_watchdog_rejects_llm_on_4gb_profile():
    sched = SingleSlotScheduler(total_ram_mb=4096, baseline_mb=1800,
                                reserve_mb=512)     # available 1784 MB
    with pytest.raises(MemoryBudgetExceeded):
        sched.acquire(Stage.A_NLU)                  # 2500 MB
    assert sched.stats()["memory_rejections"] == 1
    with sched.slot(Stage.A_ASR):                   # 1500 MB fits
        assert sched.stats()["available_mb"] >= 0


def test_run_returns_value_and_releases():
    sched = SingleSlotScheduler()
    assert sched.run(Stage.B_OCR, lambda: 41) == 41
    assert sched.stats()["active"] is None
    assert sched.stats()["by_stage"]["B_OCR"] == 1


def test_evictor_runs_under_pressure():
    sched = SingleSlotScheduler(total_ram_mb=8192, baseline_mb=2000,
                                reserve_mb=1024)
    freed = {"v": False}
    sched.claim("blob", 2500)

    def evict():
        freed["v"] = True
        sched.release_claim("blob")
        return True

    sched.register_evictor("blob", evict)
    with sched.slot(Stage.A_ASR, ram_mb=2800):      # needs the blob gone
        pass
    assert freed["v"] and sched.stats()["evictions"] >= 1

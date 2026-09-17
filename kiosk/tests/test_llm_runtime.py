"""J2 shared LLM runtime tests: load-once, idle claim, eviction, budget."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from kiosk.llm_runtime import LLMState, SharedLLMRuntime
from kiosk.scheduler import (MemoryBudgetExceeded, SingleSlotScheduler, Stage)


def _runtime(sched, **kw):
    loads = []
    rt = SharedLLMRuntime(sched, loader=lambda url, model: loads.append(model),
                          **kw)
    return rt, loads


def test_loads_once_across_sequential_leases():
    sched = SingleSlotScheduler()
    rt, loads = _runtime(sched, load_mb=2500)
    with rt.lease(Stage.A_NLU) as url:
        assert url.startswith("http")
    with rt.lease(Stage.B_STRUCTURE):
        pass
    assert rt.load_count == 1 and loads == ["qwen3"]


def test_idle_model_registers_a_reclaimable_claim():
    sched = SingleSlotScheduler()
    rt, _ = _runtime(sched, load_mb=2500)
    with rt.lease(Stage.A_NLU):
        assert "llm" not in sched.stats()["claims"]     # lease accounts for it
    assert sched.stats()["claims"].get("llm") == 2500
    assert rt.unload() is True
    assert sched.stats()["claims"] == {}
    with rt.lease(Stage.A_NLU):
        pass
    assert rt.load_count == 2


def test_idle_model_is_evicted_under_pressure():
    sched = SingleSlotScheduler(total_ram_mb=8192, baseline_mb=2000,
                               reserve_mb=1024)
    rt, _ = _runtime(sched, load_mb=2500)
    with rt.lease(Stage.A_NLU):
        pass
    assert sched.available_mb() == 2668              # 7168 - 2000 - 2500
    with sched.slot(Stage.A_ASR, ram_mb=2800):       # forces eviction
        assert rt.state == LLMState.UNLOADED
    assert sched.stats()["evictions"] >= 1


def test_llm_lease_rejected_on_4gb_profile():
    sched = SingleSlotScheduler(total_ram_mb=4096, baseline_mb=1800,
                               reserve_mb=512)
    rt, _ = _runtime(sched, load_mb=2500)
    with pytest.raises(MemoryBudgetExceeded):
        with rt.lease(Stage.A_NLU):
            pass
    assert rt.state == LLMState.UNLOADED


def test_busy_model_is_not_evicted():
    sched = SingleSlotScheduler()
    rt, _ = _runtime(sched, load_mb=2500, idle_evict=False)
    assert rt.unload() is False                       # never loaded
    rt.ensure_loaded()
    assert rt.unload() is True

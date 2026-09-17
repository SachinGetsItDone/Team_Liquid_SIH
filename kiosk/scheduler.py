"""J1 - Single-slot kiosk scheduler (doc/23 section 3.4).

Exactly one heavy stage holds the kiosk CPU/RAM at a time. Stages request a
lease; the scheduler grants by priority (A preempts B at the next boundary),
runs a memory watchdog, and lets red-flag evaluation bypass the slot entirely
(it is a cheap synchronous rule pass, never queued).

Why this exists: Module A is interactive and latency-critical; Module B is
batch and preemptible. Without arbitration they would co-run ASR + OCR + LLM and
violate the hard constraint (doc/09 section 6) on a ~4-8 GB kiosk.
"""
from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass
from enum import IntEnum


class Stage(IntEnum):
    """Lower value = higher priority."""
    A_REDFLAG = 1
    A_ASR = 2
    A_NLU = 3
    A_TTS = 4
    B_OCR = 5
    B_STRUCTURE = 6
    SYNC_DRAIN = 7


# Default RAM estimates (doc/23 section 2.3). Callers may override per request.
STAGE_RAM_MB = {
    Stage.A_REDFLAG: 1,
    Stage.A_ASR: 1500,
    Stage.A_NLU: 2500,
    Stage.A_TTS: 300,
    Stage.B_OCR: 2200,
    Stage.B_STRUCTURE: 2500,
    Stage.SYNC_DRAIN: 100,
}

# Stages that never take the single slot (they must always be able to run).
BYPASS_STAGES = frozenset({Stage.A_REDFLAG})


class MemoryBudgetExceeded(RuntimeError):
    """Raised when a stage cannot be admitted within the kiosk RAM budget.

    Callers MUST degrade to a safe fallback (deterministic rules, smaller model,
    touch input) - never to a fabricated result and never to a dead kiosk."""


@dataclass
class Lease:
    stage: Stage
    ram_mb: int
    scheduler: "SingleSlotScheduler"
    bypass: bool = False
    _released: bool = False
    _claim_name: str = ""

    def release(self) -> None:
        if not self.bypass:
            self.scheduler._release(self)

    def __enter__(self) -> "Lease":
        return self

    def __exit__(self, *exc) -> None:
        self.release()


@dataclass
class _Waiter:
    stage: Stage
    ram_mb: int
    seq: int
    lease: Lease | None = None
    error: Exception | None = None


class SingleSlotScheduler:
    def __init__(self, total_ram_mb: int = 8192, baseline_mb: int = 2000,
                 reserve_mb: int = 1024, stage_ram_mb: dict | None = None,
                 timeout_s: float = 30.0):
        self.total_ram_mb = total_ram_mb
        self.baseline_mb = baseline_mb
        self.reserve_mb = reserve_mb
        self.stage_ram_mb = dict(stage_ram_mb or STAGE_RAM_MB)
        self.timeout_s = timeout_s

        self._cond = threading.Condition(threading.RLock())
        self._active: Lease | None = None
        self._waiters: list[_Waiter] = []
        self._claims: dict[str, int] = {}
        self._evictors: dict[str, callable] = {}
        self._seq = 0
        self._stats = {"grants": 0, "releases": 0, "bypass": 0,
                       "memory_rejections": 0, "evictions": 0,
                       "by_stage": {s.name: 0 for s in Stage}}

    # ------------------------------------------------------------- accounting
    @property
    def capacity_mb(self) -> int:
        return self.total_ram_mb - self.reserve_mb

    def available_mb(self) -> int:
        with self._cond:
            return self._available_locked()

    def _available_locked(self) -> int:
        return self.capacity_mb - self.baseline_mb - sum(self._claims.values())

    def _fits_locked(self, ram_mb: int) -> bool:
        return ram_mb <= self._available_locked()

    def claim(self, name: str, mb: int) -> None:
        """Register an external RAM claim (e.g. an idle-loaded LLM)."""
        with self._cond:
            self._claims[name] = mb
            self._cond.notify_all()

    def release_claim(self, name: str) -> None:
        # NOTE: does not call _dispatch_locked() - an evictor may invoke this
        # from inside the dispatch loop. Wake the waiters instead; each waiter
        # re-dispatches after it wakes.
        with self._cond:
            self._claims.pop(name, None)
            self._cond.notify_all()

    def register_evictor(self, name: str, fn) -> None:
        """Register a reclaim callback, invoked under memory pressure."""
        with self._cond:
            self._evictors[name] = fn

    def unregister_evictor(self, name: str) -> None:
        with self._cond:
            self._evictors.pop(name, None)

    # --------------------------------------------------------------- acquiring
    def acquire(self, stage: Stage | int, ram_mb: int | None = None,
                timeout: float | None = None) -> Lease:
        stage = Stage(stage)
        ram = self.stage_ram_mb.get(stage, 100) if ram_mb is None else int(ram_mb)

        if stage in BYPASS_STAGES:
            with self._cond:
                self._stats["bypass"] += 1
            return Lease(stage=stage, ram_mb=0, scheduler=self, bypass=True)

        if timeout is None:
            timeout = self.timeout_s
        deadline = None if timeout is None else time.monotonic() + timeout

        with self._cond:
            waiter = _Waiter(stage=stage, ram_mb=ram, seq=self._seq)
            self._seq += 1
            self._waiters.append(waiter)
            self._dispatch_locked()
            while waiter.lease is None and waiter.error is None:
                remaining = None if deadline is None else deadline - time.monotonic()
                if remaining is not None and remaining <= 0:
                    self._waiters.remove(waiter)
                    raise TimeoutError(f"{stage.name}: scheduler wait timed out")
                self._cond.wait(remaining)
                self._dispatch_locked()
            if waiter.error is not None:
                raise waiter.error
            assert waiter.lease is not None
            return waiter.lease

    def _dispatch_locked(self) -> None:
        if self._active is not None:
            return
        while self._waiters:
            waiter = min(self._waiters, key=lambda w: (int(w.stage), w.seq))
            if not self._fits_locked(waiter.ram_mb):
                self._run_evictors_locked()
            if not self._fits_locked(waiter.ram_mb):
                self._waiters.remove(waiter)
                self._stats["memory_rejections"] += 1
                waiter.error = MemoryBudgetExceeded(
                    f"{waiter.stage.name}: needs {waiter.ram_mb}MB, "
                    f"available {self._available_locked()}MB "
                    f"(profile {self.total_ram_mb}MB)")
                self._cond.notify_all()
                continue
            self._waiters.remove(waiter)
            lease = Lease(stage=waiter.stage, ram_mb=waiter.ram_mb,
                          scheduler=self,
                          _claim_name=f"active:{waiter.stage.name}")
            self._claims[lease._claim_name] = waiter.ram_mb
            self._active = lease
            waiter.lease = lease
            self._stats["grants"] += 1
            self._stats["by_stage"][waiter.stage.name] += 1
            self._cond.notify_all()
            return

    def _run_evictors_locked(self) -> None:
        for name, fn in list(self._evictors.items()):
            try:
                freed = fn()
                if freed:
                    self._stats["evictions"] += 1
            except Exception:
                # an evictor must never break scheduling
                continue

    def _release(self, lease: Lease) -> None:
        with self._cond:
            if lease._released:
                return
            lease._released = True
            if self._active is lease:
                self._claims.pop(lease._claim_name, None)
                self._active = None
            self._stats["releases"] += 1
            self._dispatch_locked()
            self._cond.notify_all()

    # ------------------------------------------------------------- convenience
    @contextmanager
    def slot(self, stage: Stage | int, ram_mb: int | None = None,
             timeout: float | None = None):
        lease = self.acquire(stage, ram_mb=ram_mb, timeout=timeout)
        try:
            yield lease
        finally:
            lease.release()

    def run(self, stage: Stage | int, fn, *args, ram_mb: int | None = None,
            timeout: float | None = None, **kwargs):
        with self.slot(stage, ram_mb=ram_mb, timeout=timeout):
            return fn(*args, **kwargs)

    # ---------------------------------------------------------------- reporting
    def stats(self) -> dict:
        with self._cond:
            return {
                "profile_mb": self.total_ram_mb,
                "capacity_mb": self.capacity_mb,
                "baseline_mb": self.baseline_mb,
                "available_mb": self._available_locked(),
                "active": self._active.stage.name if self._active else None,
                "waiting": [w.stage.name for w in self._waiters],
                "claims": dict(self._claims),
                **self._stats,
            }

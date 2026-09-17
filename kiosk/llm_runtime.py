"""J2 - Shared llama.cpp/Qwen3 runtime manager (doc/23 section 4.3).

Module A's NLU and Module B's structurer both want the same Qwen3 model. This
manager makes that one runtime, one lease, one model:
- load on demand, behind a scheduler lease;
- only one consumer at a time (the scheduler already serialises);
- the idle-loaded model registers a RAM claim, and unloads under memory
  pressure so a higher-priority stage can be admitted.

The actual llama-server process is created by an injected `loader`; the default
is a no-op so the integration is testable offline.
"""
from __future__ import annotations

import threading
from contextlib import contextmanager
from enum import Enum


class LLMState(str, Enum):
    UNLOADED = "unloaded"
    LOADED = "loaded"


class SharedLLMRuntime:
    def __init__(self, scheduler, load_mb: int = 2500,
                 base_url: str = "http://127.0.0.1:8080/v1",
                 model: str = "qwen3", loader=None, unloader=None,
                 idle_evict: bool = True, claim_name: str = "llm"):
        self.scheduler = scheduler
        self.load_mb = load_mb
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.idle_evict = idle_evict
        self.claim_name = claim_name
        self._loader = loader or (lambda url, model: None)
        self._unloader = unloader or (lambda: None)
        self._lock = threading.RLock()
        self._refs = 0
        self._loaded = False
        self.load_count = 0
        if idle_evict:
            self.scheduler.register_evictor(claim_name, self.unload)

    @property
    def state(self) -> LLMState:
        with self._lock:
            return LLMState.LOADED if self._loaded else LLMState.UNLOADED

    def ensure_loaded(self) -> None:
        with self._lock:
            if not self._loaded:
                self._loader(self.base_url, self.model)
                self._loaded = True
                self.load_count += 1

    def unload(self) -> bool:
        """Evictor: free the model if no lease is active. Returns True if freed."""
        with self._lock:
            if self._refs > 0 or not self._loaded:
                return False
            self._unloader()
            self._loaded = False
            self.scheduler.release_claim(self.claim_name)
            return True

    def _begin(self) -> None:
        with self._lock:
            self.ensure_loaded()
            self._refs += 1
            # the active lease now accounts for the model's RAM, so drop the
            # idle claim to avoid double-counting
            if self._refs == 1:
                self.scheduler.release_claim(self.claim_name)

    def _end(self) -> None:
        with self._lock:
            self._refs -= 1
            if self._refs == 0 and self._loaded:
                # model stays loaded but reclaimable: register the idle claim
                self.scheduler.claim(self.claim_name, self.load_mb)

    @contextmanager
    def lease(self, stage):
        with self.scheduler.slot(stage, ram_mb=self.load_mb):
            self._begin()
            try:
                yield self.base_url
            finally:
                self._end()

    def endpoint(self) -> str:
        return self.base_url

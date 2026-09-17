"""media - MediKiosk Module A: patient-facing conversational history capture.

Implements the Module A design (doc/09) as production-shaped code:
deterministic dialogue FSM + deterministic red-flag classifier + slot-level
provenance, emitting the `medikiosk-history-bundle/1` contract consumed by
Module C (`module-c/medic/contracts.py`).

Nothing here diagnoses, recommends treatment, or fabricates a field. The
system elicits and structures; the physician owns assessment and plan.
"""
from .contracts import (HISTORY_SCHEMA, SLOT_STATES, SOCRATES_FIELDS,
                        HistoryDraft, RedFlagHit, Slot)
from .fsm import HistoryFSM, Turn
from .redflags import RedFlagEngine
from .session import HistorySession

__all__ = [
    "HISTORY_SCHEMA", "SLOT_STATES", "SOCRATES_FIELDS",
    "HistoryDraft", "RedFlagHit", "Slot",
    "RedFlagEngine", "HistoryFSM", "Turn", "HistorySession",
]

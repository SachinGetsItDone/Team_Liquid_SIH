"""Clinical reference ranges as an external, versioned, clinician-signed table.

The v1 `config.REFERENCE_RANGES` dict is a **placeholder demo table**. Shipping
it as the source of truth for abnormal-value flagging is a clinical-safety gap:
a wrong range produces a wrong patient-facing flag. This module makes the table
external and provenance-carrying, and lets the merger run in a strict mode that
refuses to flag anything read against an unsigned table (never invent a flag,
same posture as "omit rather than invent" in doc/21 §C-C).

Production flow: a clinician signs a JSON table (version + signed_by +
citation), it is loaded here, and `MergerConfig` is built from it. Until then
the placeholder table can be used for demos with `strict_ranges=False`.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

RangesType = dict[str, tuple[float, float, str]]


class RangeTableError(ValueError):
    """Raised when a range table file is malformed."""


@dataclass(frozen=True)
class ReferenceRangeTable:
    version: str
    ranges: RangesType
    signed_by: str | None = None
    citation: str | None = None
    signed_on: str | None = None

    @property
    def is_signed(self) -> bool:
        return bool(self.signed_by and self.signed_by.strip())

    def to_dict(self) -> dict:
        return {
            "version": self.version,
            "signed_by": self.signed_by,
            "signed_on": self.signed_on,
            "citation": self.citation,
            "ranges": {k: list(v) for k, v in self.ranges.items()},
        }

    @staticmethod
    def from_dict(raw: dict) -> "ReferenceRangeTable":
        if not isinstance(raw, dict) or "ranges" not in raw:
            raise RangeTableError("range table must be an object with a 'ranges' map")
        ranges: RangesType = {}
        for name, triple in (raw.get("ranges") or {}).items():
            if not (isinstance(triple, (list, tuple)) and len(triple) == 3):
                raise RangeTableError(
                    f"range {name!r}: expected [low, high, unit]")
            low, high, unit = triple
            if float(low) > float(high):
                raise RangeTableError(f"range {name!r}: low > high")
            ranges[str(name).strip().lower()] = (float(low), float(high), str(unit))
        return ReferenceRangeTable(
            version=str(raw.get("version") or "unversioned"),
            ranges=ranges,
            signed_by=raw.get("signed_by"),
            citation=raw.get("citation"),
            signed_on=raw.get("signed_on"),
        )


def load_ranges(path: Path | str) -> ReferenceRangeTable:
    return ReferenceRangeTable.from_dict(
        json.loads(Path(path).read_text(encoding="utf-8")))


def save_ranges(table: ReferenceRangeTable, path: Path | str) -> Path:
    p = Path(path)
    p.write_text(json.dumps(table.to_dict(), indent=2, ensure_ascii=False),
                 encoding="utf-8")
    return p


def default_table() -> ReferenceRangeTable:
    """The built-in placeholder table (UNSIGNED - demo use only)."""
    from .config import REFERENCE_RANGES
    return ReferenceRangeTable(version="placeholder-2026-09",
                               ranges=dict(REFERENCE_RANGES),
                               signed_by=None,
                               citation="built-in placeholder (not clinical)")

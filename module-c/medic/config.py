"""Module C configuration. Reference ranges are PLACEHOLDER demo values pending
clinician validation - same honesty posture as Module B's engine thresholds
(medib config note / doc/17 section 7.1)."""
from __future__ import annotations

from dataclasses import dataclass, field


# Adult reference ranges used by the C2 merger's abnormality compiler.
# Demo-scale table (the values a physician would sanity-check anyway);
# the production set is clinician-validated and LOINC/NRCeS-bound (doc/07).
REFERENCE_RANGES: dict[str, tuple[float, float, str]] = {
    # name-lowercase: (low, high, unit)
    "hemoglobin": (12.0, 16.0, "g/dL"),
    "hb": (12.0, 16.0, "g/dL"),
    "fasting glucose": (70.0, 100.0, "mg/dL"),
    "fasting blood sugar": (70.0, 100.0, "mg/dL"),
    "hba1c": (4.0, 5.6, "%"),
    "tsh": (0.4, 4.0, "mIU/L"),
    "vitamin d": (30.0, 100.0, "ng/mL"),
}


@dataclass
class MergerConfig:
    # medication reconciliation (C2): normalized-name match threshold
    med_name_match: str = "exact-normalized"     # v1: lowercase alnum only
    # flag dose conflicts between patient statement and document
    flag_dose_conflicts: bool = True
    # reference-range table key (see REFERENCE_RANGES)
    ranges: dict = field(default_factory=lambda: dict(REFERENCE_RANGES))
    # provenance for the range table. `signed_by` empty = unsigned placeholder.
    ranges_version: str = "placeholder-2026-09"
    ranges_signed_by: str | None = None
    ranges_citation: str | None = None
    # when True, an unsigned table produces NO abnormal flags (never invent one)
    strict_ranges: bool = False

    @property
    def ranges_are_signed(self) -> bool:
        return bool(self.ranges_signed_by and self.ranges_signed_by.strip())

    @classmethod
    def from_range_table(cls, table, strict: bool = True) -> "MergerConfig":
        """Build a config from a `ranges.ReferenceRangeTable` (doc/21 §C-C)."""
        return cls(ranges=dict(table.ranges), ranges_version=table.version,
                   ranges_signed_by=table.signed_by,
                   ranges_citation=table.citation, strict_ranges=strict)


CONFIG = MergerConfig()

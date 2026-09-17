"""Reference-range provenance + strict gate (doc/21 section C-C)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from medic.config import MergerConfig
from medic.contracts import load_documents, load_history
from medic.fixtures import DEMO_DOCUMENTS, DEMO_HISTORY
from medic.merger import merge
from medic.ranges import (RangeTableError, ReferenceRangeTable, default_table,
                          load_ranges, save_ranges)

_EXAMPLE = Path(__file__).resolve().parents[1] / "medic" / "ranges.example.json"


def _case(cfg):
    return merge(load_history(DEMO_HISTORY), load_documents(DEMO_DOCUMENTS), cfg)


def test_default_table_is_unsigned():
    table = default_table()
    assert table.is_signed is False
    assert table.version


def test_strict_unsigned_table_never_flags():
    cfg = MergerConfig.from_range_table(default_table(), strict=True)
    case = _case(cfg)
    for lab in case.labs:
        assert lab.abnormal == ""
        assert "not clinician-signed" in lab.range_note


def test_signed_table_flags_normally():
    unsigned = default_table()
    signed = ReferenceRangeTable(version="v1.0", ranges=unsigned.ranges,
                                 signed_by="Dr A. Clinician", signed_on="2026-09-16")
    assert signed.is_signed
    cfg = MergerConfig.from_range_table(signed, strict=True)
    labs = {lab.name.lower(): lab for lab in _case(cfg).labs}
    assert labs["hemoglobin"].abnormal == "low"
    assert labs["hba1c"].abnormal == "high"
    assert "v1.0" in labs["hemoglobin"].range_note


def test_legacy_default_still_flags_for_demo():
    case = _case(MergerConfig())                 # strict_ranges defaults False
    labs = {lab.name.lower(): lab for lab in case.labs}
    assert labs["hemoglobin"].abnormal == "low"


def test_range_table_round_trip(tmp_path):
    table = default_table()
    path = save_ranges(table, tmp_path / "r.json")
    loaded = load_ranges(path)
    assert loaded.version == table.version
    assert loaded.ranges["hemoglobin"] == table.ranges["hemoglobin"]
    assert loaded.is_signed is False


def test_range_table_rejects_malformed():
    with pytest.raises(RangeTableError):
        ReferenceRangeTable.from_dict({"ranges": {"x": [1, 2]}})
    with pytest.raises(RangeTableError):
        ReferenceRangeTable.from_dict({"ranges": {"x": [5.0, 1.0, "u"]}})


def test_example_file_loads_and_is_unsigned():
    table = load_ranges(_EXAMPLE)
    assert table.is_signed is False
    cfg = MergerConfig.from_range_table(table, strict=True)
    for lab in _case(cfg).labs:
        assert lab.abnormal == ""                # unsigned -> never flags

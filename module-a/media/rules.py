"""Red-flag rule spec: external, versioned, clinician-signable.

The rule set is the safety layer, so it must be reviewable and fillable by a
clinician without a code change. This module round-trips `RedFlagRule` objects
to/from JSON, lets a signed spec override or activate rules, and can emit a
template for clinical review.

The shipped spec (`redflags.spec.json`) is the DEMO list (RF-1..RF-4) plus the
8 named production candidates left empty and inactive. A clinician signs by
setting `clinician_signed: true` and supplying `terms`; `RedFlagEngine` with
`require_clinician_signoff=True` then runs only the signed rules.
"""
from __future__ import annotations

import json
from pathlib import Path

from .redflags import ALL_RULES, RedFlagRule


class RuleSpecError(ValueError):
    """Raised when a red-flag spec file is malformed."""


def rule_to_dict(rule: RedFlagRule) -> dict:
    return {
        "id": rule.id,
        "title_en": rule.title_en,
        "title_hi": rule.title_hi,
        "kind": rule.kind,
        "groups": list(rule.groups),
        "terms": {group: list(terms) for group, terms in rule.terms.items()},
        "active": rule.active,
        "clinician_signed": rule.clinician_signed,
        "note": rule.note,
    }


def rules_to_spec(rules=ALL_RULES) -> list[dict]:
    return [rule_to_dict(r) for r in rules]


def rule_from_dict(raw: dict) -> RedFlagRule:
    if not isinstance(raw, dict) or not raw.get("id"):
        raise RuleSpecError("each rule needs an 'id'")
    kind = raw.get("kind", "pending")
    terms = raw.get("terms") or {}
    if not isinstance(terms, dict):
        raise RuleSpecError(f"rule {raw['id']!r}: 'terms' must be group->list")
    active = bool(raw.get("active", False))
    signed = bool(raw.get("clinician_signed", False))
    if active and signed and not terms:
        # a signed active rule with no terms can never match -> likely an error
        raise RuleSpecError(
            f"rule {raw['id']!r}: signed+active rule must define terms")
    return RedFlagRule(
        id=str(raw["id"]),
        title_en=str(raw.get("title_en") or raw["id"]),
        title_hi=str(raw.get("title_hi") or raw["id"]),
        kind=str(kind),
        groups=tuple(raw.get("groups") or ()),
        terms={str(g): tuple(t) for g, t in terms.items()},
        active=active,
        clinician_signed=signed,
        note=str(raw.get("note") or ""),
    )


def rules_from_spec(items: list[dict]) -> tuple[RedFlagRule, ...]:
    if not isinstance(items, list):
        raise RuleSpecError("rule spec must be a JSON list")
    return tuple(rule_from_dict(i) for i in items)


def merge_rules(base=ALL_RULES, overrides: list[dict] | tuple = ()) -> tuple[RedFlagRule, ...]:
    """Override base rules by id; append rules whose id is not in base."""
    by_id = {r.id: r for r in base}
    order = [r.id for r in base]
    for raw in overrides:
        rule = rule_from_dict(raw) if isinstance(raw, dict) else raw
        if rule.id not in by_id:
            order.append(rule.id)
        by_id[rule.id] = rule
    return tuple(by_id[i] for i in order)


def load_rules(path: Path | str) -> tuple[RedFlagRule, ...]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "rules" in raw:
        raw = raw["rules"]
    return rules_from_spec(raw)


def save_spec(rules, path: Path | str, meta: dict | None = None) -> Path:
    payload = {"meta": meta or {}, "rules": rules_to_spec(rules)}
    p = Path(path)
    p.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    return p


def write_template(path: Path | str) -> Path:
    """Emit the current rule set as a review template (unsigned)."""
    return save_spec(ALL_RULES, path, meta={
        "status": "TEMPLATE - not clinician-signed",
        "instructions": ("Set clinician_signed=true and fill 'terms' for a rule "
                         "after dual-physician sign-off, then set active=true. "
                         "Never invent terms without sign-off."),
    })

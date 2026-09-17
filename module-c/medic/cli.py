"""C7 - Pipeline + CLI: HistoryBundle + DocumentSide -> canon -> views ->
OPConsultRecord bundle -> eval report -> files.

Serial, deterministic, zero network. Mirrors medib.pipeline.run's shape
(summary dict + out-dir artefacts) for consistency with Module B."""
from __future__ import annotations

import json
from pathlib import Path

from . import eval_harness, fhir_emitter
from .contracts import DocumentSide, HistoryBundle, load_documents, load_history, load_json
from .merger import merge
from .renderer import render_oldcarts, render_readback, render_soap


def run_case(history: HistoryBundle, documents: DocumentSide,
             out_dir: Path | None = None, practitioner: str = "Practitioner/DEMO",
             attest: bool = False) -> dict:
    """End-to-end Module C run. Returns the summary dict; writes artefacts
    when out_dir is given (soap.json, readback-en/hi.json, oldcarts.json,
    opconsultrecord.json, eval.json, run_summary.json)."""
    case = merge(history, documents)

    soap = render_soap(case)
    oldcarts = render_oldcarts(case)
    readback_en = render_readback(case, "en")
    readback_hi = render_readback(case, "hi")

    bundle = fhir_emitter.build_opconsultrecord(case)
    validation_errors = fhir_emitter.validate_bundle(bundle)
    if attest:
        bundle = fhir_emitter.physician_attest(bundle, practitioner)

    report = eval_harness.evaluate(case)

    summary = {
        "session": history.session_id,
        "doc_session": documents.session_id,
        "counts": case.counts(),
        "alerts": [a.__dict__ for a in case.alerts],
        "fhir_validation_errors": validation_errors,
        "eval": report,
    }

    if out_dir is not None:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        (out / "soap.json").write_text(_j(soap), encoding="utf-8")
        (out / "oldcarts.json").write_text(_j(oldcarts), encoding="utf-8")
        (out / "readback-en.json").write_text(_j(readback_en), encoding="utf-8")
        (out / "readback-hi.json").write_text(_j(readback_hi), encoding="utf-8")
        fhir_emitter.save_bundle(bundle, out)
        (out / "eval.json").write_text(_j(report), encoding="utf-8")
        (out / "run_summary.json").write_text(_j(summary), encoding="utf-8")
        summary["out_dir"] = str(out)
    return summary


def _j(obj) -> str:
    return json.dumps(obj, indent=2, ensure_ascii=False)


def main(argv=None) -> int:
    """CLI: python -m medic.cli [--fixture demo] [--history hb.json --documents rs.json]
    [--out out/] [--attest]"""
    import argparse
    ap = argparse.ArgumentParser(prog="medic",
                                 description="MediKiosk Module C summary generator")
    ap.add_argument("--fixture", default="demo", help="built-in demo case")
    ap.add_argument("--history", type=Path, help="HistoryBundle JSON (else fixture)")
    ap.add_argument("--documents", type=Path,
                    help="DocumentBundle JSON (run_summary or FHIR bundle; else fixture)")
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--attest", action="store_true",
                    help="record the physician attestation (demo practitioner)")
    args = ap.parse_args(argv)

    if args.history and args.documents:
        history = load_history(load_json(args.history))
        documents = load_documents(load_json(args.documents))
    else:
        from .fixtures import demo_case
        history, documents = demo_case()

    summary = run_case(history, documents, out_dir=args.out, attest=args.attest)

    c = summary["counts"]
    print(f"session         : {summary['session']} (+ docs {summary['doc_session']})")
    print(f"canon           : {c['meds']} meds, {c['labs']} labs, {c['dx']} dx, "
          f"{c['socrates_captured']}/8 SOCRATES captured, "
          f"{c['needs_review']} needs_review, {c['not_answered']} not_answered")
    print(f"alerts          : {len(summary['alerts'])} "
          f"({c['red_flags']} red-flag, severity-ordered)")
    for a in summary["alerts"][:6]:
        print(f"  [{a['severity']:8s}] {a['text']}" +
              (f" - {a['detail']}" if a["detail"] else ""))
    print(f"FHIR bundle     : {args.out / 'opconsultrecord.json'}"
          f"{' (VALID)' if not summary['fhir_validation_errors'] else ' (INVALID)'}")
    for e in summary["fhir_validation_errors"][:3]:
        print(f"  validation: {e[:200]}")
    print(f"eval            : {eval_harness.format_report(summary['eval']).splitlines()[0]}")
    print(f"artefacts       : {args.out}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

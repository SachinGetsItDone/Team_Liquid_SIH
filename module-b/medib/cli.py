"""CLI: python -m medib.cli <image-or-dir> --out out/ [--review] [--persist-raw]"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import config_from_env
from .intake import ConsentArtefact
from .pipeline import run


def _collect(target: Path) -> list[Path]:
    if target.is_dir():
        exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
        return sorted(p for p in target.iterdir() if p.suffix.lower() in exts)
    return [target]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="medib", description="MediKiosk Module B pipeline")
    ap.add_argument("target", type=Path, help="image file or directory of images")
    ap.add_argument("--out", type=Path, default=Path("out"))
    ap.add_argument("--persist-raw", action="store_true",
                    help="retain raw scan in DocumentReference (DPDP default is transient)")
    ap.add_argument("--json-only", action="store_true", help="print summary JSON only")
    args = ap.parse_args(argv)

    pages = _collect(args.target)
    if not pages:
        print(f"no images found under {args.target}", file=sys.stderr)
        return 2

    consent = ConsentArtefact(patient_ack=True)   # kiosk UI records this; CLI assumes ack
    cfg = config_from_env()
    summary = run(pages, consent, cfg=cfg,
                  persist_raw=args.persist_raw or None, out_dir=args.out)

    if args.json_only:
        print(json.dumps(summary, indent=2, ensure_ascii=False))
    else:
        print(f"pages processed : {summary['n_pages']}")
        print(f"engines used    : {', '.join(summary['engines_used'])}")
        print(f"verify needed   : {summary['pages_needing_verify']}/{summary['n_pages']} pages")
        print(f"FHIR bundle     : {summary['bundle']}"
              f"{' (VALID)' if not summary['fhir_validation_errors'] else ' (INVALID)'}")
        if summary["fhir_validation_errors"]:
            for e in summary["fhir_validation_errors"][:3]:
                print(f"  validation: {e[:200]}")
        print(f"review payload  : {args.out / 'physician_review.json'}")
        print(f"manifest        : {summary['manifest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Pipeline orchestration: B1 intake -> B2 router -> B3 engines+fallback+voting ->
B4 structurer -> B5 confidence gate -> B6 FHIR bundle -> B7 review payload.

Serial scheduling per doc/17 section 4: one stage resident at a time; watchdog
ladder primary -> fallback -> manual-entry."""
from __future__ import annotations

from contextlib import nullcontext
from dataclasses import dataclass, field
from pathlib import Path

from . import confidence as conf_mod
from . import fhir_emitter, router as router_mod
from .config import EngineConfig, config_from_env
from .engines import RapidOCREngine, TesseractEngine, run_with_fallback
from .intake import ConsentArtefact, load_page
from .structurer import make_structurer
from .voting import field_vote


@dataclass
class PageResult:
    image_path: str
    page_type: str
    router_signals: dict
    engine: str
    ladder: list[str]
    n_lines: int
    elapsed_engine_s: float
    structured: dict
    verify: dict
    review_fields: list[dict] = field(default_factory=list)
    session_id: str = ""
    any_verify: bool = False
    ocr_text: str = ""

    def to_dict(self) -> dict:
        return {
            "image": self.image_path, "page_type": self.page_type,
            "router_signals": self.router_signals, "engine": self.engine,
            "watchdog_ladder": self.ladder, "n_lines": self.n_lines,
            "engine_elapsed_s": round(self.elapsed_engine_s, 3),
            "structured": self.structured, "verify": self.verify,
            "review_fields": self.review_fields, "session_id": self.session_id,
            "any_verify": self.any_verify, "ocr_text": self.ocr_text,
        }


def process_page(image_path: Path | str, consent: ConsentArtefact,
                 cfg: EngineConfig | None = None, persist_raw: bool | None = None
                 ) -> tuple[PageResult, object]:
    """Process one page end-to-end. Returns (PageResult, intake_result)."""
    cfg = cfg or config_from_env()
    page = load_page(image_path, consent)
    if persist_raw is not None:
        page.persist_raw = persist_raw

    # B3 (+B2 needs OCR stats, so engine runs first, then classify)
    primary = RapidOCREngine.instance(getattr(cfg, "ocr_lang", "hi")) if cfg.rapidocr_enabled else None
    fallback = TesseractEngine(cfg.tesseract_langs) if cfg.tesseract_enabled else None
    if primary is None:
        raise RuntimeError("no primary OCR engine configured")
    result, ladder = run_with_fallback(page.image, primary, fallback)

    route = router_mod.classify(result, cfg)
    page_type = route["page_type"]
    is_handwritten = page_type == "handwritten"

    # B3 voting (only when both engines produced output)
    votes = field_vote(result, fallback, cfg) if (result.engine == "rapidocr" and fallback
                                                  and fallback.available() and result.ok) else []
    line_fields = conf_mod.gate_votes(votes, cfg, is_handwritten) if votes else []

    # B4 structurer
    structurer = make_structurer(cfg)
    structured = structurer.structure(result) if result.ok else {}
    verify = conf_mod.gate_structured(structured, cfg, is_handwritten)

    review_fields = ([f.to_review() for f in line_fields] +
                     verify.get("fields", []))
    any_verify = bool(review_fields) and any(f["verify"] for f in review_fields)

    pr = PageResult(
        image_path=str(page.image_path), page_type=page_type,
        router_signals=route["signals"], engine=result.engine, ladder=ladder,
        n_lines=len(result.lines), elapsed_engine_s=result.elapsed_s,
        structured=structured, verify=verify, review_fields=review_fields,
        session_id=page.session_id, any_verify=any_verify,
        ocr_text=result.full_text(),
    )
    return pr, page


def run(image_paths: list[Path], consent: ConsentArtefact, cfg: EngineConfig | None = None,
        persist_raw: bool | None = None, out_dir: Path | None = None,
        page_guard=None) -> dict:
    """Process pages, emit FHIR bundle + review payload + manifest. Returns summary dict.

    `page_guard` is an optional zero-argument callable returning a context
    manager held around each page. The kiosk runtime passes a single-slot
    scheduler lease here so Module A can preempt Module B at a page boundary
    (doc/23 section 3.4) without Module B knowing about the scheduler."""
    from .intake import session_manifest
    cfg = cfg or config_from_env()
    out = out_dir or cfg.out_dir

    pages, results = [], []
    for p in image_paths:
        guard = page_guard() if page_guard is not None else nullcontext()
        with guard:
            pr, page = process_page(p, consent, cfg, persist_raw)
        pages.append(page)
        results.append(pr)

    manifest = session_manifest(pages, Path(out))
    if not results:
        return {"n_pages": 0, "pages": [], "manifest": str(manifest), "bundle": None,
                "fhir_validation_errors": [], "engines_used": [], "pages_needing_verify": 0}

    # multi-document session: merge all pages into one record (doc/17 B6)
    any_verify = any(r.any_verify for r in results)
    merged = {
        "session_id": results[0].session_id,
        "structured": {
            k: [dict(item) for r in results for item in r.structured.get(k, [])]
            for k in ("medications", "labs", "diagnoses")
        },
        # any_verify is stored INSIDE verify because fhir_emitter.build_bundle
        # reads verify["any_verify"] to decide preliminary vs final; keeping it
        # only at the top level made every bundle status "final" (audit finding,
        # research log 2026-09-16). It is also mirrored at the top level for the
        # run summary.
        "verify": {"verify_all": any(r.verify.get("verify_all") for r in results),
                   "any_verify": any_verify,
                   "fields": [f for r in results for f in r.verify.get("fields", [])]},
        "any_verify": any_verify,
    }
    persist = pages[0].persist_raw if persist_raw is None else persist_raw
    bundle = fhir_emitter.build_bundle(merged, Path(results[0].image_path),
                                       persist_raw=persist)
    validation_errors = fhir_emitter.validate_bundle(bundle)
    bundle_path = fhir_emitter.save_bundle(bundle, Path(out))

    summary = {
        "n_pages": len(results),
        "pages": [r.to_dict() for r in results],
        "manifest": str(manifest),
        "bundle": str(bundle_path) if bundle_path else None,
        "fhir_validation_errors": validation_errors,
        "engines_used": sorted({r.engine for r in results}),
        "pages_needing_verify": sum(1 for r in results if r.any_verify),
    }
    (Path(out) / "run_summary.json").write_text(
        _json(summary), encoding="utf-8")
    (Path(out) / "physician_review.json").write_text(
        _json({"pages": [{"image": r.image_path, "fields": r.review_fields} for r in results]}),
        encoding="utf-8")
    return summary


def _json(obj) -> str:
    import json
    return json.dumps(obj, indent=2, ensure_ascii=False)

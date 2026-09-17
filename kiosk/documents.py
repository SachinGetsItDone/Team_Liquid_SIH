"""Module B integration: real `medib` document digitisation.

Two intake paths, both real:

- `ingest_images` runs the actual `medib.pipeline.run` OCR + structurer +
  confidence gate on uploaded page images. Consent is enforced: Module B's
  intake gate refuses to extract without an acknowledged consent artefact, and
  this wrapper refuses to synthesise one unless the session carries a consent
  reference.
- `accept_run_summary` accepts a genuine Module B run_summary (e.g. produced on
  the edge node) so the kiosk does not have to re-OCR documents it already has.

The kiosk never invents structured values: whatever Module B outputs (with its
per-field verify states) is what Module C merges.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from .paths import uploads_dir


class DocumentError(RuntimeError):
    pass


def _ensure_image(path: Path, workdir: Path) -> list[Path]:
    """Accept common image formats; convert a PDF to page images when possible."""
    suffix = path.suffix.lower()
    if suffix in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"):
        return [path]
    if suffix == ".pdf":
        try:
            import pypdfium2 as pdfium  # optional dependency
        except Exception as exc:  # pragma: no cover - depends on host
            raise DocumentError(
                "PDF intake needs the optional 'pypdfium2' package; upload an image instead"
            ) from exc
        out: list[Path] = []
        pdf = pdfium.PdfDocument(str(path))
        for i in range(len(pdf)):
            page = pdf[i]
            bitmap = page.render(scale=2)
            pil = bitmap.to_pil()
            dest = workdir / f"{path.stem}-p{i + 1}.png"
            pil.save(dest)
            out.append(dest)
        if not out:
            raise DocumentError("PDF contained no pages")
        return out
    raise DocumentError(f"unsupported document type {suffix!r}")


def ingest_images(paths: list[Path], consent_ref: str, session_id: str,
                  language: str = "en", persist_raw: bool = False) -> dict:
    """Run the real Module B pipeline over the given page images."""
    if not consent_ref:
        raise DocumentError("refusing to extract: session has no consent reference")

    from medib.intake import ConsentArtefact
    from medib import pipeline as medib_pipeline

    workdir = uploads_dir() / session_id
    workdir.mkdir(parents=True, exist_ok=True)

    pages: list[Path] = []
    for p in paths:
        pages.extend(_ensure_image(Path(p), workdir))
    if not pages:
        raise DocumentError("no pages to process")

    consent = ConsentArtefact(patient_ack=True, language=language)
    out_dir = workdir / "out"
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = medib_pipeline.run(pages, consent, persist_raw=persist_raw,
                                 out_dir=out_dir)
    # keep a copy of the run summary next to the session for auditability
    import json
    (workdir / "run_summary.json").write_text(
        json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    return summary


def accept_run_summary(run_summary: dict) -> dict:
    """Validate and pass through a Module B run_summary produced elsewhere."""
    if not isinstance(run_summary, dict):
        raise DocumentError("run_summary must be a JSON object")
    if "pages" not in run_summary and "structured" not in run_summary:
        raise DocumentError(
            "run_summary must contain 'pages' (per-page results) or 'structured'"
        )
    return run_summary


def discard_uploads(session_id: str) -> None:
    """Crypto-erasure seam: remove transient uploads for a session."""
    d = uploads_dir() / session_id
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)

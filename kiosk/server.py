"""MediKiosk kiosk API + static frontend (FastAPI).

Run:  python -m kiosk.server        (from the repository root)
      uvicorn kiosk.server:app --host 0.0.0.0 --port 8080

The server is the thin-kiosk runtime: it serves the patient and physician
surfaces and exposes the real Module B / Module C pipelines over HTTP. It runs
with zero outbound network calls.
"""
from __future__ import annotations

import base64
import binascii
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import services as svc
from .config_loader import ConfigError
from .paths import WEB_DIR, uploads_dir
from .store import STORE

app = FastAPI(title="MediKiosk kiosk", version="1.0.0")


# ------------------------------------------------------------------ error map

@app.exception_handler(svc.ServiceError)
async def _service_error(_request: Request, exc: svc.ServiceError):
    return JSONResponse(status_code=exc.status,
                        content={"error": str(exc), "detail": exc.detail})


@app.exception_handler(ConfigError)
async def _config_error(_request: Request, exc: ConfigError):
    return JSONResponse(status_code=500, content={"error": f"config error: {exc}"})


# -------------------------------------------------------------------- meta API

@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True}


@app.get("/api/config")
def get_config() -> dict:
    return svc.public_config()


@app.get("/api/interview")
def get_interview() -> dict:
    return svc.interview_schema()


@app.get("/api/interview/options/{turn_id}")
def get_options(turn_id: str, complaint: str = "general") -> dict:
    return {"turn_id": turn_id, "options": svc.options_for(turn_id, complaint)}


# ----------------------------------------------------------------- sessions API

@app.post("/api/sessions")
def create_session(payload: dict) -> dict:
    return svc.create_session(payload)


@app.get("/api/sessions")
def list_sessions(limit: int = 100) -> list[dict]:
    return svc.physician_queue(limit=limit)


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str) -> dict:
    return svc.get_session(session_id)


@app.put("/api/sessions/{session_id}/answers")
def put_answers(session_id: str, payload: dict) -> dict:
    return svc.save_answers(session_id, payload.get("answers") or {})


@app.post("/api/sessions/{session_id}/history")
def post_history(session_id: str) -> dict:
    return svc.finalize_history(session_id)


@app.post("/api/sessions/{session_id}/safety")
def post_safety(session_id: str) -> dict:
    return svc.preview_red_flags(session_id)


@app.post("/api/sessions/{session_id}/asr")
async def post_asr(session_id: str, request: Request) -> dict:
    """Transcribe browser-captured WAV audio with the real Module A ASR."""
    body = await request.json()
    return svc.transcribe_audio(session_id, body.get("audio_b64") or "")


@app.get("/api/speech")
def get_speech() -> dict:
    return svc.speech_svc.capabilities()


@app.post("/api/speech/tts")
async def post_tts(request: Request) -> Response:
    """Synthesize text to a WAV stream with the real Module A OS TTS."""
    body = await request.json()
    wav = svc.synthesize_speech(body.get("text") or "", body.get("lang") or "hi")
    return Response(content=wav, media_type="audio/wav")


@app.get("/api/sessions/{session_id}/history")
def get_history(session_id: str) -> dict:
    record = svc.get_session(session_id)
    if not record.get("history"):
        return JSONResponse(status_code=404, content={"error": "history not finalized"})
    return record["history"]


@app.post("/api/sessions/{session_id}/documents")
async def post_documents(session_id: str, request: Request) -> dict:
    """Base64 image upload: {"images": [{"filename":..., "content_b64":...}]}.

    Base64-in-JSON avoids a multipart dependency in the kiosk runtime; the
    kiosk scanner/camera already hands the app image bytes. A genuine Module B
    run_summary can be posted to /documents/bundle instead."""
    body = await request.json()
    images = body.get("images") or []
    if not images:
        raise svc.ServiceError("no images supplied", 422)

    limits = svc.cfg.app_config()["limits"]
    if len(images) > limits["max_documents"]:
        raise svc.ServiceError(f"at most {limits['max_documents']} documents per session", 413)

    workdir = uploads_dir() / session_id / "incoming"
    workdir.mkdir(parents=True, exist_ok=True)

    paths: list[Path] = []
    total = 0
    for i, item in enumerate(images):
        name = _safe_name(item.get("filename") or f"page-{i + 1}.png")
        try:
            blob = base64.b64decode(item.get("content_b64") or "", validate=True)
        except (binascii.Error, ValueError):
            raise svc.ServiceError(f"image {name!r} is not valid base64", 422)
        total += len(blob)
        if total > limits["max_document_bytes"]:
            raise svc.ServiceError("uploaded documents exceed the size limit", 413)
        dest = workdir / name
        dest.write_bytes(blob)
        paths.append(dest)

    return svc.ingest_documents(session_id, image_paths=paths)


@app.post("/api/sessions/{session_id}/documents/bundle")
async def post_documents_bundle(session_id: str, request: Request) -> dict:
    body = await request.json()
    run_summary = body.get("run_summary") or body
    return svc.ingest_documents(session_id, run_summary=run_summary)


# ------------------------------------------------------------------ summary API

@app.post("/api/sessions/{session_id}/summary")
def post_summary(session_id: str) -> dict:
    return svc.generate_summary(session_id)


@app.get("/api/sessions/{session_id}/summary")
def get_summary(session_id: str) -> dict:
    return svc.get_summary(session_id)


@app.post("/api/sessions/{session_id}/attest")
def post_attest(session_id: str, payload: dict) -> dict:
    return svc.attest(
        session_id,
        practitioner_ref=payload.get("practitioner_ref") or "Practitioner/UNKNOWN",
        actor=payload.get("actor") or "physician",
        resolved_fids=payload.get("resolved_fids") or [],
    )


@app.post("/api/sessions/{session_id}/edit")
def post_edit(session_id: str, payload: dict) -> dict:
    return svc.apply_edit(
        session_id,
        fid=payload.get("fid") or "",
        value=payload.get("value") or "",
        actor=payload.get("actor") or "physician",
    )


@app.post("/api/sessions/{session_id}/erase")
def post_erase(session_id: str) -> dict:
    return svc.erase_session(session_id)


def _safe_name(name: str) -> str:
    keep = "".join(c for c in name if c.isalnum() or c in "._-")
    return keep[:80] or "page.png"


# -------------------------------------------------------------------- static UI

@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


@app.get("/physician")
def physician() -> FileResponse:
    return FileResponse(WEB_DIR / "physician.html")


app.mount("/static", StaticFiles(directory=str(WEB_DIR)), name="static")


def main() -> None:
    import uvicorn
    uvicorn.run("kiosk.server:app", host="127.0.0.1", port=8080, reload=False)


if __name__ == "__main__":
    main()

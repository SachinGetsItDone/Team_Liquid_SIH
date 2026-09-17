"""File-backed session store with atomic writes.

Production notes (doc/19): the kiosk tier is transient and encrypts at rest
with SQLCipher; this store is the seam for that. It writes one JSON document
per session atomically (temp file + os.replace) so a power cut never leaves a
half-written record, and it is safe for the single-process server that runs
on a kiosk. Swapping in SQLCipher later means re-implementing this class, not
its callers.
"""
from __future__ import annotations

import json
import os
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path

from .paths import sessions_dir

_INDEX_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_session_id() -> str:
    """Kiosk-local, sortable, collision-resistant session id."""
    stamp = datetime.now(timezone.utc).strftime("%y%m%d%H%M%S")
    return f"A{stamp}{secrets.token_hex(2).upper()}"


class SessionStore:
    def __init__(self, root: Path | None = None):
        self.root = Path(root) if root else sessions_dir()
        self.root.mkdir(parents=True, exist_ok=True)
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    # ------------------------------------------------------------------ paths
    def _path(self, session_id: str) -> Path:
        safe = "".join(c for c in session_id if c.isalnum() or c in "-_")
        if not safe or safe != session_id:
            raise ValueError(f"invalid session id: {session_id!r}")
        return self.root / f"{safe}.json"

    def _lock(self, session_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks.setdefault(session_id, threading.Lock())

    # ---------------------------------------------------------------- write
    def save(self, record: dict) -> dict:
        sid = record["session_id"]
        record["updated_at"] = now_iso()
        path = self._path(sid)
        payload = json.dumps(record, ensure_ascii=False, indent=2)
        with self._lock(sid):
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, path)  # atomic on Windows and POSIX
        return record

    def create(self, session_id: str, **fields) -> dict:
        if self.exists(session_id):
            raise FileExistsError(session_id)
        record = {
            "session_id": session_id,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "status": "draft",
            "answers": {},
            "history": None,
            "documents": None,
            "documents_raw": None,
            "summary": None,
            "attestation": None,
            "audit": [],
        }
        record.update(fields)
        return self.save(record)

    def append_audit(self, record: dict, actor: str, action: str, detail: str = "") -> None:
        record.setdefault("audit", []).append(
            {"ts": now_iso(), "actor": actor, "action": action, "detail": detail}
        )

    # ----------------------------------------------------------------- read
    def get(self, session_id: str) -> dict | None:
        path = self._path(session_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"session {session_id} is corrupt: {exc}") from exc

    def exists(self, session_id: str) -> bool:
        return self._path(session_id).exists()

    def list(self, limit: int = 100) -> list[dict]:
        records = []
        for path in self.root.glob("A*.json"):
            try:
                records.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        records.sort(key=lambda r: r.get("created_at", ""), reverse=True)
        return records[:limit]


STORE = SessionStore()

"""Headless-browser smoke test for the kiosk and physician surfaces.

Starts the real server, drives the patient flow far enough to prove the UI is
config-driven and boots without console errors, seeds a complete session over
the API, then verifies the physician summary + attestation gate render.

Run:  python kiosk/tests/browser_smoke.py
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PORT = 8123
BASE = f"http://127.0.0.1:{PORT}"


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def put(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


def seed_session() -> str:
    s = post("/api/sessions", {
        "language": "en", "respondent": {"role": "patient"},
        "visit": {"type": "new"}, "notice_acknowledged": True})
    sid = s["session_id"]
    put(f"/api/sessions/{sid}/answers", {"answers": {
        "complaint_id": "chest",
        "narrative": {"text": "seene mein dard aur saans phool rahi hai"},
        "socrates.severity": {"value": 8},
        "socrates.associations": {"values": ["breathless"]},
    }})
    post(f"/api/sessions/{sid}/documents/bundle", {"run_summary": {
        "session_id": "B-TEST",
        "pages": [{"image": "hp.png", "structured": {
            "medications": [{"name": "Metformin", "dose": "500", "frequency": "BD",
                             "_src_conf": 0.52, "_verify": True}],
            "labs": [], "diagnoses": []},
            "verify": {"verify_all": True, "fields": []}}],
    }})
    post(f"/api/sessions/{sid}/history", {})
    post(f"/api/sessions/{sid}/summary", {})
    return sid


def main() -> int:
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "kiosk.server:app",
         "--host", "127.0.0.1", "--port", str(PORT), "--log-level", "warning"],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(40):
            try:
                urllib.request.urlopen(BASE + "/healthz", timeout=1)
                break
            except Exception:
                time.sleep(0.5)

        from playwright.sync_api import sync_playwright
        failures: list[str] = []
        sid = seed_session()

        with sync_playwright() as p:
            browser = p.chromium.launch()
            # ---------- kiosk boot + start ----------
            ctx = browser.new_context(viewport={"width": 1280, "height": 900})
            page = ctx.new_page()
            errors: list[str] = []
            page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(BASE + "/", wait_until="networkidle")
            page.wait_for_selector(".kiosk-header strong")
            brand = page.inner_text(".kiosk-header strong")
            if "MediKiosk" not in brand:
                failures.append(f"brand not rendered (got {brand!r})")
            # language buttons come from config
            if page.locator(".langswitch button").count() < 2:
                failures.append("language switch not rendered from config")
            page.check("#notice-ack")
            page.get_by_role("button", name="Start").click()
            page.wait_for_selector(".ask", timeout=10000)
            # voice lane: server reports speech available -> toggle + per-turn control
            caps = json.loads(urllib.request.urlopen(BASE + "/api/speech").read())
            if caps["tts"]["available"]:
                toggle = page.get_by_role("button", name="Voice: on")
                if toggle.count():
                    toggle.click()  # turn auto-speak off to keep the run fast
                    page.wait_for_selector(".ask", timeout=5000)
                if page.get_by_role("button", name="Hear question").count() == 0:
                    failures.append("voice TTS control not rendered")
            # body-map choices come from config
            if page.locator(".bodymap .choice").count() < 5:
                failures.append("body-map regions not rendered from config")
            page.locator(".bodymap .choice").first.click()
            page.wait_for_timeout(400)
            page.get_by_role("button", name="Next").first.click()
            page.wait_for_timeout(500)
            # the narrative (text) turn should offer a speech-answer control
            if caps["asr"]["available"] and page.get_by_role("button", name="Speak answer").count() == 0:
                failures.append("voice ASR control not rendered on a text turn")
            # step through the interview by answering/choosing where needed
            for _ in range(50):
                if page.locator(".readback-line").count() or page.locator(".handoff-code").count():
                    break
                # acknowledge the urgent banner if it appeared
                ack = page.get_by_role("button", name="Staff: acknowledge and continue")
                if ack.count() and ack.first.is_enabled():
                    try: ack.first.click(timeout=800)
                    except Exception: pass
                # answer the current card if it expects input
                for sel in (".choices .choice", ".scale .btn", ".bodymap .choice"):
                    loc = page.locator(sel)
                    if loc.count() and page.locator(".readback-line").count() == 0:
                        try:
                            loc.first.click(timeout=500)
                        except Exception:
                            pass
                        break
                btn = page.get_by_role("button", name="Next")
                if btn.count() == 0:
                    btn = page.get_by_role("button", name="Finish")
                if btn.count() == 0 or not btn.first.is_enabled():
                    break
                try:
                    btn.first.click(timeout=2500)
                except Exception:
                    break
                page.wait_for_timeout(300)
            reached = (page.locator(".redflag-banner").count() > 0
                       or page.locator(".readback-line").count() > 0
                       or page.locator(".handoff-code").count() > 0
                       or page.locator(".banner.ok").count() > 0)
            if not reached:
                failures.append("kiosk flow did not progress to safety/read-back/handoff")
            if errors:
                failures.append("console errors: " + " | ".join(errors[:3]))
            ctx.close()

            # ---------- physician summary ----------
            ctx2 = browser.new_context(viewport={"width": 1440, "height": 1000})
            page2 = ctx2.new_page()
            perr: list[str] = []
            page2.on("pageerror", lambda e: perr.append(str(e)))
            page2.goto(BASE + f"/physician?session={sid}", wait_until="networkidle")
            page2.wait_for_selector(".worklist .item")
            page2.wait_for_selector("text=Pre-consultation summary", timeout=15000)
            if page2.locator(".alert.red-flag").count() == 0:
                failures.append("no red-flag alert rendered for a red-flag session")
            if page2.get_by_role("button", name="Attest & finalise").count() == 0:
                failures.append("attestation control missing")
            if page2.locator("text=Assessment and Plan are physician-only").count() == 0:
                failures.append("A/P physician-only notice missing")
            if perr:
                failures.append("physician console errors: " + " | ".join(perr[:3]))
            ctx2.close()
            browser.close()

        if failures:
            print("BROWSER SMOKE: FAIL")
            for f in failures:
                print("  -", f)
            return 1
        print("BROWSER SMOKE: PASS (kiosk boot + interview + physician summary + attestation)")
        return 0
    finally:
        server.terminate()


if __name__ == "__main__":
    raise SystemExit(main())

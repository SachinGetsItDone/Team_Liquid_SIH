"""Browser click-through test for module-c-kiosk-demo.html (headless Chromium).
Mirrors the presenter path for BOTH demo cases: case picker -> merge screen
(med reconciliation, abnormal labs, severity-ordered alerts) -> bilingual
read-back -> physician handoff (SOAP + locked A/P + OPConsultRecord +
attestation). Verifies no console errors and key bilingual content."""
from __future__ import annotations

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).parent
PAGE = (HERE / "module-c-kiosk-demo.html").resolve().as_uri()
SHOTS = HERE / "screenshots"
SHOTS.mkdir(exist_ok=True)

errors: list[str] = []


def run_case_flow(page, case_text: str, case_id: str, checks: list[str],
                  shots_prefix: str, handoff_checks: list[str] | None = None) -> None:
    page.wait_for_selector("text=The interview is done. The papers are scanned.",
                           timeout=10_000)
    page.wait_for_selector("text=Choose a demo session", timeout=5_000)
    print("PASS  welcome screen lists demo sessions")
    page.screenshot(path=str(SHOTS / f"{shots_prefix}1-welcome.png"))

    page.click(f"[data-case='{case_id}']")
    page.wait_for_selector("text=Joining your interview with your papers", timeout=5_000)
    for c in checks:
        page.wait_for_selector(f"text={c}", timeout=5_000)
    print(f"PASS  merge screen ({case_id}): reconciliation + labs + alerts render")
    page.screenshot(path=str(SHOTS / f"{shots_prefix}2-merge.png"))

    page.click("[data-goto='readback']")
    page.wait_for_selector("text=Please check your summary", timeout=5_000)
    page.wait_for_selector("[data-rb='0']", timeout=5_000)
    print(f"PASS  read-back renders with provenance ({case_id})")
    page.screenshot(path=str(SHOTS / f"{shots_prefix}3-readback.png"))

    # language toggle: read-back must switch to Hindi labels
    page.click("text=हिन्दी")
    page.wait_for_selector("text=अपना सारांश जाँचें", timeout=5_000)
    page.wait_for_selector("text=तीव्रता", timeout=5_000)
    print(f"PASS  Hindi read-back switches labels ({case_id})")
    page.screenshot(path=str(SHOTS / f"{shots_prefix}3b-readback-hi.png"))
    page.click("text=English")

    page.click("[data-goto='handoff']")
    page.wait_for_selector("text=Physician handoff", timeout=5_000)
    page.wait_for_selector("text=One-page SOAP summary", timeout=5_000)
    page.wait_for_selector("text=physician-only, never generated", timeout=5_000)
    page.wait_for_selector("text=OPConsultRecord", timeout=5_000)
    page.wait_for_selector("text=professional", timeout=5_000)
    for c in (handoff_checks or []):
        page.wait_for_selector(f"text={c}", timeout=5_000)
    print(f"PASS  handoff: SOAP + locked A/P + OPConsultRecord + attestation ({case_id})")
    page.screenshot(path=str(SHOTS / f"{shots_prefix}4-handoff.png"))

    page.click("text=↺ restart demo")
    page.wait_for_selector("text=Choose a demo session", timeout=5_000)
    print(f"PASS  restart returns to case picker ({case_id})")


def main() -> int:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}")
                if m.type == "error" else None)

        page.goto(PAGE)

        # red-flag case: Ramesh (priority triage)
        run_case_flow(
            page, "Ramesh", "ramesh",
            checks=[
                "patient + document",            # Atorvastatin merged provenance
                "Hemoglobin: 10.2 g/dL",         # lab carried with abnormal flag
                "RF-2: chest pain + breathlessness",  # red-flag alert
                "PRIORITY TRIAGE",               # queue state
            ],
            shots_prefix="c1",
        )

        # routine case: Sunita (no papers, green path)
        run_case_flow(
            page, "Sunita", "sunita",
            checks=[
                "no papers brought",             # interview-only canon
                "ROUTINE OPD",                   # queue state
            ],
            handoff_checks=[
                "Radiation",                     # not_answered honesty line in SOAP gaps
            ],
            shots_prefix="c2",
        )

        browser.close()

    if errors:
        print("\nCONSOLE/PAGE ERRORS:")
        for e in errors[:10]:
            print("  " + e[:300])
        return 1
    print("\nBROWSER CLICK-THROUGH: ALL PASSED, zero console errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())

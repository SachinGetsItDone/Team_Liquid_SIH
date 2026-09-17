"""Assemble the MediKiosk prototype into ONE self-contained HTML file.

Reads the editable sources in prototype/medikiosk-src/ and writes
prototype/medikiosk-prototype.html. The output needs no server, no network and
no build step at run time — it is a single file that can be opened directly, or
served over localhost when the microphone is wanted.

Run:  python prototype/build-prototype.py
"""

import base64
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SRC = HERE / "medikiosk-src"
OUT = HERE / "medikiosk-prototype.html"
ANATOMY_PNG = SRC / "anatomy.png"

# The visual system is the archived Sep-11 Module A stylesheet, referenced —
# not forked — so the prototype renders exactly that UI.
ARCHIVE_HTML = (HERE / ".." / "archive" / "SEP11" / "module-a-kiosk-demo.html").resolve()

PARTS = ["languages.js", "content.js", "body.js", "app.js"]

HTML_HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="color-scheme" content="light" />
<meta name="description" content="MediKiosk — patient self check-in for OPD: voice and touch history, paper digitisation, and a physician-ready summary." />
<title>MediKiosk — OPD self check-in</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230E6E66'/%3E%3Cpath d='M32 14v36M14 32h36' stroke='white' stroke-width='9' stroke-linecap='round'/%3E%3C/svg%3E" />
<style>
{css}
</style>
</head>
<body>
<div id="root"></div>
<noscript><p style="padding:30px">This prototype needs JavaScript enabled.</p></noscript>
<script>
{js}
</script>
</body>
</html>
"""


def read(name: str) -> str:
    return (SRC / name).read_text(encoding="utf-8")


def archived_css() -> str:
    """Extract the Sep-11 Module A stylesheet verbatim, minus comments.

    Comments are visual no-ops, so stripping them keeps the rendering
    byte-identical while leaving no stray wording in the shipped file.
    The one user-visible pseudo-element badge is neutralised, and the
    presenter-bar class names are renamed (same rules, same look).
    """
    html = ARCHIVE_HTML.read_text(encoding="utf-8")
    m = re.search(r"<style[^>]*>(.*?)</style>", html, re.S)
    if not m:
        raise SystemExit("archived stylesheet not found in " + str(ARCHIVE_HTML))
    css = m.group(1)
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = css.replace('content:"demo script"', 'content:"Suggested answer"')
    css = css.replace("content:'demo script'", "content:'Suggested answer'")
    for old, new in [
        (".demobar", ".controlbar"),
        (".dbTitle", ".cbTitle"),
        (".dbBtn", ".cbBtn"),
        (".dbSpacer", ".cbSpacer"),
        (".dbNote", ".cbNote"),
        (".dbTimer", ".cbTimer"),
        (".demoChip", ".noteChip"),
    ]:
        css = css.replace(old, new)
    return css


def main() -> None:
    css = archived_css() + "\n\n/* ===== medikiosk additions (same tokens) ===== */\n" + read("sep11-additions.css")
    js = "\n\n".join("/* ===== " + p + " ===== */\n" + read(p) for p in PARTS)
    # Embed the anatomy photo so the file stays self-contained.
    png = ANATOMY_PNG.read_bytes()
    js = js.replace("__ANATOMY_IMAGE__",
                    "data:image/png;base64," + base64.b64encode(png).decode("ascii"))
    # A literal </script> inside injected JS would close the tag early.
    js = js.replace("</script", "<\\/script")
    html = HTML_HEAD.format(css=css, js=js)
    OUT.write_text(html, encoding="utf-8")
    size = OUT.stat().st_size
    print("wrote %s (%d bytes, %.1f KB)" % (OUT.name, size, size / 1024))
    print("open:  file://%s" % OUT)
    print("mic:   python prototype/serve-prototype.py")


if __name__ == "__main__":
    main()

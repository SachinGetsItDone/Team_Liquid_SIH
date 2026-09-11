#!/usr/bin/env node
/*
 * MediKiosk demo — local server (presenter aid).
 *
 * Why this exists: browsers block microphone access for pages opened via file:// ,
 * so the demo's voice input only works when the page is served over http://127.0.0.1.
 * This script serves the prototype folder on localhost (loopback only) and opens the
 * demo in the default browser. Zero dependencies — plain Node >= 16.
 *
 * Run:   double-click serve-demo.bat   (or:  node serve-demo.mjs)
 * Stop:  close the window or press Ctrl+C
 */
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const INDEX = "module-a-kiosk-demo.html";
const PORTS = [8000, 8001, 8002, 8003, 8004, 8005];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function handler(req, res) {
  Promise.resolve()
    .then(async () => {
      const pathname = decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname);
      const rel = pathname === "/" ? INDEX : normalize(pathname).replace(/^[/\\]+/, "");
      const file = join(ROOT, rel);
      if (!file.startsWith(ROOT)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("403 Forbidden");
        return;
      }
      const body = await readFile(file);
      res.writeHead(200, {
        "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(body);
    })
    .catch(() => {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found — " + req.url);
    });
}

function attempt(port) {
  return new Promise((resolve) => {
    const s = http.createServer(handler);
    s.once("error", () => resolve(null));
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

function openBrowser(url) {
  try {
    if (process.platform === "win32") spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    console.log("  Opening: " + url);
  } catch (e) {
    console.log("  Open manually: " + url);
  }
}

let server = null;
for (const p of PORTS) {
  server = await attempt(p);
  if (server) break;
}
if (!server) {
  console.error("ERROR: no free port among " + PORTS.join(", "));
  process.exit(1);
}
const url = "http://127.0.0.1:" + server.address().port + "/" + INDEX;
console.log([
  "",
  "  MediKiosk demo — local server",
  "  ----------------------------------------------------------",
  "  URL:   " + url,
  "  Voice: use Chrome or Edge; allow the microphone when asked.",
  "         (Hindi/Hinglish input = hi-IN recognizer, English = en-IN.)",
  "  Keep this window open while presenting.",
  "  Stop:  close this window or press Ctrl+C.",
  "",
].join("\n"));
if (!process.argv.includes("--no-open")) openBrowser(url);
process.on("SIGINT", () => { try { server.close(); } catch (e) {} process.exit(0); });

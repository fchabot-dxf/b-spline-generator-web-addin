// H23 item 92: how the palette page learns it runs inside Fusion, DECLARED ONCE. The add-in (b-spline-gen.py,
// _palette_url) appends ?<param>=<value> to the palette's file URL; the page (core/fusion-bridge.js, pollMode) reads it.
// Fusion injects `adsk` some time after the page starts (seat A, 2026-10-06: ~3 s on a palette restoring a brick wall,
// the page then gave up after 300 ms and opened as the website, with no Send button), so a page that carries the flag
// waits for adsk up to modeDetectTimeoutMs and decides the moment it appears; a page without it (the website, or an
// older add-in) decides after webGraceMs, as before. The object below must stay pure JSON (the add-in json-loads it).
export default {
  "param": "host",
  "value": "fusion",
  "modeDetectTimeoutMs": 10000,
  "pollMs": 100,
  "webGraceMs": 300
}

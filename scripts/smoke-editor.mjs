// Usage: node scripts/smoke-editor.mjs <outDir> [desktop|mobile] [url]
// Headless-Chrome (CDP, no deps) smoke test of the SVG editor lattice/pattern flow on the live site (or a local URL).
// Prints a JSON report (counts, layers, probes, console errors) and writes screenshots to <outDir>.
// Minimal CDP driver (no deps): live-site smoke test of the SVG editor lattice/pattern flow.
//
// T25: testing against a LOCAL build needs the server rooted at the REPO ROOT, not the
// html folder — bspline_gen_palette.html links its CSS/JS with paths like
// `../../styles/editor.css`, relative to the page's real depth in the repo. Serving just
// the html folder makes those 404 SILENTLY (no console error — the browser just renders
// unstyled/un-scripted), which looks exactly like a real layout bug (a collapsed,
// off-screen canvas; `position:fixed` computing as `static`) but isn't one. Correct setup:
//   python -m http.server 8765 --directory .            (from the REPO ROOT)
//   node scripts/smoke-editor.mjs <outDir> mobile http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// Confirmed working this way — if a local run ever again shows a collapsed/off-screen
// canvas, check the CSS actually 200s (curl the editor.css URL) before assuming a real bug.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop';          // desktop | mobile
const URL = process.argv[4] || 'https://bspline-generator.pages.dev/';
const PORT = MODE === 'mobile' ? 9334 : 9333;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find(t => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL });
await sleep(9000);

// T25: a two-finger spread centered on #editorSVGContainer's current
// midpoint via Input.dispatchTouchEvent — confirmed (once the CSS above
// actually loads) to produce real pointerType:'touch' PointerEvents the
// SE7m pointer path handles correctly. Shared so the "does the mechanism
// work at all" check (early, plain canvas) and the "does it survive the
// full real-world flow" check (late, Pattern panel open) run byte-
// identical gesture code — only the container's on-screen size differs
// between the two calls.
async function doPinch() {
  const box = await evalJS(`(() => { const r = document.getElementById('editorSVGContainer').getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
  const zoomBefore = await evalJS(`window.svgEditor._view && window.svgEditor._view.zoom`);
  const pts = (d) => [{ x: box.x - d, y: box.y, id: 1 }, { x: box.x + d, y: box.y, id: 2 }];
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
  for (let d = 35; d <= 120; d += 5) { await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d) }); await sleep(16); }
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(800);
  const zoomAfter = await evalJS(`window.svgEditor._view && window.svgEditor._view.zoom`);
  return { box, zoomBefore, zoomAfter };
}

const report = {};
report.buildStamp = await evalJS(`(document.body.innerText.match(/[0-9a-f]{7} · 20\\d\\d-\\d\\d-\\d\\d/)||[''])[0]`);
report.editorPresent = await evalJS(`!!window.svgEditor`);
await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
report.modalOpen = await evalJS(`getComputedStyle(document.getElementById('svgEditorModal')).display`);
await shot(`${MODE}-1-editor.png`);

if (MODE === 'mobile') {
  // T25: pinch BEFORE opening the Lattice tool — isolates "does pinch-
  // zoom work at all" from the Pattern panel's own SE7p layout bug
  // (still open, tracked separately). With the panel closed the canvas
  // has its full flex space; this is the SE7m pointer path's own proof,
  // uncontaminated by SE7p's state.
  const early = await doPinch();
  report.earlyPinch = early; // { box, zoomBefore, zoomAfter } — zoomAfter should be > zoomBefore
  report.touchActionsVisible = await evalJS(`(() => { const g = document.querySelector('[id*="TouchActions"],[class*="touch-actions"]'); return g ? getComputedStyle(g).display : 'none-found'; })()`);
  await shot(`${MODE}-2-early-pinch.png`);
  // The early pinch's zoom is left applied (not reset) — later
  // screenshots may show the canvas zoomed in; that's cosmetic, not a
  // correctness concern for any other report field below.
}

await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);
report.mode = await evalJS(`window.svgEditor._currentMode`);
report.patternPanelHidden = await evalJS(`document.getElementById('editorLatticePanel').classList.contains('hidden')`);
report.gridVisible = await evalJS(`!!(window.svgEditor._grid && window.svgEditor._grid.visible)`);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(3500);
report.lattice = await evalJS(`(() => { const c = {}; document.querySelectorAll('#editorSVGContainer [data-lattice]').forEach(e => { const k = e.getAttribute('data-lattice'); c[k] = (c[k]||0)+1; }); return c; })()`);
report.owned = await evalJS(`document.querySelectorAll('#editorSVGContainer [data-lattice-gen]').length`);
report.layers = await evalJS(`window.svgEditor._layers.map(l => l.name + (l.visible===false?'(hidden)':'')).join(', ')`);
report.activeLayer = await evalJS(`String(window.svgEditor._activeLayer)`);
report.generateLabel = await evalJS(`document.getElementById('latticeGenerate').textContent.trim()`);
await shot(`${MODE}-3-generated.png`);

if (MODE === 'mobile') {
  // T25: the ORIGINAL "ground truth" scenario (ROADMAP's Live browser
  // test) — pinching while the Pattern panel is open. Kept as its own
  // check (not replaced by the early one above) because it still tracks
  // SE7p's own bug: expect zoomAfter to stay ~1 here until that panel's
  // fixed-position/bottom-sheet redesign (T24, on hold) lands, since the
  // panel currently collapses #editorSVGContainer to ~1.5x2px in this
  // state — a DIFFERENT failure than "pinch doesn't work."
  const late = await doPinch();
  report.pinchWithPatternPanelOpen = late;
  report.latticeAfterPinch = await evalJS(`document.querySelectorAll('#editorSVGContainer [data-lattice]').length`);
  await shot(`${MODE}-4-pinched-with-panel-open.png`);
}
report.railAttrs = await evalJS(`(() => { const e = document.querySelector("[data-lattice=rail]"); return e ? ["x1","y1","x2","y2","stroke","stroke-width","opacity","data-layer"].map(a => a+"="+e.getAttribute(a)).join(" ") : null; })()`);
report.nodeAttrs = await evalJS(`(() => { const e = document.querySelector("[data-lattice=node]"); return e ? ["cx","cy","r","fill","stroke","stroke-width"].map(a => a+"="+e.getAttribute(a)).join(" ") : null; })()`);
report.board = await evalJS(`["mW="+window.svgEditor._mW, "mH="+window.svgEditor._mH, "strokeWidth="+window.svgEditor._strokeWidth].join(" ")`);
report.svgOrder = await evalJS(`[...document.querySelector("#editorSVGContainer svg").children].map(c => (c.id||c.tagName)+"("+c.children.length+")").join(" > ")`);
report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

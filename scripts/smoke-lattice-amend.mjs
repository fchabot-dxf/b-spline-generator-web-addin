// Usage: node scripts/smoke-lattice-amend.mjs <outDir> [url]
// SE7k AMEND 1 (click-to-spawn) + AMEND 4/5 (direct rail end-stretch, not
// via a node) — the two pieces smoke-lattice-connected.mjs (tie-stretch-
// via-node, mid-span-move, rail/tie MOVE, vertical mirror) doesn't cover.
// Standalone CDP script, desktop only. Serve from the REPO ROOT:
//   python -m http.server 8765 --directory .
//   node scripts/smoke-lattice-amend.mjs <outDir> http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const PORT = 9397;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-amend`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-amend`,
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
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EVAL ERROR:', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = {};
await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(500);

async function modelToScreen(mx, my) {
  return evalJS(`(() => {
    const svg = document.querySelector('#editorSVGContainer svg');
    const pt = svg.createSVGPoint();
    pt.x = ${mx}; pt.y = ${my};
    const s = pt.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  })()`);
}
async function click(mPt) {
  const s = await modelToScreen(mPt.x, mPt.y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(40);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(250);
}
async function dragFromTo(mStart, mEnd, steps = 4) {
  const start = await modelToScreen(mStart.x, mStart.y);
  const end = await modelToScreen(mEnd.x, mEnd.y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
  await sleep(60);
  for (let k = 1; k <= steps; k++) {
    const x = start.x + (end.x - start.x) * (k / steps);
    const y = start.y + (end.y - start.y) * (k / steps);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(30);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  await sleep(250);
}
async function addKind(k) { await evalJS(`document.getElementById('latticeAdd-${k}').click(); true`); await sleep(100); }

report.board = await evalJS(`({ mW: window.svgEditor._mW, mH: window.svgEditor._mH, spacing: window.svgEditor._grid.spacing })`);
report.expectedExtent = await evalJS(`(() => {
  const margin = 1, spacing = window.svgEditor._grid.spacing;
  return { iMin: margin, iMax: Math.round(window.svgEditor._mW / spacing) - margin };
})()`); // matches PATTERN_DEFAULTS.margin (1) with no pattern set yet on a fresh layer

// ── AMEND 1: Rail click-spawn — a CLICK (no drag) spawns a FULL-WIDTH
// rail at the clicked row, same extent Generate would use. ──
await addKind('rail');
await click({ x: 3, y: 2 });
report.railClickSpawn = await evalJS(`(() => {
  const r = document.querySelector('[data-lattice=rail]');
  return r ? { x1: +r.getAttribute('x1'), y1: +r.getAttribute('y1'), x2: +r.getAttribute('x2'), y2: +r.getAttribute('y2') } : null;
})()`);
report.railClickSpawnedFullWidth = report.railClickSpawn
  && report.railClickSpawn.x1 === report.expectedExtent.iMin * report.board.spacing
  && report.railClickSpawn.x2 === report.expectedExtent.iMax * report.board.spacing
  && report.railClickSpawn.y1 === 2 && report.railClickSpawn.y2 === 2;
await shot('amend-1-rail-click-spawn.png');

// A second rail, further down, so the next click-spawned tie has TWO
// rails to bridge.
await click({ x: 3, y: 5 });
report.railCountAfterSecondClick = await evalJS(`document.querySelectorAll('[data-lattice=rail]').length`);

// ── AMEND 1: Tie click-spawn with >=2 rails — bridges the two nearest
// existing rail rows straddling the click. ──
await addKind('tie');
await click({ x: 3, y: 3.5 }); // between row 2 and row 5
report.tieClickSpawnBetween = await evalJS(`(() => {
  const t = document.querySelector('[data-lattice=tie][data-layer="' + window.svgEditor._activeLayer + '"]');
  return t ? { x1: +t.getAttribute('x1'), y1: +t.getAttribute('y1'), x2: +t.getAttribute('x2'), y2: +t.getAttribute('y2') } : null;
})()`);
report.tieClickSpawnedBetweenRails = report.tieClickSpawnBetween
  && report.tieClickSpawnBetween.x1 === 3 && report.tieClickSpawnBetween.x2 === 3
  && Math.min(report.tieClickSpawnBetween.y1, report.tieClickSpawnBetween.y2) === 2
  && Math.max(report.tieClickSpawnBetween.y1, report.tieClickSpawnBetween.y2) === 5;

// ── AMEND 1: Tie click-spawn with < 2 rails — falls back to a spanMin-
// length tie. Fresh layer, no rails at all. ──
await evalJS(`document.getElementById('editorAddLayer').click(); true`);
await sleep(400);
await addKind('tie');
await click({ x: 3, y: 3 });
report.tieClickSpawnFallback = await evalJS(`(() => {
  const t = document.querySelector('[data-lattice=tie][data-layer="' + window.svgEditor._activeLayer + '"]');
  return t ? { x1: +t.getAttribute('x1'), y1: +t.getAttribute('y1'), x2: +t.getAttribute('x2'), y2: +t.getAttribute('y2'), spanMin: (window.svgEditor._layers.find(l=>l.id===window.svgEditor._activeLayer).pattern?.ties?.spanMin) } : null;
})()`);
const defaultSpanMinModel = 1 * report.board.spacing; // PATTERN_DEFAULTS.ties.spanMin (1 lattice cell) — this fresh layer has no .pattern yet
report.tieClickSpawnFallbackSpan = report.tieClickSpawnFallback
  && report.tieClickSpawnFallback.x1 === 3 && report.tieClickSpawnFallback.x2 === 3
  && Math.abs(report.tieClickSpawnFallback.y2 - report.tieClickSpawnFallback.y1) === defaultSpanMinModel;
await shot('amend-1-tie-click-spawn.png');

// ── AMEND 4/5: DIRECT rail end-stretch (no node involved — auto-nodes
// off for this one draw, so the grab hits the rail's own line, not a
// node sitting on top of it). ──
await evalJS(`document.getElementById('editorAddLayer').click(); true`);
await sleep(400);
await evalJS(`window.svgEditor._lattice.autoNodes = false; true`);
await addKind('rail');
await dragFromTo({ x: 1, y: 2 }, { x: 5, y: 2 });
const railBefore = await evalJS(`(() => { const r = document.querySelector('[data-lattice=rail][data-layer="' + window.svgEditor._activeLayer + '"]'); return { x1:+r.getAttribute('x1'), y1:+r.getAttribute('y1'), x2:+r.getAttribute('x2'), y2:+r.getAttribute('y2') }; })()`);
report.directRailBuilt = railBefore;
report.noAutoNodesOnThisRail = await evalJS(`document.querySelectorAll('[data-lattice=node][data-layer="' + window.svgEditor._activeLayer + '"]').length === 0`);
// Grab within the end-grab zone of the 'a' end (x=1) but not exactly on
// it, and drag it further out (still on the correct/unclamped side).
await dragFromTo({ x: 1.05, y: 2 }, { x: -2, y: 2 });
report.railAfterDirectEndStretch = await evalJS(`(() => { const r = document.querySelector('[data-lattice=rail][data-layer="' + window.svgEditor._activeLayer + '"]'); return { x1:+r.getAttribute('x1'), y1:+r.getAttribute('y1'), x2:+r.getAttribute('x2'), y2:+r.getAttribute('y2') }; })()`);
report.railEndStretchedDirectly = report.railAfterDirectEndStretch.x1 === -2 && report.railAfterDirectEndStretch.x2 === 5 && report.railAfterDirectEndStretch.y1 === 2 && report.railAfterDirectEndStretch.y2 === 2;
await shot('amend-4-rail-direct-end-stretch.png');

// ── Regression: grabbing the rail's BODY (away from either end) still
// MOVES it (SE7i, unchanged) — confirms the end-zone check doesn't
// swallow ordinary body grabs. ──
await dragFromTo({ x: 1.5, y: 2 }, { x: 1.5, y: 4 });
report.railAfterBodyGrab = await evalJS(`(() => { const r = document.querySelector('[data-lattice=rail][data-layer="' + window.svgEditor._activeLayer + '"]'); return { x1:+r.getAttribute('x1'), y1:+r.getAttribute('y1'), x2:+r.getAttribute('x2'), y2:+r.getAttribute('y2') }; })()`);
report.railBodyGrabStillMoves = report.railAfterBodyGrab.y1 === 4 && report.railAfterBodyGrab.y2 === 4
  && report.railAfterBodyGrab.x1 === -2 && report.railAfterBodyGrab.x2 === 5; // row changed, x-range preserved — a MOVE, not a stretch
await shot('amend-5-rail-body-still-moves.png');

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

// Usage: node scripts/smoke-lattice-addkind.mjs <outDir> [desktop|mobile] [url]
// SE7k — explicit Add Rail / Add Tie / Add Node in the Lattice tool.
// Standalone CDP script (same reasoning as every other smoke-lattice-*.mjs
// this cycle: avoid touching the shared smoke-editor.mjs / smoke-lattice-
// connected.mjs while seat B is on lane-b). Serve from the REPO ROOT:
//   python -m http.server 8765 --directory .
//   node scripts/smoke-lattice-addkind.mjs <outDir> desktop http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop'; // desktop | mobile
const URL = process.argv[4] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const [W, H] = MODE === 'mobile' ? [390, 844] : [1400, 900];
const PORT = MODE === 'mobile' ? 9391 : 9390;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-addkind-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-addkind-${MODE}`,
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
await send('Network.setCacheDisabled', { cacheDisabled: true }); // seat B lands commits mid-session
const coarse = MODE === 'mobile';
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: coarse ? 2 : 1, mobile: coarse });
if (coarse) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = { mode: MODE };
await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(500);
if (coarse) await evalJS(`document.getElementById('editorLatticePanel').classList.remove('collapsed'); true`);
await sleep(200);

// Give the active layer a DISTINCTIVE pattern (colors/widths) directly —
// same object getLayerPattern reads — so hand-drawn pieces below can be
// checked against something other than PATTERN_DEFAULTS' own values,
// proving they come from THIS layer's pattern, not a coincidence.
await evalJS(`(() => {
  const editor = window.svgEditor;
  const layer = editor._layers.find(l => l.id === editor._activeLayer);
  layer.pattern = layer.pattern || {};
  layer.pattern.colors = { rails: '#123456', ties: '#654321', nodes: '#00ff00' };
  layer.pattern.widths = { rails: 0.31, ties: 0.19, nodeDiameter: 0.26 };
  true;
})()`);

report.addKindGroupRect = await evalJS(`(() => { const r = document.getElementById('latticeAddKindGroup')?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; })()`);
report.defaultActive = await evalJS(`document.getElementById('latticeAdd-rail')?.classList.contains('active')`);
await shot(`addkind-${MODE}-1-panel.png`);

// On a phone the Pattern sheet (where the Add: buttons live) squeezes the
// canvas to a thin strip while expanded (MOB2/MOB2b's own finding) — a
// real user picks a kind with the sheet open, then collapses it to get
// canvas room back to actually draw. Mirrors that real workflow rather
// than fighting it: collapse before every draw step below, re-expand only
// to click a different Add: button.
async function collapsePanel() {
  if (!coarse) return;
  await evalJS(`document.getElementById('editorLatticePanel').classList.add('collapsed'); true`);
  await sleep(200);
}
async function expandPanel() {
  if (!coarse) return;
  await evalJS(`document.getElementById('editorLatticePanel').classList.remove('collapsed'); true`);
  await sleep(200);
}
await collapsePanel();

// SE7m's touch path commits at a MARKER position offset from the raw
// finger point (editor-input.js's INPUT_PROFILE.touch.markerOffsetPx=40,
// purely vertical — "commits at the MARKER position, not the raw finger
// position"), confirmed live in MOB2's own PERF/touch-drag work. Every
// touch-dispatched point below is nudged DOWN by this amount first so the
// point that actually commits lands where the test intends — needed for
// the two spots that check an EXACT position (the node click, and
// grabbing an existing rail within its own tolerance), not just shape.
async function touchMarkerCorrectionModelUnits() {
  if (!coarse) return 0;
  const p0 = await modelToScreen(0, 0);
  const p1 = await modelToScreen(0, 1);
  const pxPerUnit = p1.y - p0.y;
  return 40 / pxPerUnit;
}

async function modelToScreen(mx, my) {
  return evalJS(`(() => {
    const svg = document.querySelector('#editorSVGContainer svg');
    const pt = svg.createSVGPoint();
    pt.x = ${mx}; pt.y = ${my};
    const s = pt.matrixTransform(svg.getScreenCTM());
    return { x: s.x, y: s.y };
  })()`);
}
// Mobile emulation (mobile:true) needs real TOUCH events — a dispatched
// mouse event doesn't reliably drive interaction there (confirmed live:
// every draw silently no-op'd under dispatchMouseEvent in mobile mode,
// same lesson MOB2's touch-drag verification already learned). Absolute
// landed positions can differ from the requested model point on touch
// (SE7m's marker-offset — see MOB2's own writeup) but every assertion
// this script makes is RELATIVE (straight line, width, color, duplicate-
// or-not) or uses the SAME two points for both a click and its repeat, so
// a consistent offset never affects the result either way.
async function dragFromTo(mStart, mEnd, steps = 6) {
  const dy = await touchMarkerCorrectionModelUnits();
  const start = await modelToScreen(mStart.x, mStart.y + dy);
  const end = await modelToScreen(mEnd.x, mEnd.y + dy);
  if (coarse) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
  }
  await sleep(60);
  for (let k = 1; k <= steps; k++) {
    const x = start.x + (end.x - start.x) * (k / steps);
    const y = start.y + (end.y - start.y) * (k / steps);
    if (coarse) {
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
    } else {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    }
    await sleep(30);
  }
  if (coarse) {
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  }
  await sleep(250);
}

// ── Rail mode (default): a drag that moves in BOTH real axes — the old
// direction-guessed tool would have called this a tie (dj > di). Must
// still come out as a straight horizontal rail (constant y) because Rail
// is explicitly selected. ──
await dragFromTo({ x: 1, y: 2 }, { x: 2, y: 6 });
report.railResult = await evalJS(`(() => {
  const r = document.querySelector('[data-lattice=rail]');
  return r ? { x1:+r.getAttribute('x1'), y1:+r.getAttribute('y1'), x2:+r.getAttribute('x2'), y2:+r.getAttribute('y2'), sw:r.getAttribute('stroke-width'), color:r.getAttribute('stroke') } : null;
})()`);
report.railIsStraightDespiteDiagonalDrag = report.railResult && report.railResult.y1 === report.railResult.y2;
report.railWidthFromPattern = report.railResult && Math.abs(parseFloat(report.railResult.sw) - 0.31) < 1e-6;
report.railColorFromPattern = report.railResult && report.railResult.color.toLowerCase() === '#123456';
await shot(`addkind-${MODE}-2-rail-drawn.png`);

// ── Tie mode: click Add: Tie, then a drag that moves in BOTH axes — must
// come out as a straight vertical line (constant x), and use the tie
// width/color, not the rail's. ──
await expandPanel();
await evalJS(`document.getElementById('latticeAdd-tie').click(); true`);
await sleep(200);
report.tieButtonActive = await evalJS(`document.getElementById('latticeAdd-tie').classList.contains('active')`);
report.railButtonInactiveAfterTieClick = await evalJS(`!document.getElementById('latticeAdd-rail').classList.contains('active')`);
await collapsePanel();
await dragFromTo({ x: 4, y: 1 }, { x: 5.5, y: 5 });
report.tieResult = await evalJS(`(() => {
  const t = document.querySelector('[data-lattice=tie]');
  return t ? { x1:+t.getAttribute('x1'), y1:+t.getAttribute('y1'), x2:+t.getAttribute('x2'), y2:+t.getAttribute('y2'), sw:t.getAttribute('stroke-width'), color:t.getAttribute('stroke') } : null;
})()`);
report.tieIsStraightDespiteDiagonalDrag = report.tieResult && report.tieResult.x1 === report.tieResult.x2;
report.tieWidthFromPattern = report.tieResult && Math.abs(parseFloat(report.tieResult.sw) - 0.19) < 1e-6;
report.tieColorFromPattern = report.tieResult && report.tieResult.color.toLowerCase() === '#654321';
await shot(`addkind-${MODE}-3-tie-drawn.png`);

// ── Node mode: click Add: Node, a single click (mousedown+up, ~no
// movement) must place exactly one node with the pattern's node
// width/color; clicking the SAME spot again must not duplicate it. ──
await expandPanel();
await evalJS(`document.getElementById('latticeAdd-node').click(); true`);
await sleep(200);
await collapsePanel();
const beforeNodeCount = await evalJS(`document.querySelectorAll('[data-lattice=node]').length`);
await dragFromTo({ x: 6, y: 6 }, { x: 6, y: 6 }, 1); // a true click: start === end
report.nodeResult = await evalJS(`(() => {
  const nodes = [...document.querySelectorAll('[data-lattice=node]')];
  const n = nodes.find(e => Math.abs(+e.getAttribute('cx') - 6) < 1e-6 && Math.abs(+e.getAttribute('cy') - 6) < 1e-6);
  return n ? { r: +n.getAttribute('r'), color: n.getAttribute('fill'), totalNodes: nodes.length } : { totalNodes: nodes.length };
})()`);
report.nodePlacedOnClick = !!report.nodeResult.r;
report.nodeRadiusFromPattern = report.nodeResult.r != null && Math.abs(report.nodeResult.r - 0.13) < 1e-6; // NODE-D: pattern stores nodeDiameter=0.26, drawn r is half of it
report.nodeColorFromPattern = report.nodeResult.color && report.nodeResult.color.toLowerCase() === '#00ff00';
const countAfterFirstClick = report.nodeResult.totalNodes;
await dragFromTo({ x: 6, y: 6 }, { x: 6, y: 6 }, 1); // click the SAME spot again
const countAfterSecondClick = await evalJS(`document.querySelectorAll('[data-lattice=node]').length`);
report.secondClickOnExistingNodeDidNotDuplicate = countAfterSecondClick === countAfterFirstClick;
await shot(`addkind-${MODE}-4-node-placed.png`);

// ── Drag-to-move still works in EVERY Add mode (currently Node is
// active) — grab the rail drawn earlier and move it, per SE7i/SE7j. ──
const beforeMoveRail = report.railResult;
if (!beforeMoveRail) {
  report.skippedMoveCheck = 'railResult was null';
} else {
  await dragFromTo({ x: 1.5, y: beforeMoveRail.y1 }, { x: 1.5, y: beforeMoveRail.y1 + 1 });
  report.railAfterMoveWhileNodeModeActive = await evalJS(`(() => {
    const r = document.querySelector('[data-lattice=rail]');
    return r ? { y1: +r.getAttribute('y1'), y2: +r.getAttribute('y2') } : null;
  })()`);
  report.dragToMoveStillWorksInNodeMode = report.railAfterMoveWhileNodeModeActive
    && Math.abs(report.railAfterMoveWhileNodeModeActive.y1 - (beforeMoveRail.y1 + 1)) < 0.01;
  await shot(`addkind-${MODE}-5-moved-in-node-mode.png`);
}

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);


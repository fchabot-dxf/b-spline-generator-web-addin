// Usage: node scripts/smoke-lattice-orientation.mjs <outDir> [url]
// SE7h — headless-Chrome (CDP, no deps) browser proof, standing in for a
// Fusion live check per Fred's hard rule (no Fusion tool calls while he's
// using it): serve the repo root (python -m http.server 8765 --directory .
// from the REPO ROOT) and pass
// http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// as <url>. Standalone script (same reasoning as smoke-lattice-seed-
// color.mjs: no collision risk with a shared script another seat might
// touch this same cycle).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const PORT = 9341;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-se7h`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-se7h`,
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
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = {};

await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);

await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);

report.orientButtonsPresent = await evalJS(`!!document.getElementById('latticeOrientHorizontal') && !!document.getElementById('latticeOrientVertical')`);
report.horizontalActiveByDefault = await evalJS(`document.getElementById('latticeOrientHorizontal').classList.contains('active')`);

// --- Generate horizontal (default) ---
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(2000);
report.horizontal = await evalJS(`(() => ({
  seed: window.svgEditor._latticePattern.seed,
  rails: [...document.querySelectorAll('[data-lattice=rail]')].map(e => ({ x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') })),
}))()`);
report.horizontalRailsAreHorizontalLines = report.horizontal.rails.length > 0
  && report.horizontal.rails.every(r => r.y1 === r.y2 && r.x1 !== r.x2);
await shot(`se7h-1-horizontal.png`);

// --- Flip to vertical via the panel toggle ---
await evalJS(`document.getElementById('latticeOrientVertical').click(); true`);
await sleep(2000);
report.verticalActiveAfterClick = await evalJS(`document.getElementById('latticeOrientVertical').classList.contains('active')`);
report.vertical = await evalJS(`(() => ({
  seed: window.svgEditor._latticePattern.seed,
  orientation: window.svgEditor._latticePattern.orientation,
  rails: [...document.querySelectorAll('[data-lattice=rail]')].map(e => ({ x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') })),
  ties: [...document.querySelectorAll('[data-lattice=tie]')].map(e => ({ x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') })),
}))()`);
report.orientationFlipDidNotReseed = report.vertical.seed === report.horizontal.seed;
report.verticalRailsAreVerticalLines = report.vertical.rails.length > 0
  && report.vertical.rails.every(r => r.x1 === r.x2 && r.y1 !== r.y2);
report.verticalTiesAreHorizontalConnectors = report.vertical.ties.length === 0
  || report.vertical.ties.every(t => t.y1 === t.y2 && t.x1 !== t.x2);
await shot(`se7h-2-vertical.png`);
await evalJS(`document.getElementById('previewCanvas')?.scrollIntoView; true`); // no-op nav aid only

// --- Flip back to horizontal, confirm it reverses cleanly ---
await evalJS(`document.getElementById('latticeOrientHorizontal').click(); true`);
await sleep(2000);
report.backToHorizontal = await evalJS(`(() => ({
  orientation: window.svgEditor._latticePattern.orientation,
  seed: window.svgEditor._latticePattern.seed,
  rails: [...document.querySelectorAll('[data-lattice=rail]')].map(e => ({ x1: +e.getAttribute('x1'), y1: +e.getAttribute('y1'), x2: +e.getAttribute('x2'), y2: +e.getAttribute('y2') })),
}))()`);
report.flipBackDidNotReseed = report.backToHorizontal.seed === report.horizontal.seed;
report.flipBackRailsAreHorizontalAgain = report.backToHorizontal.rails.length > 0
  && report.backToHorizontal.rails.every(r => r.y1 === r.y2 && r.x1 !== r.x2);

// --- Hand-drawn tool respects orientation too (SE7h's own file list item:
// editor-interaction.js's classifyDrag/constrain call sites). Drives a REAL
// mouse drag via CDP Input.dispatchMouseEvent (press/move/release), mapped
// from MODEL-space points to screen pixels via the SVG's own
// getScreenCTM() — indistinguishable to the page's pointer listeners from
// genuine hardware input, so this exercises editor-interaction.js's actual
// latticeHandler.start/update/finish, not a reimplementation. ---
await evalJS(`document.getElementById('latticeOrientVertical').click(); true`);
await sleep(1500);
await evalJS(`document.getElementById('toolLattice').click(); true`); // ensure Lattice tool is the active mode
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
async function dragLattice(mStart, mEnd) {
  const start = await modelToScreen(mStart.x, mStart.y);
  const end = await modelToScreen(mEnd.x, mEnd.y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
  await sleep(80);
  // A few intermediate moves — some pointer-tracking code only reacts to
  // 'move' deltas, not a single teleport from press to release.
  for (let k = 1; k <= 4; k++) {
    const x = start.x + (end.x - start.x) * (k / 4);
    const y = start.y + (end.y - start.y) * (k / 4);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  await sleep(300);
}

const beforeHandDraw = await evalJS(`({
  rails: document.querySelectorAll('[data-lattice=rail]:not([data-lattice-gen])').length,
  ties: document.querySelectorAll('[data-lattice=tie]:not([data-lattice-gen])').length,
})`);
// A clearly vertical-on-screen drag (same model-x, large model-y delta) —
// under 'vertical' orientation this should classify as a RAIL (a column
// drag = rail, per the dispatch). Picked away from the board edge/margin
// so it lands inside the generated extent, in an area unlikely to already
// have a hand-drawn element.
await dragLattice({ x: 1, y: 1 }, { x: 1, y: 5 });
report.handDrawnAfterVerticalColumnDrag = await evalJS(`({
  rails: document.querySelectorAll('[data-lattice=rail]:not([data-lattice-gen])').length,
  ties: document.querySelectorAll('[data-lattice=tie]:not([data-lattice-gen])').length,
})`);
report.handToolColumnDragMadeARail =
  report.handDrawnAfterVerticalColumnDrag.rails === beforeHandDraw.rails + 1 &&
  report.handDrawnAfterVerticalColumnDrag.ties === beforeHandDraw.ties;
await shot(`se7h-3-hand-drawn-vertical-rail.png`);

// Now the SAME drag shape, but flip back to horizontal first — under
// 'horizontal' orientation the identical column-shaped drag should
// classify as a TIE instead (proving the hand tool's classification
// actually FLIPS with orientation, not just "always rail" by accident).
await evalJS(`document.getElementById('latticeOrientHorizontal').click(); true`);
await sleep(1500);
const beforeHandDraw2 = await evalJS(`({
  rails: document.querySelectorAll('[data-lattice=rail]:not([data-lattice-gen])').length,
  ties: document.querySelectorAll('[data-lattice=tie]:not([data-lattice-gen])').length,
})`);
await dragLattice({ x: 2, y: 1 }, { x: 2, y: 5 });
report.handDrawnAfterHorizontalColumnDrag = await evalJS(`({
  rails: document.querySelectorAll('[data-lattice=rail]:not([data-lattice-gen])').length,
  ties: document.querySelectorAll('[data-lattice=tie]:not([data-lattice-gen])').length,
})`);
report.handToolColumnDragMadeATieUnderHorizontal =
  report.handDrawnAfterHorizontalColumnDrag.ties === beforeHandDraw2.ties + 1 &&
  report.handDrawnAfterHorizontalColumnDrag.rails === beforeHandDraw2.rails;
await shot(`se7h-4-hand-drawn-horizontal-tie.png`);

report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

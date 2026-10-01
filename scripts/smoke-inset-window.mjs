// Usage: node scripts/smoke-inset-window.mjs <outDir> [desktop|mobile] [url]
// T82 item 2 (remainder): live confirmation that a Shape Lattice pattern following the frame
// (contour.fromFrame on) skips the frame's own inset window -- the app half (toggle, drag UI, 2D/3D
// preview) was already built and is reused here unchanged; this script drives the frame record and the
// Shape Lattice panel directly (dynamic import of the SAME singleton modules the UI itself uses, not a
// second/mocked state) rather than reconstructing every click, since the UI handlers it calls
// (setFrameRecord/drawFrameProfile, the From-frame checkbox's own regenerateSilhouetteAndFill) are the
// exact functions the real buttons invoke -- the rendered SVG is the real DOM, not a simulated one.
// Serve from the REPO ROOT:
//   python -m http.server 8765 --directory .
//   node scripts/smoke-inset-window.mjs <outDir> mobile http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'desktop'; // desktop | mobile
const URL = process.argv[4] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const [W, H] = MODE === 'mobile' ? [390, 844] : [1400, 900];
const PORT = MODE === 'mobile' ? 9401 : 9400;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-insetwin-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-insetwin-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EVAL ERROR:', JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result?.result?.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
const coarse = MODE === 'mobile';
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: coarse ? 2 : 1, mobile: coarse });
if (coarse) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = { mode: MODE };

await evalJS(`document.getElementById('btnEditFrameShape').click(); true`);
await sleep(4000);
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(500);

// Frame record + an inset window well inside a simple template's own opening -- set via the SAME
// singleton module the UI reads (dynamic import of an already-loaded module URL returns the cached
// instance), then redraw via the real drawFrameProfile so the Frame tab's own band/cutaway (built in the
// app-half commit) picks it up exactly as a real drag would leave it.
report.frameSetup = await evalJS(`(async () => {
  const FR = await import('./core/frame-record.js');
  const EFP = await import('./editor/editor-frame-profile.js');
  const S = await import('./core/state.js');
  const W = S.P.widthIn, H = S.P.heightIn;
  const win = { enabled: true, x1: W * 0.3, y1: H * 0.35, x2: W * 0.7, y2: H * 0.65 };
  FR.setFrameRecord({ templateId: 'template_1', insetWindow: win });
  EFP.drawFrameProfile(window.svgEditor);
  return { W, H, win, rec: FR.getFrameRecord() };
})()`);
await shot(`insetwin-${MODE}-1-frame-tab.png`);

await evalJS(`document.getElementById('editorTabArtwork').click(); true`);
await sleep(300);
await evalJS(`document.getElementById('toolShapeLattice').click(); true`);
await sleep(500);
if (coarse) await evalJS(`document.getElementById('editorShapeLatticePanel')?.classList.remove('collapsed'); true`);
await sleep(200);

// Dense rails (every row) on the active layer's pattern BEFORE turning From-frame on, so the checkbox's
// own regenerateSilhouetteAndFill (which only touches p.contour) fills with enough rails that the window
// is guaranteed to be crossed by at least one, not left to chance with a sparse default count.
await evalJS(`(() => {
  const editor = window.svgEditor;
  const layer = editor._layers.find((l) => l.id === editor._activeLayer);
  layer.pattern = layer.pattern || {};
  layer.pattern.rails = { every: 1, offset: 0 };
  layer.pattern.ties = { ...(layer.pattern.ties || {}), mode: 'density', density: 0 };
  true;
})()`);

report.fromFrameCheckboxFound = await evalJS(`!!document.getElementById('shapeLatticeContourFromFrame')`);
report.fromFrameCheckboxStateBefore = await evalJS(`(() => { const el = document.getElementById('shapeLatticeContourFromFrame'); return el ? { disabled: el.disabled, checked: el.checked } : null; })()`);
await evalJS(`(() => { const el = document.getElementById('shapeLatticeContourFromFrameDistance'); if (el) el.value = '0.25'; true; })()`);
await evalJS(`document.getElementById('shapeLatticeContourFromFrame').click(); true`);
await sleep(1500);
report.fromFrameCheckboxStateAfter = await evalJS(`(() => { const el = document.getElementById('shapeLatticeContourFromFrame'); return el ? { disabled: el.disabled, checked: el.checked } : null; })()`);
report.layerPatternAfterClick = await evalJS(`(() => {
  const editor = window.svgEditor;
  const layer = editor._layers.find((l) => l.id === editor._activeLayer);
  const p = layer.pattern || {};
  return { shapeSource: p.shape && p.shape.source, extent: p.extent, contourFromFrame: p.contour && p.contour.fromFrame, boundaryShapeId: p.boundary && p.boundary.shapeId };
})()`);
// NOTE: deliberately no extra "latticeGenerate" click here -- that button id is shared with the plain
// (board-mode) Lattice tool's own panel, whose handler is bound regardless of which tool is active and
// clobbered this fromFrame fill with a board-mode one (confirmed live: it overwrote the boundary-clipped
// rails with full-board-width ones even though layer.pattern itself still read extent.mode:'boundary').
// The From-frame checkbox's own change handler (regenerateSilhouetteAndFill) already both redraws the
// contour and refills -- the real UI never needs a second Generate click either.

report.railCount = await evalJS(`document.querySelectorAll('[data-lattice=rail]').length`);
report.tieCount = await evalJS(`document.querySelectorAll('[data-lattice=tie]').length`);

// Data check, not just a picture: no rail element's own drawn segment should have an endpoint-to-endpoint
// midpoint landing strictly inside the window's own HOLE rectangle (computed the same way the app itself
// does, via insetWindowGeometry) -- the real geometric claim the screenshot is illustrating.
report.holeCheck = await evalJS(`(async () => {
  const IW = await import('./core/inset-window.js');
  const FR = await import('./core/frame-record.js');
  const rec = FR.getFrameRecord();
  const tplDefsMod = await import('./data/frame-defs.js');
  const defs = tplDefsMod.default;
  const tpl = defs.templates.find((t) => t.id === rec.templateId);
  const ft = (rec.params && rec.params.frame_thickness) ?? tpl.params.find((p) => p.name === 'frame_thickness').default;
  const win = IW.insetWindowGeometry(rec, ft, rec.panelLip);
  if (!win) return { error: 'no window geometry' };
  const rails = [...document.querySelectorAll('[data-lattice=rail]')];
  const offenders = rails.filter((r) => {
    const mx = (parseFloat(r.getAttribute('x1')) + parseFloat(r.getAttribute('x2'))) / 2;
    const my = (parseFloat(r.getAttribute('y1')) + parseFloat(r.getAttribute('y2'))) / 2;
    return IW.rectContains(win.hole, mx, my);
  });
  return {
    hole: win.hole, railCount: rails.length, offendingMidpointsInsideHole: offenders.length,
    allRails: rails.map((r) => ({ x1: +r.getAttribute('x1'), y1: +r.getAttribute('y1'), x2: +r.getAttribute('x2'), y2: +r.getAttribute('y2') })),
  };
})()`);

await shot(`insetwin-${MODE}-2-lattice-skips-window.png`);

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

// H1 SNAP-SPLIT item 4 acceptance shots: the GRID/GEOM toolbar toggles,
// and a tie end mid-drag that has snapped onto an off-grid RAIL-SPACING
// rail's row via GEOMETRY.
//   node tools/repro/snap_split_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
// Serve with tools/serve_app.py so the CSS loads. Writes <outPrefix>_toolbar.png
// and <outPrefix>_geometry_snap.png.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9392);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-snapshots-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 300)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolLattice').click(); await W(800);
  const input = document.getElementById('latticeRailsSpacing');
  if (input) { input.value = '0.6'; input.dispatchEvent(new Event('input', {bubbles:true})); input.dispatchEvent(new Event('change', {bubbles:true})); }
  await W(200);
  document.getElementById('latticeGenerate').click(); await W(2500);
  const btns=[...document.querySelectorAll('button,[role=button]')].filter(b=>b.offsetParent && /select/i.test((b.title||'')+(b.getAttribute('aria-label')||'')+b.id));
  const sel=btns.find(b=>/tap a piece/i.test(b.title||'')); if(sel) sel.click(); await W(400);
})()`);

// Shot 1: the toolbar with the two new GRID/GEOM toggles, GEOMETRY on.
if (await evalJS(`window.svgEditor._grid.gridSnap`)) { await evalJS(`document.getElementById('editorSnapGrid').click()`); await sleep(150); }
if (!(await evalJS(`window.svgEditor._grid.geometrySnap`))) { await evalJS(`document.getElementById('editorSnapGeometry').click()`); await sleep(150); }
await shot('toolbar');

// Shot 2: a tie end mid-drag, snapped exactly onto an off-grid rail's row.
// Same rig/grab approach as select_drag_shape.mjs's own H1 scenario
// (direct DOM query, no pixel hit-test) -- deterministic regardless of
// mobile drawer layout, and the point of this shot is the RESULT
// (dashed guide + exact position), not the drag gesture itself.
const rig = JSON.parse(await evalJS(`(()=>{
  const rails = [...document.querySelectorAll('[data-lattice="rail"]')];
  const ties = [...document.querySelectorAll('[data-lattice="tie"]')];
  const spacing = 0.25;
  const nearMultiple = (v) => Math.abs(v / spacing - Math.round(v / spacing)) < 0.01;
  const onRail = (x, y, r) => { const ry = +r.getAttribute('y1'); const rx1 = +r.getAttribute('x1'), rx2 = +r.getAttribute('x2'); return Math.abs(y - ry) < 0.02 && x >= Math.min(rx1, rx2) - 0.02 && x <= Math.max(rx1, rx2) + 0.02; };
  const offGridRail = rails.find((r) => !nearMultiple(+r.getAttribute('y1')));
  if (!offGridRail) return JSON.stringify({ ok: false, reason: 'no off-grid rail' });
  const railY = +offGridRail.getAttribute('y1');
  const railX = +offGridRail.getAttribute('x1');
  let target = null;
  for (const t of ties) {
    const x1 = +t.getAttribute('x1'), y1 = +t.getAttribute('y1'), x2 = +t.getAttribute('x2'), y2 = +t.getAttribute('y2');
    if (!rails.some((r) => onRail(x1, y1, r))) { target = { tie: t, end: 0, x1, y1, x2, y2 }; break; }
    if (!rails.some((r) => onRail(x2, y2, r))) { target = { tie: t, end: 1, x1, y1, x2, y2 }; break; }
  }
  if (!target) return JSON.stringify({ ok: false, reason: 'no free-ended tie' });
  const ed = window.svgEditor;
  const wrapped = ed._sketchLayer.children().toArray().find((c) => c.node === target.tie);
  const pieceCanon = { a: { i: target.x1 / spacing, j: target.y1 / spacing }, b: { i: target.x2 / spacing, j: target.y2 / spacing } };
  ed._latticeMove = { kind: 'tie', mode: 'stretch', el: wrapped, orientation: 'horizontal', spacing, startAttrs: { x1: target.x1, y1: target.y1, x2: target.x2, y2: target.y2 }, pieceCanon, end: target.end === 0 ? 'a' : 'b', endNode: null };
  ed._isDrawing = true;
  target.tie.id = 'lt_shot_tie';
  return JSON.stringify({ ok: true, railX, railY, spacing });
})()`));
console.log('rig:', JSON.stringify(rig));
if (rig.ok) {
  // Drop point: a couple hundredths off the rail's own endpoint --
  // GEOMETRY should still pull it exactly onto that endpoint's row.
  const screenPt = JSON.parse(await evalJS(`(()=>{
    const el = document.getElementById('lt_shot_tie'); const svg = el.ownerSVGElement;
    const p = svg.createSVGPoint(); p.x = ${rig.railX}; p.y = ${rig.railY} + 0.02;
    const q = p.matrixTransform(svg.getScreenCTM()); return JSON.stringify([q.x, q.y]);
  })()`));
  const [sx, sy] = screenPt;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx, y: sy, button: 'left', buttons: 1 });
  await sleep(150);
  const after = await evalJS(`(()=>{ const t = document.getElementById('lt_shot_tie'); return JSON.stringify({ y1: +t.getAttribute('y1'), y2: +t.getAttribute('y2') }); })()`);
  console.log('mid-drag tie state (not yet released, still visually dragging):', after);
  await shot('geometry_snap');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx, y: sy, button: 'left', clickCount: 1 });
} else {
  console.log('  (no usable rig for the geometry-snap shot this generation -- shot skipped)');
}

chrome.kill();
process.exit(0);

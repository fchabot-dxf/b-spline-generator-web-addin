// F35 item 18 (1): brick top FLAT vs ORGANIC, real 3D close-ups of the SAME bricks on the SAME
// hilly terrain, plus a measurement from the real rebuilt heights: per brick, how far its base
// (final height minus its own profile, body*depth) is from one plane. Flat should be ~0 on every
// brick; Organic follows the hills. Forks tools/repro/brick_resolution_grid_shots.mjs's CDP driver
// (headless chrome + swiftshader, raw websocket, window.__preview.getSnapshot).
//
//   node tools/repro/f35item18_flat_organic_shots.mjs <outDir> <paletteUrl> [port]
// <paletteUrl> e.g. http://127.0.0.1:8838/b-spline-gen/html/bspline_gen_palette.html
//              (serve from bspline-frame-builder/ so ../../ CSS resolves)
// Env: SIZE_IN (brick length, default 1.5), SPACING (default 0.03), PEAK (P.peakShape override, optional)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) { console.log('usage: node tools/repro/f35item18_flat_organic_shots.mjs <outDir> <paletteUrl> [port]'); process.exit(1); }
const PORT = Number(PORTARG || 9481);
const SIZE_IN = Number(process.env.SIZE_IN || 1.5);
const SPACING = Number(process.env.SPACING || 0.03);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${OUT_DIR}/.chrome-flatorganic-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const resp = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (resp.result?.exceptionDetails) errors.push('EVAL: ' + (resp.result.exceptionDetails.exception?.description || resp.result.exceptionDetails.text).split('\n')[0]);
  return resp.result?.result?.value;
};
const snap = async (file) => {
  const dataUrl = await evalJS('window.__preview.getSnapshot(960, 640)');
  writeFileSync(file, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(14000);

const setup = await evalJS(`(async()=>{
  const W = ms => new Promise(r=>setTimeout(r,ms));
  const { updateP, P } = await import('./core/state.js');
  ${process.env.PEAK ? `updateP('peakShape', ${Number(process.env.PEAK)});` : ''}
  document.getElementById('btnEditFrameShape').click(); await W(3000);
  document.getElementById('editorTabBrick').click(); await W(300);
  const { setBrickSize } = await import('./main/brick-panel.js');
  document.getElementById('brickTool_wall').click(); await W(800);
  setBrickSize(${SIZE_IN}, 'auto'); await W(1500);
  updateP('spacing', ${SPACING});
  return JSON.stringify({ widthIn: P.widthIn, heightIn: P.heightIn, bricks: document.querySelectorAll('[data-brick-gen="1"]').length });
})()`);

// One mode: set it through the real toggle, then an explicit awaited mask + rebuild (the toggle's own
// change pipeline also fires; waiting out rebuild.isRebuilding keeps the timed call real -- see
// brick_resolution_grid_shots.mjs), then measure per-brick planarity of the base from the real heights.
const runMode = (mode) => evalJS(`(async()=>{
  const W = ms => new Promise(r=>setTimeout(r,ms));
  document.getElementById('${mode === 'flat' ? 'brickBtnTopFlat' : 'brickBtnTopOrganic'}').click();
  await W(2500);
  const { P, lastResult } = await import('./core/state.js');
  const { resolveGrid } = await import('./core/terrain.js');
  const { updateStampMasks } = await import('./main/stamp-mask-manager.js');
  const { rebuild } = await import('./core/engine.js');
  const { updatePreviewSculptMode } = await import('./core/sculpt-interaction.js');
  const { AppState } = await import('./main/app-state.js');
  const { fitPlane } = await import('./core/bricks/plane-fit.js');
  const grid = resolveGrid(P.widthIn, P.heightIn, P.spacing);
  let w = 0; while (rebuild.isRebuilding && w < 30000) { await W(50); w += 50; }
  await updateStampMasks(grid.nx, grid.nz);
  w = 0; while (rebuild.isRebuilding && w < 30000) { await W(50); w += 50; }
  await rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode);
  await W(300);
  const st = await import('./core/state.js');
  const res = st.lastResult;
  const layer = window.svgEditor._layers.find((l) => l._mask && l._mask.body && document.querySelector('[data-layer="' + l.id + '"][data-brick-gen="1"]'));
  const m = layer._mask, depth = layer.depth, nx = res.nx;
  // brick membership: the Flat mask's own brickOf (re-rasterized in flat once if this is organic)
  let brickOf = m.flatTop && m.flatTop.brickOf, count = m.flatTop && m.flatTop.count;
  if (!brickOf) {
    const { rasterizeBrickHeightMask } = await import('./editor/editor-brick-height-mask.js');
    const fm = await rasterizeBrickHeightMask(window.svgEditor, layer, grid.nx, grid.nz, P.widthIn, P.heightIn, { topMode: 'flat' });
    brickOf = fm.flatTop.brickOf; count = fm.flatTop.count;
  }
  const members = Array.from({ length: count }, () => []);
  for (let k = 0; k < brickOf.length; k++) if (brickOf[k] >= 0) members[brickOf[k]].push(k);
  const resid = (ks, z) => {
    const pl = fitPlane(ks.map((k) => ({ x: k % nx, y: Math.floor(k / nx), z: z(k) })));
    return Math.max(...ks.map((k) => Math.abs(pl.eval(k % nx, Math.floor(k / nx)) - z(k))));
  };
  const base = (k) => res.heights[k] - m.body[k] * depth;
  const per = members.filter((ks) => ks.length >= 6).map((ks) => ({ base: resid(ks, base), terrain: resid(ks, (k) => res.cleanHeights[k]) }));
  const max = (a) => Math.max(...a), med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  // camera: a low oblique close-up on the board centre
  const p = window.__preview, o = p._orbit, T = p._THREE;
  o._targetOrb.q.setFromEuler(new T.Euler(1.05, 0, 0.6, 'ZXY'));
  o._targetOrb.r = Math.min(9, Math.max(3, ${SIZE_IN} * 3.4));
  o._targetOrb.target.set(0, 0, 0);
  o._orb.q.copy(o._targetOrb.q); o._orb.r = o._targetOrb.r; o._orb.target.copy(o._targetOrb.target);
  p._camera.position.addVectors(o._orb.target, new T.Vector3(0, 0, o._orb.r).applyQuaternion(o._orb.q));
  p._camera.quaternion.copy(o._orb.q);
  if (typeof p.updateFrustum === 'function') p.updateFrustum(); else if (typeof o.updateFrustum === 'function') o.updateFrustum();
  p._needsRender = true;
  await W(400);
  return JSON.stringify({
    mode: P.brickSettings.brickTopMode, maskHasFlatTop: !!m.flatTop, nx: grid.nx, nz: grid.nz, bricksMeasured: per.length, depth,
    baseResidualIn: { max: +max(per.map((q) => q.base)).toFixed(5), median: +med(per.map((q) => q.base)).toFixed(5) },
    terrainResidualIn: { max: +max(per.map((q) => q.terrain)).toFixed(5), median: +med(per.map((q) => q.terrain)).toFixed(5) },
  });
})()`);

const out = { setup: JSON.parse(setup || '{}'), sizeIn: SIZE_IN, spacing: SPACING };
const rawO = await runMode("organic"); if (typeof rawO !== "string") { console.log("RAW", JSON.stringify(rawO), errors); ws.close(); chrome.kill(); process.exit(1); }
out.organic = JSON.parse(rawO);
await snap(`${OUT_DIR}/f35item18_organic_${SIZE_IN}in.png`);
out.flat = JSON.parse((await runMode('flat')) || 'null');
await snap(`${OUT_DIR}/f35item18_flat_${SIZE_IN}in.png`);
out.errors = errors.slice(0, 5);
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();

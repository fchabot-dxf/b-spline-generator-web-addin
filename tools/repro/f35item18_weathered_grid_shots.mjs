// F35 item 18 (turn 181): a 3x3 TUNING GRID of the Weathered surface style for Fred to mark --
// rows = edge wear (heightProfile edgeNoiseIn), cols = pit contrast (pitGain), every other Weathered
// value as declared in editor/brick-surface-styles.js. Each cell renders the SAME bricks on the SAME
// board through the real app (an inline style declaration in P.brickSettings.surfaceStyle, which
// surfaceStyleById accepts, then a real mask + rebuild), as a 3D close-up LIT FROM THE TOP-LEFT (the
// scene's sun moved for the capture only; the app's own lighting is untouched). Grout is Recessed so
// the deep joints show (Flush = no recess in every style). Writes <outDir>/weathered_grid/cell_r_c.png
// + report.json; compose with:
//   python tools/grid_composite.py <outDir>/weathered_grid/report.json <outDir>/weathered_grid <out.png>
//     --row-label 'edge wear {:.3f} in' --col-label 'pit gain {}'
//
//   node tools/repro/f35item18_weathered_grid_shots.mjs <outDir> <paletteUrl> [port]
// Env: SIZE_IN (brick length, default 0.75), SPACING (default 0.011), EDGE (3 values), PIT (3 values),
//      RADIUS (camera distance, default 1.1). Each cell also reports rmsVsCleanIn: the RMS height change
//      over the whole board vs Clean (same grout), a number to read beside the picture.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) { console.log('usage: node tools/repro/f35item18_weathered_grid_shots.mjs <outDir> <paletteUrl> [port]'); process.exit(1); }
const PORT = Number(PORTARG || 9495);
const SIZE_IN = Number(process.env.SIZE_IN || 0.75);
const SPACING = Number(process.env.SPACING || 0.011);
const EDGES = (process.env.EDGE || '0,0.02,0.04').split(',').map(Number);
const PITS = (process.env.PIT || '1,2.5,4').split(',').map(Number);
const RADIUS = Number(process.env.RADIUS || 1.1);
const CELL_DIR = `${OUT_DIR}/weathered_grid`;
const PROFILE = `${OUT_DIR}/.chrome-wgrid-${PORT}`;
mkdirSync(CELL_DIR, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  'about:blank'], { stdio: 'ignore' });
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

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(14000);

const setup = await evalJS(`(async()=>{
  const W = ms => new Promise(r=>setTimeout(r,ms));
  const { updateP, P } = await import('./core/state.js');
  document.getElementById('btnEditFrameShape').click(); await W(3000);
  document.getElementById('editorTabBrick').click(); await W(300);
  const { setBrickSize, setGroutProfile } = await import('./main/brick-panel.js');
  document.getElementById('brickTool_wall').click(); await W(800);
  setBrickSize(${SIZE_IN}, 'auto'); await W(1500);
  setGroutProfile('recessed'); await W(500);
  updateP('spacing', ${SPACING});
  // the capture's lighting: sun high and from the top-left of the view, fill low; app lighting untouched
  const p = window.__preview, T = p._THREE;
  const lights = p._scene.children.filter((c) => c.isDirectionalLight);
  if (lights[0]) { lights[0].position.set(-4, 4, 9); lights[0].intensity = 1.5; }
  if (lights[1]) { lights[1].position.set(4, -4, 3); lights[1].intensity = 0.35; }
  return JSON.stringify({ bricks: document.querySelectorAll('[data-brick-gen="1"]').length, lights: lights.length, grout: P.brickSettings.grout });
})()`);

// a shared rebuild helper + the Clean baseline heights (same grout) for the per-cell number
await evalJS(`(async()=>{
  const W = ms => new Promise(r=>setTimeout(r,ms));
  const { P } = await import('./core/state.js');
  const { resolveGrid } = await import('./core/terrain.js');
  const { updateStampMasks } = await import('./main/stamp-mask-manager.js');
  const { rebuild } = await import('./core/engine.js');
  const { updatePreviewSculptMode } = await import('./core/sculpt-interaction.js');
  const { AppState } = await import('./main/app-state.js');
  window.__wgridRebuild = async () => {
    const grid = resolveGrid(P.widthIn, P.heightIn, P.spacing);
    let t = 0; while (rebuild.isRebuilding && t < 30000) { await W(50); t += 50; }
    await updateStampMasks(grid.nx, grid.nz);
    t = 0; while (rebuild.isRebuilding && t < 30000) { await W(50); t += 50; }
    await rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode);
    return (await import('./core/state.js')).lastResult.heights;
  };
  P.brickSettings.surfaceStyle = 'clean';
  window.__wgridClean = Float32Array.from(await window.__wgridRebuild());
})()`);

const report = { rows: EDGES, cols: PITS, sizeIn: SIZE_IN, spacing: SPACING, setup: JSON.parse(setup || '{}'), cells: [] };
for (let r = 0; r < EDGES.length; r++) {
  for (let c = 0; c < PITS.length; c++) {
    const cell = await evalJS(`(async()=>{
      const W = ms => new Promise(r=>setTimeout(r,ms));
      const { P } = await import('./core/state.js');
      const { BRICK_SURFACE_STYLES } = await import('./editor/brick-surface-styles.js');
      const w = BRICK_SURFACE_STYLES.weathered;
      // an explicit (edge, pit) cell: no wear key on the inline style, so the Wear slider does not override it
      P.brickSettings.surfaceStyle = { ...w, wear: undefined, profileSet: { ...w.profileSet, edgeNoiseIn: ${EDGES[r]} }, pitGain: ${PITS[c]} };
      const h = await window.__wgridRebuild();
      const c0 = window.__wgridClean;
      let ss = 0; for (let k = 0; k < h.length; k++) ss += (h[k] - c0[k]) ** 2;
      window.__wgridRms = Math.sqrt(ss / h.length);
      const p = window.__preview, o = p._orbit, T = p._THREE;
      o._targetOrb.q.setFromEuler(new T.Euler(0.45, 0, 0, 'ZXY'));
      o._targetOrb.r = ${RADIUS};
      o._targetOrb.target.set(0.3, 0.6, 0);
      o._orb.q.copy(o._targetOrb.q); o._orb.r = o._targetOrb.r; o._orb.target.copy(o._targetOrb.target);
      p._camera.position.addVectors(o._orb.target, new T.Vector3(0, 0, o._orb.r).applyQuaternion(o._orb.q));
      p._camera.quaternion.copy(o._orb.q);
      if (typeof p.updateFrustum === 'function') p.updateFrustum(); else if (typeof o.updateFrustum === 'function') o.updateFrustum();
      p._needsRender = true;
      await W(400);
      return JSON.stringify({ png: window.__preview.getSnapshot(640, 480), rms: window.__wgridRms });
    })()`);
    const { png, rms } = JSON.parse(cell);
    const file = `cell_${r}_${c}.png`;
    writeFileSync(`${CELL_DIR}/${file}`, Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64'));
    report.cells.push({ row: r, col: c, file, edgeNoiseIn: EDGES[r], pitGain: PITS[c], rmsVsCleanIn: +rms.toFixed(4) });
  }
}
// leave the session state as the app would have it
await evalJS(`(async()=>{ const { P } = await import('./core/state.js'); P.brickSettings.surfaceStyle = 'clean'; })()`);
report.errors = errors.slice(0, 5);
writeFileSync(`${CELL_DIR}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ setup: report.setup, cells: report.cells.length, errors: report.errors }));
ws.close(); chrome.kill();

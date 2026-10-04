// F35 item 16 follow-up (Fred wants it measured, not theorised): a grid of real 3D close-ups,
// rows = terrain spacing (mesh resolution), cols = the new GLOBAL brick size (P.brickSettings.
// brickLengthIn), so the resolution hint's threshold and the "life size" (8in) floor on the app's
// own default 7x9 board can be read off real renders instead of guessed. Forks the established
// tools/repro/frame_3d_shots.mjs / filter_shots.mjs CDP driver pattern (headless chrome +
// swiftshader, raw debugger websocket, no deps) and filter_shots.mjs's own window.__preview.
// getSnapshot(w,h) capture (an exact render of just the 3D canvas, independent of page layout).
//
// Usage:
//   node tools/repro/brick_resolution_grid_shots.mjs <outDir> <paletteUrl> [port]
//
// <outDir>     e.g. shots/seatC  -- writes <outDir>/resolution_scale_grid/cell_<r>_<c>.png (one
//              per cell, kept for inspection) and a JSON report on stdout; the labeled composite
//              is assembled separately by tools/grid_composite.py (no image library in Node here).
// <paletteUrl> e.g. http://127.0.0.1:8784/b-spline-gen/html/bspline_gen_palette.html
//              (serve from the bspline-frame-builder/ folder so ../../ CSS resolves)
// [port]       default 9472
//
// The app's own DEFAULT state is a 7x9 board with template_1 already active (confirmed live,
// not assumed) -- so no board/template setup is needed; Wall tool + the Frame tool's own
// resolveFrameGeom() both fire off the SAME generateBricks call once Wall is selected, giving
// every cell real Wall fill AND real Frame bands together, which is what the life-size floor
// question is actually about.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) {
  console.log('usage: node tools/repro/brick_resolution_grid_shots.mjs <outDir> <paletteUrl> [port]');
  process.exit(1);
}
const PORT = Number(PORTARG || 9472);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CELL_DIR = `${OUT_DIR}/resolution_scale_grid`;
const PROFILE = `${OUT_DIR}/.chrome-brickgrid-${PORT}`;
mkdirSync(CELL_DIR, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rows/cols per the advisor's own dispatch (F35 item 16 follow-up): spacing is the terrain mesh's
// own sampling pitch (core/terrain.js resolveGrid), brickLengthIn is the new global brick-size
// control (F35 item 16) replacing the old 0.5-2x scale multiplier -- 8in is Fred's own "Life size"
// preset (library.js BRICK_SIZE_PRESETS / brick-panel.js), the one this grid exists to check the
// floor behaviour of on the app's default 7x9 board.
const SPACINGS = process.env.DEBUG_SPACINGS ? process.env.DEBUG_SPACINGS.split(',').map(Number) : [0.05, 0.03, 0.02, 0.015, 0.011];
const SIZES_IN = process.env.DEBUG_SIZES ? process.env.DEBUG_SIZES.split(',').map(Number) : [0.375, 0.75, 1.5, 3, 8];

const chrome = process.env.SKIP_SPAWN ? null : spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
], { stdio: 'ignore' });

let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl;
  } catch { /* not up yet */ }
}
if (!wsUrl) { console.log('NO CDP'); chrome?.kill(); process.exit(1); }

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
  if (resp.result?.exceptionDetails) {
    const ex = resp.result.exceptionDetails;
    const desc = ex.exception?.description || ex.text || JSON.stringify(ex);
    console.error('EVAL EXCEPTION:', desc.split('\n').slice(0, 5).join(' | '));
  }
  return resp.result?.result?.value;
};
const shotCell = async (r, c) => {
  const dataUrl = await evalJS(`window.__preview.getSnapshot(640, 480)`);
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(`${CELL_DIR}/cell_${r}_${c}.png`, Buffer.from(b64, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(9000);

// Open the editor (default lands on the Frame tab, template_1, the app's own 7x9 default board --
// confirmed live via a probe before writing this script, not assumed), switch to Brick, select
// Wall (this is enough to also draw Frame bands: brick-panel.js's own _commitBrickSlider calls
// runBricks with resolveFrameGeom(editor) regardless of which brick tool is active).
const setup = await evalJS(`(async()=>{
  const W = ms => new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnEditFrameShape').click();
  await W(3000);
  document.getElementById('editorTabBrick').click();
  await W(300);
  document.getElementById('brickTool_wall').click();
  await W(800);
  const { getFrameRecord } = await import('./core/frame-record.js');
  const { P } = await import('./core/state.js');
  return JSON.stringify({ templateId: getFrameRecord().templateId, widthIn: P.widthIn, heightIn: P.heightIn });
})()`);
console.error('SETUP', setup);

const report = { board: JSON.parse(setup || '{}'), rows: SPACINGS, cols: SIZES_IN, cells: [], errors: [] };

for (let r = 0; r < SPACINGS.length; r++) {
  for (let c = 0; c < SIZES_IN.length; c++) {
    const spacing = SPACINGS[r];
    const sizeIn = SIZES_IN[c];
    const cellJson = await evalJS(`(async()=>{
      const W = ms => new Promise(r=>setTimeout(r,ms));
      // 1) Brick size, via the real slider (the user's own gesture) -- 'change' commits through
      //    _commitBrickSlider -> runBricks(editor, P.brickSettings, resolveFrameGeom(editor)).
      const slider = document.getElementById('brickSizeSlider');
      slider.value = '${sizeIn}';
      slider.dispatchEvent(new Event('change'));
      await W(400);

      // 2) Spacing -- a plain state write (updateP), deliberately NOT applyParam: applyParam's own
      //    spacing branch fires an UN-AWAITED refreshAllStampMasks -> scheduleRebuild(rebuild) in
      //    the background, which races core/engine/rebuild.js's own re-entrancy guard
      //    (rebuild.isRebuilding) against the explicit, awaited rebuild() this script times below --
      //    measured live: that race made every rebuild from row 3 onward (158k+ points) return
      //    near-instantly with NO real work done, because this script's own call found
      //    isRebuilding already true and hit the guard's early 'return' (undefined, not even a
      //    promise standing in for the real completion). A direct state write sidesteps the
      //    background scheduling entirely -- this script is the only caller of rebuild() here.
      const { updateP, P } = await import('./core/state.js');
      updateP('spacing', ${spacing});

      // 3) Timed FULL rebuild -- mask rasterization (editor/editor-brick-height-mask.js's own
      //    per-grid-point sampleHeight loop) AND the terrain mesh rebuild it feeds (core/engine/
      //    rebuild.js's own rebuild()). ONE pass, not an averaged repeat: repeating this exact call
      //    is not a fair "mean of N" the way frame_3d_shots.mjs's own cheap refreshFrame() loop is --
      //    this is the one rebuild a real user's one slider release actually pays for.
      const { resolveGrid } = await import('./core/terrain.js');
      const { updateStampMasks } = await import('./main/stamp-mask-manager.js');
      const { rebuild } = await import('./core/engine.js');
      const { updatePreviewSculptMode } = await import('./core/sculpt-interaction.js');
      const { AppState } = await import('./main/app-state.js');
      const grid = resolveGrid(P.widthIn, P.heightIn, P.spacing);
      // Something other than this script's own calls occasionally leaves rebuild.isRebuilding
      // true when this per-cell pass starts (measured live: a prior run's VERY FIRST cell hit it) --
      // waiting it out here guarantees the timed call below actually STARTS the real work instead
      // of silently hitting core/engine/rebuild.js's own re-entrancy guard and returning undefined.
      let waited = 0;
      while (rebuild.isRebuilding && waited < 20000) { await W(50); waited += 50; }
      const isRebuildingBeforeMask = rebuild.isRebuilding;
      await updateStampMasks(grid.nx, grid.nz);
      let waited2 = 0;
      while (rebuild.isRebuilding && waited2 < 20000) { await W(50); waited2 += 50; }
      const isRebuildingBeforeRebuild = rebuild.isRebuilding;
      const t0 = performance.now();
      const rv = await rebuild(AppState.preview, updateStampMasks, updatePreviewSculptMode);
      const rebuildMs = performance.now() - t0;
      const samePreview = AppState.preview === window.__preview;
      await W(150);

      const wallCount = document.querySelectorAll('[data-brick-gen="1"][data-brick="wall"]').length;
      const frameCount = document.querySelectorAll('[data-brick-gen="1"][data-brick="frame"]').length;
      const anyBrick = document.querySelectorAll('[data-brick-gen="1"]').length;

      // Camera: zoom proportional to the brick's own length, so every column shows a comparable
      // 2-4 bricks across regardless of absolute size (a fixed small window would show nothing but
      // a blank tan square for the small-brick columns). Capped at 9 -- uncapped, the 8in life-size
      // column's own "3x brick length" radius (25.6) is wider than the whole 7x9 board, so it would
      // render the SAME full-board wide shot every column was meant to zoom in FROM (measured live:
      // this is exactly what happened before the cap was added). At life size this board only fits
      // ~1 brick across its own 7in width anyway (wallCount 16 total, confirmed by this same run's
      // own brick counts) -- the capped view showing most of the board IS the honest close-up for
      // that column, not an artifact to hide. Framed on a bottom-left corner where the Frame band
      // and the Wall fill meet, so both are visible.
      const p = window.__preview, o = p._orbit, T = p._THREE;
      const radius = Math.min(9, Math.max(2.2, ${sizeIn} * 3.2));
      o._targetOrb.q.setFromEuler(new T.Euler(1.0, 0, 0.78, 'ZXY'));
      o._targetOrb.r = radius;
      o._targetOrb.target.set(-2.5, -3.5, 0); // bottom-left corner: Frame band + Wall fill both visible
      o._orb.q.copy(o._targetOrb.q); o._orb.r = o._targetOrb.r; o._orb.target.copy(o._targetOrb.target);
      const pos = new T.Vector3(0, 0, o._orb.r).applyQuaternion(o._orb.q);
      p._camera.position.addVectors(o._orb.target, pos);
      p._camera.quaternion.copy(o._orb.q);
      if (typeof p.updateFrustum === 'function') p.updateFrustum();
      else if (typeof o.updateFrustum === 'function') o.updateFrustum();
      p._needsRender = true;
      await W(150);

      return JSON.stringify({
        spacing: ${spacing}, sizeIn: ${sizeIn},
        nx: grid.nx, nz: grid.nz, pointCount: grid.nx * grid.nz,
        rebuildMs: +rebuildMs.toFixed(2),
        diag: { isRebuildingBeforeMask, isRebuildingBeforeRebuild, rvType: typeof rv, samePreview, hasPreview: !!AppState.preview },
        wallCount, frameCount, anyBrick,
      });
    })()`);
    await shotCell(r, c);
    let cell;
    if (typeof cellJson === 'string') {
      cell = JSON.parse(cellJson);
    } else {
      console.error(`cell[${r},${c}] FAILED (see EVAL EXCEPTION above) typeof=${typeof cellJson}`);
      cell = { spacing, sizeIn, failed: true };
    }
    cell.row = r; cell.col = c; cell.file = `cell_${r}_${c}.png`;
    report.cells.push(cell);
    console.error(`cell[${r},${c}] spacing=${spacing} size=${sizeIn}in -> ${JSON.stringify(cell)}`);
  }
}

report.errors = errors.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome?.kill();
process.exit(0);

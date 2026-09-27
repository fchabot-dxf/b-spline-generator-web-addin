// T78 (FILTER REWORK, Fred: "the planet ones aren't planet-like at all,
// craters don't look like craters either") — headless before/after render
// tool for the terrain noise filters (#noiseType select). Forks the
// established tools/repro/frame_3d_shots.mjs CDP driver pattern (chrome
// headless + swiftshader, raw debugger websocket, no deps) rather than a
// new one, and captures via window.__preview.getSnapshot(w,h) -- the app's
// own purpose-built headless-verification hook (main/main.js) -- instead
// of a full-page Page.captureScreenshot, so every shot is an exact,
// layout-independent render of just the 3D canvas.
//
// Usage:
//   node tools/repro/filter_shots.mjs <outDir> <paletteUrl> <label> [noiseTypesCsv] [seed] [port] [lowlight]
//
// <outDir>       e.g. shots/seatB
// <paletteUrl>   e.g. http://127.0.0.1:8080/b-spline-gen/html/bspline_gen_palette.html
//                (serve from the bspline-frame-builder/ folder so ../../
//                CSS resolves -- same convention as every other repro tool)
// <label>        filename tag, e.g. "before" or "after-moon"
// [noiseTypesCsv] default 'simplex,moon,mars,dunes,reef' (simplex first,
//                as the "good" reference every other filter is compared
//                against per the dispatch)
// [seed]         default 42 (the app's own DEFAULT.seed, state.js) -- same
//                seed across a before/after pair is the whole point.
// [port]         default 9362
// [lowlight]     any truthy string ("1"/"lowlight") repositions the scene's
//                own sun DirectionalLight to a low grazing angle before
//                every shot in this run (T78 MOON REFERENCE amendment,
//                Fred: "check your render under low-angle light: the rims
//                should pop") -- reads the light straight off the live
//                THREE.Scene (no preview.js source change needed).
//
// Writes <outDir>/<label>_<noiseType>_seed<seed>.png for each type, plus a
// JSON report (on stdout) with each type's raw fn() output stats (mean,
// stdDev, min, max) read straight from the live page's own imported
// filter module + PerlinNoise instances -- the same "measured std-dev/
// detail metric vs Simplex" the dispatch's item 6 asks for, computed once
// per shot rather than needing a second separate tool.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, LABEL, TYPES_CSV, SEEDARG, PORTARG, LOWLIGHT] = process.argv.slice(2);
if (!OUT_DIR || !URL || !LABEL) {
  console.log('usage: node tools/repro/filter_shots.mjs <outDir> <paletteUrl> <label> [typesCsv] [seed] [port] [lowlight]');
  process.exit(1);
}
const TYPES = (TYPES_CSV || 'simplex,moon,mars,dunes,reef').split(',');
const SEED = Number(SEEDARG || 42);
const PORT = Number(PORTARG || 9362);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${OUT_DIR}/.chrome-filtershots-${PORT}`;
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PowerShell's own Start-Process is the reliable way to launch chrome.exe
// headless in this environment (bash/node child_process.spawn of chrome.exe
// silently fails here) -- SKIP_SPAWN=1 lets an already-running instance
// (launched externally on the same PORT) be reused instead.
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
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => {
  const dataUrl = await evalJS(`window.__preview.getSnapshot(900, 700)`);
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  writeFileSync(`${OUT_DIR}/${name}.png`, Buffer.from(b64, 'base64'));
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(9000);

if (LOWLIGHT) {
  // T78 MOON REFERENCE amendment: a low grazing sun angle so raised rims
  // cast real shadows -- repositions the scene's own sun DirectionalLight
  // (core/preview/index.js constructs it as a local `sun` var, never
  // exposed on the instance, so it's found by scanning _scene.children;
  // no preview.js source change needed since this only mutates the LIVE
  // object at runtime, in this throwaway headless page).
  await evalJS(`(() => {
    const p = window.__preview;
    const sun = p._scene.children.find((c) => c.isDirectionalLight && c.intensity > 1);
    if (sun) sun.position.set(8, 0.6, 0.9); // near-horizontal grazing light
    p._needsRender = true;
    return !!sun;
  })()`);
}

// Instant, deterministic isometric camera -- goHome() computes the correct
// fit-to-board `r` from the REAL board size, then we copy targetOrb straight
// into orb (skipping the damped lerp) so every shot uses the identical
// camera with no wait-for-settle guessing (same technique
// frame_3d_shots.mjs's own custom-angle shots already use). Snapping `_orb`
// alone is NOT enough headlessly -- the app's own animate loop is what
// normally turns `_orb` into `_camera.position`/`quaternion` each frame,
// and that loop does not reliably tick in a headless/unfocused page, so
// the camera transform is recomputed and applied explicitly right here
// (T78 tuning finding: a first attempt at a custom side-angle shot for
// Dunes silently rendered from the STALE previous camera with this step
// skipped -- caught by comparing the rendered image, not by inspection).
const SNAP_CAMERA = `
  const p = window.__preview, o = p._orbit, T = p._THREE;
  const pos = new T.Vector3(0, 0, o._orb.r).applyQuaternion(o._orb.q);
  p._camera.position.addVectors(o._orb.target, pos);
  p._camera.quaternion.copy(o._orb.q);
  if (typeof p.updateFrustum === 'function') p.updateFrustum();
  else if (typeof o.updateFrustum === 'function') o.updateFrustum();
  p._needsRender = true;
`;
await evalJS(`(async () => {
  const p = window.__preview;
  p.goHome(); // internally: this._orbit.goHome(this._lastWidth, this._lastHeight)
  p._orbit._orb.q.copy(p._orbit._targetOrb.q);
  p._orbit._orb.r = p._orbit._targetOrb.r;
  p._orbit._orb.target.copy(p._orbit._targetOrb.target);
  ${SNAP_CAMERA}
  true;
})()`);

const report = { label: LABEL, seed: SEED, types: {} };

for (const noiseType of TYPES) {
  await evalJS(`(async () => {
    const W = (ms) => new Promise((r) => setTimeout(r, ms));
    const seedEl = document.getElementById('seed');
    seedEl.value = '${SEED}'; seedEl.dispatchEvent(new Event('input'));
    await W(120);
    const sel = document.getElementById('noiseType');
    sel.value = '${noiseType}'; sel.dispatchEvent(new Event('change'));
    await W(700);
  })()`);
  // Re-apply the fixed camera every time -- some noiseType/board-size
  // interactions can nudge the orbit target (terrain centre Z changes).
  await evalJS(`(async () => {
    const p = window.__preview;
    p.goHome();
    p._orbit._orb.q.copy(p._orbit._targetOrb.q);
    p._orbit._orb.r = p._orbit._targetOrb.r;
    p._orbit._orb.target.copy(p._orbit._targetOrb.target);
    ${SNAP_CAMERA}
    true;
  })()`);
  await sleep(150);
  await shot(`${LABEL}_${noiseType}_seed${SEED}`);

  // Raw fn() output stats over a coarse grid, straight from the live
  // page's own imported filter module + a freshly-seeded PerlinNoise pair
  // (matching terrain.js's own noiseFine/noiseWarp construction) -- the
  // "measured std-dev/detail metric vs Simplex" figure, computed here so
  // no second tool is needed.
  const statsJson = await evalJS(`(async () => {
    const mod = await import('./core/noise/${noiseType}.js');
    const { PerlinNoise } = await import('./core/noise.js');
    const noiseFine = new PerlinNoise(${SEED});
    const noiseWarp = new PerlinNoise(${SEED} ^ 0x9e3779b9);
    const noiseRefs = { noiseFine, noiseWarp };
    const params = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1.0, tweaks: {} };
    const aspect = 7 / 9;
    const N = 96;
    let sum = 0, sumSq = 0, min = Infinity, max = -Infinity;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const su = i / (N - 1), sv = j / (N - 1);
        const h = mod.fn(su, sv, aspect, params, noiseRefs);
        sum += h; sumSq += h * h;
        if (h < min) min = h;
        if (h > max) max = h;
      }
    }
    const n = N * N;
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    return JSON.stringify({ mean, stdDev: Math.sqrt(variance), min, max, range: max - min });
  })()`);
  report.types[noiseType] = JSON.parse(statsJson);
}

report.errors = errors.slice(0, 10);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome?.kill();
process.exit(0);

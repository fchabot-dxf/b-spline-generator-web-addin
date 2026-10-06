// Fred (2026-10-06): "load screens were for during refresh of geometry" -- every GEOMETRY-REFRESH path in the app,
// measured: does the loading card / pill show from the first frame of the work to its end, with the stage named?
// Headless palette (the driver of tools/repro/f35item41_load_stages_measure.mjs), 900 px, CPU throttled (CPU, default 4).
// Per path, from the tap (or the first tick of a drag / stroke) until idle:
//   firstPaintMs  tap -> the first frame with the overlay on screen (null = never)
//   stages        the overlay texts it showed, in order; surfaces = card / pill
//   shows         how many separate times the overlay appeared (1 = steady; more = it went away and came back)
//   shortestShowMs  the shortest of those appearances (a flash reads as < MIN_VISIBLE_MS)
//   blindMs       main-thread long-task time while NOTHING was on screen (what reads as frozen)
//   gapsMs        overlay-hidden gaps between two appearances, while the path was still working
//
//   node tools/repro/geometry_refresh_stages_measure.mjs <outDir> <paletteUrl> [port]
// Env: TAG, CPU (default 4)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const [OUT_DIR, URL, PORTARG] = process.argv.slice(2);
if (!OUT_DIR || !URL) { console.log('usage: node tools/repro/geometry_refresh_stages_measure.mjs <outDir> <paletteUrl> [port]'); process.exit(1); }
const PORT = Number(PORTARG || 9581);
const TAG = process.env.TAG || 'measure';
const CPU = Number(process.env.CPU || 4);
const PROFILE = `${OUT_DIR}/.chrome-geomrefresh-${PORT}`;
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

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Network.setBlockedURLs', { urls: ['*workers.dev*'] });
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(15000);

await evalJS(`(async()=>{
  const { rebuild } = await import('./core/engine.js');
  const W = ms => new Promise(r=>setTimeout(r,ms));
  const el = document.getElementById('loading-stage');
  const vis = () => !!el && !el.hidden;
  window.__ov = [];
  new MutationObserver(() => { const v = vis(), txt = v ? (el.textContent || '').trim() : '', surface = v ? el.dataset.surface : '';
    const t = performance.now(); requestAnimationFrame(() => window.__ov.push({ t, painted: performance.now(), v, txt, surface })); })
    .observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  window.__long = [];
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ start: e.startTime, dur: e.duration }); }).observe({ entryTypes: ['longtask'] });
  window.__idle = async () => { let quiet = 0; const t0 = performance.now();
    while (quiet < 1500 && performance.now() - t0 < 90000) { await W(100); quiet = (rebuild.isRebuilding || vis()) ? 0 : quiet + 100; }
    return performance.now() - t0 - 1500; };
  // a slider drag the way a finger does it: pointer down, input ticks, release (change), pointer up
  window.__drag = async (id, values, tickMs = 120) => {
    const s = document.getElementById(id); if (!s) return false;
    s.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    for (const v of values) { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); await W(tickMs); }
    s.dispatchEvent(new Event('change', { bubbles: true }));
    s.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    return true;
  };
  window.__set = (id, v) => { const e = document.getElementById(id); if (!e) return false; e.value = String(v);
    e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true; };
  window.__measure = async (name, act) => {
    await window.__idle();
    window.__ov = []; window.__long = [];
    const t0 = performance.now();
    const ok = await act();
    await window.__idle();
    const tEnd = performance.now() - 1500;
    const ov = window.__ov.slice();
    // appearances: from a painted visible state to the next painted hidden state
    const shows = []; let on = null;
    for (const e of ov) { if (e.v && on === null) on = e.painted; if (!e.v && on !== null) { shows.push([on, e.painted]); on = null; } }
    if (on !== null) shows.push([on, tEnd]);
    const visibleAt = (t) => shows.some(([a, b]) => t >= a && t <= b);
    const longs = window.__long.filter((e) => e.start >= t0 - 5 && e.start <= tEnd);
    const blind = longs.filter((e) => !visibleAt(e.start)).reduce((s, e) => s + e.dur, 0);
    const gaps = shows.slice(1).map(([a], i) => Math.round(a - shows[i][1]));
    return { name, ok: ok !== false, totalMs: Math.round(tEnd - t0), firstPaintMs: shows.length ? Math.round(shows[0][0] - t0) : null,
      stages: [...new Set(ov.filter((e) => e.v).map((e) => e.txt))], surfaces: [...new Set(ov.filter((e) => e.v).map((e) => e.surface))],
      shows: shows.length, shortestShowMs: shows.length ? Math.round(Math.min(...shows.map(([a, b]) => b - a))) : null,
      blindMs: Math.round(blind), longestTaskMs: Math.round(Math.max(0, ...longs.map((e) => e.dur))), gapsMs: gaps };
  };
})()`);
await send('Emulation.setCPUThrottlingRate', { rate: CPU });

const results = [];
const measure = async (name, body) => {
  const r = await evalJS(`(async()=>{ const W = ms => new Promise(r=>setTimeout(r,ms));
    return JSON.stringify(await window.__measure(${JSON.stringify(name)}, async () => { ${body} })); })()`);
  const row = r ? JSON.parse(r) : { name, error: 'eval failed' };
  results.push(row);
  console.log(JSON.stringify(row));
};

await measure('Generate New Seed', `document.getElementById('btnRandomSeed').click();`);
await measure('filter slider: drag (scale) + release', `return window.__drag('scaleSlider', [0.9, 1.0, 1.1, 1.2, 1.3, 1.4]);`);
await measure('filter slider: one release (density)', `return window.__drag('densitySlider', [0.6], 0);`);
await measure('noise type change', `const s = document.getElementById('noiseType'); const o = [...s.options].find((x) => x.value !== s.value); return o ? window.__set('noiseType', o.value) : false;`);
await measure('carve depth: drag + release', `return window.__drag('carveZSlider', [1.3, 1.2, 1.1, 1.0]);`);
await measure('thicken offset: drag + release', `return window.__drag('thickenOffsetSlider', [0.55, 0.6, 0.65, 0.7]);`);
await measure('resolution change (spacing)', `const s = document.getElementById('spacing'); const o = [...s.options].find((x) => x.value !== s.value && Number(x.value) >= 0.03); return o ? window.__set('spacing', o.value) : false;`);
await measure('stock width change', `return window.__set('widthIn', 8);`);
await measure('stock height change', `return window.__set('heightIn', 10);`);
await measure('frame template change', `const s = document.getElementById('frameTemplate'); const o = [...s.options].find((x) => x.value && x.value !== s.value); return o ? window.__set('frameTemplate', o.value) : false;`);
await measure('sculpt stroke (top draw)', `document.getElementById('btnToolTopDraw')?.click(); await W(800);
  const cfg = window.__preview && window.__preview._sculpt && window.__preview._sculpt._sculpt; if (!cfg) return false;
  cfg.onStart('top'); for (let k = 0; k < 8; k++) { cfg.onStroke('top', 30 + k, 40, 0.02); await W(60); } cfg.onStrokeEnd('top');
  document.getElementById('btnToolTopDraw')?.click(); return true;`);
// set up outside the measurement: the editor open, a wall laid -- then only the Apply is timed
await evalJS(`(async()=>{ const W = ms => new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnEditBricks').click(); await W(2500); await window.__idle();
  document.getElementById('editorTabBrick').click(); await W(300); document.getElementById('brickTool_wall').click(); await W(300);
  document.getElementById('brickGenerate').click(); await W(1200); await window.__idle(); })()`);
await measure('editor Apply (bricks laid)', `document.getElementById('editorApply').click();`);
await measure('project load (applySnapshot)', `const { applySnapshot } = await import('./main/snapshot-manager.js');
  const { persistableP } = await import('./core/state.js');
  await applySnapshot({ P: JSON.parse(JSON.stringify(persistableP())), preDelta: null, postDelta: null, extraThickenThinMask: null }, window.__preview, { source: 'load' });`);

const report = { tag: TAG, cpu: CPU, width: 900, results, errors: errors.slice(0, 8) };
writeFileSync(`${OUT_DIR}/${TAG}_geometry_refresh.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ errors: report.errors }));
ws.close(); chrome.kill();

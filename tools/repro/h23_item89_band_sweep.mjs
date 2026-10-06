// H23 item 89: the Fusion-side BASELINE for the joint-planner fix -- frame bands only (no wall), every template x
// BAND_PRESETS at BRICK_LENGTH_IN, laid in the real app (headless Chrome, a fresh state per case), and the Bricks
// payload taken through the Send's own functions (export-flow.js _bricksLayerSvg + editor-io.js bakeSvgForCarving,
// exactly what sendToFusion puts in stamp.bricks). One JSON per case in <outDir>; existing cases are skipped (resume).
//   python tools/serve_app.py <port>   then
//   node tools/repro/h23_item89_band_sweep.mjs <outDir> <paletteUrl> [cdpPort] [--board=WxH] [--only=template_1,...] [--seed=89]
// The Fusion half (import the svg through the add-in's own _apply_bricks_sketch) reads these files.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';

const BAND_PRESETS = ['single_soldier', 'three_band', 'double_course'];
const BRICK_LENGTH_IN = 1;
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = (k, d) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').slice(k.length + 3) || d;
const [OUT, URL, PORTARG] = ARGS;
const PORT = Number(PORTARG || 9396);
const [BW, BH] = opt('board', '7x9').split('x').map(Number);
const ONLY = opt('only', '') ? opt('only', '').split(',') : null;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${OUT}/chrome-sweep-${PORT}`;
mkdirSync(OUT, { recursive: true });
rmSync(PROFILE, { recursive: true, force: true }); // a reused profile restores the previous board (item 83)
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
const evalJS = async (expr) => {
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r?.exceptionDetails) console.log('PAGE EVAL ERROR:', String(r.exceptionDetails.exception?.description || r.exceptionDetails.text).split(/\r?\n/)[0]);
  return r?.result?.value;
};
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
// Math.random SEEDED before any page script: a fresh load otherwise draws a new frame shape / terrain each time
// (measured: one template, three different silhouettes), and the before/after must lay the SAME boards.
const SEED = Number(opt('seed', '89'));
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  { let s = ${SEED} >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
  window.adsk = { fusionSendData() { return ''; } };` });

const templates = JSON.parse(await (async () => {
  await send('Page.navigate', { url: URL }); await sleep(8000);
  return evalJS(`(async()=>{ const FD = (await import('./data/frame-defs.js')).default; return JSON.stringify(FD.templates.map((t) => t.id)); })()`);
})());
const todo = templates.filter((t) => !ONLY || ONLY.includes(t));
for (const template of todo) {
  for (const preset of BAND_PRESETS) {
    const file = `${OUT}/${template}__${preset}.json`;
    if (existsSync(file)) { console.log('skip (done)', template, preset); continue; }
    // A FRESH start: wipe the origin's storage from about:blank. MEASURED (item 89 follow-up): localStorage.clear() from
    // inside the app and then navigating does NOT give one -- the previous board (frame record, terrain seed) came back.
    await send('Page.navigate', { url: 'about:blank' }); await sleep(800);
    await send('Storage.clearDataForOrigin', { origin: new globalThis.URL(URL).origin, storageTypes: 'all' });
    await send('Page.navigate', { url: URL }); await sleep(8000);
    const t0 = Date.now();
    const r = JSON.parse(await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
      document.getElementById('btnStampEdit').click(); await W(2500);
      { const w = document.getElementById('widthIn'), h = document.getElementById('heightIn');
        w.value = '${BW}'; w.dispatchEvent(new Event('change')); h.value = '${BH}'; h.dispatchEvent(new Event('change')); await W(500); }
      (await import('./main/frame-panel.js')).editFrame({ templateId: '${template}', params: {} }); await W(1500);
      document.getElementById('editorFrameGenerate').click(); await W(1500);
      document.getElementById('editorTabBrick').click(); await W(800);
      const B = await import('./main/brick-panel.js'), S = await import('./core/state.js');
      B.setBrickSize(${BRICK_LENGTH_IN}); B.setFrameBandPreset('${preset}'); await W(300);
      document.getElementById('brickTool_frame').click(); await W(500);
      const t = performance.now();
      document.getElementById('brickGenerate').click();
      const q = () => document.querySelectorAll('[data-brick-gen="1"]').length;
      let last = -1, stable = 0;
      for (let i = 0; i < 120 && stable < 6; i++) { await W(250); const n = q(); if (n === last && n > 0) stable++; else stable = 0; last = n; }
      const layMs = Math.round(performance.now() - t);
      const ed = window.svgEditor, X = await import('./main/export-flow.js'), IO = await import('./editor/editor-io.js');
      const polys = [...ed._sketchLayer.node.querySelectorAll('[data-brick-gen="1"]')];
      const byKind = {}; for (const p of polys) { const k = p.getAttribute('data-brick') || '?'; byKind[k] = (byKind[k] || 0) + 1; }
      const raw = await X._bricksLayerSvg(ed);
      const svg = raw ? await IO.bakeSvgForCarving(raw, S.P.widthIn, S.P.heightIn, 96) : '';
      return JSON.stringify({ pieces: polys.length, byKind, layMs, board: [S.P.widthIn, S.P.heightIn],
        brickLengthIn: S.P.brickSettings.brickLengthIn, preset: S.P.brickSettings.frameBandPreset,
        bricks: svg ? { enabled: true, carve: true, svg } : { enabled: false } }); })()`) || 'null');
    if (!r) { console.log('FAILED', template, preset); continue; }
    writeFileSync(file, JSON.stringify({ template, ...r }));
    console.log(template, preset, 'pieces', r.pieces, JSON.stringify(r.byKind), 'lay ms', r.layMs, 'case s', ((Date.now() - t0) / 1000).toFixed(1));
  }
}
ws.close(); chrome.kill();

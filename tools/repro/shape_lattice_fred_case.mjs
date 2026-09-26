// SIL-RESOLVE (F5) repro: Fred's live Shape Lattice case (Hourglass, waist reach
// 0.294, corner radius 0.432, waist position 0) in the real app, via a minimal
// CDP driver (no deps, same pattern as select_drag_shape.mjs).
//   node tools/repro/shape_lattice_fred_case.mjs <out.png> <paletteUrl> [desktop|mobile] [port]
// Serve from the bspline-frame-builder folder so the CSS loads, e.g.
//   python -m http.server 8784 --directory <repo>/bspline-frame-builder
//   url = http://127.0.0.1:8784/b-spline-gen/html/bspline_gen_palette.html
// Prints the outline guard's verdict for the drawn contour.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [OUTPNG, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9345);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(OUTPNG)}/chrome-fredcase-${PORT}`;
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
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') errors.push((msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
else await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
const verdict = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('shapePresetHourglass')?.click(); await W(300);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500);
  const set = async (k, v) => { const el = document.getElementById('shapeParam-' + k); el.value = String(v); el.dispatchEvent(new Event('change')); await W(1200); };
  await set('waistCenterY', 0); await set('waistReach', 0.294); await set('cornerRadius', 0.432);
  const cr = document.getElementById('shapeParam-cornerRadius');
  const e = window.svgEditor;
  return JSON.stringify({ cornerRadiusSlider: { value: cr.value, min: cr.min, max: cr.max },
    defects: e && e._shapeOutlineDefects ? e._shapeOutlineDefects.map((d) => d.kind) : 'n/a (pre-F5 build)',
    hint: document.getElementById('editorStatusHint')?.textContent || '' });
})()`);
const shotRes = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUTPNG, Buffer.from(shotRes.result.data, 'base64'));
console.log(verdict);
if (errors.length) console.log('PAGE ERRORS:', errors.slice(0, 3));
ws.close(); chrome.kill();

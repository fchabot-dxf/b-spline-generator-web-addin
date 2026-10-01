// T82 item 3 acceptance shots: the inset window's own subframe bars shown in the 3D preview (behind the
// panel, visible from the back/side/bottom) and the hole cut as a clean edge, not jagged.
//   node tools/repro/inset_window_3d_shots.mjs <outPrefix> <paletteUrl> <template_1> [port]
// Serve from the bspline-frame-builder folder so the CSS loads:
//   python -m http.server <port> --directory <repo>/bspline-frame-builder
// Writes <outPrefix>_front.png and <outPrefix>_below.png.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9362);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-insetwin3d-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
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
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
const initial = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(1500);
  const rec = await import('./core/frame-record.js'); const panel = await import('./main/frame-panel.js');
  rec.setFrameRecord({ insetWindow: { enabled: true, x1: 2, y1: 3, x2: 5, y2: 6 } }); panel.syncFramePanel(); await W(1200);
  const { AppState } = await import('./main/app-state.js'); const p = AppState.preview;
  const names = (p?._frameMeshes || []).map(m => m.name);
  return JSON.stringify({ frameMeshNames: names, hasWindowBars: names.includes('frame-window-bars'), hasWindowWall: names.includes('frame-window-wall') });
})()`);
await shot('front');
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const { AppState } = await import('./main/app-state.js'); const p = AppState.preview, o = p._orbit, T = p._THREE;
  o._targetOrb.q.setFromEuler(new T.Euler(2.25, 0, 0.6, 'ZXY')); o._targetOrb.r = 12; o._targetOrb.target.set(0, 0, -0.5);
  p._needsRender = true; await W(2500); })()`);
await shot('below');
console.log(JSON.stringify({ initial: JSON.parse(initial || 'null'), errors: errors.slice(0, 3) }));
ws.close(); chrome.kill();

// FB-APP F9 item 1 shots: the sidebar FRAME section's "Trim offset (in)" field, at the
// default and at a changed value, with the 3D trim following it live (same page, no reload).
//   node tools/repro/frame_trim_shots.mjs <outPrefix> <paletteUrl> <template_1|template_2> <value> [port]
// Writes <outPrefix>_default.png and <outPrefix>_<value>.png; prints what the app read back.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, VALUE, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9471);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-frametrim-${PORT}`;
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
const STATE = `(async()=>{ const rec = await import('./core/frame-record.js'); const prof = await import('./editor/editor-frame-profile.js');
  const r = rec.getFrameRecord(), p = prof.frameCutProfile(rec.FRAME_DEFS, r, { widthIn: 7, heightIn: 9 });
  const { AppState } = await import('./main/app-state.js'); const g = AppState.preview._mesh.geometry;
  return JSON.stringify({ field: document.getElementById('frameTrimOffset').value, record: r.params, region: p.region,
    fitOk: p.fit.ok, keptTriangles: g.index.count / 3 }); })()`;

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(300);
  const h = document.getElementById('framePanelHeader'); if (h.classList.contains('collapsed')) h.click();
  document.querySelector('.panel-frame .panel-body')?.classList.remove('hidden'); await W(1500); })()`);
const out = { template: TEMPLATE, atDefault: JSON.parse(await evalJS(STATE)) };
await shot('default');
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const f = document.getElementById('frameTrimOffset'); f.value = '${VALUE}'; f.dispatchEvent(new Event('input', { bubbles: true }));
  f.dispatchEvent(new Event('change', { bubbles: true })); await W(1500); })()`);
out.atValue = JSON.parse(await evalJS(STATE));
await shot(String(VALUE));
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out));
ws.close(); chrome.kill();

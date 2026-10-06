// F35 item 70 (seat A, measured live): what the CAM palette's status line reads for each report shape -- a BUILD
// report, APPLY's own report, failures with and without an errors list. Headless, the real palette, served with the
// deploy's folder layout (python tools/serve_app.py <port>).
//   node tools/repro/f35item70_cam_report_status.mjs <outDir> http://127.0.0.1:<port>/CAM-builder/ui/html/cam_builder_palette.html
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const [OUT, URL] = process.argv.slice(2); const PORT = 9592;
mkdirSync(`${OUT}/.p2`, { recursive: true });
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/.p2`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; for (let i = 0; i < 50 && !ws; i++) { await sleep(200); try { const u = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; if (u) ws = new WebSocket(u); } catch {} }
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pend = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable'); await send('Page.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: URL }); await sleep(4000);
const r = await send('Runtime.evaluate', { expression: `(()=>{ const h = (a, d) => window.fusionJavaScriptHandler.handle(a, JSON.stringify(d)); const bar = () => document.getElementById('status-bar-bspline').textContent; const out = {};
  h('report', { ok: true, mode: 'bspline', mms: { stock: true, bspline_set: true, frame: true }, setups: [{ name: 'Setup 1', ok: true }, { name: 'Setup 2', ok: true }, { name: 'Setup 3', ok: true }, { name: 'Setup 4', ok: true }] }); out.build = bar();
  h('report', { ok: true, msg: 'Templates applied to 3 setup(s). Toolpath generation in progress.' }); out.apply = bar();
  h('report', { ok: false, msg: 'Toolpaths missing: 3' }); out.failNoErrors = bar();
  h('report', { ok: false, errors: ['MM frame was not built.'] }); out.failErrors = bar();
  return JSON.stringify(out, null, 1); })()`, returnByValue: true });
console.log(r.result.result.value); ws.close(); chrome.kill();

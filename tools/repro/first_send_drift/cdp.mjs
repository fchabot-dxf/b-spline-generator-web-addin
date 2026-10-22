// usage: node cdp.mjs start | eval <exprFile> [shot.png] | stop
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os'; import { resolve } from 'node:path';
const SP = resolve(tmpdir(), 'first-send-drift'); mkdirSync(SP, { recursive: true }); const PORT = 12783, SRV = 12782;
const WT = resolve(import.meta.dirname, '../../..').split(String.fromCharCode(92)).join('/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = process.argv[2];
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { ws, send };
}
if (mode === 'start') {
  const srv = spawn('python', [`${WT}/tools/serve_app.py`, String(SRV)], { detached: true, windowsHide: true, stdio: 'ignore' }); srv.unref();
  mkdirSync(`${SP}/prof2`, { recursive: true });
  const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${SP}/prof2`, '--no-first-run', '--window-size=1400,900', 'about:blank'], { detached: true, windowsHide: true, stdio: 'ignore' }); ch.unref();
  writeFileSync(`${SP}/pids2.json`, JSON.stringify({ srv: srv.pid, chrome: ch.pid }));
  await sleep(3000);
  const { ws, send } = await connect();
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `{ let s = 20261022 >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; } window.__sends = []; window.adsk = { fusionSendData(a, d) { window.__sends.push([a, d]); return ''; } };` });
  await send('Page.navigate', { url: `http://127.0.0.1:${SRV}/b-spline-gen/html/bspline_gen_palette.html` });
  await sleep(10000);
  console.log('started', readFileSync(`${SP}/pids2.json`, 'utf8')); ws.close();
} else if (mode === 'reload') {
  const { ws, send } = await connect();
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `{ let s = 20261022 >>> 0; Math.random = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; } window.__sends = []; window.adsk = { fusionSendData(a, d) { window.__sends.push([a, d]); return ''; } };` });
  await send('Page.reload'); await sleep(11000); console.log('reloaded'); ws.close();
} else if (mode === 'eval') {
  const { ws, send } = await connect();
  const expr = readFileSync(process.argv[3], 'utf8');
  const r = (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result;
  if (r.exceptionDetails) console.log('EVAL ERROR', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  else console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value));
  if (process.argv[4]) { const s = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(process.argv[4], Buffer.from(s.result.data, 'base64')); }
  ws.close();
}

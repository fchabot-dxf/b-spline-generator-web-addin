// F22 PANEL LIP shots: T1 chosen, the Frame section's "Panel lip (in)" set (the real field), the editor's Frame tab
// (the lip band just outside the outline) and the 3D preview (the panel trimmed on the lip loop, the bars unchanged).
//   node tools/repro/panel_lip_shots.mjs <outPrefix> <paletteUrl> [lip] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, LIP = '0.25', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9581);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-panellip-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disk-cache-size=1', '--use-angle=swiftshader', 'about:blank'], { stdio: 'ignore' });
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
const out = {};
out.set = JSON.parse(await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const t = document.getElementById('frameTemplate'); t.value = 'template_1'; t.dispatchEvent(new Event('change')); await W(1500);
  const l = document.getElementById('framePanelLip'); l.value = '${LIP}'; l.dispatchEvent(new Event('change')); await W(2500);
  const rec = (await import('./core/frame-record.js')).getFrameRecord();
  return JSON.stringify({ panelLip: rec.panelLip, fieldMax: l.max, fieldMin: l.min }); })()`));
await shot('3d');
out.editor = JSON.parse(await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnEditFrameShape').click(); await W(3000);
  const band = window.svgEditor._bgLayer.node.querySelector('.frame-panel-lip');
  return JSON.stringify({ band: !!band }); })()`));
await shot('frame_tab');
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out));
ws.close(); chrome.kill();

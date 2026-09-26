// FB-APP F8 acceptance shots: the editor's [Frame | Artwork] tabs for one template.
// "Edit frame shape" -> Frame tab shot; then the Artwork tab shot.
//   node tools/repro/frame_tabs_shots.mjs <outPrefix> <paletteUrl> <template_1|template_2> [desktop|mobile] [port]
// Serve from the bspline-frame-builder folder so the CSS loads:
//   python -m http.server 8784 --directory <repo>/bspline-frame-builder
// Writes <outPrefix>_frame-tab.png and <outPrefix>_artwork-tab.png; prints the state it read back.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9351);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-frametabs-${PORT}`;
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
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
const frameTab = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(400);
  document.getElementById('btnEditFrameShape').click(); await W(3000);
  const vis = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return JSON.stringify({ framePanel: vis('editorFramePanel'), layersPanel: vis('editorLayersPanel'), shield: vis('editorFrameShield'),
    template: document.getElementById('editorFrameTemplate').value, thickness: document.getElementById('editorFrameThickness').value,
    profileDrawn: !!document.getElementById('frame-profile') });
})()`);
await shot('frame-tab');
const artTab = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('editorTabArtwork').click(); await W(800);
  const vis = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return JSON.stringify({ framePanel: vis('editorFramePanel'), layersPanel: vis('editorLayersPanel'), shield: vis('editorFrameShield'),
    profileDrawn: !!document.getElementById('frame-profile') });
})()`);
await shot('artwork-tab');
console.log(JSON.stringify({ template: TEMPLATE, mode: MODE, frameTab: JSON.parse(frameTab || 'null'), artworkTab: JSON.parse(artTab || 'null'), errors: errors.slice(0, 3) }));
ws.close(); chrome.kill();

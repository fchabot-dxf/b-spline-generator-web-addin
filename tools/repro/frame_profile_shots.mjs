// FB-APP S2 (F6) acceptance shots (design §3.5): the sidebar FRAME section and
// the editor's board drawn as the frame's cut profile, for one template.
//   node tools/repro/frame_profile_shots.mjs <outPrefix> <paletteUrl> <template_1|template_2> [desktop|mobile] [port]
// Serve from the bspline-frame-builder folder so the CSS loads:
//   python -m http.server 8784 --directory <repo>/bspline-frame-builder
// Writes <outPrefix>_sidebar.png and <outPrefix>_editor.png; prints the state it read back.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9351);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-frameshots-${PORT}`;
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
const sidebar = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(500);
  const hdr = document.getElementById('framePanelHeader'); if (hdr.classList.contains('collapsed')) hdr.click(); await W(400);
  (document.querySelector('.panel-stock') || hdr).scrollIntoView({ block: 'start' }); await W(400);
  return JSON.stringify({ summary: document.getElementById('frameSummary').textContent,
    settingsShown: document.getElementById('frameSettings').style.display !== 'none',
    woods: [...document.getElementById('frameAppearance').options].map(o => o.textContent) });
})()`);
await shot('sidebar');
const editor = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(3000);
  const e = window.svgEditor; const g = document.getElementById('frame-profile');
  return JSON.stringify({ profileDrawn: !!g, defects: e && e._frameProfile ? e._frameProfile.defects.length : 'n/a',
    fit: e && e._frameProfile ? e._frameProfile.fit.ok : 'n/a', board: e ? [e._mW, e._mH] : null });
})()`);
await shot('editor');
console.log(JSON.stringify({ sidebar: JSON.parse(sidebar || 'null'), editor: JSON.parse(editor || 'null'), errors: errors.slice(0, 3) }));
ws.close(); chrome.kill();

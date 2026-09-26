// UI5 items 1/3/4 acceptance shots: the "Selected piece" override panel
// with an active colour + width override on a rail.
//   node tools/repro/piece_override_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
// Serve with tools/serve_app.py so the CSS loads. Writes <outPrefix>.png.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9391);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-pieceshots-${PORT}`;
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
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
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
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolLattice').click(); await W(800);
  document.getElementById('latticeGenerate').click(); await W(2500);
})()`);
// Direct select (not a pixel click) -- deterministic regardless of mobile
// drawer layout or any rail/node hit-test coincidence.
await evalJS(`(()=>{
  const rail = document.querySelector('[data-lattice="rail"]');
  const ed = window.svgEditor;
  const wrapped = ed._sketchLayer.children().toArray().find(c => c.node === rail);
  ed._select(wrapped);
})()`);
await sleep(400);
await evalJS(`document.querySelector('.lattice-piece-color')?.click()`);
await sleep(500);
const pickResult = await evalJS(`(()=>{ const cell = [...document.querySelectorAll('button')].find(b => (b.title||'').toLowerCase() === '#1565c0'); if (cell) { cell.click(); return 'clicked'; } return 'NOT FOUND'; })()`);
console.log('mosaic pick:', pickResult);
await sleep(500);
await evalJS(`(()=>{ const input = document.querySelector('.lattice-piece-width'); if (input) { input.value = 0.4; input.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
await sleep(500);
const finalState = await evalJS(`(()=>{ const p = document.querySelector('.lattice-piece-panel'); return p ? p.querySelector('.lattice-piece-color').style.background + ' / ' + p.querySelector('.lattice-piece-width').value : 'NO PANEL'; })()`);
console.log('final panel state:', finalState);
// Page.captureScreenshot can otherwise beat the compositor to the punch --
// force two real paint frames before capturing.
await evalJS(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
await sleep(300);
if (MODE === 'mobile') {
  // The tool's own settings panel lives in the drawer on mobile -- open it.
  await evalJS(`(()=>{ const t=[...document.querySelectorAll('[role=tab],button')].find(b=>/lattice/i.test(b.textContent||'')); if (t) t.click(); })()`);
  await sleep(400);
}
await shot(MODE);
console.log('saved', `${PREFIX}_${MODE}.png`);
chrome.kill();
process.exit(0);

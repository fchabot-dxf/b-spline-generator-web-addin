// FB-APP F13 (FRAME-GEN) shots: the Frame tab's [Generate] pressed 3 times (3 shapes), then the
// first handle tweaked with a real pointer drag through the Frame tab's shield.
//   node tools/repro/frame_gen_shots.mjs <outPrefix> <paletteUrl> <template_1|template_2> [desktop|mobile] [port]
// Writes <outPrefix>_gen1..3.png and _tweaked.png; prints each shape's seed + seeds and the tweak.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9541);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-framegen-${PORT}`;
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
const STATE = `(async()=>{ const rec = (await import('./core/frame-record.js')).getFrameRecord();
  return JSON.stringify({ genSeed: rec.genSeed, seeds: rec.seeds, defects: (window.svgEditor._frameProfile?.defects || []).length,
    undoEnabled: !document.getElementById('editorFrameUndo').disabled }); })()`;

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = '${TEMPLATE}'; sel.dispatchEvent(new Event('change')); await W(400);
  document.getElementById('btnEditFrameShape').click(); await W(3000); })()`);
const out = { template: TEMPLATE, mode: MODE, shapes: [] };
for (let k = 1; k <= 3; k++) {
  await evalJS(`(async()=>{ document.getElementById('editorFrameGenerate').click(); await new Promise(r=>setTimeout(r,1200)); })()`);
  out.shapes.push(JSON.parse(await evalJS(STATE)));
  await shot(`gen${k}`);
}
out.tweak = JSON.parse(await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const ed = window.svgEditor, h = ed._frameHandles[0], m = ed._draw.node.getScreenCTM();
  const scr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
  const to = h.axis === 'x' ? { x: h.anchor.x - 0.4, y: h.anchor.y } : { x: h.anchor.x, y: h.anchor.y + 0.5 };
  const shield = document.getElementById('editorFrameShield');
  const fire = (type, p) => { const c = scr(p); shield.dispatchEvent(new PointerEvent(type, { clientX: c.x, clientY: c.y, bubbles: true, cancelable: true, pointerId: 1, pointerType: '${MODE === 'mobile' ? 'touch' : 'mouse'}' })); };
  fire('pointerdown', h.anchor);
  for (let k = 1; k <= 6; k++) { fire('pointermove', { x: h.anchor.x + (to.x - h.anchor.x) * k / 6, y: h.anchor.y + (to.y - h.anchor.y) * k / 6 }); await W(50); }
  fire('pointerup', to); await W(1500);
  return JSON.stringify({ key: h.key }); })()`) || 'null');
out.tweaked = JSON.parse(await evalJS(STATE));
await shot('tweaked');
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out));
ws.close(); chrome.kill();

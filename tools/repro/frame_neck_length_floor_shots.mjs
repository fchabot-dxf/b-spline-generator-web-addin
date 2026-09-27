// F24 item 2/3: T2's "Shoulder height" (neckLength) handle dragged with REAL input (CDP mouse on desktop,
// touch on mobile) toward its NEW floor -- proving a manual drag now reaches the true geometric floor
// (~0.01) rather than the retired declared-band floor (0.08).
//   node tools/repro/frame_neck_length_floor_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9591);
const MOBILE = MODE === 'mobile';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-necklength-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
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

async function press(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y }] });
  else { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y }); await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1 }); }
  await sleep(60);
}
async function moveTo(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: s.x, y: s.y }] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'left', buttons: 1 });
  await sleep(30);
}
async function release(s) {
  if (MOBILE) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1 });
  await sleep(800);
}
const STATE = `(async()=>{ const rec = (await import('./core/frame-record.js')).getFrameRecord(); const ed = window.svgEditor;
  const { feasibleParamRanges } = await import('./editor/editor-shape-lattice-generator.js');
  const m = ed._draw.node.getScreenCTM(); const scr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
  const prof = ed._frameProfile;
  const ranges = prof ? feasibleParamRanges('bottle', prof.region, prof.params) : {};
  return JSON.stringify({ seeds: rec.seeds, defects: (prof?.defects || []).length, ranges,
    handles: Object.fromEntries((ed._frameHandles || []).map((h) => [h.key, { label: h.label, axis: h.axis, anchor: h.anchor, screen: scr(h.anchor) }])) }); })()`;
const state = async () => JSON.parse(await evalJS(STATE));

await send('Runtime.enable'); await send('Page.enable');
if (MOBILE) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = 'template_2'; sel.dispatchEvent(new Event('change')); await W(400);
  document.getElementById('btnEditFrameShape').click(); await W(3000); })()`);
const out = { mode: MODE };
const s0 = await state();
await shot('before');
const key = 'neckLength';
const h = s0.handles[key];
if (!h) { out.error = 'no handle'; out.have = Object.keys(s0.handles); console.log(JSON.stringify(out, null, 1)); ws.close(); chrome.kill(); process.exit(0); }
// drag toward the floor: neckLength increases as world y INCREASES (this handle's own
// valueFromWorld reads (pt.y - region.y)/region.h), so a big upward drag (past the old 0.08 floor) reaches the min.
const toBoard = { x: h.anchor.x, y: h.anchor.y - 10 };
const to = JSON.parse(await evalJS(`(()=>{ const m = window.svgEditor._draw.node.getScreenCTM();
  return JSON.stringify({ x: m.a * ${toBoard.x} + m.c * ${toBoard.y} + m.e, y: m.b * ${toBoard.x} + m.d * ${toBoard.y} + m.f }); })()`));
await press(h.screen);
for (let k = 1; k <= 8; k++) await moveTo({ x: h.screen.x + (to.x - h.screen.x) * k / 8, y: h.screen.y + (to.y - h.screen.y) * k / 8 });
await release(to);
const now = await state();
const r = now.ranges[key];
out.seedValue = now.seeds[key];
out.range = r;
out.pastOldFloor = now.seeds[key] < 0.08;
out.atMin = r ? Math.abs(now.seeds[key] - r.min) < 1e-6 : null;
out.defects = now.defects;
await shot('after');
out.ok = out.pastOldFloor && out.atMin && out.defects === 0 && !errors.length;
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();

// F20 SHOULDER-HIP: the T1 frame's Shoulder and Hip handles dragged INDEPENDENTLY in the Frame tab, with real
// input (CDP mouse on desktop, touch on mobile). Each drag must change only its own seed, move its own handle and
// leave the other handle exactly where it was; the outline stays defect-free. Shots before / after each drag.
//   node tools/repro/frame_shoulder_hip_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9561);
const MOBILE = MODE === 'mobile';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-shoulderhip-${PORT}`;
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
// the handles (board inches + screen px), the record's seeds and the outline defects
const STATE = `(async()=>{ const rec = (await import('./core/frame-record.js')).getFrameRecord(); const ed = window.svgEditor;
  const m = ed._draw.node.getScreenCTM(); const scr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
  return JSON.stringify({ seeds: rec.seeds, defects: (ed._frameProfile?.defects || []).length,
    handles: Object.fromEntries((ed._frameHandles || []).map((h) => [h.key, { label: h.label, axis: h.axis, anchor: h.anchor, screen: scr(h.anchor) }])) }); })()`;
const state = async () => JSON.parse(await evalJS(STATE));

await send('Runtime.enable'); await send('Page.enable');
if (MOBILE) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  const sel = document.getElementById('frameTemplate'); sel.value = 'template_1'; sel.dispatchEvent(new Event('change')); await W(400);
  document.getElementById('btnEditFrameShape').click(); await W(3000); })()`);
const out = { mode: MODE, steps: [] };
const s0 = await state();
out.labels = Object.fromEntries(Object.entries(s0.handles).map(([k, h]) => [k, h.label]));
await shot('before');
let prev = s0;
for (const [key, other, name] of [['cornerRadiusTop', 'cornerRadiusBottom', 'shoulder'], ['cornerRadiusBottom', 'cornerRadiusTop', 'hip']]) {
  const h = prev.handles[key];
  if (!h) { out.steps.push({ key, error: 'no handle', have: Object.keys(prev.handles) }); continue; }
  // drag 0.4 in toward the centreline along the handle's own axis (a bigger corner radius)
  const toBoard = h.axis === 'x' ? { x: h.anchor.x - 0.4, y: h.anchor.y } : { x: h.anchor.x, y: h.anchor.y + 0.4 };
  const to = JSON.parse(await evalJS(`(()=>{ const m = window.svgEditor._draw.node.getScreenCTM();
    return JSON.stringify({ x: m.a * ${toBoard.x} + m.c * ${toBoard.y} + m.e, y: m.b * ${toBoard.x} + m.d * ${toBoard.y} + m.f }); })()`));
  await press(h.screen);
  for (let k = 1; k <= 8; k++) await moveTo({ x: h.screen.x + (to.x - h.screen.x) * k / 8, y: h.screen.y + (to.y - h.screen.y) * k / 8 });
  await release(to);
  const now = await state();
  const changed = Object.keys({ ...prev.seeds, ...now.seeds }).filter((k) => prev.seeds[k] !== now.seeds[k]);
  out.steps.push({ key, label: h.label, changedSeeds: changed, seeds: now.seeds, defects: now.defects,
    ownMoved: Math.hypot(now.handles[key].anchor.x - h.anchor.x, now.handles[key].anchor.y - h.anchor.y),
    otherMoved: Math.hypot(now.handles[other].anchor.x - prev.handles[other].anchor.x, now.handles[other].anchor.y - prev.handles[other].anchor.y) });
  await shot(`after_${name}`);
  prev = now;
}
out.ok = out.labels.cornerRadiusTop === 'Shoulder' && out.labels.cornerRadiusBottom === 'Hip' && !('cornerRadius' in out.labels)
  && out.steps.length === 2 && out.steps.every((s) => !s.error && s.changedSeeds.length === 1 && s.changedSeeds[0] === s.key
    && s.ownMoved > 0.05 && s.otherMoved < 1e-9 && s.defects === 0) && !errors.length;
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out, null, 1));
ws.close(); chrome.kill();

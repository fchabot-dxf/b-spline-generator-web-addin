// F12 SHAPE-PARAMS shots: each NEW Shape Lattice handle before / after a real pointer drag.
//   node tools/repro/shape_params_shots.mjs <outPrefix> <paletteUrl> <hourglass|bottle> [desktop|mobile] [port]
// Opens the editor, Shape Lattice tool, the preset, Generate; then for each new handle
// (hourglass: cornerRadiusTop, cornerRadiusBottom, waistRadius; bottle: bodyRadius) drags it
// with PointerEvents on the canvas (board -> screen via the SVG's own screen CTM) and shoots.
// Prints each handle's param value before/after and the outline defects.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PRESET, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9511);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-shapeparams-${PORT}`;
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
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(2500);
  document.getElementById('toolShapeLattice').click(); await W(800);
  document.getElementById('${PRESET === 'bottle' ? 'shapePresetBottle' : 'shapePresetHourglass'}')?.click(); await W(400);
  document.getElementById('shapeLatticeGenerate').click(); await W(2500); })()`);
await shot('before');

const KEYS = PRESET === 'bottle' ? [['bodyRadius', -0.35]] : [['cornerRadiusTop', -0.35], ['cornerRadiusBottom', -0.2], ['waistRadius', 0.3]];
const out = { preset: PRESET, mode: MODE, drags: [] };
for (const [key, dx] of KEYS) {
  const r = JSON.parse(await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const { paramHandleRecords } = await import('./editor/properties-shape-lattice.js');
    const ed = window.svgEditor;
    const recs = paramHandleRecords(ed), h = recs.find((q) => q.key === '${key}');
    if (!h) return JSON.stringify({ key: '${key}', error: 'no handle', have: recs.map((q) => q.key) });
    const svg = ed._draw.node, m = svg.getScreenCTM();
    const scr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
    const valueOf = () => { const recs2 = paramHandleRecords(ed); return recs2.find((q) => q.key === '${key}'); };
    const before = h.valueFromWorld({ x: h.hx, y: h.hy });
    const to = { x: h.hx + ${dx}, y: h.hy };
    const type = '${MODE === 'mobile' ? 'touch' : 'mouse'}';
    const fire = (el, ev, p) => { const c = scr(p); el.dispatchEvent(new PointerEvent(ev, { clientX: c.x, clientY: c.y, bubbles: true, cancelable: true, pointerId: 7, pointerType: type, isPrimary: true, buttons: ev === 'pointerup' ? 0 : 1 })); };
    fire(svg, 'pointerdown', { x: h.hx, y: h.hy }); await W(50);
    for (let k = 1; k <= 8; k++) { fire(window, 'pointermove', { x: h.hx + (to.x - h.hx) * k / 8, y: h.hy }); await W(40); }
    fire(window, 'pointerup', to); await W(1500);
    const after = valueOf();
    return JSON.stringify({ key: '${key}', before: +before.toFixed(4), after: after ? +after.valueFromWorld({ x: after.hx, y: after.hy }).toFixed(4) : null,
      handleMovedTo: after ? { x: +after.hx.toFixed(3), y: +after.hy.toFixed(3) } : null, target: { x: +to.x.toFixed(3), y: +to.y.toFixed(3) },
      defects: (ed._shapeOutlineDefects || []).map((d) => d.kind) });
  })()`) || 'null');
  out.drags.push(r);
  await shot(`after-${key}`);
}
out.errors = errors.slice(0, 3);
console.log(JSON.stringify(out));
ws.close(); chrome.kill();

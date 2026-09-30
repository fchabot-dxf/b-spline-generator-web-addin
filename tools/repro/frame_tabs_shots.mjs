// FB-APP F8 acceptance shots: the editor's [Frame | Artwork] tabs for one template.
// "Edit frame shape" -> Frame tab shot; then the Artwork tab shot.
//   node tools/repro/frame_tabs_shots.mjs <outPrefix> <paletteUrl> <template_1|template_2> [desktop|mobile] [port] [art]
// With "art", a real artwork (paths + a circle on the active layer) is drawn first, and the
// artwork's SVG is read back on both tabs (switching tabs must never change it).
// With a 7th arg "drag" (F9), the first frame shape handle is dragged through the Frame tab's
// shield with real pointer events (board -> screen via the SVG's own screen CTM), then shot again.
// Serve from the bspline-frame-builder folder so the CSS loads:
//   python -m http.server 8784 --directory <repo>/bspline-frame-builder
// Writes <outPrefix>_frame-tab.png and <outPrefix>_artwork-tab.png; prints the state it read back.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, TEMPLATE, MODE = 'desktop', PORTARG, ART, DRAG] = process.argv.slice(2);
const ART_JS = ART ? `{ const e = window.svgEditor, L = String(e._activeLayer ?? '0');
    e._sketchLayer.path('M1.2 2.2 C 2.6 0.6, 4.4 3.8, 5.8 2.2').fill('none').stroke({ color: '#1565c0', width: 0.12 }).attr('data-layer', L);
    e._sketchLayer.path('M1.5 6.8 L 3.5 4.6 L 5.5 6.8 Z').fill('#e57373').stroke({ color: '#b71c1c', width: 0.06 }).attr('data-layer', L);
    e._sketchLayer.circle(1.6).center(3.5, 4.5).fill('none').stroke({ color: '#2e7d32', width: 0.1 }).attr('data-layer', L); }` : '';
const ART_SVG = "(window.svgEditor ? window.svgEditor._sketchLayer.children().map(el => el.svg()).join('') : '')";
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
  ${ART_JS} window.__artBefore = ${ART_SVG}; await W(300);
  const vis = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return JSON.stringify({ framePanel: vis('editorFramePanel'), layersPanel: vis('editorLayersPanel'), shield: vis('editorFrameShield'),
    template: document.getElementById('editorFrameTemplate').value, thickness: document.getElementById('frameThickness').value,
    profileDrawn: !!document.getElementById('frame-profile'), artShapes: window.svgEditor._sketchLayer.children().length,
    artOpacity: window.svgEditor._sketchLayer.attr('opacity'), artLocked: window.svgEditor._artworkLocked });
})()`);
await shot('frame-tab');
let dragged = null;
if (DRAG) {
  dragged = JSON.parse(await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
    const ed = window.svgEditor, h = ed._frameHandles[0], m = ed._draw.node.getScreenCTM();
    const scr = (p) => ({ x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f });
    const to = h.axis === 'x' ? { x: h.anchor.x - 0.6, y: h.anchor.y } : { x: h.anchor.x, y: h.anchor.y + 0.8 };
    const shield = document.getElementById('editorFrameShield');
    const fire = (type, p) => { const c = scr(p); shield.dispatchEvent(new PointerEvent(type, { clientX: c.x, clientY: c.y, bubbles: true, cancelable: true, pointerId: 1, pointerType: '${MODE === 'mobile' ? 'touch' : 'mouse'}' })); };
    fire('pointerdown', h.anchor);
    for (let k = 1; k <= 6; k++) { fire('pointermove', { x: h.anchor.x + (to.x - h.anchor.x) * k / 6, y: h.anchor.y + (to.y - h.anchor.y) * k / 6 }); await W(60); }
    fire('pointerup', to); await W(1500);
    const rec = (await import('./core/frame-record.js')).getFrameRecord();
    const after = ed._frameHandles.find((q) => q.key === h.key).anchor;
    return JSON.stringify({ key: h.key, axis: h.axis, from: h.anchor, to, handleNow: after, seeds: rec.seeds, params: rec.params });
  })()`) || 'null');
  await shot('frame-tab-dragged');
}
const artTab = await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('editorTabArtwork').click(); await W(800);
  const vis = (id) => { const el = document.getElementById(id); return !!el && el.offsetParent !== null; };
  return JSON.stringify({ framePanel: vis('editorFramePanel'), layersPanel: vis('editorLayersPanel'), shield: vis('editorFrameShield'),
    profileDrawn: !!document.getElementById('frame-profile'), artUnchanged: ${ART_SVG} === window.__artBefore,
    frameOpacity: document.getElementById('frame-profile')?.getAttribute('opacity'), artLocked: window.svgEditor._artworkLocked });
})()`);
await shot('artwork-tab');
console.log(JSON.stringify({ template: TEMPLATE, mode: MODE, dragged, frameTab: JSON.parse(frameTab || 'null'), artworkTab: JSON.parse(artTab || 'null'), errors: errors.slice(0, 3) }));
ws.close(); chrome.kill();

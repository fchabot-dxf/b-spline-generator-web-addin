// RAIL-SPACING R7 item 4: real-browser proof of the restructured panels — screenshots BOTH panels
// (box Lattice + Shape Lattice) in their new section order, and drives Fred's own case THROUGH THE
// UI this time (click Anchor "Top", Generate, confirm a rail lands exactly on the boundary edge).
//   python tools/serve_app.py 8780
//   node tools/repro/r7_panel_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [cdpPort]
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9400);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-r7-${PORT}`;
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
const rectOf = async (sel) => JSON.parse(await evalJS(`JSON.stringify((()=>{const r=document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null})())`));
const tap = async (sel) => {
  const p = await rectOf(sel); if (!p) return false;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(200); return true;
};

await send('Runtime.enable'); await send('Page.enable');
if (MODE === 'mobile') {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`document.getElementById('btnStampEdit')?.click()`); await sleep(2500);

// 1. Box Lattice panel — new section order.
await evalJS(`document.getElementById('toolLattice')?.click()`); await sleep(500);
await evalJS(`document.getElementById('editorLatticePanelBody')?.scrollIntoView({block:'start'})`);
await shot('box-panel');
const boxSections = await evalJS(`[...document.getElementById('editorLatticePanelBody').children]
  .map(c => c.querySelector(':scope > span[style*="font-weight:600"]')?.textContent.trim()).filter(Boolean)`);

// Fred's own case, via the UI this time: Anchor "Top", Generate, read the first rail's Y back.
await tap('#latticeRailsAnchorStart');
await evalJS(`(()=>{ const s=document.getElementById('latticeRailsSpacing'); s.value='1';
  s.dispatchEvent(new Event('input',{bubbles:true})); s.dispatchEvent(new Event('change',{bubbles:true})); })()`);
await tap('#latticeGenerate');
await sleep(500);
await shot('box-anchor-top');
const railCheck = await evalJS(`(()=>{ const e=window.svgEditor;
  const rails=[...e._sketchLayer.children()].filter(el => el.attr('data-lattice')==='rail');
  const ys=rails.map(el=>Number(el.attr('y1'))).sort((a,b)=>a-b);
  return JSON.stringify({ railCount: rails.length, firstRailY: ys[0], gaps: ys.slice(1).map((y,i)=>+(y-ys[i]).toFixed(6)) }); })()`);

// 2. Shape Lattice panel — new section order (Boundary, Contour, Rails, Ties, Nodes).
await evalJS(`document.getElementById('toolShapeLattice')?.click()`); await sleep(500);
await evalJS(`document.getElementById('shapePresetHourglass')?.click()`); await sleep(300);
await evalJS(`document.getElementById('editorShapeLatticePanelBody')?.scrollIntoView({block:'start'})`);
await shot('shape-panel');
const shapeSections = await evalJS(`[...document.getElementById('editorShapeLatticePanelBody').children]
  .map(c => c.querySelector(':scope > span[style*="font-weight:600"]')?.textContent.trim()).filter(Boolean)`);

console.log(JSON.stringify({
  mode: MODE, boxSections, shapeSections, railCheck: JSON.parse(railCheck || 'null'), errors: errors.slice(0, 5),
}, null, 1));
ws.close(); chrome.kill();

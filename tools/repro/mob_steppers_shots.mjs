// H4 MOB-STEPPERS + editor header acceptance, at the real 390px breakpoint:
// the header wraps to its own second row (Cancel/Apply Stencils always
// visible, no scroll gesture needed) with the "Active Layer" text label
// gone (the layer-name pill itself stays); every numeric stepper's own
// button/input hits the shared 44px touch size (sidebar .cad-stepper, the
// main-toolbar .stepper-container Stroke/Font/Detail steppers, and the
// Selected-piece panel's own bare width input); no row overflows 390px
// anywhere checked.
//   node tools/repro/mob_steppers_shots.mjs <outPrefix> <paletteUrl> [port]
// Serve with tools/serve_app.py so the CSS loads. Always runs at 390px
// mobile emulation (this feature has no desktop-facing behavior to shoot).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9470);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-h4verify-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) { await sleep(200); try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) {} }
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms)); document.getElementById('btnStampEdit').click(); await W(3000); })()`);

// 1) Header: Cancel + Apply Stencils visible without any scroll, no page overflow.
const headerInfo = await evalJS(`(()=>{
  const cancel = document.getElementById('editorCancel');
  const apply = document.getElementById('editorApply');
  const label = [...document.querySelectorAll('#svgEditorHeader span')].find(s => s.textContent.trim() === 'Active Layer');
  return JSON.stringify({
    cancelRect: cancel.getBoundingClientRect(), applyRect: apply.getBoundingClientRect(),
    docScrollWidth: document.documentElement.scrollWidth,
    activeLayerLabelExists: !!label,
    pill: document.getElementById('editorActiveLayerLabel')?.textContent,
  });
})()`);
console.log('header:', headerInfo);
const h = JSON.parse(headerInfo);
check(h.cancelRect.right <= 390 && h.cancelRect.right > 0, `H4: Cancel is fully within the 390px viewport without scrolling (right=${h.cancelRect.right})`);
check(h.applyRect.right <= 390 && h.applyRect.right > 0, `H4: Apply Stencils is fully within the 390px viewport without scrolling (right=${h.applyRect.right})`);
check(h.docScrollWidth <= 390, `H4: no page-level horizontal overflow (scrollWidth=${h.docScrollWidth})`);
check(!h.activeLayerLabelExists, 'H4: the "Active Layer" text label is gone');
check(!!h.pill, `H4: the layer-name pill itself still exists and shows a value (got "${h.pill}")`);
await shot('header');

// 2) Steppers: sidebar + lattice panel + frame section, no row overflow.
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms)); document.getElementById('toolLattice').click(); await W(800); document.getElementById('latticeGenerate').click(); await W(2000); })()`);
const stepperInfo = await evalJS(`(()=>{
  const cs = getComputedStyle(document.documentElement);
  const token = cs.getPropertyValue('--cad-stepper-touch').trim();
  const stepper = document.querySelector('.cad-stepper');
  const btn = stepper?.querySelector('button');
  const input = stepper?.querySelector('input');
  const toolbarStepper = document.querySelector('.stepper-container');
  const toolbarBtn = toolbarStepper?.querySelector('button');
  return JSON.stringify({
    token,
    stepperRect: stepper?.getBoundingClientRect(),
    btnRect: btn?.getBoundingClientRect(),
    inputRect: input?.getBoundingClientRect(),
    toolbarBtnRect: toolbarBtn?.getBoundingClientRect(),
    docScrollWidth: document.documentElement.scrollWidth,
  });
})()`);
console.log('steppers:', stepperInfo);
const s = JSON.parse(stepperInfo);
check(s.token === '44px', `H4: the shared --cad-stepper-touch token is 44px (got "${s.token}")`);
check(s.btnRect && s.btnRect.height >= 44 && s.btnRect.width >= 44, `H4: a .cad-stepper button is >= 44x44 (got ${JSON.stringify(s.btnRect)})`);
check(s.inputRect && s.inputRect.height >= 44, `H4: a .cad-stepper input has a matching >= 44px height (got ${JSON.stringify(s.inputRect)})`);
check(s.toolbarBtnRect && s.toolbarBtnRect.height >= 44 && s.toolbarBtnRect.width >= 44, `H4: a toolbar .stepper-container button is >= 44x44 (got ${JSON.stringify(s.toolbarBtnRect)})`);
check(s.docScrollWidth <= 390, `H4: no row overflow at 390px after stepper resize (scrollWidth=${s.docScrollWidth})`);
await shot('lattice_panel');

// 3) Selected-piece panel width input.
await evalJS(`(()=>{
  const rail = document.querySelector('[data-lattice="rail"]');
  const ed = window.svgEditor;
  const wrapped = ed._sketchLayer.children().toArray().find(c => c.node === rail);
  ed._select(wrapped);
})()`);
await sleep(300);
const pieceInfo = await evalJS(`(()=>{
  const input = [...document.querySelectorAll('.lattice-piece-width')].find(el => el.getBoundingClientRect().width > 0);
  return JSON.stringify({ rect: input?.getBoundingClientRect() });
})()`);
console.log('selected-piece panel:', pieceInfo);
const p = JSON.parse(pieceInfo);
check(p.rect && p.rect.height >= 44, `H4: the Selected-piece panel's width input has a matching >= 44px height (got ${JSON.stringify(p.rect)})`);
await shot('selected_piece_panel');

// 4) Frame section.
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms)); document.getElementById('editorTabFrame')?.click(); await W(1500); })()`);
const frameOverflow = await evalJS(`document.documentElement.scrollWidth`);
check(frameOverflow <= 390, `H4: no row overflow in the Frame section at 390px (scrollWidth=${frameOverflow})`);
await shot('frame_section');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);

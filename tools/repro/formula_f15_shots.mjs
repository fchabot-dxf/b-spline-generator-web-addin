// F15: the remaining formula fields in a real (headless) Chrome, with REAL key events: the stamp layer transform
// (Offset X, through bindLayerOnlyNumber -> the active layer), the sculpt Strength / Hardness (-> P, bound since F15),
// Frame bottom (z) and the Frame tab's thickness (-> the frame record). Each: a formula commits, a clamped one
// (rotation), a bad one keeps the old value, the dropdown lists the declared names. Reads back from the app's own
// state (P, the active stamp layer, the frame record).
//   python tools/serve_app.py 8780
//   node tools/repro/formula_f15_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [cdpPort]
// Writes <outPrefix>_stamp.png, _sculpt.png, _frame.png, _thickness.png; prints the checks as JSON.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9371);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-f15-${PORT}`;
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
const MOBILE = MODE === 'mobile';
const KEYS = { Enter: 13, Escape: 27 };
const typeText = async (s) => { for (const ch of s) { await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(30); } };
const press = async (k) => { const c = KEYS[k]; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: c, nativeVirtualKeyCode: c }); if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: c, nativeVirtualKeyCode: c }); await sleep(80); };
const rectOf = async (sel) => JSON.parse(await evalJS(`JSON.stringify((()=>{const r=document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r&&r.width?{x:r.left+r.width/2,y:r.top+r.height/2}:null})())`));
const tap = async (sel) => {
  const p = await rectOf(sel); if (!p) return false;
  if (MOBILE) {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p.x, y: p.y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  }
  await sleep(200); return true;
};
const openPanel = (cls) => evalJS(`(()=>{ const s=document.querySelector('.${cls}'); const h=s.querySelector('.panel-header');
  if (h.classList.contains('collapsed') || getComputedStyle(s.querySelector('.panel-body')).display==='none') h.click(); })()`);
const scrollTo = (sel) => evalJS(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'center'})`);
const read = async () => JSON.parse(await evalJS(`(async()=>{ const { P } = await import('./core/state.js');
  // the binder's own accessor (main/stamp/_shared.js activeLayer): the editor's layers, else P.stampLayers
  const E = window.svgEditor && window.svgEditor._layers; const L = (E && E.length ? E : (P.stampLayers||[]))[P.activeLayerIdx||0] || {};
  return JSON.stringify({ tx: L.tx, rotation: L.rotation, strength: P.sculptTopStrength, frame: P.frame,
    dropdown: [...document.querySelectorAll('.formula-dropdown li')].map(li=>li.dataset.name),
    preview: document.querySelector('.formula-preview')?.textContent || '' }); })()`));
/** Tap the field, select its text, type `text`; return the state while typing (before commit). */
const typeInto = async (sel, text) => { await scrollTo(sel); await sleep(200); await tap(sel); await evalJS(`document.querySelector(${JSON.stringify(sel)}).select()`); await typeText(text); return read(); };

await send('Runtime.enable'); await send('Page.enable');
if (MOBILE) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
const checks = {};
const W = JSON.parse(await evalJS(`(async()=>{ const { P } = await import('./core/state.js'); return JSON.stringify({ w: P.widthIn, h: P.heightIn }); })()`));

// 1. stamp layer transform: Offset X = width/4 (the active layer's tx), rotation clamped, bad kept
await openPanel('panel-stamp');
await evalJS(`document.querySelector('.panel-stamp details:has(#stampTx)').open = true`);
checks.stampTyping = await typeInto('#stampTx', 'width/4 + ro');
await shot('stamp');
await press('Escape');
await evalJS(`document.getElementById('stampTx').select()`); await typeText('width/4'); await press('Enter');
checks.stampTx = (await read()).tx; checks.stampTxOk = Math.abs(checks.stampTx - W.w / 4) < 1e-9;
await typeInto('#stampRotation', 'rotation+500'); await press('Enter');
checks.rotationClamped = (await read()).rotation === 180;
await typeInto('#stampTx', 'x+*'); await press('Enter');
checks.stampBadKept = (await read()).tx === checks.stampTx;
await press('Escape');

// 2. sculpt Strength / Hardness -> P.sculptTopStrength (unbound before F15)
await openPanel('panel-sculpt-top');
const s0 = (await read()).strength;
checks.sculptTyping = await typeInto('#sculptTopHardness', 'str');
await shot('sculpt');
await press('Enter');                       // pick "strength" from the dropdown
await typeText('*2'); await press('Enter');
checks.strength = { before: s0, after: (await read()).strength };
checks.strengthOk = Math.abs(checks.strength.after - s0 * 2) < 1e-9;
await typeInto('#sculptTopHardness', 'strength*100'); await press('Enter');
checks.strengthClamped = (await read()).strength === 0.1;

// 3. Frame bottom (z) + the Frame tab's thickness -> the frame record
await openPanel('panel-frame');
await evalJS(`(()=>{ const s=document.getElementById('frameTemplate'); s.value='template_1'; s.dispatchEvent(new Event('change')); })()`);
await sleep(500);
checks.frameTyping = await typeInto('#frameBottomZ', '-height/9 - t');
await shot('frame');
await press('Escape');
await evalJS(`document.getElementById('frameBottomZ').select()`); await typeText('-height/9 - trim'); await press('Enter');
checks.frameBottomZ = (await read()).frame?.frameBottomZ;
checks.frameBottomOk = Math.abs(checks.frameBottomZ - (-W.h / 9 - 0.25)) < 1e-9;
await typeInto('#frameBottomZ', 'bottom +'); await press('Enter');
checks.frameBadKept = (await read()).frame?.frameBottomZ === checks.frameBottomZ;
await press('Escape');
await evalJS(`document.getElementById('btnEditFrameShape').click()`); await sleep(2500);
checks.thicknessTyping = await typeInto('#editorFrameThickness', 'width/10');
await shot('thickness');
await press('Enter');
checks.thickness = (await read()).frame?.params?.frame_thickness;
checks.thicknessOk = Math.abs(checks.thickness - Math.min(1.5, Math.max(0.25, W.w / 10))) < 1e-9;

checks.errors = errors.slice(0, 3);
checks.ok = !!(checks.stampTxOk && checks.rotationClamped && checks.stampBadKept && checks.strengthOk && checks.strengthClamped
  && checks.frameBottomOk && checks.frameBadKept && checks.thicknessOk && !errors.length);
console.log(JSON.stringify(checks));
ws.close(); chrome.kill();

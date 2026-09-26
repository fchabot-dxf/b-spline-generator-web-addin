// FORMULA-FIELDS R1 item 5: drive the stock Width field in a real (headless) Chrome with REAL key events and taps,
// screenshot the autocomplete dropdown open, and read back the committed value from the app's own P.
//   python tools/serve_app.py 8780      (serves the palette WITH its stylesheets)
//   node tools/repro/formula_field_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [cdpPort]
// Writes <outPrefix>_dropdown.png and <outPrefix>_committed.png; prints the checks as JSON (ok:false on any miss).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9361);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-formula-${PORT}`;
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

// Real keyboard: printable chars as keyDown(text)+keyUp; named keys with their codes.
const KEYS = { Enter: 13, Tab: 9, Escape: 27, ArrowDown: 40, ArrowUp: 38, Backspace: 8 };
const typeText = async (s) => { for (const ch of s) { await send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch }); await sleep(30); } };
const press = async (k) => { const c = KEYS[k]; await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: c, nativeVirtualKeyCode: c }); if (k === 'Enter') await send('Input.dispatchKeyEvent', { type: 'char', text: '\r', key: 'Enter' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: c, nativeVirtualKeyCode: c }); await sleep(60); };
const rectOf = async (sel) => JSON.parse(await evalJS(`JSON.stringify((()=>{const r=document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return r?{x:r.left+r.width/2,y:r.top+r.height/2}:null})())`));
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
const state = async () => JSON.parse(await evalJS(`(async()=>{ const { P } = await import('./core/state.js');
  const f=document.getElementById('widthIn'); return JSON.stringify({ value: f.value, type: f.type, P: P.widthIn, H: P.heightIn,
    focused: document.activeElement===f, dropdown: [...document.querySelectorAll('.formula-dropdown li')].map(li=>li.textContent),
    preview: document.querySelector('.formula-preview')?.textContent || '',
    steppers: f.closest('.cad-stepper')?.querySelectorAll('button').length || 0 }); })()`));

await send('Runtime.enable'); await send('Page.enable');
if (MOBILE) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}
await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(()=>{ const s=document.querySelector('.panel-stock'); const h=s.querySelector('.panel-header');
  if (h.classList.contains('collapsed') || getComputedStyle(s.querySelector('.panel-body')).display==='none') h.click();
  s.scrollIntoView({block:'start'}); })()`);
await sleep(500);

const checks = {};
const s0 = await state();
checks.initial = s0;
// 1. tap the field, select all, type a formula with a partial name -> dropdown open
await tap('#widthIn');
await evalJS(`document.getElementById('widthIn').select()`);
await typeText('height-h');
const s1 = await state();
checks.typedPartial = s1;
checks.halfTypedNotApplied = s1.P === s0.P;
await shot('dropdown');
// 2. pick the item (tap on mobile, Enter on desktop), check it inserted and nothing committed yet
if (MOBILE) await tap('.formula-dropdown li'); else await press('Enter');
const s2 = await state();
checks.inserted = s2.value === 'height-height';
// 3. finish the formula and commit with Enter
await typeText('/3');
await press('Enter');
const s3 = await state();
checks.committed = s3;
const expect = +(s0.H - s0.H / 3).toFixed(10);
checks.committedOk = Math.abs(s3.P - expect) < 1e-9 && s3.value === String(expect);
await shot('committed');
// 4. bad formula keeps the old value
await evalJS(`document.getElementById('widthIn').select()`);
await typeText('wdth/2');
await press('Enter');
const s4 = await state();
checks.badKept = s4.P === s3.P && /unknown name/.test(s4.preview);
await press('Escape');
// 5. plain number and the stepper still work
await evalJS(`document.getElementById('widthIn').select()`);
await typeText('8');
await press('Enter');
const s5 = await state();
checks.plainOk = s5.P === 8;
await tap('.panel-stock .cad-stepper button:last-child');
const s6 = await state();
checks.stepperOk = s6.P === 9 && s6.steppers === 2;

const ok = checks.halfTypedNotApplied && s1.dropdown.length === 1 && /^height/.test(s1.dropdown[0]) && checks.inserted
  && checks.committedOk && checks.badKept && checks.plainOk && checks.stepperOk && errors.length === 0;
console.log(JSON.stringify({ ok, mode: MODE, checks, errors: errors.slice(0, 5) }, null, 1));
ws.close(); chrome.kill();
process.exit(ok ? 0 : 1);

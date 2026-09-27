// H9 acceptance shots: the MAIN APP header fits at 390px with no
// horizontal scroll, and every stepper row (bare or slider+stepper combo)
// keeps its buttons AND number visible -- the Carve Depth regression this
// same check is built to catch again.
//   node tools/repro/main_header_shots.mjs <outPrefix> <paletteUrl> [port]
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9580);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-h9-${PORT}`;
mkdirSync(PROFILE, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let wsUrl = null;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); wsUrl = list.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch (_) {}
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const msg = JSON.parse(ev.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } });
const send = (method, params = {}) => new Promise((r, rej) => {
  const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error(`CDP timeout: ${method}`)); } }, 15000);
});
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL }); await sleep(6000);

// 1) The main header fits at 390px, no horizontal scroll anywhere on the page.
check((await evalJS('document.documentElement.scrollWidth')) <= 390, `H9: no horizontal scroll at 390px (scrollWidth=${await evalJS('document.documentElement.scrollWidth')})`);
const headerInfo = JSON.parse(await evalJS(`(()=>{
  const nav = document.querySelector('.cad-navbar');
  const rect = nav.getBoundingClientRect();
  const btns = [...nav.querySelectorAll('.cad-nav-btn, #btnDownload')];
  const offscreen = btns.filter(b => { const r = b.getBoundingClientRect(); return r.right > 390.5 || r.left < -0.5; }).map(b => b.id);
  const sizes = btns.map(b => { const r = b.getBoundingClientRect(); return Math.round(r.width); });
  const group = nav.querySelector('.cad-nav-group');
  const actions = nav.querySelector('.cad-navbar-actions');
  const gr = group.getBoundingClientRect(), ar = actions.getBoundingClientRect();
  const oneRow = Math.abs((gr.top + gr.height / 2) - (ar.top + ar.height / 2)) < 5;
  return JSON.stringify({ navRight: rect.right, navHeight: rect.height, offscreen, sizes, oneRow });
})()`));
console.log('header info:', JSON.stringify(headerInfo));
check(headerInfo.navRight <= 390.5, `H9: the navbar's own box stays within 390px (right=${headerInfo.navRight})`);
check(headerInfo.offscreen.length === 0, `H9: every header button is fully on-screen (offscreen: ${JSON.stringify(headerInfo.offscreen)})`);
check(headerInfo.sizes.every((s) => s <= 40), `H9: header buttons are the smaller declared mobile size, not 44px (sizes: ${JSON.stringify(headerInfo.sizes)})`);
check(headerInfo.oneRow, `H10: back+dot and the action buttons share ONE row, no leftover empty row (navHeight=${headerInfo.navHeight})`);
await shot('header');

// 2) Every stepper row (bare AND slider+stepper combo) keeps its buttons
// AND its number visible -- the general check the checklist asks for, so
// this can never silently regress again for ANY row, not just Carve Depth.
// Most sidebar panels are collapsed by default (a stepper inside one
// measures 0×0 via getBoundingClientRect, same as any display:none
// descendant) -- expand every panel (including the Filter panel's own
// nested "Edit Filter" sub-panel) first so every row is actually rendered
// before checking it.
await evalJS(`[...document.querySelectorAll('.panel-header.collapsed')].forEach(h => h.click())`);
await sleep(300);
const stepperInfo = JSON.parse(await evalJS(`(()=>{
  const rows = [...document.querySelectorAll('.cad-stepper')].filter(r => r.getBoundingClientRect().width > 0);
  const bad = [];
  for (const row of rows) {
    const input = row.querySelector('input');
    const buttons = [...row.querySelectorAll('button')];
    if (!input) continue;
    const iw = input.getBoundingClientRect().width;
    const bw = buttons.map(b => b.getBoundingClientRect().width);
    const id = input.id || input.closest('[id]')?.id || '(no id)';
    if (iw < 20 || bw.some(w => w < 20)) bad.push({ id, inputWidth: Math.round(iw), buttonWidths: bw.map(Math.round) });
  }
  return JSON.stringify({ total: rows.length, bad });
})()`));
console.log('stepper check:', JSON.stringify(stepperInfo));
check(stepperInfo.bad.length === 0, `H9: every stepper's number AND buttons stay visible (>=20px) at 390px -- ${stepperInfo.total} rows checked, bad: ${JSON.stringify(stepperInfo.bad)}`);

// 3) Carve Depth specifically -- the reported regression.
const carve = JSON.parse(await evalJS(`(()=>{
  const input = document.getElementById('carveZ');
  const stepper = input.closest('.cad-stepper');
  const buttons = [...stepper.querySelectorAll('button')];
  const r = input.getBoundingClientRect();
  return JSON.stringify({ inputWidth: Math.round(r.width), inputVisible: r.width > 0 && getComputedStyle(input).visibility !== 'hidden',
    buttonWidths: buttons.map(b => Math.round(b.getBoundingClientRect().width)) });
})()`));
console.log('Carve Depth:', JSON.stringify(carve));
check(carve.inputVisible && carve.inputWidth >= 20, `H9: Carve Depth's number is visible (width=${carve.inputWidth})`);
check(carve.buttonWidths.every((w) => w >= 20), `H9: Carve Depth's +/- buttons are visible (widths=${JSON.stringify(carve.buttonWidths)})`);
// Scroll Stock Dimensions into view for the shot.
await evalJS(`document.getElementById('carveZ').scrollIntoView({block:'center'})`);
await sleep(200);
await shot('stock-dimensions');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);

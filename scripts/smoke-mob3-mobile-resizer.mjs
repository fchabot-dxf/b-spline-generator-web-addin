// Usage: node scripts/smoke-mob3-mobile-resizer.mjs <outDir> [mobile|desktop] [url]
// MOB3 AMEND — the main screen's 3D preview / sidebar splitter (Fred:
// "another option is a draggable handle on the preview panel window"),
// wired through the SAME shared splitter.js as the editor's own bottom-
// drawer handle (see smoke-mob3-drawer.mjs). Standalone CDP script, serve
// from the REPO ROOT:
//   python -m http.server 8765 --directory .
//   node scripts/smoke-mob3-mobile-resizer.mjs <outDir> mobile
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'mobile'; // mobile | desktop
const URL = process.argv[4] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const DIMS = { mobile: [390, 844], desktop: [1400, 900] };
const [W, H] = DIMS[MODE];
const PORT = { mobile: 9411, desktop: 9412 }[MODE];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-mob3res-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-mob3res-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find((t) => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning')) {
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EVAL ERROR:', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };
async function rectOf(sel) {
  return evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left,right:r.right,bottom:r.bottom}; })()`);
}

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true }); // seat B lands commits mid-session
const mobile = MODE !== 'desktop';
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile });
if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL });
await sleep(4000);

const report = { mode: MODE, width: W, height: H };

if (!mobile) {
  // Desktop: byte-for-byte unchanged — horizontal sidebar-width drag still
  // works, vertical preview-row logic never engages.
  report.gridTemplateColumnsDesktop = await evalJS(`getComputedStyle(document.querySelector('.cad-main-content')).gridTemplateColumns`);
  const before = await rectOf('.cad-sidebar');
  const resizerRect = await rectOf('#resizer');
  const sx = resizerRect.x + resizerRect.width / 2, sy = resizerRect.y + resizerRect.height / 2;
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: sx, y: sy, button: 'left', clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: sx + 80, y: sy, button: 'left' });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: sx + 80, y: sy, button: 'left' });
  await sleep(300);
  const after = await rectOf('.cad-sidebar');
  report.sidebarWidthBefore = before.width;
  report.sidebarWidthAfter = after.width;
  report.desktopHorizontalDragStillWorks = after.width > before.width + 40;
  report.mainContentInlineGridTemplateRows = await evalJS(`document.querySelector('.cad-main-content').style.gridTemplateRows`);
  await shot(`mob3res-${MODE}-1-after-horizontal-drag.png`);
  report.logs = logs.slice(0, 20);
  console.log(JSON.stringify(report, null, 1));
  ws.close(); chrome.kill();
  process.exit(0);
}

// ── Mobile: the preview/sidebar splitter ──
report.gridTemplateRowsInitial = await evalJS(`document.querySelector('.cad-main-content').style.gridTemplateRows`);
const initialViewport = await rectOf('.cad-viewport');
report.initialPreviewHeight = Math.round(initialViewport.height);
report.initialPreviewFraction = initialViewport.height / H;
await shot(`mob3res-${MODE}-1-initial.png`);

// Drag the handle DOWN by a small amount (touch) — should land on a FREE
// custom height, not a snap (snapDistance is 24px; 70px clears every snap
// gap at this viewport).
const r1 = await rectOf('#resizer');
const sx1 = r1.x + r1.width / 2, sy1 = r1.y + r1.height / 2;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx1, y: sy1, id: 1 }] });
await sleep(40);
await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx1, y: sy1 + 70, id: 1 }] });
await sleep(30);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const customViewport = await rectOf('.cad-viewport');
report.customPreviewHeight = Math.round(customViewport.height);
report.previewGrewByTouchDrag = report.customPreviewHeight > report.initialPreviewHeight + 40;
report.mainContentInlineGridTemplateRowsAfterDrag = await evalJS(`document.querySelector('.cad-main-content').style.gridTemplateRows`);
await shot(`mob3res-${MODE}-2-custom-height.png`);

// Dragging to WITHIN a few px of the 'small' snap point should settle
// EXACTLY on it (soft-snap within 24px) — this splitter's computeRawSize
// is ABSOLUTE (clientY - mainContent.top, not delta-based like the
// drawer's), so target the touch's Y coordinate directly rather than a
// relative delta.
const mainRect = await rectOf('.cad-main-content');
const smallSnapExpected = Math.round(mainRect.height * 0.25);
const targetY = mainRect.top + smallSnapExpected;
const r2 = await rectOf('#resizer');
const sx2 = r2.x + r2.width / 2, sy2 = r2.y + r2.height / 2;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx2, y: sy2, id: 1 }] });
await sleep(40);
await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx2, y: targetY, id: 1 }] });
await sleep(30);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const afterSnapViewport = await rectOf('.cad-viewport');
report.afterSnapHeight = Math.round(afterSnapViewport.height);
report.smallSnapExpected = smallSnapExpected;
report.snappedToSmall = Math.abs(report.afterSnapHeight - smallSnapExpected) <= 3;
await shot(`mob3res-${MODE}-3-snapped-small.png`);

// Persisted across a reload (sessionStorage, "per session" not indefinite).
await evalJS(`document.querySelector('#resizer').dispatchEvent(new Event('noop'))`); // settle
const beforeReloadHeight = report.afterSnapHeight;
await send('Page.navigate', { url: URL });
await sleep(4000);
const reloadedViewport = await rectOf('.cad-viewport');
report.heightAfterReload = Math.round(reloadedViewport.height);
report.persistedAcrossReload = Math.abs(report.heightAfterReload - beforeReloadHeight) <= 3;

// Desktop layout is never touched by this module: confirm the grid never
// received a 3-row inline override on THIS mobile-only path's own sibling
// concern — i.e. crossing back to desktop width clears it.
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(400);
report.gridTemplateRowsAfterCrossingToDesktop = await evalJS(`document.querySelector('.cad-main-content').style.gridTemplateRows`);
report.desktopGridClearedOnCrossover = report.gridTemplateRowsAfterCrossingToDesktop === '';
await shot(`mob3res-${MODE}-4-crossed-to-desktop.png`);

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

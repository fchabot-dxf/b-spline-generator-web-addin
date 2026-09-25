// Usage: node scripts/smoke-mob3-drawer.mjs <outDir> [mobile|tablet|desktop] [url]
// MOB3 — one bottom drawer for tool options + Layers on phones.
// Standalone CDP script (avoids touching the shared smoke-editor.mjs
// while seat B is on lane-b). Serve from the REPO ROOT:
//   python -m http.server 8765 --directory .
//   node scripts/smoke-mob3-drawer.mjs <outDir> mobile http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'mobile'; // mobile | tablet | desktop
const URL = process.argv[4] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const DIMS = { mobile: [390, 844], tablet: [768, 1024], desktop: [1400, 900] };
const [W, H] = DIMS[MODE];
const PORT = { mobile: 9401, tablet: 9402, desktop: 9403 }[MODE];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-mob3-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-mob3-${MODE}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = (list.find(t => t.type === 'page') || {}).webSocketDebuggerUrl;
  } catch { /* not up yet */ }
  if (!wsUrl) await sleep(250);
}
if (!wsUrl) { console.log('NO CDP'); chrome.kill(); process.exit(1); }

const ws = new WebSocket(wsUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
  if (msg.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text).split('\n')[0]);
  if (msg.method === 'Runtime.consoleAPICalled' && (msg.params.type === 'error' || msg.params.type === 'warning'))
    logs.push(msg.params.type.toUpperCase() + ' ' + msg.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 200));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.log('EVAL ERROR:', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
};
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true }); // seat B lands commits mid-session
const coarse = MODE !== 'desktop';
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: coarse ? 2 : 1, mobile: coarse });
if (coarse) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = { mode: MODE, width: W, height: H };
await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);

async function rectOf(sel) {
  return evalJS(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,top:r.top,left:r.left,right:r.right,bottom:r.bottom}; })()`);
}
function visibleInViewport(r, w, h) {
  return r && r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.right <= w && r.bottom <= h;
}

// ── Desktop: byte-for-byte unchanged (the drawer wrapper is display:contents there) ──
if (!coarse) {
  await shot(`mob3-${MODE}-1-before-lattice.png`);
  report.drawerIsDisplayContents = await evalJS(`getComputedStyle(document.getElementById('editorMobileDrawer')).display`);
  await evalJS(`document.getElementById('toolLattice').click(); true`);
  await sleep(500);
  report.latticePanelRectDesktop = await rectOf('#editorLatticePanel');
  report.layersPanelRectDesktop = await rectOf('#editorLayersPanel');
  report.handleHiddenOnDesktop = await evalJS(`getComputedStyle(document.getElementById('editorDrawerHandle')).display`);
  report.tabsHiddenOnDesktop = await evalJS(`getComputedStyle(document.getElementById('editorDrawerTabs')).display`);
  await shot(`mob3-${MODE}-2-lattice-desktop.png`);
  report.logs = logs.slice(0, 20);
  console.log(JSON.stringify(report, null, 1));
  ws.close(); chrome.kill();
  process.exit(0);
}

// ── Mobile/tablet: the full drawer flow ──
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(500);

report.drawerHiddenBeforeLattice = false; // will be overwritten below if actually true; Lattice tool should have just shown it
report.drawerVisible = await evalJS(`!document.getElementById('editorMobileDrawer').classList.contains('hidden')`);
report.drawerStateAfterOpeningLattice = await evalJS(`document.getElementById('editorMobileDrawer').classList.contains('is-peek')`);
report.toolTabLabel = await evalJS(`document.getElementById('editorDrawerTab-tool').textContent`);
report.toolTabVisible = await evalJS(`!document.getElementById('editorDrawerTab-tool').classList.contains('hidden')`);
report.toolTabActive = await evalJS(`document.getElementById('editorDrawerTab-tool').classList.contains('active')`);

// Peek: Add buttons + Generate visible, canvas >= 55% of viewport.
report.addKindGroupRectAtPeek = await rectOf('#latticeAddKindGroup');
report.generateBtnRectAtPeek = await rectOf('#latticeGenerate');
report.addVisibleAtPeek = visibleInViewport(report.addKindGroupRectAtPeek, W, H);
report.generateVisibleAtPeek = visibleInViewport(report.generateBtnRectAtPeek, W, H);
report.canvasRectAtPeek = await rectOf('#editorCanvasContainer');
report.canvasFractionAtPeek = report.canvasRectAtPeek ? report.canvasRectAtPeek.height / H : 0;
report.canvasAtLeast55PctAtPeek = report.canvasFractionAtPeek >= 0.55;
await shot(`mob3-${MODE}-1-peek.png`);

// Cycle to half via a TAP (no real movement) on the handle.
async function tapHandle() {
  const r = await rectOf('#editorDrawerHandle');
  const x = r.x + r.width / 2, y = r.y + r.height / 2;
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(30);
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(300);
}
await tapHandle();
report.drawerStateAfterOneTap = await evalJS(`(() => { const h = document.getElementById('editorMobileDrawer').getBoundingClientRect().height; return Math.round(h); })()`);
await shot(`mob3-${MODE}-2-half.png`);

await tapHandle();
report.drawerHeightAfterTwoTaps = await evalJS(`Math.round(document.getElementById('editorMobileDrawer').getBoundingClientRect().height)`);
await shot(`mob3-${MODE}-3-full.png`);

// At full: every Lattice control should be reachable — spot-check a few
// spread across the panel (Grid & rails/Ties/Nodes/Colors/Widths/Seed are
// collapsed by default open=true, so their own fields should already be
// in the DOM and laid out, even if scrolled below the fold).
report.widthsRowExistsAtFull = await evalJS(`!!document.getElementById('latticeWidthNodes')`);
report.seedFieldExistsAtFull = await evalJS(`!!document.getElementById('latticeSeed')`);
report.colorsRowExistsAtFull = await evalJS(`!!document.getElementById('latticeColorNodes')`);

// Collapse ONE section (Grid & rails) and confirm its own fields hide,
// then re-expand and confirm they come back — the generic collapsible-
// section sweep actually works, not just "the DOM has these ids somewhere".
const gridRailsLabel = await evalJS(`(() => {
  const spans = [...document.querySelectorAll('#editorLatticePanelBody > div > span')];
  const s = spans.find(sp => sp.textContent.trim().startsWith('Grid'));
  return s ? true : false;
})()`);
report.gridRailsLabelFound = gridRailsLabel;
await evalJS(`(() => {
  const spans = [...document.querySelectorAll('#editorLatticePanelBody > div > span')];
  const s = spans.find(sp => sp.textContent.trim().startsWith('Grid'));
  if (s) s.click();
})()`);
await sleep(150);
report.orientationHiddenAfterCollapse = await evalJS(`(() => { const el = document.getElementById('latticeOrientHorizontal'); return el ? getComputedStyle(el.closest('div[style*="display:flex"]') || el).display === 'none' || el.offsetParent === null : null; })()`);
await evalJS(`(() => {
  const spans = [...document.querySelectorAll('#editorLatticePanelBody > div > span')];
  const s = spans.find(sp => sp.textContent.trim().startsWith('Grid'));
  if (s) s.click();
})()`);
await sleep(150);
report.orientationVisibleAfterReExpand = await evalJS(`(() => { const el = document.getElementById('latticeOrientHorizontal'); return el ? el.offsetParent !== null : null; })()`);

// Layers tab: switch, rows tappable.
await evalJS(`document.getElementById('editorDrawerTab-layers').click(); true`);
await sleep(300);
report.layersTabActive = await evalJS(`document.getElementById('editorDrawerTab-layers').classList.contains('active')`);
report.latticePanelHiddenOnLayersTab = await evalJS(`document.getElementById('editorLatticePanel').classList.contains('editor-drawer-tab-hidden')`);
report.layerRowVisible = await evalJS(`(() => {
  const row = document.querySelector('#editorLayersPanel .layer-row');
  if (!row) return false;
  const r = row.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
  return row.contains(el) || row === el;
})()`);
await shot(`mob3-${MODE}-4-layers-tab.png`);

// A tool with NO options (Select): only the Layers tab shows.
await evalJS(`document.getElementById('toolSelect').click(); true`);
await sleep(300);
report.toolTabHiddenForSelect = await evalJS(`document.getElementById('editorDrawerTab-tool').classList.contains('hidden')`);
report.layersTabActiveForSelect = await evalJS(`document.getElementById('editorDrawerTab-layers').classList.contains('active')`);
await shot(`mob3-${MODE}-5-select-tool-layers-only.png`);

// Drag the handle with real touch events (not a tap) — resize live.
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(300);
await evalJS(`document.getElementById('editorMobileDrawer').classList.remove('is-peek'); true`); // no-op safety, real state comes from applyState
const beforeDragHeight = await evalJS(`Math.round(document.getElementById('editorMobileDrawer').getBoundingClientRect().height)`);
const handleRect = await rectOf('#editorDrawerHandle');
const sx = handleRect.x + handleRect.width / 2, sy = handleRect.y + handleRect.height / 2;
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx, y: sy, id: 1 }] });
await sleep(40);
for (let k = 1; k <= 5; k++) {
  await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx, y: sy - 40 * k, id: 1 }] });
  await sleep(30);
}
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const afterDragHeight = await evalJS(`Math.round(document.getElementById('editorMobileDrawer').getBoundingClientRect().height)`);
report.dragHandleWithTouchChangedHeight = afterDragHeight > beforeDragHeight + 20; // dragged UP -> taller
report.beforeDragHeight = beforeDragHeight;
report.afterDragHeight = afterDragHeight;
await shot(`mob3-${MODE}-6-after-touch-drag.png`);

// MOB3 AMEND: the handle is now a FREE splitter — a short drag that lands
// >24px from every declared snap point should hold that CUSTOM height,
// not snap. Start from peek, drag up by a small, deliberately off-snap
// amount, and confirm the settled height is far from peek/half/full.
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(300);
const peekHeight = await evalJS(`Math.round(document.getElementById('editorMobileDrawer').getBoundingClientRect().height)`);
const halfHeight = Math.round(H * 0.5);
const fullHeight = Math.round(H * 0.88);
const handleRect2 = await rectOf('#editorDrawerHandle');
const sx2 = handleRect2.x + handleRect2.width / 2, sy2 = handleRect2.y + handleRect2.height / 2;
const customDragUpPx = 60; // small enough to land well clear of the 24px snapDistance around peek/half
await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sx2, y: sy2, id: 1 }] });
await sleep(40);
await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: sx2, y: sy2 - customDragUpPx, id: 1 }] });
await sleep(30);
await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await sleep(400);
const customHeight = await evalJS(`Math.round(document.getElementById('editorMobileDrawer').getBoundingClientRect().height)`);
report.peekHeight = peekHeight;
report.customDragTargetHeight = peekHeight + customDragUpPx;
report.customHeight = customHeight;
report.customHeightFarFromEverySnap = Math.abs(customHeight - peekHeight) > 24 && Math.abs(customHeight - halfHeight) > 24 && Math.abs(customHeight - fullHeight) > 24;
report.customHeightIsPeekClass = await evalJS(`document.getElementById('editorMobileDrawer').classList.contains('is-peek')`);
await shot(`mob3-${MODE}-7-custom-height.png`);

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

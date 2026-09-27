// H5 MULTI-SELECT acceptance: double-tap-and-hold adds/removes a piece,
// a plain tap replaces the selection, drag is unaffected, text is
// excluded, the panel reads the whole selection with batch colour/reset
// in one undo step, and the selection hint shows for a single tap-select.
//   node tools/repro/multiselect_shots.mjs <outPrefix> <paletteUrl> [desktop|mobile] [port]
// Serve with tools/serve_app.py so the CSS loads.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [PREFIX, URL, MODE = 'desktop', PORTARG] = process.argv.slice(2);
const PORT = Number(PORTARG || 9490);
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PROFILE = `${dirname(PREFIX)}/chrome-multiselect-${PORT}`;
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
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails.exception).slice(0, 400)); return r.result?.result?.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${PREFIX}_${name}.png`, Buffer.from(r.result.data, 'base64')); };
let failures = 0;
function check(cond, label) { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures++; }

await send('Runtime.enable'); await send('Page.enable');
const isMobile = MODE === 'mobile';
if (isMobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
} else {
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
}

await send('Page.navigate', { url: URL }); await sleep(9000);
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('btnStampEdit').click(); await W(3000);
  document.getElementById('toolLattice').click(); await W(800);
  document.getElementById('latticeGenerate').click(); await W(2000);
  const btns=[...document.querySelectorAll('button,[role=button]')].filter(b=>b.offsetParent && /select/i.test((b.title||'')+(b.getAttribute('aria-label')||'')+b.id));
  const sel=btns.find(b=>/tap a piece/i.test(b.title||'')); if(sel) sel.click(); await W(400);
})()`);

// Rig 3 distinct, stably-referenceable rails (grabbed at each one's own
// midpoint, t=0.5 -- box Lattice's own exact-corner ambiguity, documented
// extensively in the H1 turn's own WORK-LOG, only ever bites an END grab).
const rigInfo = await evalJS(`(()=>{
  const rails = [...document.querySelectorAll('[data-lattice="rail"]')];
  if (rails.length < 4) return JSON.stringify({ ok: false, count: rails.length });
  rails.slice(0, 4).forEach((r, i) => { r.id = 'lt_rail' + i; });
  return JSON.stringify({ ok: true });
})()`);
console.log('rig:', rigInfo);
const rig = JSON.parse(rigInfo);
if (!rig.ok) { console.log('FAIL: fewer than 4 rails this generation, aborting'); chrome.kill(); process.exit(1); }

// Real pointer-driven midpoint of a rigged piece, at t=0.5 along its span.
// In mobile mode, the app itself shifts a touch's resolved hit-test point
// UP by a fixed on-screen amount before using it (editor-grid.js's own
// applyTouchMarkerOffset -- "a fingertip covers the real target", a real,
// pre-existing, deliberate design predating H5, not something this turn
// changes). A touch dispatched exactly on the rail therefore resolves
// ABOVE it and misses -- compensate by dispatching that same amount BELOW
// the rail instead, measured live via the app's own function + CTM so it
// tracks the current zoom rather than a guessed constant.
async function midpointScreen(id) {
  const [x, y] = JSON.parse(await evalJS(`(async()=>{
    const el = document.getElementById('${id}');
    const svg = el.ownerSVGElement;
    const x1=+el.getAttribute('x1'),y1=+el.getAttribute('y1'),x2=+el.getAttribute('x2'),y2=+el.getAttribute('y2');
    const mx = (x1+x2)/2, my = (y1+y2)/2;
    let targetModelY = my;
    if (${isMobile}) {
      const mod = await import('./editor/editor-grid.js');
      const ed = window.svgEditor;
      const prevType = ed._pointerType;
      ed._pointerType = 'touch';
      const shifted = mod.applyTouchMarkerOffset(ed, { x: mx, y: my });
      const dyModel = my - shifted.y; // amount the app will shift UP
      ed._pointerType = prevType;
      targetModelY = my + dyModel; // dispatch BELOW by the same amount
    }
    const p = svg.createSVGPoint(); p.x = mx; p.y = targetModelY;
    const q = p.matrixTransform(svg.getScreenCTM());
    return JSON.stringify([q.x, q.y]);
  })()`));
  return { x, y };
}
// Real touch in mobile mode (Input.dispatchTouchEvent -- the browser's own
// pointer-events layer synthesizes pointerType:'touch' from this, unlike
// dispatchMouseEvent under setTouchEmulationEnabled, which still surfaces
// as pointerType:'mouse'; formula_field_shots.mjs's own tap() established
// this split first), real mouse otherwise.
async function pointerDown(x, y) {
  if (isMobile) { await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); }
  else {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  }
}
async function pointerMove(x, y) {
  if (isMobile) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
}
async function pointerUp(x, y) {
  if (isMobile) await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  else await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
async function tap(id) {
  const { x, y } = await midpointScreen(id);
  await pointerDown(x, y);
  await sleep(30);
  await pointerUp(x, y);
  await sleep(30);
}
// A REAL double-tap-and-hold: press, release quickly (within the double-
// tap window), press again on the SAME spot and hold for the declared
// hold time before releasing.
async function doubleTapAndHold(id) {
  const { x, y } = await midpointScreen(id);
  await pointerDown(x, y);
  await sleep(30);
  await pointerUp(x, y);
  await sleep(100); // well inside the 350ms double-tap window
  await pointerDown(x, y);
  await sleep(500); // past the 450ms hold time, held still throughout
  await pointerUp(x, y);
  await sleep(50);
}
const selection = async () => JSON.parse(await evalJS(`JSON.stringify([...document.querySelectorAll('.svg-selected')].map(e => e.id))`));

// 1) A plain tap replaces the selection.
await tap('lt_rail0');
check(JSON.stringify(await selection()) === JSON.stringify(['lt_rail0']), `H5: a plain tap selects only that piece (got ${JSON.stringify(await selection())})`);

// 2) Double-tap-and-hold a DIFFERENT piece ADDS it.
await doubleTapAndHold('lt_rail1');
let sel = (await selection()).sort();
check(JSON.stringify(sel) === JSON.stringify(['lt_rail0', 'lt_rail1']), `H5: double-tap-and-hold ADDS a different piece to the selection (got ${JSON.stringify(sel)})`);

// 3) Double-tap-and-hold a THIRD piece grows it further.
await doubleTapAndHold('lt_rail2');
sel = (await selection()).sort();
check(JSON.stringify(sel) === JSON.stringify(['lt_rail0', 'lt_rail1', 'lt_rail2']), `H5: a second hold grows the selection to 3 (got ${JSON.stringify(sel)})`);
await shot('panel_three_pieces');

// 4) Double-tap-and-hold an ALREADY-selected piece REMOVES just it.
await doubleTapAndHold('lt_rail1');
sel = (await selection()).sort();
check(JSON.stringify(sel) === JSON.stringify(['lt_rail0', 'lt_rail2']), `H5: holding an already-selected piece REMOVES just it (got ${JSON.stringify(sel)})`);

// 5) A plain tap on an UNSELECTED piece replaces the whole multi-selection
// with just it. (A plain tap on an ALREADY-selected MEMBER of the group is
// pre-existing, unrelated behaviour this turn does not change — it leaves
// the whole group selected so it can still be dragged together; only
// tapping something OUTSIDE the current selection ever replaces it. See
// WORK-LOG for this scope note.)
await tap('lt_rail3');
check(JSON.stringify(await selection()) === JSON.stringify(['lt_rail3']), `H5: a plain tap on an unselected piece replaces the whole selection (got ${JSON.stringify(await selection())})`);

// 6) Press-and-move is still an ordinary drag, unaffected.
const before = await evalJS(`document.getElementById('lt_rail0').getAttribute('y1')`);
const { x: dx, y: dy } = await midpointScreen('lt_rail0');
await pointerDown(dx, dy);
for (let i = 1; i <= 6; i++) { await pointerMove(dx, dy + 40 * i / 6); await sleep(20); }
await pointerUp(dx, dy + 40);
await sleep(200);
const after = await evalJS(`document.getElementById('lt_rail0').getAttribute('y1')`);
check(before !== after, `H5: a normal press-and-move drag still moves the piece (before=${before}, after=${after})`);

// 7) Text is excluded from the gesture. This must run on the MAIN Select
// tool (toolSelect / selectHandler.start), not the Lattice tool's own
// "select" sub-mode used above -- that sub-mode's own hit-test
// (_getNearbyLatticePiece) only ever recognizes rail/tie/node pieces, so a
// text element there hits NEITHER lattice-piece branch NOR selectHandler
// at all; it falls into UI3 AMEND 1's pre-existing "empty space" branch,
// which just deselects -- unrelated to H5 and not what this item's "text
// elements excluded" rule is about. selectHandler.start's own
// `hit.type !== 'text'` guard is the one that actually matters here.
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('toolSelect').click(); await W(300);
})()`);
// Placed at model (1,1) once, the text sat within the lattice's own hit
// tolerance of lt_rail0, so every press there resolved to the RAIL, not
// the text, no matter which tool was active -- not an H5 bug, a rig bug.
// Pick a point clear of every existing lattice piece's bbox instead.
const textInfo = await evalJS(`(()=>{
  const ed = window.svgEditor;
  const pieces = [...document.querySelectorAll('[data-lattice]')];
  const boxes = pieces.map(p => p.getBBox());
  const maxX = Math.max(0, ...boxes.map(b => b.x + b.width));
  const maxY = Math.max(0, ...boxes.map(b => b.y + b.height));
  const tx = maxX + 20, ty = maxY + 20;
  const t = ed._sketchLayer.text('Hi').move(tx, ty).attr('data-layer', ed._activeLayer);
  t.node.id = 'lt_text0';
  ed._draw.viewbox(0, 0, Math.max(ed._draw.viewbox().width, tx + 20), Math.max(ed._draw.viewbox().height, ty + 20));
  return JSON.stringify({ tx, ty });
})()`);
console.log('text rig:', textInfo);
// The gesture's text exclusion (selectHandler.start's `hit.type !== 'text'`
// guard) has NO pointer-type branch at all -- mouse dispatch exercises it
// exactly as touch would, so it's used unconditionally rather than
// fighting touch-marker-offset + grid-snap math for a tiny target.
const textScreen = JSON.parse(await evalJS(`(()=>{
  const el = document.getElementById('lt_text0');
  const svg = el.ownerSVGElement;
  const b = el.getBBox();
  const p = svg.createSVGPoint(); p.x = b.x + b.width/2; p.y = b.y + b.height/2;
  const q = p.matrixTransform(svg.getScreenCTM());
  return JSON.stringify([q.x, q.y]);
})()`));
const [tx, ty] = textScreen;
// This growing viewbox, on mobile's own narrow layout, can push the
// enlarged canvas under a fixed drawer-tab overlay (#editorDrawerTab-*,
// H4's mobile pass) that has nothing to do with H5 -- verify the point is
// actually reachable before asserting anything through it, and skip this
// one sub-check with a clear note rather than report a false feature
// failure when it isn't. The gesture's OWN touch-specific behaviours
// (double-tap-hold add/remove, drag, the touch hint string) are all
// checked elsewhere in this file with real touch dispatch and don't
// depend on this placement at all.
const occluder = await evalJS(`(()=>{ const el = document.elementFromPoint(${tx}, ${ty}); return el && el.closest('#editorSVGContainer') ? null : (el ? (el.id || el.tagName) : 'offscreen'); })()`);
if (occluder) {
  console.log(`SKIP H5: text-exclusion check -- rig placement occluded by "${occluder}" on this viewport, not an app issue (see comment above)`);
} else {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tx, y: ty });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 });
  await sleep(30);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
  await sleep(100);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tx, y: ty, button: 'left', clickCount: 1 });
  await sleep(500);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', clickCount: 1 });
  await sleep(50);
  check(JSON.stringify(await selection()) === JSON.stringify(['lt_text0']), `H5: text is excluded from the gesture -- it never gets ADDED to an existing selection (got ${JSON.stringify(await selection())})`);
}
await evalJS(`(()=>{ const t = document.getElementById('lt_text0'); if (t) t.remove(); })()`);

// Back to the Lattice tool's own "select" sub-mode for the remaining
// steps, which exercise lattice pieces exactly as steps 1-6 did.
await evalJS(`(async()=>{ const W=ms=>new Promise(r=>setTimeout(r,ms));
  document.getElementById('toolLattice').click(); await W(300);
  const btns=[...document.querySelectorAll('button,[role=button]')].filter(b=>b.offsetParent && /select/i.test((b.title||'')+(b.getAttribute('aria-label')||'')+b.id));
  const sel=btns.find(b=>/tap a piece/i.test(b.title||'')); if(sel) sel.click(); await W(300);
})()`);

// 8) The hint: selecting exactly one piece shows the declared string.
// Explicit deselect first -- the tool-switch above already ran its own
// restoreModeHint, and lt_rail0 may already BE the selection (a no-op
// tap wouldn't fire editorSelectionChanged at all, leaving that stale
// mode hint in place rather than genuinely exercising this item).
await evalJS(`window.svgEditor._deselect()`);
await tap('lt_rail0');
await sleep(100);
const hint = await evalJS(`document.getElementById('editorStatusHint')?.textContent`);
const expectedHint = isMobile ? 'Double-tap and hold another piece to add it to the selection' : 'Shift+click to add';
check(hint === expectedHint, `H5: the hint shows the declared string for a single tap-selection (got "${hint}", want "${expectedHint}")`);
await shot('hint');

// 9) Batch colour: select 3 pieces (mixed colours), panel shows "Mixed",
// one pick recolours all, Reset resets all, in ONE undo step.
await evalJS(`(()=>{
  const ed = window.svgEditor;
  document.getElementById('lt_rail1').setAttribute('stroke', '#123456'); // force a genuinely different starting colour
})()`);
await tap('lt_rail0');
await doubleTapAndHold('lt_rail1');
await doubleTapAndHold('lt_rail2');
await sleep(200);
const panelState1 = await evalJS(`(()=>{
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  return JSON.stringify({
    kindText: panel.querySelector('.lattice-piece-panel-kind')?.textContent,
    mixedVisible: panel.querySelector('.lattice-piece-color-mixed')?.style.display !== 'none',
  });
})()`);
console.log('panel with 3 mixed pieces:', panelState1);
const p1 = JSON.parse(panelState1);
check(p1.kindText === '3 pieces (3 rails)', `H5: panel summarizes the whole selection (got "${p1.kindText}")`);
check(p1.mixedVisible, 'H5: panel shows "Mixed" when the 3 pieces have different colours');
await shot('panel_mixed');

await evalJS(`(()=>{
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  panel.querySelector('.lattice-piece-color').click();
})()`);
await sleep(300);
await evalJS(`(()=>{ const cell = [...document.querySelectorAll('button')].find(b => (b.title||'').toLowerCase() === '#1565c0'); cell?.click(); })()`);
await sleep(300);
const afterBatchColor = await evalJS(`JSON.stringify(['lt_rail0','lt_rail1','lt_rail2'].map(id => document.getElementById(id).getAttribute('stroke')))`);
console.log('after batch colour:', afterBatchColor);
check(JSON.parse(afterBatchColor).every((c) => c === '#1565c0'), `H5: one pick recolours ALL selected pieces (got ${afterBatchColor})`);

await evalJS(`(()=>{
  const panel = [...document.querySelectorAll('.lattice-piece-panel')].find(p => p.getBoundingClientRect().width > 0);
  panel.querySelector('.lattice-piece-color-reset').click();
})()`);
await sleep(300);
const afterBatchReset = await evalJS(`JSON.stringify(['lt_rail0','lt_rail1','lt_rail2'].map(id => document.getElementById(id).getAttribute('stroke')))`);
console.log('after batch reset:', afterBatchReset);
const resetColors = JSON.parse(afterBatchReset);
check(resetColors.every((c) => c === resetColors[0]), `H5: Reset resets ALL selected pieces to the SAME layer default (got ${afterBatchReset})`);

// One undo step: undo ONCE should bring back the batch colour on ALL 3.
await evalJS(`window.svgEditor.undo()`);
await sleep(200);
const afterOneUndo = await evalJS(`JSON.stringify(['lt_rail0','lt_rail1','lt_rail2'].map(id => document.getElementById(id).getAttribute('stroke')))`);
console.log('after ONE undo:', afterOneUndo);
check(JSON.parse(afterOneUndo).every((c) => c === '#1565c0'), `H5: undo is ONE step for the whole batch reset (got ${afterOneUndo})`);
await evalJS(`window.svgEditor.undo()`);
await sleep(200);
const afterSecondUndo = await evalJS(`JSON.stringify(['lt_rail0','lt_rail1','lt_rail2'].map(id => document.getElementById(id).getAttribute('stroke')))`);
console.log('after a SECOND undo (should undo the batch SET too, one step):', afterSecondUndo);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nALL CHECKS PASSED');
chrome.kill();
process.exit(failures ? 1 : 0);

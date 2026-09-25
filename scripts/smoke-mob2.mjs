// Usage: node scripts/smoke-mob2.mjs <outDir> <mobile|tablet|desktop|touch-drag> [url]
// MOB2 (Fred: "make sure it's mobile friendly", found live on pages.dev at
// 390x844 touch) — standalone CDP script (same reasoning as every other
// smoke-lattice-*.mjs this cycle: avoid touching the shared smoke-editor.mjs
// while seat B is on lane-b). Serve from the REPO ROOT:
//   python -m http.server 8765 --directory .
//   node scripts/smoke-mob2.mjs <outDir> mobile http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const MODE = process.argv[3] || 'mobile'; // mobile | tablet | desktop | touch-drag
const URL = process.argv[4] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const DIMS = { mobile: [390, 844], tablet: [768, 1024], desktop: [1400, 900], 'touch-drag': [390, 844] };
const [W, H] = DIMS[MODE];
const PORT = { mobile: 9351, tablet: 9352, desktop: 9353, 'touch-drag': 9354 }[MODE];
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-mob2-${MODE}`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-mob2-${MODE}`,
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
const evalJS = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}`, Buffer.from(r.result.data, 'base64')); };

await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
// Seat B (lane-b) commits land on this same shared repo mid-session, and
// this script's OWN chrome-mob2-<mode> profile dir is reused across runs
// — without this, a stale cached module from an earlier run can mismatch
// a freshly-changed one (hit live: editor-outline-preview.js cached
// pre-T42, editor-expand-text.js served fresh, "export not found").
await send('Network.setCacheDisabled', { cacheDisabled: true });
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
function intersects(a, b) {
  if (!a || !b) return false;
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function withinViewport(r, w, h) {
  if (!r) return false;
  return r.left >= 0 && r.top >= 0 && r.right <= w && r.bottom <= h;
}

if (MODE === 'touch-drag') {
  // Same known-geometry scenario smoke-lattice-connected.mjs proves for
  // mouse (Rail A (1,1)-(4,1), a Tie (2,3)-(2,1) attaching to it) — here
  // driven through Input.dispatchTouchEvent instead of dispatchMouseEvent,
  // to prove the SAME editor-interaction.js code path (Pointer Events,
  // already touch-aware per getDynamicTolerance/INPUT_PROFILE) actually
  // fires from real touch input, not just mouse. No new app code — this
  // is a verify, per the dispatch ("a touch drag of a rail stretches its
  // tie" was flagged as ALREADY supported, not a bug to fix).
  await evalJS(`document.getElementById('toolLattice').click(); true`);
  await sleep(800);

  async function modelToScreen(mx, my) {
    return evalJS(`(() => {
      const svg = document.querySelector('#editorSVGContainer svg');
      const pt = svg.createSVGPoint();
      pt.x = ${mx}; pt.y = ${my};
      const s = pt.matrixTransform(svg.getScreenCTM());
      return { x: s.x, y: s.y };
    })()`);
  }
  async function touchDragFromTo(mStart, mEnd, steps = 6) {
    const start = await modelToScreen(mStart.x, mStart.y);
    const end = await modelToScreen(mEnd.x, mEnd.y);
    const pt = (x, y) => [{ x, y, id: 1 }];
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(start.x, start.y) });
    await sleep(80);
    for (let k = 1; k <= steps; k++) {
      const x = start.x + (end.x - start.x) * (k / steps);
      const y = start.y + (end.y - start.y) * (k / steps);
      await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x, y) });
      await sleep(40);
    }
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
  }

  // SE7m's touch path deliberately commits at a MARKER position offset
  // from the raw finger point (editor-input.js's INPUT_PROFILE.touch.
  // markerOffsetPx = 40px, ~0.72 model units at this zoom — "touch
  // commits at the MARKER position, not the raw finger position" per
  // editor-interaction.js's own handleStart comment), so a screen point
  // computed for exact model coords lands ~0.75 grid rows away (40px
  // rounds through the 0.25 grid to 3 cells) once actually committed —
  // confirmed live, not a bug. This helper draws by touch and reads back
  // where things ACTUALLY landed rather than asserting the raw intended
  // coordinates, then reasons in DELTAS from there.
  report.spacing = await evalJS(`window.svgEditor._grid.spacing`);
  await touchDragFromTo({ x: 1, y: 1 }, { x: 4, y: 1 });  // Rail A, via touch
  await touchDragFromTo({ x: 2, y: 3 }, { x: 2, y: 1 });  // Tie, via touch, 'b' end lands on Rail A
  report.builtViaTouch = await evalJS(`(() => {
    const rails = [...document.querySelectorAll('[data-lattice=rail]')].map(r => ({x1:+r.getAttribute('x1'),y1:+r.getAttribute('y1'),x2:+r.getAttribute('x2'),y2:+r.getAttribute('y2')}));
    const ties = [...document.querySelectorAll('[data-lattice=tie]')].map(t => ({x1:+t.getAttribute('x1'),y1:+t.getAttribute('y1'),x2:+t.getAttribute('x2'),y2:+t.getAttribute('y2')}));
    return { rails, ties };
  })()`);
  report.tieAttachedToRailViaTouch = report.builtViaTouch.ties.length === 1 && report.builtViaTouch.ties[0].x2 === 2 && report.builtViaTouch.ties[0].y2 === report.builtViaTouch.rails[0].y1;
  await shot('mob2-touch-1-built.png');

  // Grab Rail A via touch and drag it down by exactly 1 model unit.
  // Grab at x=3 (not the desktop test's x=3.5) — deliberately 1 full unit
  // from the nearest AUTO NODES point (the crossing at x=2, the rail's
  // own end at x=4), clear of touch's own wider grab tolerance (28px,
  // ~0.5 model units at this zoom, vs mouse's 15px/~0.27 — x=3.5 sat
  // right at that boundary and touch grabbed the neighboring node
  // instead of the rail, confirmed live). The known marker offset is
  // applied identically to both the start and end point, so it cancels
  // out of the DELTA even though it shifts the absolute grab point.
  const spacing = report.spacing;
  const pxPerUnit = (await modelToScreen(1, 0)).x - (await modelToScreen(0, 0)).x;
  const markerOffsetModelUnits = 40 / pxPerUnit; // editor-input.js INPUT_PROFILE.touch.markerOffsetPx
  const railRowBefore = report.builtViaTouch.rails[0].y1;
  await touchDragFromTo(
    { x: 3, y: railRowBefore + markerOffsetModelUnits },
    { x: 3, y: railRowBefore + 1 + markerOffsetModelUnits },
  );
  report.afterTouchRailMove = await evalJS(`(() => {
    const rail = [...document.querySelectorAll('[data-lattice=rail]')].find(r => +r.getAttribute('x1') === 1);
    const tie = document.querySelector('[data-lattice=tie]');
    return {
      rail: rail ? { y1: +rail.getAttribute('y1'), y2: +rail.getAttribute('y2') } : null,
      tie: tie ? { x1: +tie.getAttribute('x1'), y1: +tie.getAttribute('y1'), x2: +tie.getAttribute('x2'), y2: +tie.getAttribute('y2') } : null,
    };
  })()`);
  const expectedNewRow = +(railRowBefore + 1).toFixed(2);
  report.railMovedViaTouch = report.afterTouchRailMove.rail?.y1 === expectedNewRow && report.afterTouchRailMove.rail?.y2 === expectedNewRow;
  report.tieStretchedViaTouch = report.afterTouchRailMove.tie?.x2 === 2 && report.afterTouchRailMove.tie?.y2 === expectedNewRow
    && report.afterTouchRailMove.tie?.x1 === 2 && report.afterTouchRailMove.tie?.y1 === report.builtViaTouch.ties[0].y1; // other end untouched
  await shot('mob2-touch-2-rail-moved.png');

  report.logs = logs.slice(0, 15);
  console.log(JSON.stringify(report, null, 1));
  ws.close(); chrome.kill();
  process.exit(0);
}

await shot(`mob2-${MODE}-1-before.png`);

// Bug #1: the pill must never overlap the Layers panel.
report.pillRect = await rectOf('.editor-history');
report.layersPanelRect = await rectOf('#editorLayersPanel');
report.pillIntersectsLayersPanel = intersects(report.pillRect, report.layersPanelRect);

// Bug #2: Apply Stencils must always be reachable inside the viewport.
report.applyRect = await rectOf('#editorApply');
report.applyFullyVisible = withinViewport(report.applyRect, W, H);
report.cancelRect = await rectOf('#editorCancel');
report.cancelFullyVisible = withinViewport(report.cancelRect, W, H);

// Bug #3/#4 + MOB2b: generate a lattice with the Lattice panel in its
// REAL default state (collapsed on a coarse pointer — the exact
// dispatched repro path: open Lattice tool, tap Generate, panel still
// collapsed) and add 2 more layers first (3 total, matching the
// dispatch's own verify scenario) so the Layers panel has real rows to
// hide behind the Pattern sheet if the fix regresses.
await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(800);
await evalJS(`document.getElementById('editorAddLayer').click(); true`);
await sleep(200);
await evalJS(`document.getElementById('editorAddLayer').click(); true`);
await sleep(200);
await evalJS(`document.getElementById('latticeGenerate').click(); true`);
await sleep(3000);
await shot(`mob2-${MODE}-2-generated.png`);

report.layersPanelRectAfterGenerate = await rectOf('#editorLayersPanel');
report.canvasRect = await rectOf('#editorCanvasContainer');
report.pillRectAfterGenerate = await rectOf('.editor-history');
report.pillIntersectsLayersPanelAfterGenerate = intersects(report.pillRectAfterGenerate, report.layersPanelRectAfterGenerate);

// MOB2b (Fred's own follow-up finding): the pill-doesn't-intersect and
// toggle-size checks above don't prove the ROWS themselves are visible —
// a bounded-height panel can still have its lowest row(s) covered by the
// Lattice sheet's own fixed footer sitting on top of it. Ground truth:
// elementFromPoint at each row's own center must return that row (or a
// descendant of it), not whatever the Lattice sheet stacked above it.
report.layerRowVisibility = await evalJS(`(() => {
  const rows = [...document.querySelectorAll('#editorLayersPanel .layer-row')];
  return rows.map((row, idx) => {
    const r = row.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const topEl = document.elementFromPoint(cx, cy);
    return { idx, visible: row.contains(topEl) || row === topEl, fullyInViewport: r.top >= 0 && r.bottom <= window.innerHeight };
  });
})()`);
report.allLayerRowsVisible = report.layerRowVisibility.length > 0 && report.layerRowVisibility.every(r => r.visible && r.fullyInViewport);
await shot(`mob2-${MODE}-2b-layers-rows.png`);

if (coarse) {
  // Expand the Lattice panel (a separate user action, one tap) to inspect
  // the Widths/Nodes controls that only exist in the DOM once it's open.
  await evalJS(`document.getElementById('editorLatticePanelHeader').click(); true`);
  await sleep(400);
}

const toggleSelectors = [
  '#editorLayersPanel .layer-visibility', '#editorLayersPanel .layer-carve', '#editorLayersPanel .layer-showcolor',
  '#latticeNodesEnds', '#latticeNodesCrossings', '#latticeNodesRailEnds',
];
report.toggleSizes = {};
for (const sel of toggleSelectors) {
  const r = await rectOf(sel);
  report.toggleSizes[sel] = r ? { width: +r.width.toFixed(1), height: +r.height.toFixed(1), meetsMin: r.width >= 32 && r.height >= 32 } : 'NOT FOUND';
}

report.widthsRowInputsVisible = await evalJS(`['latticeWidthRails','latticeWidthTies','latticeWidthNodes'].map(id => { const e = document.getElementById(id); if (!e) return id+':missing'; const r = e.getBoundingClientRect(); return id+':'+Math.round(r.width)+'x'+Math.round(r.height); }).join(' ')`);
report.widthsRowFitsPanel = await evalJS(`(() => {
  const panel = document.getElementById('editorLatticePanel');
  const row = document.getElementById('latticeWidthNodes')?.closest('div[style*="display:flex"]');
  if (!panel || !row) return 'missing';
  const pr = panel.getBoundingClientRect(), rr = row.getBoundingClientRect();
  return { panelRight: pr.right, rowRight: rr.right, clipped: rr.right > pr.right + 1 };
})()`);

await shot(`mob2-${MODE}-3-lattice-panel.png`);

if (coarse) {
  // MOB2b's own documented limit (see styles/editor.css's
  // .editor-layers-panel comment): fully expanding the Pattern sheet (up
  // to 65vh) can shrink the canvas past its floor before the Layers
  // panel's reserved margin fully fits, so a partial overlap can
  // reappear here — not asserted false, just recorded, since the
  // dispatched/verified scenario is the default collapsed state (above,
  // BEFORE this block). Collapsing back (below) must recover full
  // clearance regardless — THAT round-trip IS asserted.
  report.layersPanelRectExpanded = await rectOf('#editorLayersPanel');
  report.latticePanelRectExpanded = await rectOf('#editorLatticePanel');
  report.pillIntersectsLayersPanelExpanded = intersects(await rectOf('.editor-history'), report.layersPanelRectExpanded);

  await evalJS(`document.getElementById('editorLatticePanelHeader').click(); true`);
  await sleep(600);
  report.layerRowVisibilityAfterCollapseAgain = await evalJS(`(() => {
    const rows = [...document.querySelectorAll('#editorLayersPanel .layer-row')];
    return rows.map(row => {
      const r = row.getBoundingClientRect();
      const topEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return row.contains(topEl) || row === topEl;
    });
  })()`);
  report.allRowsVisibleAfterRoundTrip = report.layerRowVisibilityAfterCollapseAgain.length > 0 && report.layerRowVisibilityAfterCollapseAgain.every(Boolean);
  await shot(`mob2-${MODE}-4-recollapsed.png`);
}

report.logs = logs.slice(0, 15);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

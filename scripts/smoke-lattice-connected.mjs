// Usage: node scripts/smoke-lattice-connected.mjs <outDir> [url]
// SE7i Section 3+4 — connected editing in the Lattice tool. Headless-
// Chrome (CDP, no deps) browser proof, standing in for a Fusion live
// check per Fred's hard rule (no Fusion tool calls while he's using it):
// serve the repo root (python -m http.server 8765 --directory . from the
// REPO ROOT) and pass
// http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html
// as <url>. Standalone script (same reasoning as every other
// smoke-lattice-*.mjs this cycle).
//
// Coordinate discipline: under the NEW hit-test-first behavior, starting
// a drag exactly ON an existing rail/tie/node now GRABS it instead of
// drawing something new through it — a real, intended UX change, not a
// bug (confirmed the hard way while writing this script: a tie drawn
// starting exactly on a just-drawn rail silently became a rail MOVE
// instead). Every "draw a new tie that ends up attached to a rail" drag
// below therefore starts from genuinely EMPTY space and ends exactly ON
// the rail — hit-testing only ever looks at the drag's START point.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.argv[2];
const URL = process.argv[3] || 'http://localhost:8765/bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html';
const PORT = 9344;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
mkdirSync(`${OUT}/chrome-se7i-connected`, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${OUT}/chrome-se7i-connected`,
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

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(9000);

const report = {};

await evalJS(`document.getElementById('btnStampEdit').click(); true`);
await sleep(2500);
await evalJS(`document.getElementById('svgEditorModal').scrollIntoView({ block: 'start' }); true`);
await sleep(300);
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
async function dragFromTo(mStart, mEnd, steps = 4) {
  const start = await modelToScreen(mStart.x, mStart.y);
  const end = await modelToScreen(mEnd.x, mEnd.y);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: start.x, y: start.y, button: 'left', clickCount: 1 });
  await sleep(80);
  for (let k = 1; k <= steps; k++) {
    const x = start.x + (end.x - start.x) * (k / steps);
    const y = start.y + (end.y - start.y) * (k / steps);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left' });
    await sleep(40);
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: end.x, y: end.y, button: 'left', clickCount: 1 });
  await sleep(300);
}
async function moveTo(mPt) {
  const s = await modelToScreen(mPt.x, mPt.y);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y });
  await sleep(200);
}

report.spacing = await evalJS(`window.svgEditor._grid.spacing`);

// ============================================================
// Build a known, precise configuration by hand-drawing (not Generate —
// exact coordinates matter for these assertions):
//   Rail A: (1,1)-(4,1)         row y=1, spans x=1..4
//   Tie:    (2,3)-(2,1)         starts in EMPTY space (y=3), ends
//                                exactly ON Rail A's row (y=1) — its
//                                'b' endpoint is the one attached.
//   Rail B: (1,6)-(4,6)         a second, unrelated rail (Section 4)
// ============================================================
await dragFromTo({ x: 1, y: 1 }, { x: 4, y: 1 });      // Rail A
await dragFromTo({ x: 2, y: 3 }, { x: 2, y: 1 });      // Tie, 'b' end lands on Rail A
await dragFromTo({ x: 1, y: 6 }, { x: 4, y: 6 });      // Rail B

function findRail(x1) {
  return `[...document.querySelectorAll('[data-lattice=rail]')].find(r => +r.getAttribute('x1') === ${x1})`;
}
report.built = await evalJS(`(() => {
  const rails = [...document.querySelectorAll('[data-lattice=rail]')].map(r => ({x1:+r.getAttribute('x1'),y1:+r.getAttribute('y1'),x2:+r.getAttribute('x2'),y2:+r.getAttribute('y2'), owned: r.hasAttribute('data-lattice-gen')}));
  const ties = [...document.querySelectorAll('[data-lattice=tie]')].map(t => ({x1:+t.getAttribute('x1'),y1:+t.getAttribute('y1'),x2:+t.getAttribute('x2'),y2:+t.getAttribute('y2')}));
  const nodes = [...document.querySelectorAll('[data-lattice=node]')].map(n => ({cx:+n.getAttribute('cx'),cy:+n.getAttribute('cy')}));
  return { rails, ties, nodes };
})()`);
report.tieAttachedToRailA = report.built.ties.length === 1 && report.built.ties[0].x2 === 2 && report.built.ties[0].y2 === 1;
await shot('se7i-connected-1-built.png');

// ============================================================
// HOVER: pointer over Rail A's own body (away from the tie junction, so
// the hit is unambiguous) highlights it; moving to empty space clears it.
// ============================================================
await moveTo({ x: 3.5, y: 1 });
report.hoverHighlightsRail = await evalJS(`window.svgEditor._hoveredElement != null && window.svgEditor._hoveredElement.node.getAttribute('data-lattice') === 'rail'`);
await moveTo({ x: 6, y: 4.5 }); // still ON the 7x9 board (default _mW/_mH), away from everything drawn
report.hoverClearsOnEmptySpace = await evalJS(`window.svgEditor._hoveredElement == null`);

// ============================================================
// RAIL MOVE: grab Rail A away from the tie junction (x=3.5, not x=2) and
// drag it to a new row (y=1 -> y=2). Expect:
//  - Rail A's own y1/y2 become 2, x-range (1..4) unchanged
//  - the tie's ATTACHED end ('b', at (2,1)) follows to (2,2); its OTHER
//    end (2,3) is untouched — the tie's length changes
//  - every node that was exactly on Rail A's original row (its own two
//    end-nodes at (1,1)/(4,1), and the tie/rail crossing node at (2,1))
//    is carried along to row 2
//  - ownership (data-lattice-gen) preserved
//  - ONE undo step for the whole gesture
// ============================================================
const beforeUndo = await evalJS(`window.svgEditor._undoStack.length`);
await dragFromTo({ x: 3.5, y: 1 }, { x: 3.5, y: 2 });
await sleep(300);
report.afterRailMove = await evalJS(`(() => {
  const rail = ${findRail(1)};
  const tie = document.querySelector('[data-lattice=tie]');
  const nodeAtCrossing = [...document.querySelectorAll('[data-lattice=node]')].find(n => +n.getAttribute('cx') === 2 && Math.abs(+n.getAttribute('cy') - 2) < 1e-9);
  const railEndNode1 = [...document.querySelectorAll('[data-lattice=node]')].find(n => +n.getAttribute('cx') === 1 && +n.getAttribute('cy') === 2);
  const railEndNode2 = [...document.querySelectorAll('[data-lattice=node]')].find(n => +n.getAttribute('cx') === 4 && +n.getAttribute('cy') === 2);
  return {
    rail: rail ? { y1: +rail.getAttribute('y1'), y2: +rail.getAttribute('y2'), x1: +rail.getAttribute('x1'), x2: +rail.getAttribute('x2'), owned: rail.hasAttribute('data-lattice-gen') } : null,
    tie: tie ? { x1: +tie.getAttribute('x1'), y1: +tie.getAttribute('y1'), x2: +tie.getAttribute('x2'), y2: +tie.getAttribute('y2') } : null,
    nodeAtCrossingFound: !!nodeAtCrossing,
    railEndNodesCarried: !!railEndNode1 && !!railEndNode2,
    undoStackLen: window.svgEditor._undoStack.length,
  };
})()`);
report.railMovedToNewRow = report.afterRailMove.rail?.y1 === 2 && report.afterRailMove.rail?.y2 === 2;
report.railXRangeUnchanged = report.afterRailMove.rail?.x1 === 1 && report.afterRailMove.rail?.x2 === 4;
report.tieAttachedEndFollowed = report.afterRailMove.tie?.x2 === 2 && report.afterRailMove.tie?.y2 === 2;
report.tieOtherEndUntouched = report.afterRailMove.tie?.x1 === 2 && report.afterRailMove.tie?.y1 === 3;
report.crossingNodeCarriedWithRail = report.afterRailMove.nodeAtCrossingFound;
report.railsOwnEndNodesCarried = report.afterRailMove.railEndNodesCarried;
report.railStillOwned = report.afterRailMove.rail?.owned === false; // hand-drawn — never owned by a generator pattern; confirms nothing spuriously tagged it
report.oneUndoStepForWholeGesture = report.afterRailMove.undoStackLen === beforeUndo + 1;
await shot('se7i-connected-2-rail-moved.png');

// Undo reverts rail + tie + nodes together (one Ctrl+Z).
await evalJS(`window.svgEditor.undo(); true`);
await sleep(300);
report.afterUndo = await evalJS(`(() => {
  const rail = ${findRail(1)};
  const tie = document.querySelector('[data-lattice=tie]');
  return {
    rail: rail ? { y1: +rail.getAttribute('y1') } : null,
    tie: tie ? { x1: +tie.getAttribute('x1'), y1: +tie.getAttribute('y1'), x2: +tie.getAttribute('x2'), y2: +tie.getAttribute('y2') } : null,
  };
})()`);
report.undoRevertedRailAndTieTogether = report.afterUndo.rail?.y1 === 1
  && report.afterUndo.tie?.x1 === 2 && report.afterUndo.tie?.y1 === 3 && report.afterUndo.tie?.x2 === 2 && report.afterUndo.tie?.y2 === 1;

// Redo puts it all back.
await evalJS(`window.svgEditor.redo(); true`);
await sleep(300);
report.afterRedo = await evalJS(`(() => { const rail = ${findRail(1)}; return rail ? +rail.getAttribute('y1') : null; })()`);
report.redoReappliedRailMove = report.afterRedo === 2;

// ============================================================
// NODE MOVE (Fred: "moves the tie end it belongs to along its rail"):
// grab the crossing node (currently at (2,2), the tie's own attached end,
// itself sitting on Rail A's row 2) and drag it. Since it's rail-
// attached, the drag must be CONSTRAINED to slide ALONG the rail — only
// the along-rail coordinate (x) follows the pointer; the row (y) stays
// pinned at 2. The tie's own endpoint must move WITH the node (same
// point, always).
// ============================================================
await dragFromTo({ x: 2, y: 2 }, { x: 3, y: 4 }); // deliberately off-axis — constraint should still pin y=2
await sleep(300);
report.afterNodeMove = await evalJS(`(() => {
  const node = [...document.querySelectorAll('[data-lattice=node]')].find(n => Math.abs(+n.getAttribute('cy') - 2) < 0.01 && +n.getAttribute('cx') !== 1 && +n.getAttribute('cx') !== 4);
  const tie = document.querySelector('[data-lattice=tie]');
  return {
    node: node ? { cx: +node.getAttribute('cx'), cy: +node.getAttribute('cy') } : null,
    tie: tie ? { x2: +tie.getAttribute('x2'), y2: +tie.getAttribute('y2') } : null,
  };
})()`);
report.nodeSlidAlongRailNotOffIt = report.afterNodeMove.node?.cy === 2 && report.afterNodeMove.node?.cx !== 2; // y pinned, x actually moved
report.tieEndFollowedTheDraggedNode = report.afterNodeMove.tie?.x2 === report.afterNodeMove.node?.cx && report.afterNodeMove.tie?.y2 === 2;
await shot('se7i-connected-2b-node-moved.png');

// ============================================================
// TIE MOVE: grab the tie somewhere along its own length and drag it
// rigidly. Expect both ends to shift by the SAME delta (shape/length
// preserved) — "drags freely, not confined between rails."
// ============================================================
const tieBefore = await evalJS(`(() => { const t = document.querySelector('[data-lattice=tie]'); return { x1:+t.getAttribute('x1'), y1:+t.getAttribute('y1'), x2:+t.getAttribute('x2'), y2:+t.getAttribute('y2') }; })()`);
const tieMidY = (tieBefore.y1 + tieBefore.y2) / 2;
await dragFromTo({ x: tieBefore.x1, y: tieMidY }, { x: tieBefore.x1 + 1, y: tieMidY + 1 });
await sleep(300);
report.tieAfterMove = await evalJS(`(() => { const t = document.querySelector('[data-lattice=tie]'); return { x1:+t.getAttribute('x1'), y1:+t.getAttribute('y1'), x2:+t.getAttribute('x2'), y2:+t.getAttribute('y2') }; })()`);
report.tieMovedRigidly = (report.tieAfterMove.x2 - report.tieAfterMove.x1) === (tieBefore.x2 - tieBefore.x1)
  && (report.tieAfterMove.y2 - report.tieAfterMove.y1) === (tieBefore.y2 - tieBefore.y1)
  && (report.tieAfterMove.x1 !== tieBefore.x1 || report.tieAfterMove.y1 !== tieBefore.y1); // non-vacuous: it actually moved
await shot('se7i-connected-3-tie-moved.png');

// ============================================================
// SECTION 4 ROBUSTNESS: Select-move Rail B (creates a transform=), then
// a Lattice-mode drag on Rail A (a DIFFERENT rail) must read world
// positions correctly and throw no errors. Then grab Rail B ITSELF via
// Lattice mode — its own leftover transform must get baked out.
// ============================================================
await evalJS(`document.getElementById('toolSelect').click(); true`);
await sleep(300);
await dragFromTo({ x: 3.5, y: 6 }, { x: 3.5, y: 7 }); // Select-drag Rail B — writes a transform=
await sleep(300);
report.railBHasTransformAfterSelectMove = await evalJS(`[...document.querySelectorAll('[data-lattice=rail]')].some(r => r.hasAttribute('transform'))`);

await evalJS(`document.getElementById('toolLattice').click(); true`);
await sleep(300);
const railANow = await evalJS(`(() => { const r = ${findRail(1)}; return { y: +r.getAttribute('y1') }; })()`);
await dragFromTo({ x: 3.5, y: railANow.y }, { x: 3.5, y: railANow.y + 1 });
await sleep(300);
report.noErrorsAfterCrossToolInteraction = logs.filter(l => l.startsWith('EXCEPTION') || l.startsWith('ERROR')).length === 0;

// Grab Rail B itself (still carrying its Select-transform) via Lattice
// mode — the bake-on-grab fix must clear that transform. Its WORLD
// midpoint = raw midpoint + the transform's own translation — Select
// moves always write a pure translate() (this codebase's own established
// convention), so plain arithmetic on the parsed matrix(a,b,c,d,e,f)
// avoids getCTM()'s screen-vs-viewBox scaling ambiguity entirely.
const railBWorldMid = await evalJS(`(() => {
  const r = [...document.querySelectorAll('[data-lattice=rail]')].find(r => r.hasAttribute('transform'));
  const m = r.getAttribute('transform').match(/matrix\\(([^,]+),([^,]+),([^,]+),([^,]+),([^,]+),([^,)]+)\\)/).slice(1).map(Number);
  const [, , , , e, f] = m;
  const midX = (+r.getAttribute('x1') + +r.getAttribute('x2')) / 2 + e;
  const midY = (+r.getAttribute('y1') + +r.getAttribute('y2')) / 2 + f;
  return { x: midX, y: midY };
})()`);
await dragFromTo(railBWorldMid, { x: railBWorldMid.x, y: railBWorldMid.y + 1 });
await sleep(300);
report.transformBakedOutAfterLatticeGrab = await evalJS(`![...document.querySelectorAll('[data-lattice=rail]')].some(r => r.hasAttribute('transform'))`);
await shot('se7i-connected-4-cross-tool-robustness.png');

// ============================================================
// VERTICAL ORIENTATION MIRROR (Fred: "vice versa if I inverse the
// orientation"): flip to vertical, hand-draw a vertical rail + a
// horizontal tie whose end attaches to it, then drag the rail LEFT/RIGHT
// — the tie's LENGTH (real-i span) must change, never its stroke width,
// and it stays horizontal throughout.
//
// A FRESH layer for this — clicking the orientation toggle button calls
// generatePattern (Section 1), which would fill the WHOLE board with a
// generated pattern using this layer's current settings and collide with
// the hand-drawn content below. Setting `.pattern.orientation` directly
// (bypassing the button) keeps this a clean, quiet layer: hand-drawing
// reads orientation via getLayerPattern exactly the same either way.
// ============================================================
await evalJS(`document.getElementById('editorAddLayer').click(); true`);
await sleep(400);
await evalJS(`(() => {
  const e = window.svgEditor;
  const layer = e._layers.find(l => l.id === e._activeLayer);
  layer.pattern = { orientation: 'vertical' };
})(); true`);
await sleep(200);
await dragFromTo({ x: 4, y: 1 }, { x: 4, y: 4 });   // a VERTICAL rail (column) under vertical orientation
await dragFromTo({ x: 6, y: 2 }, { x: 4, y: 2 });   // a HORIZONTAL tie starting in empty space, ENDING on the rail
await sleep(300);
report.verticalBuilt = await evalJS(`(() => {
  const rails = [...document.querySelectorAll('[data-lattice=rail]')].filter(r => +r.getAttribute('x1') === 4 && +r.getAttribute('x2') === 4);
  const ties = [...document.querySelectorAll('[data-lattice=tie]')].filter(t => +t.getAttribute('y1') === 2 && +t.getAttribute('y2') === 2);
  return { railCount: rails.length, tieCount: ties.length };
})()`);
const tieBeforeVert = await evalJS(`(() => { const t = [...document.querySelectorAll('[data-lattice=tie]')].find(t => +t.getAttribute('y1') === 2 && +t.getAttribute('y2') === 2); return t ? { x1:+t.getAttribute('x1'), x2:+t.getAttribute('x2'), sw: t.getAttribute('stroke-width') } : null; })()`);
await dragFromTo({ x: 4, y: 3 }, { x: 5, y: 3 }); // grab the vertical rail away from the junction (y=3, not y=2), drag it right
await sleep(300);
report.tieAfterVerticalRailMove = await evalJS(`(() => { const t = [...document.querySelectorAll('[data-lattice=tie]')].find(t => +t.getAttribute('y1') === 2 && +t.getAttribute('y2') === 2); return t ? { x1:+t.getAttribute('x1'), x2:+t.getAttribute('x2'), y1:+t.getAttribute('y1'), y2:+t.getAttribute('y2'), sw: t.getAttribute('stroke-width') } : null; })()`);
report.verticalMirrorWorks = !!(tieBeforeVert && report.tieAfterVerticalRailMove
  && report.tieAfterVerticalRailMove.y1 === 2 && report.tieAfterVerticalRailMove.y2 === 2 // stayed horizontal
  && report.tieAfterVerticalRailMove.sw === tieBeforeVert.sw // stroke width UNCHANGED
  && report.tieAfterVerticalRailMove.x2 !== tieBeforeVert.x2); // length DID change (the attached end moved)
await shot('se7i-connected-5-vertical-mirror.png');

report.logs = logs.slice(0, 20);
console.log(JSON.stringify(report, null, 1));
ws.close(); chrome.kill();
process.exit(0);

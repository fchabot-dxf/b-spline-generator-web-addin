/**
 * editor-snap-resolver.js — H1 (SNAP-SPLIT, Fred 2026-09-26: "on manual
 * moving, geometry snaps if snapping is on (need snapping distinction, for
 * geometry and grid)"). This module owns the GEOMETRY half only: a pure
 * QUERY, "what existing geometry sits within tolerance of this point" —
 * no grid, no toggle state, no priority decision (that's editor-grid.js's
 * own `snapFor`, the ONE declared resolver the checklist names, which
 * imports this and decides GRID vs GEOMETRY vs neither). Kept as its own
 * file rather than folded into editor-grid.js specifically so that file
 * doesn't have to import back from a module that already imports IT
 * (snapFor needs the grid-vs-geometry priority; this file needs none of
 * editor-grid.js's own state) — a one-directional import, not a cycle.
 *
 * Targets: rail/tie/node/contour endpoints and line-line intersections
 * (covering "ties' rail contacts" from the ROADMAP entry) fall out of a
 * SINGLE generic pass over the sketch layer for free — a rail/tie is a
 * plain `<line>`, a node a plain `<circle>`, a contour segment a plain
 * `<path>`, exactly like anything hand-drawn, so `getNodes` (editor-
 * hit.js, already the direct-edit tool's own node-extraction) already
 * returns their endpoints/centres without any lattice-specific code here.
 * No `toLattice` rounding anywhere in this file (`getNodes` reads raw
 * world positions directly) — the exact-position principle UI5 item 5
 * established (compare real geometry, not the nearest grid cell) is what
 * makes an off-grid RAIL-SPACING rail's own row a valid, exact snap
 * target here too, for the identical reason.
 */
import { getNodes } from './editor-hit.js';
import { isOnVisibleLayer } from './layers.js';

// H1: the pixel radius (screen px, scaled like every other hit-test
// tolerance via getDynamicTolerance) a drag point must land within to
// snap to a geometry target — same "slopPx" input-profile tier
// getNearbyElement's own hover/click hit-testing already uses, not a new
// tolerance concept. Exported so every caller (editor-grid.js's own
// snapFor, editor-interaction.js's lattice piece drags) shares the one
// declared value.
export const GEOMETRY_SNAP_TOL_PX = 10;

/**
 * Two segments' own intersection point, or null when they're parallel or
 * the crossing falls outside EITHER segment's own extent (a real crossing,
 * never an extrapolation past either line's own drawn ends). Standard
 * parametric line-segment intersection; `1e-9` guards the parallel case
 * against float noise, not a tolerance for "nearly crossing."
 */
function _segmentIntersection(a1, a2, b1, b2) {
  const rX = a2.x - a1.x, rY = a2.y - a1.y;
  const sX = b2.x - b1.x, sY = b2.y - b1.y;
  const denom = rX * sY - rY * sX;
  if (Math.abs(denom) < 1e-9) return null; // parallel (or either segment degenerate)
  const t = ((b1.x - a1.x) * sY - (b1.y - a1.y) * sX) / denom;
  const u = ((b1.x - a1.x) * rY - (b1.y - a1.y) * rX) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { x: a1.x + t * rX, y: a1.y + t * rY };
}

/**
 * Every geometry snap TARGET point currently on screen: each editable/
 * visible element's own `getNodes()` points (endpoints, rect corners,
 * circle/ellipse centres, path segment ends — rails/ties/nodes/contour
 * fall out of this for free, being plain line/circle/path elements),
 * the midpoint between each pair of CONSECUTIVE nodes (a line's own
 * middle; a polyline/path's own per-segment middles), and every pairwise
 * `<line>`-`<line>` intersection (a tie crossing a rail; two hand-drawn
 * lines crossing — the SAME formula either way, no lattice-specific
 * branch needed). `excludeEl`, when given, drops just that one element
 * (the piece currently being dragged) so a point can't snap to its own,
 * about-to-move, endpoint.
 */
export function geometrySnapTargets(editor, excludeEl = null) {
  if (!editor._sketchLayer) return [];
  const g = editor._snapGesture && editor._sketchLayer.node ? editor._snapGesture : null; // no DOM node: never cached
  const kids = g ? [...editor._sketchLayer.node.children] : null;
  if (g && g.targets && g.excludeEl === excludeEl && g.kids.length === kids.length && g.kids.every((k, i) => k === kids[i])) return g.targets;
  const targets = (excludeEl == null && _warmTargets(editor)) || _buildSnapTargets(editor, excludeEl);
  if (g) Object.assign(g, { excludeEl, kids, targets });
  return targets;
}

/** The IDLE-WARM targets (seat D 2026-10-14; the gate's blind row "Brush stroke": a 60 ms task at POINTERDOWN, before
 *  the card -- the press's first build, getNodes over every sketch element). The targets with no excluded element are
 *  built in an IDLE slice and kept while nothing they read changes: the sketch layer's elements and their attributes
 *  (transform, display, the lock and layer marks -- a MutationObserver) and the layers' visibility (editor._layers). A
 *  press then starts on them; a stale or missing warm set is built at the press as before -- the same targets either
 *  way. */
export const SNAP_WARM = Object.freeze({ idleTimeoutMs: 1000, fallbackDelayMs: 150 });
const _layersSig = (editor) => (Array.isArray(editor._layers) ? editor._layers : []).map((l) => `${l.id}:${l.visible !== false}`).join('|');

/** Watches `editor`'s sketch layer (once per layer node) and warms the targets when it is quiet. */
export function watchSnapTargets(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || typeof MutationObserver === 'undefined') return;
  const w = editor._snapWarm;
  if (w && w.node === node) return;
  if (w) w.observer.disconnect();
  const warm = { node, targets: null, sig: null, pending: false, observer: null };
  warm.observer = new MutationObserver(() => { warm.targets = null; _scheduleWarm(editor, warm); });
  warm.observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
  editor._snapWarm = warm;
  _scheduleWarm(editor, warm);
}

function _scheduleWarm(editor, warm) {
  if (warm.pending) return;
  warm.pending = true;
  const run = () => {
    warm.pending = false;
    if (editor._snapWarm !== warm) return;
    if (warm.observer.takeRecords().length) { warm.targets = null; _scheduleWarm(editor, warm); return; } // still changing
    warm.sig = _layersSig(editor);
    warm.targets = _buildSnapTargets(editor, null);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: SNAP_WARM.idleTimeoutMs });
  else setTimeout(run, SNAP_WARM.fallbackDelayMs);
}

/** The warm targets when they still hold (no change since they were built), else null. */
function _warmTargets(editor) {
  const warm = editor._snapWarm;
  if (!warm || !editor._sketchLayer || warm.node !== editor._sketchLayer.node) return null;
  if (warm.observer.takeRecords().length) { warm.targets = null; _scheduleWarm(editor, warm); return null; } // a change this tick
  if (!warm.targets || warm.sig !== _layersSig(editor)) return null;
  return warm.targets;
}

/** The SNAP GESTURE cache (seat A 2026-10-11, matrix blind row "Brush stroke": 390 px, CPU x4, 62-217 ms frozen
 *  before its card; the profile named this function -- getNodes over every sketch element through svg.js, ~40 ms
 *  on the pointerdown AND on each pointermove). One press = one gesture (editor-interaction.js: the first pointer
 *  down begins it, the last pointer up / cancel ends it); inside it the targets are built once and reused, per
 *  `excludeEl` and while the sketch layer holds the same elements (one added or removed mid-gesture rebuilds), so
 *  every snap answers as before. Outside a gesture nothing is cached. */
export function beginSnapGesture(editor) { editor._snapGesture = { excludeEl: undefined, kids: [], targets: null }; }
export function endSnapGesture(editor) { editor._snapGesture = null; }

function _makeTarget(x, y, el, kind, el2 = null) {
  const t = { x, y };
  if (el) Object.defineProperty(t, 'el', { value: el, enumerable: false, writable: true, configurable: true });
  if (kind) Object.defineProperty(t, 'kind', { value: kind, enumerable: false, writable: true, configurable: true });
  if (el2) Object.defineProperty(t, 'el2', { value: el2, enumerable: false, writable: true, configurable: true });
  return t;
}

function _buildSnapTargets(editor, excludeEl) {
  const targets = [];
  const lines = [];

  for (const el of editor._sketchLayer.children().toArray()) {
    // SE16: `excludeEl` may also be a Set (a cut rail's whole chain being dragged)
    if (!el || el === excludeEl || (excludeEl instanceof Set && excludeEl.has(el))) continue;
    if (!isOnVisibleLayer(editor, el)) continue;
    let nodes;
    try {
      nodes = getNodes(el);
    } catch (_) {
      continue; // defensive: an element type getNodes doesn't recognize
    }
    const defaultKind = el.type === 'circle' ? 'center' : 'endpoint';
    for (const n of nodes) targets.push(_makeTarget(n.x, n.y, el, defaultKind));
    for (let i = 0; i + 1 < nodes.length; i++) {
      targets.push(_makeTarget((nodes[i].x + nodes[i + 1].x) / 2, (nodes[i].y + nodes[i + 1].y) / 2, el, 'midpoint'));
    }
    if (el.type === 'line' && nodes.length === 2) lines.push({ a: nodes[0], b: nodes[1], el });
  }

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const hit = _segmentIntersection(lines[i].a, lines[i].b, lines[j].a, lines[j].b);
      if (hit) targets.push(_makeTarget(hit.x, hit.y, lines[i].el, 'intersection', lines[j].el));
    }
  }

  return targets;
}

/** The nearest geometry target to `pt` within `tol` (model units), or
 *  null when nothing qualifies — `snapFor`'s own "geometry wins within
 *  its tolerance, else grid" priority reads this return value directly. */
export function nearestGeometrySnap(pt, editor, tol, excludeEl = null) {
  const targets = geometrySnapTargets(editor, excludeEl);
  let best = null;
  let bestDistSq = tol * tol;
  for (const c of targets) {
    const dSq = (pt.x - c.x) ** 2 + (pt.y - c.y) ** 2;
    if (dSq <= bestDistSq) { bestDistSq = dSq; best = c; }
  }
  return best;
}

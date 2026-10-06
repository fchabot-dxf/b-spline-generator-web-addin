/**
 * editor-brick-tool.js — F35 item 1: the adapter between the PORTABLE
 * core/bricks/ engine (pure geometry, zero DOM) and this editor's own
 * layers/drawing surface. Per WORK-LOG.md's own adapter table (H23 item 72,
 * P1a): a path/freehand stroke -> bricksAlongPath (Brush), a filled shape
 * -> bricksFillShape (Wall), a closed contour -> bricksContourBands (Frame).
 *
 * COORDINATES (verified live, not assumed -- a headless-Chrome probe drew a
 * known 1x1 rect at (0,0) via `editor._sketchLayer.rect(1,1).move(0,0)` and
 * confirmed by screenshot it lands exactly in the board's own top-left
 * corner): the editor's native drawing-surface units ARE board inches
 * directly (`editor._mW`/`_mH` === P.widthIn/heightIn, origin top-left, Y
 * down, no DPI scale at this layer -- DPI only enters at export/rasterize
 * time, e.g. getLayerSvg's own dpi param). So every point core/bricks/
 * returns (already in "board inches") is drawn with ZERO transform.
 *
 * LAYER TAGGING (the declared convention every generator here already
 * follows, e.g. editor-lattice.js's emitSegment/emitNode): `data-layer`
 * (membership, read by every layer op) + BRICK_ATTR (which TOOL produced
 * this piece) + BRICK_GEN_ATTR (an ownership marker, mirroring Shape
 * Lattice's own `data-lattice-gen`, so a future "regenerate" can clear only
 * this adapter's own output, never hand-drawn content on the same layer).
 *
 * HEIGHT INTO THE TERRAIN (Fred's own brief: "like the other sources"): the
 * Bricks layer is tagged with the SAME tooling fields (`depth`, `profile`,
 * `edgeFilletRadius`) every other carved layer already has (layers.js's own
 * TOOLING_DEFAULTS), but F35 item 5 routes it through its OWN rasterizer
 * (editor-brick-height-mask.js, wired in by main/stamp-mask-manager.js's own
 * isBricksLayer branch) instead of the generic SVG-polygon one every other
 * carved layer uses -- a flat per-layer depth has no way to express a
 * brick's own real top-face shape. That rasterizer calls core/bricks/'s own
 * sampleHeight/buildSpatialIndex per terrain grid point (shoulder, crown,
 * seeded corner chips, and -- via editor-brick-surface.js's sampleDetailAt --
 * a de-lit sample-photo detail layer), reading the SAME drawn polygons back
 * off the DOM via the `data-brick-*` attributes drawBrick stashes below.
 * `profile`/`edgeFilletRadius` stay set (harmless, and still what a non-brick
 * reader of this layer's tooling would see) even though the brick rasterizer
 * itself doesn't consult them. `grout.profile:'recessed'` recesses the joints
 * by `grout.depthIn` IN THE SAME brick mask (editor-brick-height-mask.js, F35
 * item 18 turn 181 -- no second stamp layer needed); 'flush' leaves them at
 * the ground.
 *
 * F35 item 3: Wall/Frame stay exactly this item-1 fire-and-forget regime
 * (regenerated fresh from current settings on each button click; their own
 * "spine" is the live board/frame contour, not a drawn element -- there's
 * nothing there for Scissors/Stripe to tap). Brush is different: it is now
 * a genuine DECLARED ELEMENT (a persistent spine + a settings snapshot;
 * bricks are DERIVED and regenerated, never hand-edited) -- see the
 * BRICK_ELEMENT_ATTR/BRICK_SETTINGS_ATTR/reconstructChains/
 * regenerateOwnedBrickElements block below for the full mechanism.
 */
import { ensureActiveLayer, BRICKS_LAYER_NAME, isBricksLayer, bricksLayerOf, applyLayerStateTo, BRICK_RECORD_ATTR, BRICK_ELEMENT_ATTR, BRICK_OWNER_ATTR, brickElementNodes, brickKindLayer, LOCKED_ATTR } from './layers.js';
import { commitEdit } from './editor-commit.js';
import { ramerDouglasPeucker } from './editor-curves.js';
import { pieceEnds } from './editor-cut-tool.js';
import { STRIPE_ATTR } from './editor-stripe-tool.js';
import { bricksAlongPath, bricksContourBands, generateBricks, pointInPolygon, ENGINE_OPTIONS, bricksClearOf, frameCornerEffect } from '../core/bricks/index.js';
import { brickSetById, BRICK_PATTERNS, BRUSH_PRESETS, FRAME_PRESETS, BRICK_SETS, scaledSet } from '../core/bricks/library.js';
import { rectToPrimitives } from '../core/inset-window.js';
import { brickFillPaint } from './editor-brick-surface.js';
import { cumulativeLengths, pointAtArcLength, inwardSignFor } from '../core/bricks/geometry.js';
import { radialSignAt } from '../core/bricks/arc-voussoir.js';
import { accentedBrickIndices, accentedRunIndices, accentLayInput, ACCENT_MARK_ATTR } from './brick-accents.js';
import { groutShapeOf, groutIdOf, pointOnGrout, primitivesOutline } from '../core/bricks/grout-shape.js';
import { wallRegionOf } from '../core/bricks/engine.js';
import { polygonIntersection } from '../core/bricks/geometry.js';

export const BRICK_ATTR = 'data-brick'; // 'brush' | 'wall' | 'frame' | 'brush-spine'
export const BRICK_GEN_ATTR = 'data-brick-gen'; // '1' on every adapter-drawn piece
// Audit K7: the Bricks layer's identity now lives in layers.js (the layer-row summary needs it, and
// layers.js cannot import this file -- this file imports layers.js). Re-exported for every importer.
export { BRICKS_LAYER_NAME, isBricksLayer, bricksLayerOf, BRICK_ELEMENT_ATTR, BRICK_OWNER_ATTR, brickElementNodes };

// F35 item 3 (advisor: "brick elements as declared spine + settings... the
// prerequisite for Scissors/Stripe"): a Brush stroke is no longer baked
// once and forgotten -- its SPINE survives as real, plain `<line>` segments
// (BRICK_ELEMENT_ATTR groups every segment of one stroke; BRICK_SETTINGS_ATTR
// is that stroke's own settings SNAPSHOT, JSON-encoded via svg.js's real
// attr() -> setAttribute(), which escapes correctly on its own -- no hand-
// rolled XML escaping needed here, unlike layers-attr.js's own codec, which
// exists for a DIFFERENT, raw-string-templated save path). A plain `<line>`
// is ALREADY `isCuttable` (editor-cut-tool.js) with ZERO changes to that
// file -- Scissors/Stripe reuse the EXISTING, unmodified cut/stripe modes
// verbatim; this module's own job is purely: keep the spine real, and
// regenerate bricks from (spine, settings) whenever either changes.
// BRICK_ELEMENT_ATTR / BRICK_OWNER_ATTR: declared in layers.js (item 22 slice 3: the context menu reads them too)
export const BRICK_SETTINGS_ATTR = 'data-brick-settings';
const SPINE_KIND = 'brush-spine';

/** F35 item 22 slice 3: bricks go on the ACTIVE layer, like art -- each element on its own layer, so a wall or a
 *  stroke can be hidden / shown / carved with its layer. An element stays where it is: a re-lay draws it on its
 *  RECORD's layer (Wall / Frame), a Brush stroke on its spine's; only a NEW element takes the active layer. (Was
 *  ensureBricksLayer: one shared "Bricks" layer for everything, created on first use.) */
const layerById = (editor, id) => (editor._layers || []).find((l) => String(l.id) === String(id)) || null;
function activeLayerOf(editor) {
  return layerById(editor, ensureActiveLayer(editor));
}
/** The layer a Wall / Frame element IS on (its record's), or null when it has none yet -- read only, never creates. */
export function layerOfElement(editor, kind) {
  const rec = brickRecordNode(editor, kind);
  return (rec && layerById(editor, rec.getAttribute('data-layer'))) || null;
}
/** The layer a Wall / Frame element lays on: its record's, else (a new element) its KIND's own layer (item 64). */
export function elementLayer(editor, kind) {
  const rec = brickRecordNode(editor, kind);
  return (rec && layerById(editor, rec.getAttribute('data-layer'))) || brickKindLayer(editor, kind) || activeLayerOf(editor);
}
/** Does this layer hold laid brick pieces (its height mask is the brick mask)? Read off the drawing, per layer. */
export function layerHasBrickPieces(editor, layerId) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  return !!(node && node.querySelector && node.querySelector(`[data-layer="${layerId}"][${BRICK_GEN_ATTR}="1"]`));
}
/** The layers holding laid bricks, in roster order. */
export function brickPieceLayers(editor) {
  return ((editor && editor._layers) || []).filter((l) => layerHasBrickPieces(editor, l.id));
}
/** The bricks' height scale + direction: the relief, negative when Carved. Not the layer's art depth (slice 3): a
 *  layer holding art AND bricks carves its art at its own depth and its bricks at this. */
export function brickDepth(settings) {
  const r = Number(settings && settings.reliefIn) || 0;
  return settings && settings.invert ? -r : r;
}

/** Writes this brick-tool run's OWN tooling (depth from reliefIn, grout-
 *  driven profile knobs) onto the Bricks layer -- "editor wins" resolution
 *  (main/stamp-mask-manager.js) means these values are what the terrain
 *  actually carves at, not just UI decoration. Direct field writes +
 *  commitEdit, the same shape setLayerCarve/setLayerShowColor already use
 *  for a layer's own tooling (there's no dedicated setLayerDepth -- those
 *  fields are read as plain object properties throughout this codebase). */
function applyBrickLayerTooling(layer, settings) {
  // item 22 slice 3: only the LEGACY brick layer (a board from before slice 3) keeps its tooling in step with the
  // bricks -- an art layer that holds bricks keeps its own (the bricks' height is brickDepth, not the layer's)
  if (!isBricksLayer(layer)) return;
  // Raised/Carved (settings.invert, the same Photo-style 2-state toggle):
  // the generic stamp compositor (core/engine/apply-stamp-layers.js) already
  // treats a NEGATIVE layer depth as "carve down from the base" (its own
  // layerSign/filletAmplitude math is explicitly signed, not clamped) -- so
  // Carved is just this one sign flip, no separate code path needed.
  layer.depth = brickDepth(settings);
  layer.profile = 'flat';
  layer.edgeFilletRadius = 0;
  // Audit C7: `carve` is NOT forced back on here. A new Bricks layer carves by default
  // (layers.js TOOLING_DEFAULTS); after that it is the user's own Layers-row toggle, which a
  // Generate must not silently undo.
}

/** F35 item 4 (a): a declared flat colour per SET, so White Rocks (and a
 *  Stripe run cycling SET, see settingsVariantForCycle) actually reads as a
 *  different material -- this app has no per-sample photo-texture rendering
 *  for bricks yet (every brick is one flat-filled polygon), so a
 *  representative colour per set is the honest, achievable stand-in: Set
 *  1's own red-brick photos read red-brown; Set 3's own fieldstone photos
 *  read pale warm grey. */
const SET_COLORS = Object.freeze(Object.fromEntries(BRICK_SETS.map((s) => [s.id, s.faceColor]))); // F35 item 56: each set's declared faceColor (library.js)
const DEFAULT_BRICK_COLOR = SET_COLORS[1];

/** Draws one `{id, polygon:{x,y}[], sampleId, flip, heightOffset}` brick as a
 *  filled polygon on `layer`, tagged per this file's own header convention.
 *  No stroke (a stroke would draw a visible line INSIDE the joint gaps
 *  between flush-fitting bricks, which core/bricks/ already sizes correctly
 *  via its own grout.widthIn -- adding our own outline would just redraw
 *  over that).
 *
 *  F35 item 5: the fill is the brick's own real sample photo
 *  (editor-brick-surface.js's brickFillPaint, an SVG <pattern>) when one
 *  resolves, falling back to the flat SET_COLORS stand-in otherwise (no
 *  sample -- e.g. the parked 'mc' engine -- or the pattern can't be built).
 *  The extra `data-brick-*` attributes are this brick's own height-relevant
 *  state, read back by editor-brick-height-mask.js's own rasterizer -- the
 *  DOM is that rasterizer's sole source of truth (see its header), so every
 *  field `sampleHeight`/`brickTopHeight` need must be stashed here, at the
 *  one place that already has the real brick object in hand. */
/** The ONE way a brick-tool element joins the Bricks layer: tagged with it AND given its current
 *  hidden / inactive / no-colour state (layers.js applyLayerStateTo). Before, bricks re-laid onto a
 *  hidden Bricks layer showed on the canvas while the layer still said hidden. Every brick-tool draw
 *  (bricks, brush spines, the slow-drag outline preview) goes through here. */
function onBricksLayer(editor, layer, el) {
  el.attr('data-layer', layer.id);
  applyLayerStateTo(editor, el);
  return el;
}

/** A brick's longest side, inches -- the size its fill pattern must cover (editor-brick-surface.js brickFillPaint). */
function brickSpanIn(polygon) {
  if (!polygon || !polygon.length) return 1;
  const xs = polygon.map((p) => p.x), ys = polygon.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function drawBrick(editor, layer, brick, kind, setId, seed, reliefIn) {
  const pts = brick.polygon.map((p) => `${p.x},${p.y}`).join(' ');
  const paint = brickFillPaint(editor, setId, brick.sampleId, brick.flip, brickSpanIn(brick.polygon)) || SET_COLORS[setId] || DEFAULT_BRICK_COLOR;
  const el = onBricksLayer(editor, layer, editor._sketchLayer.polygon(pts))
    .fill(paint)
    .stroke('none')
    .attr(BRICK_ATTR, kind)
    .attr(BRICK_GEN_ATTR, '1')
    .attr('data-brick-set', setId)
    .attr('data-brick-seed', seed)
    .attr('data-brick-relief', reliefIn)
    .attr('data-brick-sample', brick.sampleId || '')
    .attr('data-brick-flip', brick.flip ? '1' : '0')
    .attr('data-brick-id', String(brick.id))
    .attr('data-brick-height-offset', brick.heightOffset || 0);
  if (typeof brick.accentMarked === 'boolean') el.attr(ACCENT_MARK_ATTR, brick.accentMarked ? '1' : '0'); // item 31b: the engine's cut mark
  return el;
}
/** Per-element run accents: a band / stroke brick's place on its run's grid (the engine's band/row/piece). */
function stampRunPlace(el, brick, fallbackPiece) {
  if (Number.isInteger(brick.bandIndex)) el.attr('data-brick-band', brick.bandIndex);
  el.attr('data-brick-row', Number.isInteger(brick.rowIndex) ? brick.rowIndex : 0);
  el.attr('data-brick-piece', Number.isInteger(brick.pieceIndex) ? brick.pieceIndex : fallbackPiece);
  return el;
}

/** Audit v2 N1: a brick's FILL is derived from its own declared attributes (set, sample, flip -- written by
 *  drawBrick above), but the <pattern> it points at lives in the editor's outer <defs>, OUTSIDE the saved
 *  document. A reload or a project load restored the polygons with fills pointing at patterns that no
 *  longer existed: every brick drew nothing. editor-io.js open() calls this on every load, so each brick's
 *  fill is re-derived (and its pattern re-created) from its attributes. Returns how many were repainted. */
export function repaintBricks(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return 0;
  const nodes = node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][data-brick-set]`);
  nodes.forEach((el) => {
    const setId = Number(el.getAttribute('data-brick-set'));
    const nums = (el.getAttribute('points') || '').trim().split(/[ ,]+/).map(Number);
    const poly = []; for (let i = 0; i + 1 < nums.length; i += 2) poly.push({ x: nums[i], y: nums[i + 1] });
    const paint = brickFillPaint(editor, setId, el.getAttribute('data-brick-sample') || null, el.getAttribute('data-brick-flip') === '1', brickSpanIn(poly))
      || SET_COLORS[setId] || DEFAULT_BRICK_COLOR;
    el.setAttribute('fill', paint);
  });
  return nodes.length;
}

function drawBricks(editor, layer, bricks, kind, setId, seed, reliefIn, ownerId = null) {
  for (const [i, b] of bricks.entries()) {
    const el = drawBrick(editor, layer, b, kind, setId, seed, reliefIn);
    if (kind === 'frame') stampRunPlace(el, b, i); // per-band accents read it
    if (ownerId) el.attr(BRICK_OWNER_ATTR, ownerId); // item 22: which element (record) laid it
  }
}

/** F35 item 55: the GROUT as a real shape -- one node per Wall / Frame element (a wall area is its own element): the
 *  element's region minus its painted brick faces (core/bricks/grout-shape.js groutShapeOf, even-odd), drawn ABOVE its
 *  bricks so a coloured grout also covers each face's inset rim. PAINT only: it has no data-brick-set (the height mask
 *  skips it), Send's Bricks sketch skips its kind (layers.js BRICK_SEND_SKIP), and it is LOCKED (layers.js LOCKED_ATTR:
 *  no art tool picks, moves, restyles or deletes it). Its region is kept on the node, so a paint change (colour, edge)
 *  repaints it without a re-lay (repaintGrout). A Brush stroke's region is its ribbon (the engine's ribbonOutline, one
 *  per chain), its node redrawn with the stroke (regenerateOwnedBrickElements). */
export const GROUT_KIND = 'grout';
export const GROUT_OF_ATTR = 'data-brick-grout-of'; // the element KIND it belongs to: wall | frame
export const GROUT_REGION_ATTR = 'data-grout-region'; // its region [{ outer, holes }], JSON, board inches
export const GROUT_INSET_ATTR = 'data-grout-inset'; // item 56: its element's Edge when painted (the SVG download insets the faces by it)
export const GROUT_ELEMENT_KINDS = Object.freeze(['wall', 'frame', 'brush']);
/** The paint a NEW board starts with, and what a saved board without the keys reads: no colour, no inset. */
export const GROUT_PAINT_DEFAULT = Object.freeze({ color: null, paintInsetIn: 0 });
/** An element's grout paint: its own (`groutPaintByElement[kind]`, the Raised brush shares the Brush's) field by
 *  field over the board-wide `groutPaint`, over GROUT_PAINT_DEFAULT. null / missing = inherit (groutByElement's rule). */
export function groutPaintOf(settings, kind) {
  const base = (settings && settings.groutPaint) || {};
  const own = (settings && settings.groutPaintByElement && settings.groutPaintByElement[JOINT_ELEMENT[kind] || kind]) || {};
  const pick = (k) => (k in own ? own[k] : k in base ? base[k] : GROUT_PAINT_DEFAULT[k]);
  const color = pick('color'), inset = Number(pick('paintInsetIn'));
  return { color: typeof color === 'string' && color ? color : null, paintInsetIn: Number.isFinite(inset) && inset > 0 ? inset : 0 };
}
const _isGrout = (n) => n.getAttribute(BRICK_ATTR) === GROUT_KIND;
/** An element's laid brick polygons (its faces before the inset). */
const _ownedBy = (n, elementId) => { const o = n.getAttribute(BRICK_OWNER_ATTR); return o === elementId || (!!o && o.startsWith(`${elementId}:`)); }; // a stroke's bricks: `<id>:<chain>`
function _ownedBrickPolys(editor, elementId) {
  const node = editor._sketchLayer.node;
  return [...node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_OWNER_ATTR}="${elementId}"], [${BRICK_GEN_ATTR}="1"][${BRICK_OWNER_ATTR}^="${elementId}:"]`)]
    .filter((n) => !_isGrout(n)).map(_nodePolygon).filter((p) => p.length >= 3);
}
/** Other elements' bricks that may lie in this element's region (never painted over): every Brush brick, and for a
 *  wall area the other areas' bricks (a whole brick laid by centroid can cross into its neighbour's region). */
function _groutCutouts(editor, kind, elementId) {
  const node = editor._sketchLayer.node;
  const sel = [`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="brush"]`];
  if (kind === 'wall') sel.push(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="wall"]`);
  return [...node.querySelectorAll(sel.join(', '))]
    .filter((n) => !_ownedBy(n, elementId)).map(_nodePolygon).filter((p) => p.length >= 3);
}
/** (Re)computes one grout node's shape + paint from its region, its element's bricks and `settings`. */
function _paintGroutNode(editor, n, settings) {
  const kind = n.getAttribute(GROUT_OF_ATTR), id = n.getAttribute(BRICK_OWNER_ATTR);
  let region = [];
  try { region = JSON.parse(n.getAttribute(GROUT_REGION_ATTR) || '[]'); } catch { region = []; }
  const paint = groutPaintOf(settings, kind);
  const shape = groutShapeOf({ id, region, faces: _ownedBrickPolys(editor, id), cutouts: _groutCutouts(editor, kind, id), insetIn: paint.paintInsetIn });
  n.setAttribute('d', shape ? shape.d : '');
  n.setAttribute('id', groutIdOf(id));
  n.setAttribute('fill', paint.color || 'none');
  n.setAttribute('fill-rule', 'evenodd');
  n.setAttribute(GROUT_INSET_ATTR, String(paint.paintInsetIn));
  return shape;
}
const _roundRegion = (region) => region.map((r) => ({
  outer: r.outer.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) })),
  holes: (r.holes || []).map((h) => h.map((p) => ({ x: +p.x.toFixed(4), y: +p.y.toFixed(4) }))),
}));
/** Draws (or re-draws) the grout of element `elementId` (kind wall | frame) over `region`, on `layer`. */
export function drawElementGrout(editor, layer, kind, elementId, region, settings) {
  const node = editor._sketchLayer.node;
  node.querySelectorAll(`[${BRICK_ATTR}="${GROUT_KIND}"][${BRICK_OWNER_ATTR}="${elementId}"]`).forEach((n) => n.remove());
  const reg = (region || []).filter((r) => r && r.outer && r.outer.length >= 3);
  if (!reg.length) return null;
  const el = onBricksLayer(editor, layer, editor._sketchLayer.path('M0,0'))
    .stroke('none')
    .attr(BRICK_ATTR, GROUT_KIND)
    .attr(BRICK_GEN_ATTR, '1')
    .attr(GROUT_OF_ATTR, kind)
    .attr(BRICK_OWNER_ATTR, elementId)
    .attr(LOCKED_ATTR, '1')
    .attr('pointer-events', 'none')
    .attr(GROUT_REGION_ATTR, JSON.stringify(_roundRegion(reg)));
  _paintGroutNode(editor, el.node, settings);
  return el;
}
/** Every grout node repainted from `settings` (a colour / edge change: paint only, nothing re-lays). Returns how many. */
export function repaintGrout(editor, settings) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return 0;
  const nodes = [...node.querySelectorAll(`[${BRICK_ATTR}="${GROUT_KIND}"]`)];
  for (const n of nodes) _paintGroutNode(editor, n, settings);
  return nodes.length;
}
/** The Wall / Frame elements that have bricks but no grout node yet (a board laid before item 55): its region comes
 *  from the engine, so the panel re-lays them (same settings + seed = the same bricks) instead of only repainting. */
export function elementsWithoutGrout(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return [];
  const sel = GROUT_ELEMENT_KINDS.map((k) => `[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="${k}"][${BRICK_OWNER_ATTR}]`).join(', ');
  const owners = new Set([...node.querySelectorAll(sel)].map((n) => n.getAttribute(BRICK_OWNER_ATTR).split(':')[0])); // a stroke's chains = its id
  for (const g of node.querySelectorAll(`[${BRICK_ATTR}="${GROUT_KIND}"]`)) owners.delete(g.getAttribute(BRICK_OWNER_ATTR));
  return [...owners];
}
/** The grout nodes on the board, as { node, id (its element), kind } -- the SVG download reads these. */
export function groutNodes(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return [];
  return [...node.querySelectorAll(`[${BRICK_ATTR}="${GROUT_KIND}"]`)].map((n) => ({
    node: n, id: n.getAttribute(BRICK_OWNER_ATTR), kind: n.getAttribute(GROUT_OF_ATTR),
  }));
}
/** The grout region of each laid element, from one lay: the wall's fill outline (a painted area: its region cut to that
 *  outline), the frame's band ring (the contour the bands follow, its inner path the hole). */
function _wallAreaRegion(area, settings, interior) {
  const set = resolvedSetFor(elementSettings(settings, 'wall'));
  const polys = wallRegionOf({ strokes: area.strokes, minus: area.minus || [] }, set) || [];
  return polys.map((p) => {
    const outer = interior && interior.length >= 3 ? polygonIntersection(p.outer, interior) : p.outer;
    return { outer, holes: p.holes || [] };
  }).filter((r) => r.outer && r.outer.length >= 3);
}

/** F35 item 22 slice 1: each Wall / Frame ELEMENT has a RECORD -- one invisible node on the brick layer
 *  (`display="none"`: never drawn, hit-tested or exported -- getLayerSvg and the download drop it; no
 *  [data-brick] query sees it) carrying the element's id (BRICK_ELEMENT_ATTR) and the settings it was laid with
 *  (BRICK_SETTINGS_ATTR, the same snapshot a Brush stroke's spine carries). Every brick it lays carries
 *  BRICK_OWNER_ATTR = that id. Brush strokes already are records (their spines). Slice 2's painted areas add
 *  'wall-area' records; until then there is one 'wall-full' and one 'frame'. */
export const BRICK_RECORD_KINDS = Object.freeze({ wall: 'wall-full', frame: 'frame' });
/** F35 item 22 slice 2: a PAINTED wall area -- its own record (on the layer that was active when it was painted):
 *  its strokes (BRICK_AREA_ATTR, [{ points, widthIn }], the engine's wallRegion input as is), its paint order
 *  (BRICK_AREA_SEQ_ATTR: newest wins where areas overlap) and its own settings snapshot. While any area exists the
 *  whole-board 'wall-full' record does not (the first area replaces it; clearing every area brings it back). */
export const WALL_AREA_RECORD = 'wall-area';
export const BRICK_AREA_ATTR = 'data-brick-area';
export const BRICK_AREA_SEQ_ATTR = 'data-brick-area-seq';
/** The settings each wall area keeps as its OWN (its layout); everything else (size, grout depth, relief, seed,
 *  suppression, accent, level) stays shared by every wall. 'a.b' = key b of group a. */
export const WALL_AREA_FIELDS = Object.freeze(['pattern', 'patternParams', 'wallRotationDeg', 'largeStones',
  'setIds.wall', 'rusticByElement.wall', 'groutByElement.wall']);
/** `settings` with an area snapshot's own WALL_AREA_FIELDS laid over it (a new object; groups copied). */
export function withWallFields(settings, snapshot) {
  if (!snapshot) return settings;
  const out = { ...settings };
  for (const path of WALL_AREA_FIELDS) {
    const [k, sub] = path.split('.');
    if (!sub) { if (k in snapshot) out[k] = snapshot[k]; continue; }
    if (snapshot[k] && sub in snapshot[k]) out[k] = { ...(out[k] || {}), [sub]: snapshot[k][sub] };
  }
  return out;
}
const _json = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
/** The painted wall areas, oldest first: [{ node, id, seq, strokes, settings, layer }]. */
export function wallAreaRecords(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return [];
  return [...node.querySelectorAll(`[${BRICK_RECORD_ATTR}="${WALL_AREA_RECORD}"]`)].map((n) => ({
    node: n, id: n.getAttribute(BRICK_ELEMENT_ATTR), seq: Number(n.getAttribute(BRICK_AREA_SEQ_ATTR)) || 0,
    strokes: _json(n.getAttribute(BRICK_AREA_ATTR), []), settings: _json(n.getAttribute(BRICK_SETTINGS_ATTR), null),
    layer: layerById(editor, n.getAttribute('data-layer')),
  })).sort((a, b) => a.seq - b.seq);
}
/** Paint one stroke ({ points, widthIn }, board inches): onto the area `areaId` when it exists, else a NEW area
 *  (on the active layer, newest, with `settings` as its own) -- the first area replaces the whole-board wall's
 *  record. Returns the area's id. The caller lays + commits (one undo step per stroke). */
export function addWallAreaStroke(editor, stroke, settings, areaId = null) {
  const areas = wallAreaRecords(editor);
  const clean = { points: stroke.points.map((p) => ({ x: +p.x.toFixed(3), y: +p.y.toFixed(3) })), widthIn: stroke.widthIn };
  const own = areaId && areas.find((a) => a.id === areaId);
  if (own) { own.node.setAttribute(BRICK_AREA_ATTR, JSON.stringify([...own.strokes, clean])); return own.id; }
  const full = editor._sketchLayer.node.querySelector(`[${BRICK_RECORD_ATTR}="${BRICK_RECORD_KINDS.wall}"]`);
  if (full) full.remove();
  const id = newBrickElementId();
  const rec = onBricksLayer(editor, brickKindLayer(editor, 'wall') || activeLayerOf(editor), editor._sketchLayer.group()).attr('display', 'none').node; // item 64
  rec.setAttribute(BRICK_RECORD_ATTR, WALL_AREA_RECORD);
  rec.setAttribute(BRICK_ELEMENT_ATTR, id);
  rec.setAttribute(BRICK_AREA_SEQ_ATTR, String(Math.max(0, ...areas.map((a) => a.seq)) + 1));
  rec.setAttribute(BRICK_AREA_ATTR, JSON.stringify([clean]));
  rec.setAttribute(BRICK_SETTINGS_ATTR, JSON.stringify(elementSettings(settings, 'wall')));
  return id;
}
/** Remove every painted area (the wall fills the whole frame again on the next lay). Returns how many. */
export function clearWallAreas(editor) {
  const areas = wallAreaRecords(editor);
  for (const a of areas) a.node.remove();
  return areas.length;
}
/** Step 3: the key of the settings (+ frame + brush strokes) an element's bricks were laid with, on its record --
 *  per element, so a lay of one element never makes the other's key lie. Replaces the brick layer's one shared
 *  `brickLaidKey` (+ `brickLaidKinds`), which a board saved before item 22 still carries until its records are
 *  migrated (slice 1 step 5). */
export const BRICK_LAID_ATTR = 'data-brick-laid';
export { BRICK_RECORD_ATTR };
export function brickRecordNode(editor, kind) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  const recordKind = BRICK_RECORD_KINDS[kind];
  const found = recordKind && node && node.querySelector ? node.querySelector(`[${BRICK_RECORD_ATTR}="${recordKind}"]`) : null;
  if (found || kind !== 'wall') return found;
  // slice 2: painted areas ARE the wall -- the newest area stands for it (its presence, layer and laid key)
  const areas = wallAreaRecords(editor);
  return areas.length ? areas[areas.length - 1].node : null;
}
/** Step 5: the settings part of a laid key (everything before `#frame:`), as that element's snapshot -- or
 *  null when it does not parse. */
function _settingsOfLaidKey(laid, kind) {
  if (typeof laid !== 'string') return null;
  const at = laid.indexOf('#frame:');
  try { return elementSettings(JSON.parse(at < 0 ? laid : laid.slice(0, at)), kind); } catch { return null; }
}

/** F35 item 22 slice 1 step 5: a board saved BEFORE item 22 -- Wall/Frame bricks laid, no records -- gets its
 *  records ON LOAD (editor-io.js open(); one-time, idempotent: a kind that already has a record is untouched).
 *  Per kind with bricks on the brick layer (or in the layer's old `brickLaidKinds`, a wall squeezed to zero): a
 *  record whose key is the layer's old shared `brickLaidKey` (so nothing re-lays) and whose settings snapshot is
 *  that key's settings part; the kind's bricks get its owner. The layer's `brickLaidKey` / `brickLaidKinds` are
 *  then retired. Returns the kinds migrated. */
export function migrateBrickRecords(editor) {
  const layer = bricksLayerOf(editor);
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!layer || !node || !node.querySelectorAll || typeof editor._sketchLayer.group !== 'function') return [];
  const legacyKinds = Array.isArray(layer.brickLaidKinds) ? layer.brickLaidKinds : [];
  const migrated = [];
  for (const kind of BRICK_KINDS) {
    if (brickRecordNode(editor, kind)) continue;
    const bricks = node.querySelectorAll(`[data-layer="${layer.id}"][${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="${kind}"]`);
    if (!bricks.length && !legacyKinds.includes(kind)) continue;
    const id = ensureBrickRecord(editor, layer, kind);
    const rec = brickRecordNode(editor, kind);
    if (layer.brickLaidKey != null) {
      rec.setAttribute(BRICK_LAID_ATTR, layer.brickLaidKey);
      const snapshot = _settingsOfLaidKey(layer.brickLaidKey, kind);
      if (snapshot) rec.setAttribute(BRICK_SETTINGS_ATTR, JSON.stringify(snapshot));
    }
    bricks.forEach((n) => n.setAttribute(BRICK_OWNER_ATTR, id));
    migrated.push(kind);
  }
  if ('brickLaidKey' in layer || 'brickLaidKinds' in layer) { delete layer.brickLaidKey; delete layer.brickLaidKinds; }
  return migrated;
}

/** The element's record, created on first lay (its id is stable across re-lays). */
function ensureBrickRecord(editor, layer, kind) {
  const found = brickRecordNode(editor, kind);
  if (found) return found.getAttribute(BRICK_ELEMENT_ATTR);
  const id = newBrickElementId();
  onBricksLayer(editor, layer, editor._sketchLayer.group())
    .attr('display', 'none')
    .attr(BRICK_RECORD_ATTR, BRICK_RECORD_KINDS[kind])
    .attr(BRICK_ELEMENT_ATTR, id);
  return id;
}

/** Removes this adapter's own previously-generated pieces of `kind` from
 *  the Bricks layer (identified by BRICK_GEN_ATTR, never by a blanket
 *  "layer.id matches" sweep, which would also delete anything a user drew
 *  by hand on the same layer). Each tool action re-runs this first so
 *  clicking Wall/Frame again replaces its own prior output instead of
 *  piling up duplicates underneath it. */
function clearGenerated(editor, kind) {
  // Wall / Frame are one element each: their pieces go wherever they are (item 22 slice 3: on any layer)
  const nodes = editor._sketchLayer.node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="${kind}"], [${BRICK_ATTR}="${GROUT_KIND}"][${GROUT_OF_ATTR}="${kind}"]`);
  nodes.forEach((n) => n.remove());
}

/** The board outline as a closed polygon, board inches, origin top-left --
 *  Wall's own default fill target (no arbitrary-shape selection support
 *  yet; a named follow-up, not silently assumed to be the only case this
 *  tool will ever need). */
function boardPolygon(editor) {
  const w = editor._mW, h = editor._mH;
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
}

/** The set the user's CURRENT settings actually resolve to: the library's own
 *  declared entry (setForId) with the grout WIDTH override applied (the one
 *  field every tool's own settings panel lets the user override directly).
 *  Exported so main/brick-panel.js can start from the SAME resolved set
 *  Wall/Brush already use, instead of a second, independent `brickSetById`
 *  call that would silently drop the user's own current grout-width
 *  override. NEVER applies the global brick-length override (toBrickOpts'
 *  own `scale`, below, is how that reaches the engine) -- this is the
 *  UNSCALED base every `scale` multiplier is computed relative to. */
export function resolvedSetFor(settings) {
  const base = setForId(settings.setId);
  // the element's own joint (elementSettings) when given; else the set's declared one
  const widthIn = settings.grout && Number.isFinite(settings.grout.widthIn) ? settings.grout.widthIn : base.grout.widthIn;
  return { ...base, grout: { ...base.grout, widthIn } };
}

/** F35 item 16 (Fred: "I'd rather they all have the same size"): the ONE global brick length
 *  (inches) -- replacing the old per-tool 0.5-2x Scale multiplier AND the separate Frame-only
 *  frameBrickLengthIn override -- expressed as the `scale` multiplier the 3 core engines
 *  (along-path/fill-shape/contour-bands, via `scaledSet`) already take, relative to the ACTIVE
 *  set's own declared brickLengthIn. Wall, every Frame band, and Brush all resolve through this
 *  SAME function now, so picking a brick length affects every tool identically -- there is no
 *  more a separate Frame-only length to keep in sync with it. */
export function scaleFor(settings) {
  const base = setForId(settings.setId);
  return settings.brickLengthIn && base.brickLengthIn ? settings.brickLengthIn / base.brickLengthIn : 1;
}

function toBrickOpts(settings) {
  return {
    set: resolvedSetFor(settings),
    scale: scaleFor(settings),
    suppression: settings.suppression,
    clumping: settings.clumping,
    seed: settings.seed,
    // F35 item 3: a Stripe run cycles this (settingsVariantForCycle below);
    // every pre-existing call site has no `profile` field at all, so this
    // keeps defaulting to bricksAlongPath's own 'bricks' -- no behavior
    // change for Wall/Frame or an un-striped Brush stroke.
    profile: settings.profile || 'bricks',
    // F35 item 29 (a): a Brush stroke's own frozen Rustic amount (engine 'rustic', seat B) -- 0/absent = clean
    ...(Number(settings.rustic) > 0 ? { rustic: Number(settings.rustic) } : {}),
    // F35 item 10 follow-up: the Brush panel's own Orientation toggle -- bricksAlongPath already
    // declared this opt (along-path.js), only Brush's own UI control was missing. Wall/Frame never
    // read this (bricksFillShape/bricksContourBands have their own, unrelated pattern mechanisms),
    // so defaulting it here is harmless for every other caller.
    orientation: settings.orientation || 'stretcher',
  };
}

/** T86 item 7: a drawn Brush stroke's own fitted primitives for `bricksContourBands` -- the
 *  SIMPLIFIED polyline already handed to this file (see `finish()`'s own header: `ramerDouglasPeucker`
 *  collapses a raw drag into a handful of real straight segments) is ALREADY a true line-primitive
 *  list, one per consecutive point pair -- no arc-fitting step is needed (unlike a frame contour,
 *  a brush stroke has never had true circular arcs; `bricksAlongPath`'s own curve handling is a
 *  local-radius APPROXIMATION on a dense polyline, not a fitted primitive, and that distinction
 *  stays true here too). */
export function strokePrimitives(points) {
  const primitives = [];
  for (let i = 0; i < points.length - 1; i++) {
    primitives.push({ type: 'line', p0: { x: points[i].x, y: points[i].y }, p1: { x: points[i + 1].x, y: points[i + 1].y } });
  }
  return primitives;
}

/** T86 item 7 (advisor: "One engine: bricksContourBands on an open primitive list, not a separate
 *  brush code path"). Dispatches to the OLD `bricksAlongPath` only for `profile:'continuous'`
 *  (Stripe's own style-cycle variant, F35 item 3/4) -- `bricksContourBands`'s own band/row
 *  construction has no equivalent to "one unbroken band, no per-brick joints, a texture-blend plan"
 *  at all, so that profile keeps its own existing, unmodified engine. Every OTHER brush stroke
 *  (today's only other case: `profile:'bricks'`, the masonry look) now bands the SAME way a Frame
 *  does, just along an OPEN, centred primitive list instead of a closed, inward one. */
export function bricksForBrushStroke(points, settings, opts, out = null) {
  if (opts.profile === 'continuous') return bricksAlongPath(points, { ...opts, closed: false }).bricks;
  const bands = BRUSH_PRESETS[settings.brushBandPreset] || BRUSH_PRESETS.stretcher_1;
  const res = bricksContourBands(strokePrimitives(points), bands, { ...opts, closed: false, centered: true });
  if (out) out.ribbonOutline = res.ribbonOutline || null; // F35 item 55: the stroke's grout region
  return res.bricks;
}

function setForId(id) {
  return brickSetById(id) || brickSetById(1);
}

/** F35 item 23 (Fred: "a frame of fieldstone and a wall of soldier"; then "so white rocks and fieldstone is
 *  different?" -> folded). ONE source of truth, each set's declared `layout`:
 *   - the ROCK set = the BRICK_SETS entry laid as 'fieldstone' (White Rocks today) -- never picked as a "set" any
 *     more: the Fieldstone PATTERN implies it (a Wall whose pattern is fieldstone; a Frame whose bands are);
 *   - the BRICK sets = the sets laid as 'bond' (Red today; a Grey one appears here by itself) -- the Set row.
 *  The Set is PER ELEMENT (`settings.setIds`, keyed by tool: wall / frame / brush / raisedBrush); brick size and
 *  grout stay global. A settings object from before item 23 has a single `setId`: it is the fallback. */
export const ROCK_SET_ID = (BRICK_SETS.find((s) => s.layout === 'fieldstone') || {}).id ?? null;
/** A Wall pattern named after a STONE set's layout picks that set (Fieldstone -> White Rocks, Coursed rubble -> Grey
 *  stone): the set is implied by the pattern, never picked in the Set row. null for every other pattern. */
export const patternSetId = (pattern) => (pattern && pattern !== 'bond' ? (BRICK_SETS.find((s) => s.layout === pattern) || {}).id ?? null : null);
export const BRICK_SET_IDS = Object.freeze(BRICK_SETS.filter((s) => s.layout === 'bond').map((s) => s.id));
/** F35 item 61: how a set lays a FRAME, read from its declaration -- 'set': the bands are laid with its own pieces (every
 *  bond set, as courses; a stone set that declares `frameBands: 'set'`, Grey stone, as stones); 'pattern': its layout is a band-capable pattern
 *  (BRICK_PATTERNS bandCapable: Fieldstone -> picking White rocks makes the frame rock, the pattern-implies-set rule);
 *  null: it cannot lay a frame. */
export function frameModeOfSet(id) {
  const s = BRICK_SETS.find((x) => x.id === id);
  if (!s) return null;
  if (s.layout === 'bond' || s.frameBands === 'set') return 'set';
  return BRICK_PATTERNS[s.layout] && BRICK_PATTERNS[s.layout].bandCapable ? 'pattern' : null;
}
/** The sets the Frame's Set row offers (every band-capable set), in declaration order. */
export const FRAME_SET_IDS = Object.freeze(BRICK_SETS.filter((s) => frameModeOfSet(s.id)).map((s) => s.id));
/** The sets an element's Set row offers: the Frame every band-capable set, every other element the brick sets. */
export const setsOfferedFor = (kind) => (kind === 'frame' ? FRAME_SET_IDS : BRICK_SET_IDS);
/** A Frame is rock when every band pattern is fieldstone (picking it on one band writes it on all). */
export function isRockFrame(settings) {
  const p = settings && settings.frameBandPatterns;
  return Array.isArray(p) && p.length > 0 && p.every((x) => x === 'fieldstone');
}
/** Item 33: the frame CORNER styles a Frame element can pick (the engine's band `cornerStyle` vocabulary,
 *  core/bricks/contour-bands.js), in picker order. `id` = the engine's value. */
export const FRAME_CORNERS = Object.freeze([
  { id: 'mitre', label: 'Mitre', title: 'Mitre: the bricks meet on the diagonal' },
  { id: 'butt', label: 'Butt', title: 'Butt: one side runs through, the other stops square against it' },
  { id: 'block', label: 'Quoin', title: 'Quoin: a square corner block, the bands stop against it' },
  { id: 'lapped', label: 'Lapped', title: 'Lapped: butt corners alternating band by band, laced together' },
]);
/** Item 33: the old corner VARIANT presets, folded into a preset + a corner choice (the picker). Their
 *  FRAME_PRESETS entries stay (the engine's own data); the app lists the folded ones no more, and a saved board on
 *  one maps to the same result (main/app-init.js migration 'frame-corner-presets'). */
export const FOLDED_FRAME_PRESETS = Object.freeze({
  butt_frame: { preset: 'single_soldier', corner: 'butt' },
  quoin_corners: { preset: 'single_soldier', corner: 'block' },
});
/** The corner a Frame element is laid with: its own pick (`settings.frameCorner`), else its preset's own
 *  (Fred: mitred for plain Soldier). */
export function frameCornerOf(settings) {
  if (settings && FRAME_CORNERS.some((c) => c.id === settings.frameCorner)) return settings.frameCorner;
  const bands = FRAME_PRESETS[settings && settings.frameBandPreset] || FRAME_PRESETS.single_soldier;
  return (bands[0] && bands[0].cornerStyle) || 'mitre';
}
/** The bands a Frame element lays: its preset's, each band's own pattern pick (`frameBandPatterns[i]`) and the
 *  element's corner applied (a NEW array -- FRAME_PRESETS' frozen entries are never touched). */
export function frameBandsOf(settings) {
  const base = FRAME_PRESETS[settings && settings.frameBandPreset] || FRAME_PRESETS.single_soldier;
  const overrides = (settings && settings.frameBandPatterns) || [];
  const corner = settings && settings.frameCorner ? frameCornerOf(settings) : null;
  return base.map((band, i) => ({
    ...band,
    ...(overrides[i] ? { pattern: overrides[i] } : {}),
    ...(corner ? { cornerStyle: corner } : {}),
  }));
}
/** The set an element is laid with. */
export function elementSetId(settings, kind) {
  if (kind === 'wall' && patternSetId(settings.pattern) != null) return patternSetId(settings.pattern);
  if (ROCK_SET_ID != null && kind === 'frame' && isRockFrame(settings)) return ROCK_SET_ID;
  const own = settings.setIds && settings.setIds[kind];
  return own ?? settings.setId ?? BRICK_SET_IDS[0] ?? 1;
}
/** The settings an element is laid with: the shared ones, with that element's own set. */
/** Grout per ELEMENT (advisor, Fred: rubble gets wider joints; a rock frame + a brick wall on one board need two
 *  joints): `settings.groutByElement = { wall, frame, brush }` (the Raised brush shares the Brush's). A number =
 *  the user's own joint; null / missing = the element's CURRENT set's declared joint (Red 0.034, the rock set its
 *  wider one) -- so a set change falls back to the new set's joint (main/brick-panel.js clears the override). */
export const JOINT_ELEMENT = Object.freeze({ wall: 'wall', frame: 'frame', brush: 'brush', raisedBrush: 'brush' });
export function elementGroutWidth(settings, kind) {
  const v = settings && settings.groutByElement && settings.groutByElement[JOINT_ELEMENT[kind] || kind];
  if (Number.isFinite(v)) return v;
  const set = setForId(elementSetId(settings || {}, kind));
  return (set && set.grout && set.grout.widthIn) ?? 0.034;
}
export const elementSettings = (settings, kind) => ({
  ...settings,
  setId: elementSetId(settings, kind),
  grout: { ...(settings.grout || {}), widthIn: elementGroutWidth(settings, kind) },
});

/** F35 item 29 (a): a RUNNING bond -- a coursed pattern whose courses stagger (BRICK_PATTERNS staggerFrac > 0:
 *  stretcher, header). Rustic applies to those only. Read from the declared pattern, never a list of names. */
export function isRunningBond(patternId) {
  const def = BRICK_PATTERNS[patternId];
  return !!def && def.kind === 'course' && Number(def.staggerFrac) > 0;
}

/** F35 item 7: `settings.pattern` (main/brick-panel.js's Wall pattern picker) is a single
 *  BRICK_PATTERNS key the user picked for the WHOLE Wall fill -- no per-zone mixing UI exists yet
 *  (library.js's own BRICK_PATTERNS header names that as a deliberately out-of-scope extension).
 *  Dispatches on the pattern's own declared `kind`: 'course'/'course-alternating' patterns
 *  (stretcher/stack/soldier/header/flemish) still go through bond.js's own zone mechanism (one
 *  zone, the whole fill, using this pattern); 'tile2d' patterns (herringbone/basketweave) are a
 *  different ALGORITHM entirely, selected via `set.layout` (fill-shape.js's own LAYOUTS table);
 *  F35 item 12 follow-up: 'none' sets `input.skipWallFill` (generateBricks' own declared flag,
 *  checked ONCE there rather than every caller re-deriving "is the Wall off" for itself) -- mutates
 *  `input` in place, same style resolveFrameBrickSet already uses for its own Frame-only override.
 *  Leaves `input` untouched for an unrecognised/omitted pattern (falls through to bondLayout's own
 *  default single stretcher zone, byte-identical to pre-item-7 behaviour). */
/** F35 item 21: the layout the Wall fill actually uses -- a tile2d pattern's own layout, otherwise the
 *  set's declared layout (White Rocks = 'fieldstone'). The Large stones slider shows for 'fieldstone'. */
export function wallLayoutFor(settings) {
  const def = settings && settings.pattern && BRICK_PATTERNS[settings.pattern];
  if (def && def.kind === 'none') return 'none';
  if (def && def.kind === 'tile2d') return settings.pattern;
  const set = brickSetById(settings && elementSetId(settings, 'wall')) || brickSetById(1); // item 23: the WALL's set
  return set.layout;
}

/** F35 item 13 (advisor: "icons from the engine"): a wall pattern's picker icon, LAID by the real engine --
 *  the same applyWallPattern + generateBricks a Wall uses, on a small PATTERN_ICON_BOARD patch with Set 1's
 *  own brick size -- drawn as one polygon per brick over the grout colour. A new BRICK_PATTERNS entry gets its
 *  icon for free. Cached per pattern; null if the engine can't lay it. */
export const PATTERN_ICON_BOARD = Object.freeze({ widthIn: 1.8, heightIn: 1.2 }); // ~3 bricks across: the bond reads at icon size
const _patternIcons = new Map();
export function wallPatternIconSvg(patternId, heightPx = 30) {
  const key = `${patternId}:${heightPx}`;
  if (_patternIcons.has(key)) return _patternIcons.get(key);
  const { widthIn: w, heightIn: h } = PATTERN_ICON_BOARD;
  const widthPx = Math.round((heightPx * w) / h);
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<rect width="${w}" height="${h}" fill="#efe6da"/>`;
  let svg = null;
  try {
    const bricks = _iconBricks(PATTERN_ICON_BOARD, patternId, 0.6, 0.05);
    const polys = bricks.map(_iconPolygon).join('');
    svg = bricks.length
      ? `${open}<g fill="#b5533c" stroke="#efe6da" stroke-width="0.025">${polys}</g></svg>`
      : `${open}<line x1="0.3" y1="${h - 0.3}" x2="${w - 0.3}" y2="0.3" stroke="#8a8078" stroke-width="0.08"/></svg>`; // 'none'
  } catch (_) {
    svg = null;
  }
  _patternIcons.set(key, svg);
  return svg;
}

/** The bricks an icon shows: `patternId` laid by the real engine (applyWallPattern + generateBricks, as a
 *  Wall) on a `board` patch, Set 1 at `brickLengthIn`. Shared by the pattern and the accent icons. */
function _iconBricks(board, patternId, brickLengthIn, groutIn, extra = {}) {
  const { widthIn: w, heightIn: h } = board;
  const settings = { setId: 1, pattern: patternId, seed: 7, suppression: 0, clumping: 0, grout: { widthIn: groutIn }, brickLengthIn };
  const input = {
    boardOutline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    set: resolvedSetFor(settings), scale: scaleFor(settings), suppression: 0, clumping: 0, seed: settings.seed,
  };
  applyWallPattern(input, settings);
  return generateBricks({ ...input, ...extra }).bricks;
}
/** F35 item 24: what each Brick TOOL leaves on the board, in miniature, laid by the real engine (Set 1 at its
 *  own size) -- editor/brick-tool-icons.js draws the tool icons from it. kind: 'wall' (a stretcher wall),
 *  'run' / 'runLong' / 'band3' (brush runs, TOOL_MINI_RUNS), 'frame' (a soldier frame band round a square
 *  board).
 *  Board inches; cached; [] if the engine can't lay it. */
const TOOL_MINI_BRICK = Object.freeze({ setId: 1, brickLengthIn: 0.75, grout: { widthIn: 0.07 }, seed: 3, suppression: 0, clumping: 0 });
// the brush runs: preset + stroke length (a long thin run reads as a dotted line at 20 px -- measured)
const TOOL_MINI_RUNS = Object.freeze({
  run: { preset: 'stretcher_2_running', lengthIn: 1.6 },
  runLong: { preset: 'stretcher_2_running', lengthIn: 2.4 },
  band3: { preset: 'flemish_soldier_flemish_3', lengthIn: 3.6 },
  // sheet v3 (Fred: "a 2-brick long run with one brick higher" / "2 OR 3 bricks"): ONE row, 2 or 3 whole bricks
  // (a brick + its joint each = 0.75 + 0.07 in)
  row3: { preset: 'stretcher_1', lengthIn: 3 * 0.82 },
});
const _toolMinis = new Map();
export function toolMiniBricks(kind) {
  if (_toolMinis.has(kind)) return _toolMinis.get(kind);
  let bricks = [];
  try {
    const s = TOOL_MINI_BRICK;
    // sized for a 20 px icon: about 2 bricks across and 3 courses; runs only 2-3 bricks long (a long thin run
    // read as a dotted line -- measured in the first sheet)
    if (kind === 'wall') bricks = _iconBricks({ widthIn: 1.65, heightIn: 0.8 }, 'stretcher', s.brickLengthIn, s.grout.widthIn);
    else if (TOOL_MINI_RUNS[kind]) {
      const { preset, lengthIn } = TOOL_MINI_RUNS[kind];
      const settings = { ...s, brushBandPreset: preset, profile: 'bricks' };
      bricks = bricksForBrushStroke([{ x: 0, y: 1 }, { x: lengthIn, y: 1 }], settings, toBrickOpts(settings));
    } else if (kind === 'frame') {
      const w = 3.4;
      bricks = generateBricks({
        boardOutline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: w }, { x: 0, y: w }],
        set: resolvedSetFor(s), scale: scaleFor(s), suppression: 0, clumping: 0, seed: s.seed, skipWallFill: true,
        frame: { primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: w, y2: w })), bands: FRAME_PRESETS.single_soldier },
      }).frameBricks;
    }
  } catch (_) {
    bricks = [];
  }
  _toolMinis.set(kind, bricks);
  return bricks;
}
/** Item 33: a MINI FRAME corner -- `bands` laid by the real engine round a square just big enough for the band
 *  stack (Set 1 at the tool-icon size), cropped to ONE corner (the stack + MINI_FRAME.marginIn of the board inside).
 *  Draws the corner-style icons and the band-preset icons; a new FRAME_CORNERS / FRAME_PRESETS entry gets its icon
 *  free. Cached by `key`. */
const MINI_FRAME = Object.freeze({ marginIn: 0.4 });
const _miniFrames = new Map();
function _miniFrame(key, bands) {
  if (_miniFrames.has(key)) return _miniFrames.get(key);
  const depth = bands.reduce((a, b) => a + b.widthIn, 0);
  const crop = depth + MINI_FRAME.marginIn, w = 2 * depth + MINI_FRAME.marginIn;
  let bricks = [];
  try {
    const s = TOOL_MINI_BRICK;
    bricks = generateBricks({
      boardOutline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: w }, { x: 0, y: w }],
      set: resolvedSetFor(s), scale: scaleFor(s), suppression: 0, clumping: 0, seed: s.seed, skipWallFill: true, bandFit: false, // an icon: the stack as requested (T86 item 28)
      frame: { primitives: buildRibbonPrimitives(rectToPrimitives({ x1: 0, y1: 0, x2: w, y2: w })), bands },
    }).frameBricks;
  } catch (_) {
    bricks = [];
  }
  const out = { bricks, crop };
  _miniFrames.set(key, out);
  return out;
}
function _miniFrameSvg({ bricks, crop: c }, heightPx) {
  const polys = bricks.filter((b) => b.polygon.some((p) => p.x < c && p.y < c)).map((b) => _iconPolygon(b)).join('');
  if (!polys) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${heightPx}" height="${heightPx}" viewBox="0 0 ${+c.toFixed(3)} ${+c.toFixed(3)}" aria-hidden="true">`
    + `<rect width="${c}" height="${c}" fill="#efe6da"/><g fill="#b5533c" stroke="#efe6da" stroke-width="0.04">${polys}</g></svg>`;
}
/** A corner style's picker icon: two soldier bands with that `cornerStyle`. */
const _cornerBands = (cornerId) => { const band = { widthIn: 0.75, pattern: 'soldier', cornerStyle: cornerId }; return [band, band]; };
export const frameCornerBricks = (cornerId) => _miniFrame(`corner:${cornerId}`, _cornerBands(cornerId)).bricks;
export const frameCornerIconSvg = (cornerId, heightPx = 26) => _miniFrameSvg(_miniFrame(`corner:${cornerId}`, _cornerBands(cornerId)), heightPx);
/** Item 33 (audit N10, Fred's long-list rule): a band PRESET's icon -- its band stack at a corner, as laid; None = a
 *  struck-through tile (the Wall grid's own 'none'). */
export function framePresetIconSvg(presetId, heightPx = 26) {
  const bands = FRAME_PRESETS[presetId];
  if (!bands) return null;
  if (!bands.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${heightPx}" height="${heightPx}" viewBox="0 0 1 1" aria-hidden="true">`
      + `<rect width="1" height="1" fill="#efe6da"/><line x1="0.15" y1="0.85" x2="0.85" y2="0.15" stroke="#8a8078" stroke-width="0.06"/></svg>`;
  }
  return _miniFrameSvg(_miniFrame(`preset:${presetId}`, bands), heightPx);
}
// one argument only: it is passed straight to .map(), whose index must never reach the markup (a second
// `attrs` parameter once turned every pattern icon into `<polygon0 ...>` -- drawn as nothing, measured live)
const _iconPolygon = (b) => `<polygon points="${b.polygon.map((p) => `${+p.x.toFixed(3)},${+p.y.toFixed(3)}`).join(' ')}"/>`;

/** F35 item 15: a raised-accent preset's picker icon -- a stretcher wall laid by the real engine, with the
 *  bricks the preset's own rule raises (brick-accents.js accentedBrickIndices, the SAME rule the height
 *  mask applies) drawn dark with a drop shadow. The icon shows the preset's ZONE only (stretched to the
 *  whole icon), so the motif reads at icon size. A new ACCENT_PRESETS entry gets its icon for free. */
export const ACCENT_ICON_BOARD = Object.freeze({ widthIn: 3, heightIn: 1.5 });
const _accentIcons = new Map();
export function accentIconSvg(presetId, heightPx = 26, { sunk = false, bond = 'stretcher' } = {}) {
  // item 31: a preset id, or an ad-hoc preset object / an accent (a user tile) -- keyed by its content;
  // `bond` = the base pattern it is drawn on; `sunk` (item 32: a negative level) = the marked bricks drawn LOWER
  const key = `${typeof presetId === 'object' ? JSON.stringify(presetId) : presetId}:${heightPx}:${sunk ? 's' : 'r'}:${bond}`;
  if (_accentIcons.has(key)) return _accentIcons.get(key);
  const { widthIn: w, heightIn: h } = ACCENT_ICON_BOARD;
  const widthPx = Math.round((heightPx * w) / h);
  let svg = null;
  try {
    const accent = presetId && typeof presetId === 'object' && presetId.preset ? presetId : { preset: presetId };
    // item 31b / 31e: a tile at 1/2 or 1/4, or with its own custom bond, is drawn on the engine's own pieces
    const bricks = _iconBricks(ACCENT_ICON_BOARD, BRICK_PATTERNS[bond] ? bond : 'stretcher', 0.36, 0.03, accentLayInput(accent, ENGINE_OPTIONS));
    const raised = accentedBrickIndices(bricks, accent, { seed: 7, zone: [0, 1] });
    const flat = bricks.filter((b, k) => !raised.has(k)).map((b) => _iconPolygon(b)).join('');
    const up = bricks.filter((b, k) => raised.has(k));
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
      + `<rect width="${w}" height="${h}" fill="#efe6da"/><g fill="#d07a5c">${flat}</g>`
      + (sunk
        // sunk: the marked bricks darker, an inner shadow on their top edge (they sit BELOW the wall)
        ? `<g fill="#5a2416">${up.map((b) => _iconPolygon(b)).join('')}</g>`
          + `<g fill="#1d0f0b" opacity="0.55" transform="translate(0 -0.035)">${up.map((b) => _iconPolygon(b)).join('')}</g>`
        : `<g fill="#2b1a14" transform="translate(0.04 0.04)">${up.map((b) => _iconPolygon(b)).join('')}</g>`
          + `<g fill="#8e2f1c">${up.map((b) => _iconPolygon(b)).join('')}</g>`) + '</svg>';
  } catch (_) {
    svg = null;
  }
  _accentIcons.set(key, svg);
  return svg;
}

/** F35 item 14: a pattern's current user-facing params (the panel's chips): each declared param's default, then the
 *  user's pick for THIS pattern (`settings.patternParams[pattern]`). The fill (fill-shape.js) resolves the same,
 *  plus the entry's pinned `fixed` ones. */
export function patternParamsFor(settings, pattern) {
  const def = BRICK_PATTERNS[pattern] || {};
  const defaults = Object.fromEntries(Object.entries(def.params || {}).filter(([, p]) => p && 'default' in p).map(([k, p]) => [k, p.default]));
  return { ...defaults, ...((settings && settings.patternParams && settings.patternParams[pattern]) || {}) };
}

function applyWallPattern(input, settings) {
  const pattern = settings.pattern;
  const def = pattern && BRICK_PATTERNS[pattern];
  if (!def) return;
  if (def.kind === 'none') {
    input.skipWallFill = true;
  } else if (def.kind === 'tile2d') {
    input.set = { ...input.set, layout: pattern };
    // F35 item 14: the user's pick of the pattern's declared params (the fill adds the defaults + pinned ones)
    const picked = settings.patternParams && settings.patternParams[pattern];
    if (picked && Object.keys(picked).length) input.set.layoutParams = { ...picked };
  } else {
    input.zones = [{ pattern }];
  }
}

/** Wall + Frame (button-driven, no drag), unified: f3's own `generateBricks`
 *  composer (core/bricks/engine.js) already does "Frame then Wall, Wall
 *  fills the Frame's own interiorOutline" -- advisor review (turn 131):
 *  running them as two INDEPENDENT fills (Wall over the whole board, Frame
 *  drawn after) left Frame's band sitting on TOP of Wall's own bricks with
 *  no clipping between them. Using the one real composer instead of two
 *  separate calls means Wall is ALWAYS clipped to whatever the frame's true
 *  interior is (when a frame resolves), with no overlap, regardless of
 *  which button the user clicked. `frameGeom` is `{primitives, bands}`
 *  (main/brick-panel.js's own resolveFrameGeom) or null/undefined (no usable
 *  frame -- Wall alone fills the whole board, same as before Frame
 *  existed). F35 item 16: Frame bands no longer carry their own `set`
 *  override -- `scale` (derived from the ONE global brick length, below) is
 *  passed straight through to `generateBricks`, which already threads it to
 *  BOTH the Wall fill and the Frame bands identically (its own
 *  `frame.set || set` fallback picks the top-level `set` here, same as
 *  Wall), so every tool resolves the same brick length with no separate
 *  per-tool override left to keep in sync. */
/** Audit C1 (F35 item 16, Wall and Frame as their own tools): `kinds` = which element kinds this run
 *  LAYS -- only those are cleared and drawn; the others already on the canvas stay as they are. The
 *  composer still runs with the frame (when one resolves), so a Wall laid alone keeps the SAME
 *  frame-interior clip it always had. Default both = the original behaviour. */
export const BRICK_KINDS = ['wall', 'frame'];

/** F35 item 15: the Wall's generated brick nodes (DOM order) and their polygons, board inches. */
export function wallBrickNodes(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return [];
  return [...node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="wall"]`)];
}
const _nodePolygon = (n) => (n.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((p) => {
  const [x, y] = p.split(',').map(Number);
  return { x, y };
});
export const wallBrickPolygons = (editor) => wallBrickNodes(editor).map((n) => ({ polygon: _nodePolygon(n) }));

/** F35 item 15: shows which Wall bricks the raised accent lifts -- an amber outline on each, from the SAME rule the
 *  height mask applies (brick-accents.js accentedBrickIndices). 2D only.
 *  F35 item 49 (Fred: "raised bricks get a yellow edge... in the 3D view"): the outline was a stroke ATTRIBUTE on the
 *  brick node, so it travelled with the drawing -- measured: 12 marked bricks = 12 "#ffc61a" in editor.save(), in the
 *  3D drape (core/preview/drape-svg.js colours an element stroke-first) and in the saved board. Now the node carries
 *  only the inert flag (ACCENT_FLAG_ATTR, stripped from Send / the download: layers.js BRICK_EDITOR_ONLY_ATTRS) and the
 *  outline is ONE CSS rule of the live page (ensureAccentOutlineStyle), which no serialized SVG carries. */
export const ACCENT_OUTLINE = Object.freeze({ color: '#ffc61a', widthIn: 0.05 }); // amber: reads against the photo's own dark joints
export const ACCENT_FLAG_ATTR = 'data-brick-accent';
const ACCENT_STYLE_ID = 'brickAccentOutlineStyle';
/** The live editor's outline rule (CSS px = SVG user units = inches here), injected once from ACCENT_OUTLINE. */
export function ensureAccentOutlineStyle(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc || !doc.head || doc.getElementById(ACCENT_STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = ACCENT_STYLE_ID;
  style.textContent = `[${ACCENT_FLAG_ATTR}="1"] { stroke: ${ACCENT_OUTLINE.color}; stroke-width: ${ACCENT_OUTLINE.widthIn}px; }`;
  doc.head.appendChild(style);
}
function _markAccent(n, on) {
  // a board saved before item 49 carries the old stroke attribute: it goes, whatever the mark
  if (n.getAttribute('stroke') === ACCENT_OUTLINE.color) { n.setAttribute('stroke', 'none'); n.removeAttribute('stroke-width'); }
  if (on) n.setAttribute(ACCENT_FLAG_ATTR, '1');
  else if (n.hasAttribute(ACCENT_FLAG_ATTR)) n.removeAttribute(ACCENT_FLAG_ATTR);
}
/** Per-element accents on RUNS (advisor): the same outline on the Frame bands' and the Brush strokes' accented
 *  bricks, from the SAME rule the mask applies (brick-accents.js accentedRunIndices on each run's own grid). */
export function syncRunAccentHighlight(editor, settings) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll || !settings) return 0;
  const seed = settings.seed || 1;
  ensureAccentOutlineStyle();
  const asRun = (n) => ({ polygon: _nodePolygon(n), row: Number(n.getAttribute('data-brick-row')) || 0, piece: Number(n.getAttribute('data-brick-piece')) || 0 });
  let count = 0;
  const apply = (nodes, acc) => {
    const on = accentedRunIndices(nodes.map(asRun), acc, { seed });
    nodes.forEach((n, k) => _markAccent(n, on.has(k)));
    count += on.size;
  };
  const frame = [...node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="frame"]`)];
  const bands = new Map();
  for (const n of frame) { const b = Number(n.getAttribute('data-brick-band')) || 0; if (!bands.has(b)) bands.set(b, []); bands.get(b).push(n); }
  for (const [b, nodes] of bands) apply(nodes, (settings.frameBandAccents || [])[b]);
  const strokes = new Map();
  for (const n of node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="brush"]`)) {
    const k = n.getAttribute(BRICK_OWNER_ATTR) || 'stroke';
    if (!strokes.has(k)) strokes.set(k, []);
    strokes.get(k).push(n);
  }
  for (const nodes of strokes.values()) apply(nodes, settings.brushAccent);
  return count;
}
/** item 31b: a drawn brick's engine mark ({ accentMarked } when the lay was cut, else {}) -- the height mask reads the same. */
export const markOf = (n) => (n.hasAttribute(ACCENT_MARK_ATTR) ? { accentMarked: n.getAttribute(ACCENT_MARK_ATTR) === '1' } : {});
export function syncAccentHighlight(editor, accent, seed) {
  const nodes = wallBrickNodes(editor);
  const raised = accentedBrickIndices(nodes.map((n) => ({ polygon: _nodePolygon(n), ...markOf(n) })), accent, { seed: seed || 1 });
  ensureAccentOutlineStyle();
  nodes.forEach((n, k) => _markAccent(n, raised.has(k)));
  return raised.size;
}

/** F35 item 15, Custom "Click bricks" (editor._currentMode === 'brickAccentClick'): a click hands its
 *  UNSNAPPED board point to editor._brickAccentClick (main/brick-panel.js), which toggles that brick. */
export const brickAccentClickHandler = {
  start(editor, pt, e) {
    const raw = e && typeof editor._getMousePoint === 'function' ? editor._getMousePoint(e) : pt;
    if (typeof editor._brickAccentClick === 'function') editor._brickAccentClick(raw || pt);
  },
};

/** F35 item 22 slice 1 step 4, SELECT for brick elements (editor._currentMode === 'brickElementSelect'): a
 *  click hands its UNSNAPPED board point to editor._brickElementSelect (main/brick-panel.js). */
export const brickElementSelectHandler = {
  start(editor, pt, e) {
    const raw = e && typeof editor._getMousePoint === 'function' ? editor._getMousePoint(e) : pt;
    if (typeof editor._brickElementSelect === 'function') editor._brickElementSelect(raw || pt);
  },
};

/** The Wall/Frame ELEMENT whose brick lies under `pt` -- { id: its record's id, kind } -- or null. The topmost
 *  brick wins (the last drawn). Brush bricks are their own strokes' business (not a record kind). */
export function brickElementAt(editor, pt) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll || !pt) return null;
  const owned = [...node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_OWNER_ATTR}]`)].reverse();
  for (const n of owned) {
    const kind = n.getAttribute(BRICK_ATTR);
    if (!BRICK_RECORD_KINDS[kind] && kind !== 'brush') continue;
    if (!pointInPolygon(pt.x, pt.y, _nodePolygon(n))) continue;
    if (kind !== 'brush') return { id: n.getAttribute(BRICK_OWNER_ATTR), kind };
    // F35 item 36: a stroke's bricks are owned by `<element id>:<chain>`; the element is its spine
    const id = n.getAttribute(BRICK_OWNER_ATTR).split(':')[0];
    return { id, kind: strokeKindOf(brushStrokeSettings(editor, id)) };
  }
  // F35 item 55: no brick under the point -- a joint: the element whose grout region holds it (its Grout block)
  for (const g of groutNodes(editor).reverse()) {
    let region = [];
    try { region = JSON.parse(g.node.getAttribute(GROUT_REGION_ATTR) || '[]'); } catch { region = []; }
    const loops = region.flatMap((r) => [r.outer, ...(r.holes || [])]);
    if (pointOnGrout({ loops }, pt.x, pt.y)) return { id: g.id, kind: g.kind === 'brush' ? strokeKindOf(brushStrokeSettings(editor, g.id)) : g.kind, part: GROUT_KIND };
  }
  return null;
}

/** F35 item 36: a Brush stroke's own settings -- its spine's snapshot (every segment carries the same), or null. */
const _spinesOf = (editor, id) => [...editor._sketchLayer.node.querySelectorAll(`[${BRICK_ATTR}="${SPINE_KIND}"][${BRICK_ELEMENT_ATTR}="${id}"]`)];
export function brushStrokeSettings(editor, id) {
  const spine = editor && editor._sketchLayer && _spinesOf(editor, id)[0];
  return spine ? decodeBrickSettings(spine.getAttribute(BRICK_SETTINGS_ATTR)) : null;
}
/** A stroke drawn with the Raised brush carries its strokeOverrides (strokeMode + levelIn); a Brush stroke does not. */
export const strokeKindOf = (settings) => (settings && settings.strokeMode != null ? 'raisedBrush' : 'brush');
/** F35 item 36: give a stroke new settings (every segment of its spine) -- its bricks regenerate on the commit
 *  (regenerateOwnedBrickElements: the snapshot is in its fingerprint). One undo step; false when unchanged. */
export function restyleBrushStroke(editor, id, settings) {
  const spines = editor && editor._sketchLayer ? _spinesOf(editor, id) : [];
  const json = JSON.stringify(settings);
  if (!spines.length || spines.every((s) => s.getAttribute(BRICK_SETTINGS_ATTR) === json)) return false;
  for (const s of spines) s.setAttribute(BRICK_SETTINGS_ATTR, json);
  commitEdit(editor);
  return true;
}

/** A6 (3D-panel audit; Fred: "single size"): the GLOBAL settings every drawn Brush / Raised stroke follows -- written
 *  into each stroke's snapshot when they change; its other settings stay its own. Its bricks regenerate on the next
 *  commit (the snapshot is in regenerateOwnedBrickElements' fingerprint). Returns how many spines changed (no commit).
 *  Seat E (advisor ruling, the per-element model): the SIZE is global (Fred: single size), so every stroke follows it; the
 *  SET is per element, so a stroke keeps its own -- except through the sidebar's quick Set, which applies to ALL elements
 *  (STROKE_FOLLOWS_QUICK_SET, passed as `keys` by that one control). Drafted by seat D (bb), A6_tool.diff. */
export const STROKE_FOLLOWS_GLOBAL = Object.freeze(['brickLengthIn']);
export const STROKE_FOLLOWS_QUICK_SET = Object.freeze(['setId']);
export function strokesFollowGlobals(editor, settings, keys = STROKE_FOLLOWS_GLOBAL) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll || !settings) return 0;
  let changed = 0;
  for (const s of node.querySelectorAll(`[${BRICK_ATTR}="${SPINE_KIND}"]`)) {
    const snap = decodeBrickSettings(s.getAttribute(BRICK_SETTINGS_ATTR));
    if (!snap || keys.every((k) => snap[k] === settings[k])) continue;
    for (const k of keys) snap[k] = settings[k];
    s.setAttribute(BRICK_SETTINGS_ATTR, JSON.stringify(snap));
    changed++;
  }
  return changed;
}

/** The selected element's outline: each of its bricks, outlined in the editor's HIGHLIGHT layer (the same
 *  overlay layers.js flashLayerGeometry uses) -- never in the drawing, so never saved, exported or hit. */
export const ELEMENT_SELECT_OUTLINE = Object.freeze({ color: '#1e88e5', widthIn: 0.04 });
export function showElementSelection(editor, elementId) {
  if (!editor) return 0;
  for (const h of editor._brickElementOutline || []) { try { h.remove(); } catch (_) { /* gone with a reload */ } }
  editor._brickElementOutline = [];
  const node = editor._sketchLayer && editor._sketchLayer.node;
  if (!elementId || !editor._highlightLayer || !node || !node.querySelectorAll) return 0;
  // a stroke's bricks are owned per chain (`<id>:<chain>`, F35 item 36)
  for (const n of node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_OWNER_ATTR}="${elementId}"], [${BRICK_GEN_ATTR}="1"][${BRICK_OWNER_ATTR}^="${elementId}:"]`)) {
    if (_isGrout(n)) continue; // item 55: the grout is not a brick to outline
    const outline = editor._highlightLayer.polygon(n.getAttribute('points') || '')
      .fill('none')
      .stroke({ color: ELEMENT_SELECT_OUTLINE.color, width: ELEMENT_SELECT_OUTLINE.widthIn })
      .attr('pointer-events', 'none');
    editor._brickElementOutline.push(outline);
  }
  return editor._brickElementOutline.length;
}

/** F35 item 20 (brush over wall, Fred / audit C10 option B: the wall flows AROUND a brush stroke): every
 *  brush brick on the canvas is an exclusion for the Wall fill -- `input.exclusions = [{polygon}]`, board
 *  inches, the signature agreed with seat B (d3, T86 item 13: the engine DROPS any wall piece overlapping
 *  an exclusion). Read straight off the DOM, same as the height mask does. */
export function brushExclusions(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!node || !node.querySelectorAll) return [];
  return [...node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="brush"]`)].map((n) => ({
    polygon: (n.getAttribute('points') || '').trim().split(/\s+/).filter(Boolean).map((p) => {
      const [x, y] = p.split(',').map(Number);
      return { x, y };
    }),
  })).filter((e) => e.polygon.length >= 3);
}

/** STUB until the engine honours `input.exclusions` (it then returns `exclusionsApplied: true` and this
 *  is skipped): drop every wall piece that OVERLAPS an exclusion -- the SAME test seat B declared for the
 *  engine (d3: "edges crossing OR either shape containing a vertex of the other"), so the stub and the
 *  engine agree on what goes. (A centroid-only test was tried first and MEASURED wrong live: a wall row
 *  whose centres sat 0.02 in outside a brush stroke stayed, visibly overlapping it.) Exported for tests. */
function _segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}
export function polygonsOverlap(p, q) {
  if (p.some((v) => pointInPolygon(v.x, v.y, q)) || q.some((v) => pointInPolygon(v.x, v.y, p))) return true;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    for (let j = 0; j < q.length; j++) {
      if (_segmentsCross(a, b, q[j], q[(j + 1) % q.length])) return true;
    }
  }
  return false;
}
export function dropExcludedWallBricks(bricks, exclusions) {
  if (!exclusions || !exclusions.length) return bricks;
  return bricks.filter((b) => !exclusions.some((e) => polygonsOverlap(b.polygon, e.polygon)));
}

/** The generateBricks input for a lay with these settings (the Wall's own pattern / set / rustic / rotation; the
 *  frame, when given, also bounds the wall). */
function _layInput(editor, settings, frameGeom) {
  // F35 item 23: each element is laid with its OWN set (elementSettings); size + grout stay global
  const wallSettings = elementSettings(settings, 'wall');
  const frameSettings = elementSettings(settings, 'frame');
  const input = {
    boardOutline: boardPolygon(editor),
    set: resolvedSetFor(wallSettings),
    scale: scaleFor(wallSettings),
    suppression: settings.suppression,
    clumping: settings.clumping,
    seed: settings.seed,
  };
  // the engine applies ONE `scale` (the Wall's) to the frame's set too -- so the frame's set goes in pre-scaled
  // by its own scale over the Wall's (the engine's own scaledSet): its bricks / stones keep the global size
  if (frameGeom) input.frame = { ...frameGeom, set: scaledSet(resolvedSetFor(frameSettings), scaleFor(frameSettings) / input.scale) };
  applyWallPattern(input, wallSettings);
  // F35 item 21: the fieldstone layout's share of large stones (d3's T86 item 17 reads it; inert until then)
  if (wallLayoutFor(settings) === 'fieldstone') input.largeStones = Number.isFinite(settings.largeStones) ? settings.largeStones : 0.5;
  // F35 item 29 (a): the Wall's Rustic amount, for a running bond only (0 = absent = today's clean coursing)
  const rustic = Number(settings.rusticByElement && settings.rusticByElement.wall) || 0;
  if (rustic > 0 && isRunningBond(settings.pattern)) input.rustic = rustic;
  // F35 item 13: the Wall pattern's rotation (wall only; 0 = absent = today's lay, byte-identical)
  const rotationDeg = Number(settings.wallRotationDeg) || 0;
  if (rotationDeg) input.rotationDeg = rotationDeg;
  // F35 item 31b / 31e: what the Wall accent adds -- accentCuts (a tile at 1/2 or 1/4 brick, or a custom bond: the engine
  // cuts + marks the pieces) and customBond (the tile's own bond); a whole-brick tile on a built-in bond adds nothing
  Object.assign(input, accentLayInput(settings.accent, ENGINE_OPTIONS));
  return input;
}

/** Item 74b: which corner choices change the frame these settings lay -- core/bricks frameCornerEffect on the SAME
 *  input a lay builds (the frame's own set and scale, the fit rule); null with no frame contour to lay along. */
export function frameCornerEffectFor(editor, settings, frameGeom) {
  if (!frameGeom || !frameGeom.primitives || !frameGeom.primitives.length) return null;
  const { frame, seed, scale, bandFit } = _layInput(editor, settings, frameGeom);
  return frameCornerEffect(frame.primitives, frame.bands || [], { set: frame.set, seed, scale, bandFit });
}

/** F35 item 22 slice 2: the settings a painted area is laid with -- the SELECTED area (editor._brickWallAreaId,
 *  main/brick-panel.js) takes the section's current ones (it is the one being edited), every other area its own
 *  snapshot's WALL_AREA_FIELDS over the shared settings. */
export const wallAreaSettings = (editor, area, settings) =>
  (editor && area.id === editor._brickWallAreaId ? settings : withWallFields(settings, area.settings));

/** F35 item 42 (Fred: "I don't always use frames"): the frame's BANDS bound the wall only when there is a Frame element
 *  (laid now, or already on the board); with none, the wall fills the frame's contour itself -- the template's outer edge,
 *  the board rectangle for template None -- with no band reserve. Measured before: T18 7x10, 0.75 in, Wall only, no Frame
 *  element: the wall spanned x 1.00-6.00, y 1.00-7.99 (the preset's Soldier band depth kept clear on every side). */
export function frameGeomForLay(editor, frameGeom, kinds = BRICK_KINDS) {
  if (!frameGeom) return frameGeom;
  const frameElement = kinds.includes('frame') || !!brickRecordNode(editor, 'frame');
  return frameElement ? frameGeom : { ...frameGeom, bands: [] };
}

function _generateAndDraw(editor, settings, frameGeom, kinds = BRICK_KINDS) {
  frameGeom = frameGeomForLay(editor, frameGeom, kinds); // item 42
  // item 22 slice 3: each element on its own layer (its record's; a new one on the active layer)
  // item 64: only the kinds laid NOW resolve a layer (resolving creates a kind layer: never on a mere lookup -- measured: a
  // Wall-only lay had created an empty "Frame" layer)
  const layerOf = Object.fromEntries(kinds.map((k) => [k, elementLayer(editor, k)]));
  const wallSettings = elementSettings(settings, 'wall');
  const frameSettings = elementSettings(settings, 'frame');
  const input = _layInput(editor, settings, frameGeom);
  const exclusions = kinds.includes('wall') ? brushExclusions(editor) : [];
  if (exclusions.length) input.exclusions = exclusions;
  // slice 2: once any area is painted only the areas get bricks -- each its own engine call (its own settings,
  // its strokes as wallRegion, every NEWER area's strokes as minus: newest wins, the older wall flows around it).
  // T86 18c: laid NEWEST first; each older area also gets the newer areas' laid bricks as DROP exclusions (a brick
  // touching one is dropped, never cut), so two areas with different patterns never overlap
  const areas = kinds.includes('wall') ? wallAreaRecords(editor) : [];
  if (areas.length) input.skipWallFill = true;

  // Turn 195: the engine runs BEFORE anything is cleared -- if it throws, the bricks already on the
  // canvas stay exactly as they were (the caller reports the failure).
  const result = generateBricks(input);
  const bricks = result.exclusionsApplied ? result.bricks : dropExcludedWallBricks(result.bricks, exclusions);
  const { frameBricks } = result;
  const areaLays = [];
  for (let i = areas.length - 1; i >= 0; i--) {
    const area = areas[i];
    const s = wallAreaSettings(editor, area, settings);
    const ai = _layInput(editor, s, frameGeom);
    const newer = areaLays.flatMap((l) => l.bricks.map((b) => ({ polygon: b.polygon, drop: true })));
    if (exclusions.length || newer.length) ai.exclusions = [...exclusions, ...newer];
    ai.wallRegion = { strokes: area.strokes, minus: areas.slice(i + 1).flatMap((a) => a.strokes) };
    const r = generateBricks(ai);
    areaLays.unshift({ area, settings: s, bricks: r.exclusionsApplied ? r.bricks : dropExcludedWallBricks(r.bricks, ai.exclusions || []) });
  }
  for (const kind of kinds) clearGenerated(editor, kind);
  const lays = (kind) => kinds.includes(kind);
  for (const kind of kinds) applyBrickLayerTooling(layerOf[kind], settings);
  const owner = (kind) => ensureBrickRecord(editor, layerOf[kind], kind); // item 22: the element that lays them
  if (lays('frame')) drawBricks(editor, layerOf.frame, frameBricks, 'frame', frameSettings.setId, settings.seed, settings.reliefIn, owner('frame'));
  if (lays('wall') && !areas.length) drawBricks(editor, layerOf.wall, bricks, 'wall', wallSettings.setId, settings.seed, settings.reliefIn, owner('wall'));
  for (const { area, settings: s, bricks: ab } of areaLays) {
    const layer = area.layer || layerOf.wall;
    applyBrickLayerTooling(layer, s);
    drawBricks(editor, layer, ab, 'wall', elementSettings(s, 'wall').setId, settings.seed, settings.reliefIn, area.id);
  }
  // F35 item 55: each laid element's grout, once every brick is drawn (an area's cutouts are its neighbours' bricks)
  const interior = result.interiorOutline && result.interiorOutline.length >= 3 ? result.interiorOutline : boardPolygon(editor);
  if (lays('frame') && frameBricks.length && frameGeom && frameGeom.primitives && frameGeom.primitives.length) {
    const outer = primitivesOutline(frameGeom.primitives);
    drawElementGrout(editor, layerOf.frame, 'frame', owner('frame'), [{ outer, holes: [interior] }], settings);
  }
  if (lays('wall') && !areas.length && bricks.length) drawElementGrout(editor, layerOf.wall, 'wall', owner('wall'), [{ outer: interior, holes: [] }], settings);
  areas.forEach((area, i) => {
    const lay = areaLays.find((l) => l.area === area);
    if (!lay || !lay.bricks.length) return;
    const region = _wallAreaRegion({ ...area, minus: areas.slice(i + 1).flatMap((a) => a.strokes) }, lay.settings, interior);
    drawElementGrout(editor, area.layer || layerOf.wall, 'wall', area.id, region, settings);
  });
  if (lays('wall')) syncAccentHighlight(editor, settings.accent, settings.seed);
  if (lays('frame')) syncRunAccentHighlight(editor, settings); // per-band accents
  // F35 item 35: the engine's band-fit note (T86 item 28) when the Frame's stack was reduced to fit the board
  const wallCount = !lays('wall') ? 0 : areas.length ? areaLays.reduce((n, l) => n + l.bricks.length, 0) : bricks.length;
  return { wallCount, frameCount: lays('frame') ? frameBricks.length : 0,
    bandsReduced: lays('frame') ? (result.bandsReduced || null) : null };
}

/** `laidKey` (audit B1-B3): the caller's key for the settings this run lays. Item 22 step 3: it is stamped on
 *  each LAID element's record (BRICK_LAID_ATTR) BEFORE the undo commit, so every undo snapshot, the saved
 *  drawing and Cancel's restored document all carry the key of the bricks they hold. */
export function runBricks(editor, settings, frameGeom, { laidKey, kinds, amend } = {}) {
  const counts = _generateAndDraw(editor, settings, frameGeom, kinds);
  // item 22: each laid element's record keeps the settings it was laid with (its own, per element) and, from a
  // committed lay, the key of them (step 3). The record itself is what makes the element exist (audit B1: a Wall
  // the bands squeezed to zero bricks keeps its record, so the next lay brings it back).
  const areas = wallAreaRecords(editor);
  for (const kind of (kinds || BRICK_KINDS)) {
    if (kind === 'wall' && areas.length) { // slice 2: each area keeps its own snapshot; the edited one is updated
      for (const a of areas) {
        if (a.id === editor._brickWallAreaId) a.node.setAttribute(BRICK_SETTINGS_ATTR, JSON.stringify(elementSettings(settings, 'wall')));
        if (laidKey != null) a.node.setAttribute(BRICK_LAID_ATTR, laidKey);
      }
      continue;
    }
    const rec = brickRecordNode(editor, kind);
    if (!rec) continue;
    rec.setAttribute(BRICK_SETTINGS_ATTR, JSON.stringify(elementSettings(settings, kind)));
    if (laidKey != null) rec.setAttribute(BRICK_LAID_ATTR, laidKey);
  }
  commitEdit(editor, { amend }); // audit B9: `amend` = the step a frame undo's re-lay corrects in place
  notifyBricksGenerated(settings);
  return counts;
}

/** F35 item 10 follow-up (Fred): a Brick-tab slider's LIVE drag preview -- the same generate+draw
 *  step as runBricks, WITHOUT commitEdit (no undo snapshot pushed per drag tick -- a drag would
 *  otherwise spam the undo stack) or notifyBricksGenerated (no 'bricksGenerated' listener firing,
 *  so no grout-driven mesh-spacing tighten -> scheduleRebuild cascade into the expensive height-map
 *  / 3D rebuild this preview tier exists specifically to skip). main/brick-panel.js's own shared
 *  slider-binding mechanism calls this at most ~10x/sec (rAF-throttled) while dragging; the final
 *  value's runBricks() call on release/commit does the full, committed regenerate. */
export function runBricksPreview(editor, settings, frameGeom, kinds) {
  return _generateAndDraw(editor, settings, frameGeom, kinds);
}

/** F35 item 10 follow-up: the SLOW-drag fallback for runBricksPreview -- once brick-panel.js's own
 *  shared slider mechanism measures a live preview tick over its declared threshold, further live
 *  ticks of THAT SAME drag draw just the fill boundary (the frame's own board-outline default --
 *  deliberately not a precise frame-interior trace, which would need its own arc-sampling just for
 *  a rare, already-slow fallback) as one cheap dashed outline instead of the full per-brick fill.
 *  Costs nothing regardless of brick density (a large fieldstone-with-infill fill, the exact case
 *  this exists for) since it never calls generateBricks at all. The next commit (runBricks) always
 *  draws the real fill -- this is a drag-only placeholder, never a final state. */
export function runBricksOutlinePreview(editor) {
  const layer = elementLayer(editor, 'wall');
  clearGenerated(editor, 'wall');
  clearGenerated(editor, 'frame');
  const pts = boardPolygon(editor).map((p) => `${p.x},${p.y}`).join(' ');
  onBricksLayer(editor, layer, editor._sketchLayer.polygon(pts))
    .fill('none')
    .stroke({ color: '#aa4433', width: 0.03, dasharray: '0.1,0.08' })
    .attr(BRICK_ATTR, 'wall')
    .attr(BRICK_GEN_ATTR, '1');
}

/** Advisor review (turn 131, round 2): a 0.06in grout groove needs the
 *  terrain's own mesh to sample it at least 2-3 times across to read as a
 *  visible groove rather than a blur -- that's a GLOBAL mesh-resolution
 *  concern (P.spacing), which main/ owns, not this editor/ module (editor/
 *  files never import core/state.js -- see this file's own header). A plain
 *  CustomEvent is the declared bridge, same convention as layers.js's own
 *  'layer-tooling-commit' / stamp-mask-manager.js's 'stampMaskUpdated'. */
function notifyBricksGenerated(settings) {
  if (typeof document === 'undefined' || typeof CustomEvent === 'undefined') return;
  // the hint aims at the NARROWEST joint on the board (every element's own, item: grout per element)
  document.dispatchEvent(new CustomEvent('bricksGenerated', { detail: { groutWidthIn: Math.min(...BRICK_KINDS.map((k) => elementGroutWidth(settings, k))) } }));
}

/** primitives (contour-from-frame.js's own {type:'L'|'A', ...} loop) -> a
 *  flat {x,y}[] polyline + the indices of its REAL corners, exactly what
 *  bricksContourBands/bricksAlongPath expect as (path, opts.cornerIndices).
 *  `corners` is frameContourSilhouette's own declared field: "indices into
 *  primitives that are sharp (merged) joints, not tangent" -- advisor
 *  review (turn 131): marking EVERY primitive boundary as a corner (the
 *  first version of this function) forced a mitred brick-boundary + corner
 *  correction at every tangent arc-to-arc sample too, not just true
 *  corners, producing overlapping blobs/diagonal shards around a curved
 *  run. Only indices in `corners` are marked now; a run between two real
 *  corners -- however many 'A' primitives it's subdivided into -- is left
 *  to bricksAlongPath's own arc-length tangent sampling to follow smoothly,
 *  which is exactly what it's already built to do between two declared
 *  corners (its own un-mitred "plain point" path). An 'L' primitive is
 *  already a straight edge (its own two endpoints are enough); an 'A' is
 *  subdivided into ARC_STEPS points so a curved frame edge still gets a
 *  reasonably smooth polyline approximation, not one giant straight chord.
 *
 * OFF-BY-ONE FIX (f3, confirmed against outlineDefects' own notTangent
 * check): `sil.corners`' OWN declared convention is "index i = the joint
 * BETWEEN primitive i and primitive i+1" (declaredMiterJointIndices) -- the
 * first version of this function marked index i as the joint BEFORE
 * primitive i (between i-1 and i), one position early. MEASURED to leave a
 * real, visible void at T1 7x9's own bottom-left corner (its own high
 * symmetry meant the shifted index mostly still landed on SOME real corner,
 * just the wrong one of an equivalent pair -- why only one of four broke,
 * not all four). Fixed by marking the corner AFTER primitive i's own points
 * are appended, not before; a corner declared at the LAST primitive (i =
 * primitives.length-1, "the joint after the last, back to the first") wraps
 * to index 0 via the final `% points.length`, since this function never
 * emits a separate closing point for primitive 0's own repeated start. */
const ARC_STEPS = 16;

export function primitivesToPolyline(primitives, corners) {
  const cornerSet = new Set(corners || []);
  const points = [];
  const rawCornerIndices = [];
  (primitives || []).forEach((prim, i) => {
    if (prim.type === 'A') {
      for (let k = 0; k < ARC_STEPS; k++) {
        const t = prim.theta1 + (prim.dTheta * k) / ARC_STEPS;
        points.push({ x: prim.cx + prim.rx * Math.cos(t), y: prim.cy + prim.ry * Math.sin(t) });
      }
    } else {
      points.push({ x: prim.p0.x, y: prim.p0.y });
    }
    if (cornerSet.has(i)) rawCornerIndices.push(points.length);
  });
  const cornerIndices = points.length ? rawCornerIndices.map((idx) => idx % points.length) : [];
  return { points, cornerIndices };
}

/** F35 item 4 correction (H23 item 76): the declared `arcSegments`
 *  `bricksContourBands`/`bricksAlongPath` need for TRUE circular-arc brick
 *  construction (arc-voussoir.js) -- one per 'A' primitive, with centre/
 *  radius/angle read DIRECTLY off the real frame primitive data (never
 *  re-fitted from the tessellated polyline) and `radialSign` from the
 *  tessellated path's own local tangent plus the path's GLOBAL inward sign
 *  (`radialSignAt` -- the exact function the advisor's review fixed after the
 *  first version conflated per-arc convex/concave with the path's own global
 *  inward direction; reused verbatim here rather than re-derived, the same
 *  bug class). Ported from tests/bricks-real-template-contours.test.js's own
 *  `buildArcSegments` (f3's own reference implementation, written specifically
 *  so this adapter could port it verbatim -- "this is what the real Brick-tab
 *  adapter would also need to build... not yet done there"). Without this,
 *  bricksContourBands falls back to its pre-H23-item-76 corner-mitre path,
 *  which is the multi-band concave-offset bug the advisor caught in item 4. */
export function buildArcSegments(primitives, points) {
  const closedPts = points.concat([points[0]]);
  const cum = cumulativeLengths(closedPts);
  const inwardSign = inwardSignFor(points); // ONE global fact about the whole path, not per-arc
  const segments = [];
  let offset = 0;
  for (const prim of primitives || []) {
    const nPts = prim.type === 'A' ? ARC_STEPS : 1;
    if (prim.type === 'A') {
      const startIndex = offset;
      const endIndex = offset + nPts; // may equal points.length (wraparound), valid for cum[]
      const theta1 = prim.theta1, theta2 = prim.theta1 + prim.dTheta;
      const sMid = cum[startIndex] + 0.01;
      const a = pointAtArcLength(closedPts, cum, sMid - 0.005, true);
      const b = pointAtArcLength(closedPts, cum, sMid + 0.005, true);
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1;
      const mid = pointAtArcLength(closedPts, cum, sMid, true);
      const radialSign = radialSignAt({ tx: tx / tl, ty: ty / tl }, mid.x, mid.y, prim.cx, prim.cy, inwardSign);
      segments.push({ startIndex, endIndex, cx: prim.cx, cy: prim.cy, r: prim.rx, theta1, theta2, radialSign });
    }
    offset += nPts;
  }
  return segments;
}

/** H23 item 76 (advisor, primitive-ribbon.js rebuild -- "input: primitives + corners, which the
 *  adapter already has via sil.primitives"): converts contour-from-frame.js's own
 *  `{type:'L'|'A', ...}` primitive list DIRECTLY into core/bricks/primitive-ribbon.js's own RAW
 *  primitive format (`{type:'line',p0,p1}` / `{type:'arc',cx,cy,r,theta1,theta2}`) for
 *  `bricksContourBands`. No polyline, no declared `cornerIndices`: `ribbonPieces` derives every
 *  joint directly from where consecutive primitives actually meet, degenerating to "no clip" on
 *  its own for a tangent-continuous (non-corner) transition (a line-line/line-circle intersection
 *  of two parallel/tangent curves has no solution, so the joint's own mitre line is simply absent
 *  there) -- no separate "is this a real corner" declaration needed, unlike `primitivesToPolyline`/
 *  `buildArcSegments` above, which this replaces for the Frame tool specifically (both kept,
 *  unused here, for any other caller that still wants a plain declared-corners polyline). An 'L'
 *  primitive only carries its own `p0` (its own `p1` is implicit -- the NEXT primitive's own start
 *  point, same convention `primitivesToPolyline` already relies on). */
export function buildRibbonPrimitives(primitives) {
  const list = primitives || [];
  const n = list.length;
  return list.map((prim, i) => {
    if (prim.type === 'A') {
      return { type: 'arc', cx: prim.cx, cy: prim.cy, r: prim.rx, theta1: prim.theta1, theta2: prim.theta1 + prim.dTheta };
    }
    const next = list[(i + 1) % n];
    const p1 = next.type === 'A' ? { x: next.cx + next.rx * Math.cos(next.theta1), y: next.cy + next.ry * Math.sin(next.theta1) } : next.p0;
    return { type: 'line', p0: prim.p0, p1 };
  });
}

/** The Brush tool's mode handler (editor._currentMode === 'brickBrush'):
 *  mirrors makeDrawingHandler's own freehand-path shape (editor-
 *  interaction.js) for the LIVE preview stroke, but on finish discards that
 *  preview path and bakes real bricks along the drawn polyline instead of
 *  keeping it as a plain path. `editor._brickSettings` is set by main/
 *  brick-panel.js before arming this mode (read fresh on finish, not start,
 *  so dragging the Height/Scale sliders mid-stroke -- unlikely but
 *  possible -- doesn't bake a stale snapshot). */
export const brickBrushHandler = {
  start(editor, pt) {
    editor._deselect();
    editor._isDrawing = true;
    editor._points = [[pt.x, pt.y]];
    editor._currentPath = editor._sketchLayer
      .path(`M ${pt.x} ${pt.y}`)
      .fill('none')
      .stroke({ color: '#aa4433', width: 0.05, linecap: 'round', linejoin: 'round' });
  },
  update(editor, pt) {
    if (!editor._isDrawing || !editor._currentPath) return;
    editor._points.push([pt.x, pt.y]);
    editor._currentPath.attr('d', `${editor._currentPath.attr('d')} L ${pt.x} ${pt.y}`);
  },
  finish(editor) {
    editor._isDrawing = false;
    const preview = editor._currentPath;
    const points = editor._points || [];
    editor._currentPath = null;
    editor._points = [];
    if (preview) preview.remove(); // the live-feedback stroke, never the committed result
    if (points.length < 2) return; // a tap, not a stroke -- nothing to bake

    // F35 item 16 (turn 201): a brush VARIANT (the Raised brush) adds its own per-stroke fields --
    // `levelIn` (laid proud by that much) and `strokeMode` -- through editor._brickStrokeOverrides (a
    // function, read here at finish so a Level changed after picking the tool still applies). They are
    // frozen into THIS stroke's own settings snapshot like every other brush setting.
    const overrides = typeof editor._brickStrokeOverrides === 'function' ? editor._brickStrokeOverrides() : null;
    const settings = editor._brickSettings ? { ...editor._brickSettings, ...(overrides || {}) } : null;
    if (!settings) return;
    const layer = brickKindLayer(editor, 'brush') || activeLayerOf(editor); // item 64: a new stroke goes on the Brush layer
    applyBrickLayerTooling(layer, settings);

    // F35 item 3: draw the SPINE (real, persistent, plain <line> segments --
    // already isCuttable with zero changes to editor-cut-tool.js), not the
    // bricks directly. commitEdit() below dispatches 'editorCommit' BEFORE
    // the undo snapshot, so the module-level listener's own
    // regenerateOwnedBrickElements(editor) call runs synchronously and
    // draws the actual bricks from this spine + its settings snapshot --
    // the SAME path a later cut/stripe/move re-triggers, so there is only
    // ONE brick-generating code path for Brush, not two to keep in sync.
    //
    // Simplified FIRST (the SAME ramerDouglasPeucker the plain pencil tool's
    // own finishDrawing already applies, reused rather than re-derived) --
    // MEASURED why this matters: one segment per raw drag-point sample (a
    // typical mouse drag is a dozen+ points) means Stripe's own "the one
    // cuttable element under the tap" finds just ONE tiny raw segment, not
    // the user's whole visible stroke (a live test striped only 2 of a
    // 4-stroke's own inches before this fix). Simplifying first collapses a
    // straight or gently-curved drag down to a handful of real segments, so
    // a tap anywhere lands on a piece that actually spans a meaningful
    // length of the stroke -- Scissors is unaffected either way (cutAt's own
    // point is exact, not snapped to a segment's own endpoints).
    const simplified = ramerDouglasPeucker(points, 0.05);
    const elementId = newBrickElementId();
    const settingsJson = JSON.stringify(settings);
    for (let i = 0; i < simplified.length - 1; i++) {
      drawSpineSegment(
        editor, layer, elementId, settingsJson,
        { x: simplified[i][0], y: simplified[i][1] },
        { x: simplified[i + 1][0], y: simplified[i + 1][1] },
      );
    }
    commitEdit(editor);
    notifyBricksGenerated(settings);
  },
};

/** F35 item 22 slice 2, the AREA brush (editor._currentMode === 'brickWallArea'): a drag paints a round brush of
 *  editor._brickAreaWidthIn (a translucent preview while dragging); on release the simplified stroke goes to
 *  editor._brickWallArea(points) (main/brick-panel.js: adds it to an area, lays, one undo step). A tap = a dab. */
export const AREA_PREVIEW = Object.freeze({ color: '#1e88e5', opacity: 0.3 });
export const brickWallAreaHandler = {
  start(editor, pt) {
    const raw = pt; // the editor's own point (snapped like a Brush stroke's)
    editor._isDrawing = true;
    editor._points = [[raw.x, raw.y]];
    const host = editor._highlightLayer || editor._sketchLayer;
    editor._currentPath = host.path(`M ${raw.x} ${raw.y} L ${raw.x} ${raw.y}`).fill('none')
      .stroke({ color: AREA_PREVIEW.color, opacity: AREA_PREVIEW.opacity, width: editor._brickAreaWidthIn || 1, linecap: 'round', linejoin: 'round' })
      .attr('pointer-events', 'none');
  },
  update(editor, pt) {
    if (!editor._isDrawing || !editor._currentPath) return;
    const raw = pt;
    editor._points.push([raw.x, raw.y]);
    editor._currentPath.attr('d', `${editor._currentPath.attr('d')} L ${raw.x} ${raw.y}`);
  },
  finish(editor) {
    editor._isDrawing = false;
    const points = editor._points || [];
    if (editor._currentPath) editor._currentPath.remove();
    editor._currentPath = null;
    editor._points = [];
    if (!points.length || typeof editor._brickWallArea !== 'function') return;
    const simplified = points.length > 2 ? ramerDouglasPeucker(points, 0.02) : points;
    editor._brickWallArea(simplified.map(([x, y]) => ({ x, y })));
  },
};

function newBrickElementId() {
  return `be${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** One spine segment -- a plain `<line>`, deliberately unremarkable (no
 *  lattice kind, no contour-ref): isCuttable (editor-cut-tool.js) already
 *  accepts ANY `<line>`, so this needs no changes there to be cut/stripe-
 *  able. Drawn with low stroke-opacity (present for hit-testing/selection,
 *  not meant to visually compete with the opaque brick polygons drawn on
 *  top of it in z-order). */
function drawSpineSegment(editor, layer, elementId, settingsJson, a, b) {
  return onBricksLayer(editor, layer, editor._sketchLayer.line(a.x, a.y, b.x, b.y))
    .stroke({ color: '#aa4433', width: 0.06, linecap: 'round' })
    .attr('stroke-opacity', '0.15')
    .attr(BRICK_ATTR, SPINE_KIND)
    .attr(BRICK_ELEMENT_ATTR, elementId)
    .attr(BRICK_SETTINGS_ATTR, settingsJson);
}

function decodeBrickSettings(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** F35 item 3/4 (Fred: "stripe the spine into A/B/C runs, each run its own
 *  settings variant" -- item 4: "today all runs render the same red... pick
 *  a brick STYLE variant (set: Red brick/White rocks; profile: bricks/
 *  continuous; or scale)"). SET is the axis that actually reads as a
 *  different material with this app's own flat-fill brick rendering (no
 *  per-sample photo texture yet) -- White Rocks (library.js id 3) is real
 *  now (f3's item 74), so the cycle uses it for run B; profile still varies
 *  too (a 'continuous' run is also a genuinely different SHAPE, not just
 *  colour).
 *
 *  Audit C6 (F35 item 16): the user PICKS each run's style -- the Stripe panel's A/B/C slots show
 *  brick-style thumbnails in the Brick tab (main/brick-panel.js) instead of Artwork's colour swatches.
 *  BRICK_STRIPE_STYLES declares the choices; P.brickSettings.stripeStyles holds the A/B/C picks; the
 *  cycle length follows the panel's own "Use C" (2 or 3). The picks are ONE brick setting read live at
 *  every regenerate, and changing a pick re-commits, so every striped run always shows the current picks.
 *  The default picks A = red bricks, B = white continuous are exactly the old fixed 2-style cycle. */
export const BRICK_STRIPE_STYLES = Object.freeze([
  Object.freeze({ id: 'red_bricks', label: 'Red bricks', setId: 1, profile: 'bricks' }),
  Object.freeze({ id: 'white_continuous', label: 'White rocks, one band', setId: 3, profile: 'continuous' }),
  Object.freeze({ id: 'red_continuous', label: 'Red, one band', setId: 1, profile: 'continuous' }),
  Object.freeze({ id: 'white_bricks', label: 'White rocks', setId: 3, profile: 'bricks' }),
]);
export const DEFAULT_STRIPE_STYLE_PICKS = Object.freeze(['red_bricks', 'white_continuous', 'red_continuous']);

/** The style cycle for striped runs: the A/B (/C) picks resolved against BRICK_STRIPE_STYLES (an unknown
 *  or missing pick falls back to that slot's default). */
export function stripeCycleFor(picks, useC = false) {
  const n = useC ? 3 : 2;
  const byId = (id) => BRICK_STRIPE_STYLES.find((s) => s.id === id);
  return Array.from({ length: n }, (_, i) => byId(picks && picks[i]) || byId(DEFAULT_STRIPE_STYLE_PICKS[i]));
}

function settingsVariantForCycle(baseSettings, cycleIndex, cycle = stripeCycleFor()) {
  const variant = cycle[cycleIndex % cycle.length];
  return { ...baseSettings, setId: variant.setId, profile: variant.profile };
}

const pointKey = (p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;

/**
 * F35 item 3: raw spine segments -> regenerate UNITS (pure, DOM-free --
 * exported for direct unit testing). `segments`: `[{a, b, stripeId,
 * settings}]`, one entry per spine `<line>`.
 *
 * Plain (non-striped) segments that are still geometrically CONTIGUOUS
 * merge into ONE chain: a Scissors cut with no further action leaves two
 * touching pieces, and feeding bricksAlongPath the merged, full-length
 * polyline (not two separate short calls) is what keeps its own corner/
 * mitre handling correct across what were originally several drag-point
 * segments -- the SAME reasoning behind F35 item 1's own cornerIndices fix
 * (don't force a correction where the geometry is still one smooth run).
 * Dragging one of the two pieces away breaks that contiguity, so the NEXT
 * regenerate pass naturally produces two separate chains, each following
 * its own piece -- "cut -> two elements, each regenerating its own bricks"
 * in the sense that matters: they bake independently the moment they
 * actually diverge, not the instant the cut itself lands.
 *
 * A STRIPED segment (carries `stripeId`, editor-stripe-tool.js's own
 * `STRIPE_ATTR` -- "one id per striped RUN", not per piece) never merges
 * with a neighbour, striped or not: each is its OWN chain, its style cycled
 * by its own position within its run (`cycleIndex`), ordered by array
 * position -- which is DOM/draw order, the same order `cutAtNoCommit`'s own
 * `insertAfter` always keeps a run's pieces in.
 */
export function reconstructChains(segments) {
  const plain = (segments || []).filter((s) => !s.stripeId);
  const striped = (segments || []).filter((s) => s.stripeId);

  const chains = [];

  const byRun = new Map();
  for (const s of striped) {
    if (!byRun.has(s.stripeId)) byRun.set(s.stripeId, []);
    byRun.get(s.stripeId).push(s);
  }
  for (const run of byRun.values()) {
    run.forEach((s, idx) => chains.push({ points: [s.a, s.b], cycleIndex: idx, settings: s.settings }));
  }

  const used = new Set();
  const byPoint = new Map();
  plain.forEach((s, i) => {
    for (const [k, end] of [[pointKey(s.a), 'a'], [pointKey(s.b), 'b']]) {
      if (!byPoint.has(k)) byPoint.set(k, []);
      byPoint.get(k).push({ i, end });
    }
  });
  const otherEnd = (i, end) => (end === 'a' ? plain[i].b : plain[i].a);

  for (let i = 0; i < plain.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const chainPts = [plain[i].a, plain[i].b];

    let curKey = pointKey(plain[i].b);
    for (;;) {
      const cands = (byPoint.get(curKey) || []).filter((c) => !used.has(c.i));
      if (cands.length !== 1) break;
      const { i: ni, end } = cands[0];
      const next = otherEnd(ni, end);
      chainPts.push(next);
      used.add(ni);
      curKey = pointKey(next);
    }

    curKey = pointKey(plain[i].a);
    for (;;) {
      const cands = (byPoint.get(curKey) || []).filter((c) => !used.has(c.i));
      if (cands.length !== 1) break;
      const { i: ni, end } = cands[0];
      const prev = otherEnd(ni, end);
      chainPts.unshift(prev);
      used.add(ni);
      curKey = pointKey(prev);
    }

    chains.push({ points: chainPts, cycleIndex: null, settings: plain[i].settings });
  }

  return chains;
}

/** F35 item 3: the regenerate pass. Scans the Bricks layer's own spine
 *  segments (grouped by BRICK_ELEMENT_ATTR), reconstructs chains, and
 *  redraws EVERY brush-owned brick from scratch -- a full rebuild, not a
 *  diffed/cached update (the simplicity this buys -- no stale-cache class
 *  of bug possible -- is worth the extra, modest work on an action this
 *  infrequent; it runs once per discrete editor COMMIT, never per frame).
 *  Wall/Frame's own bricks (BRICK_GEN_ATTR, no BRICK_OWNER_ATTR) are
 *  untouched -- they stay the separate, fire-and-forget regime item 1
 *  already built (their own "spine" is the live board/frame contour itself,
 *  not a drawn element, so they have nothing here to react to). */
// F35 (Fred, perf: "the app lags once a brick layer exists" -- the quick win: "skip brick regen
// on non-brick commits"): regenerateOwnedBrickElements used to remove-and-redraw EVERY brush-owned
// brick on EVERY editorCommit, even one that never touched a brick spine at all (e.g. dragging an
// unrelated artwork node) -- a full DOM scan + per-chain bricksForBrushStroke + a fresh polygon
// (with its own pattern-fill lookup) per brick, on every single commit anywhere in the editor.
// A cheap fingerprint of the spine content this function ACTUALLY reads (element id, endpoints,
// stripe id, settings JSON -- every input its own output depends on) lets an unrelated commit
// skip that work entirely: if none of it changed, the redraw would produce byte-identical output,
// so skipping is exact, not a heuristic approximation.
let _lastSpineFingerprint = null;

/** turn 201: the bricks ONE brush stroke lays, from its own frozen settings. A GROUT-mode stroke (the Raised
 *  brush's mode 2) lays none -- it CUTS joints through existing bricks with seat B's bricksGroutCut (T86
 *  item 10); STUB until the engine has it (the mode is hidden until ENGINE_OPTIONS lists 'groutCut'), so
 *  the stroke keeps its spine and draws nothing. `levelIn` (the Raised brush's Level) lifts every brick of
 *  the stroke by that much (its heightOffset, read by the height mask). Exported for tests. */
export function bricksForStroke(points, settings, out = null) {
  if (settings.strokeMode === 'grout') return [];
  const level = Number(settings.levelIn) || 0;
  const bricks = bricksForBrushStroke(points, settings, toBrickOpts(settings), out);
  return level ? bricks.map((b) => ({ ...b, heightOffset: (b.heightOffset || 0) + level })) : bricks;
}

export function regenerateOwnedBrickElements(editor) {
  if (!editor || !editor._sketchLayer || !Array.isArray(editor._layers)) return;

  const children = editor._sketchLayer.children().toArray();
  const spineEls = children.filter((el) => el.attr(BRICK_ATTR) === SPINE_KIND);
  if (!spineEls.length && !children.some((el) => el.attr(BRICK_OWNER_ATTR) && el.attr(BRICK_ATTR) === 'brush')) return;

  // audit C6: the striped runs' style cycle (the A/B/C picks + Use C) is an input too -- without it in the
  // fingerprint a pick change was skipped as "nothing changed" (measured live, turn 191)
  const stripeCycle = stripeCycleFor(editor._brickSettings && editor._brickSettings.stripeStyles, !!(editor._stripe && editor._stripe.three));
  const fingerprint = spineEls.map((el) => {
    const [a, b] = pieceEnds(el);
    // + its layer (item 22 slice 3: a stroke's bricks are drawn on its spine's layer)
    return `${el.attr(BRICK_ELEMENT_ATTR)}|${a.x},${a.y},${b.x},${b.y}|${el.attr(STRIPE_ATTR) || ''}|${el.attr(BRICK_SETTINGS_ATTR) || ''}|${el.attr('data-layer')}`;
  }).join(';') + `#${stripeCycle.map((v) => v.id).join(',')}`
    // F35 item 60: the frame the strokes keep clear of -- a frame re-lay re-lays the strokes too (its record's laid key)
    + `#frame:${brickRecordNode(editor, 'frame')?.getAttribute(BRICK_LAID_ATTR) ?? ''}`;
  if (fingerprint === _lastSpineFingerprint) return;
  _lastSpineFingerprint = fingerprint;

  const byElement = new Map();
  const strokeLayer = new Map(); // a stroke's bricks go on its spine's layer
  for (const el of spineEls) {
    const elementId = el.attr(BRICK_ELEMENT_ATTR);
    if (!elementId) continue;
    const [a, b] = pieceEnds(el);
    const settings = decodeBrickSettings(el.attr(BRICK_SETTINGS_ATTR));
    if (!settings) continue;
    const stripeId = el.attr(STRIPE_ATTR) || null;
    if (!byElement.has(elementId)) byElement.set(elementId, []);
    byElement.get(elementId).push({ a, b, stripeId, settings });
    if (!strokeLayer.has(elementId)) strokeLayer.set(elementId, layerById(editor, el.attr('data-layer')));
  }

  // only the BRUSH strokes' own bricks -- Wall/Frame bricks carry an owner too since item 22 (their record)
  children.filter((el) => el.attr(BRICK_OWNER_ATTR) && el.attr(BRICK_ATTR) === 'brush').forEach((el) => el.remove());
  // F35 item 55: every stroke's grout node goes too (a deleted stroke must not leave one); each keeps its PAINT -- the
  // grout paint is per kind, never frozen into a stroke -- read back here and handed to its redraw
  const groutPaint = new Map();
  for (const g of editor._sketchLayer.node.querySelectorAll(`[${BRICK_ATTR}="${GROUT_KIND}"][${GROUT_OF_ATTR}="brush"]`)) {
    const fill = g.getAttribute('fill');
    groutPaint.set(g.getAttribute(BRICK_OWNER_ATTR), { color: fill && fill !== 'none' ? fill : null, paintInsetIn: Number(g.getAttribute(GROUT_INSET_ATTR)) || 0 });
    g.remove();
  }

  // F35 item 60 (seat A's e2e: a raised stroke over the frame's stones, the raise added onto the stone): a stroke keeps
  // clear of the laid FRAME pieces (the engine's bricksClearOf) -- a brick touching one is dropped whole (18c); a
  // Continuous run, one unbroken piece, is CUT there instead (dropping it would take the whole stroke away)
  const framePieces = [...editor._sketchLayer.node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="frame"]`)].map(_nodePolygon);
  const frameExclusions = (settings) => framePieces.map((polygon) => ({ polygon, drop: settings.profile !== 'continuous' }));
  for (const [elementId, segs] of byElement) {
    const chains = reconstructChains(segs);
    const region = []; // F35 item 55: the stroke's ribbons, one per chain
    chains.forEach((chain, chainIdx) => {
      if (chain.points.length < 2) return;
      const settings = chain.cycleIndex == null
        ? chain.settings
        : settingsVariantForCycle(chain.settings, chain.cycleIndex, stripeCycle);
      const out = {};
      const bricks = bricksClearOf(bricksForStroke(chain.points, settings, out), frameExclusions(settings), resolvedSetFor(settings));
      if (bricks.length && out.ribbonOutline && out.ribbonOutline.length >= 3) region.push({ outer: out.ribbonOutline, holes: [] });
      const ownerId = `${elementId}:${chainIdx}`;
      const layer = strokeLayer.get(elementId);
      if (!layer) return;
      bricks.forEach((b, i) => {
        // + its place on the stroke's own grid (the Brush accent, per stroke)
        stampRunPlace(drawBrick(editor, layer, b, 'brush', settings.setId, settings.seed, settings.reliefIn).attr(BRICK_OWNER_ATTR, ownerId), b, i);
      });
    });
    const layer = strokeLayer.get(elementId);
    if (layer && region.length) {
      const kept = groutPaint.get(elementId);
      const paint = kept ? { groutPaintByElement: { brush: kept } } : (editor._brickSettings || segs[0].settings);
      drawElementGrout(editor, layer, 'brush', elementId, region, paint);
    }
  }
  // the Brush accent's outline on the (re)drawn strokes (per-element accents)
  if (editor._brickSettings) syncRunAccentHighlight(editor, editor._brickSettings);
}

/** F35 item 55: regenerate every stroke even when nothing changed (a board drawn before strokes had grout: its strokes
 *  get their grout nodes; the same settings + seed lay the same bricks). */
export function forceRegenerateOwnedBrickElements(editor) {
  _lastSpineFingerprint = null;
  regenerateOwnedBrickElements(editor);
}

if (typeof document !== 'undefined') {
  document.addEventListener('editorCommit', (e) => {
    regenerateOwnedBrickElements(e.detail && e.detail.editor);
  });
}

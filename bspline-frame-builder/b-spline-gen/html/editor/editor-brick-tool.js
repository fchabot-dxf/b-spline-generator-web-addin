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
import { ensureActiveLayer, addLayer, BRICKS_LAYER_NAME, isBricksLayer, bricksLayerOf, applyLayerStateTo, BRICK_RECORD_ATTR } from './layers.js';
import { commitEdit } from './editor-commit.js';
import { ramerDouglasPeucker } from './editor-curves.js';
import { pieceEnds } from './editor-cut-tool.js';
import { STRIPE_ATTR } from './editor-stripe-tool.js';
import { bricksAlongPath, bricksContourBands, generateBricks, pointInPolygon } from '../core/bricks/index.js';
import { brickSetById, BRICK_PATTERNS, BRUSH_PRESETS, FRAME_PRESETS, BRICK_SETS, scaledSet } from '../core/bricks/library.js';
import { rectToPrimitives } from '../core/inset-window.js';
import { brickFillPaint } from './editor-brick-surface.js';
import { cumulativeLengths, pointAtArcLength, inwardSignFor } from '../core/bricks/geometry.js';
import { radialSignAt } from '../core/bricks/arc-voussoir.js';
import { accentedBrickIndices } from './brick-accents.js';

export const BRICK_ATTR = 'data-brick'; // 'brush' | 'wall' | 'frame' | 'brush-spine'
export const BRICK_GEN_ATTR = 'data-brick-gen'; // '1' on every adapter-drawn piece
// Audit K7: the Bricks layer's identity now lives in layers.js (the layer-row summary needs it, and
// layers.js cannot import this file -- this file imports layers.js). Re-exported for every importer.
export { BRICKS_LAYER_NAME, isBricksLayer, bricksLayerOf };

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
export const BRICK_ELEMENT_ATTR = 'data-brick-element';
export const BRICK_SETTINGS_ATTR = 'data-brick-settings';
export const BRICK_OWNER_ATTR = 'data-brick-owner'; // on a generated brick: which regenerate-unit made it
const SPINE_KIND = 'brush-spine';

/** Find the editor's own "Bricks" layer by NAME (not id -- there's no
 *  reserved id scheme for named layers here), creating one if it doesn't
 *  exist yet. Every brick-tool action shares this one layer so Brush/Wall/
 *  Frame output always lands together, regardless of whichever layer
 *  happened to be "active" from unrelated earlier editing. */
export function ensureBricksLayer(editor) {
  ensureActiveLayer(editor); // guarantees editor._layers is a real, non-empty array
  const existing = bricksLayerOf(editor); // item 22 slice 1: the DECLARED brick layer, whatever it is named
  if (existing) return existing;
  return addLayer(editor, {
    name: BRICKS_LAYER_NAME,
    holdsBricks: true,
    skipUndo: true, // bundled into the SAME undo step as the content about to be drawn onto it
    profile: 'flat',
    edgeFilletRadius: 0,
  });
}

/** Writes this brick-tool run's OWN tooling (depth from reliefIn, grout-
 *  driven profile knobs) onto the Bricks layer -- "editor wins" resolution
 *  (main/stamp-mask-manager.js) means these values are what the terrain
 *  actually carves at, not just UI decoration. Direct field writes +
 *  commitEdit, the same shape setLayerCarve/setLayerShowColor already use
 *  for a layer's own tooling (there's no dedicated setLayerDepth -- those
 *  fields are read as plain object properties throughout this codebase). */
function applyBrickLayerTooling(layer, settings) {
  // Raised/Carved (settings.invert, the same Photo-style 2-state toggle):
  // the generic stamp compositor (core/engine/apply-stamp-layers.js) already
  // treats a NEGATIVE layer depth as "carve down from the base" (its own
  // layerSign/filletAmplitude math is explicitly signed, not clamped) -- so
  // Carved is just this one sign flip, no separate code path needed.
  layer.depth = settings.invert ? -settings.reliefIn : settings.reliefIn;
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
const SET_COLORS = Object.freeze({ 1: '#aa4433', 3: '#c9c3b2' });
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

function drawBrick(editor, layer, brick, kind, setId, seed, reliefIn) {
  const pts = brick.polygon.map((p) => `${p.x},${p.y}`).join(' ');
  const paint = brickFillPaint(editor, setId, brick.sampleId, brick.flip) || SET_COLORS[setId] || DEFAULT_BRICK_COLOR;
  return onBricksLayer(editor, layer, editor._sketchLayer.polygon(pts))
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
    const paint = brickFillPaint(editor, setId, el.getAttribute('data-brick-sample') || null, el.getAttribute('data-brick-flip') === '1')
      || SET_COLORS[setId] || DEFAULT_BRICK_COLOR;
    el.setAttribute('fill', paint);
  });
  return nodes.length;
}

function drawBricks(editor, layer, bricks, kind, setId, seed, reliefIn, ownerId = null) {
  for (const b of bricks) {
    const el = drawBrick(editor, layer, b, kind, setId, seed, reliefIn);
    if (ownerId) el.attr(BRICK_OWNER_ATTR, ownerId); // item 22: which element (record) laid it
  }
}

/** F35 item 22 slice 1: each Wall / Frame ELEMENT has a RECORD -- one invisible node on the brick layer
 *  (`display="none"`: never drawn, hit-tested or exported -- getLayerSvg and the download drop it; no
 *  [data-brick] query sees it) carrying the element's id (BRICK_ELEMENT_ATTR) and the settings it was laid with
 *  (BRICK_SETTINGS_ATTR, the same snapshot a Brush stroke's spine carries). Every brick it lays carries
 *  BRICK_OWNER_ATTR = that id. Brush strokes already are records (their spines). Slice 2's painted areas add
 *  'wall-area' records; until then there is one 'wall-full' and one 'frame'. */
export const BRICK_RECORD_KINDS = Object.freeze({ wall: 'wall-full', frame: 'frame' });
/** Step 3: the key of the settings (+ frame + brush strokes) an element's bricks were laid with, on its record --
 *  per element, so a lay of one element never makes the other's key lie. Replaces the brick layer's one shared
 *  `brickLaidKey` (+ `brickLaidKinds`), which a board saved before item 22 still carries until its records are
 *  migrated (slice 1 step 5). */
export const BRICK_LAID_ATTR = 'data-brick-laid';
export { BRICK_RECORD_ATTR };
export function brickRecordNode(editor, kind) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  const recordKind = BRICK_RECORD_KINDS[kind];
  return recordKind && node && node.querySelector ? node.querySelector(`[${BRICK_RECORD_ATTR}="${recordKind}"]`) : null;
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
function clearGenerated(editor, layer, kind) {
  const nodes = editor._sketchLayer.node.querySelectorAll(
    `[data-layer="${layer.id}"][${BRICK_GEN_ATTR}="1"][${BRICK_ATTR}="${kind}"]`,
  );
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
  return { ...base, grout: { ...base.grout, widthIn: settings.grout.widthIn } };
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
export function bricksForBrushStroke(points, settings, opts) {
  if (opts.profile === 'continuous') return bricksAlongPath(points, { ...opts, closed: false }).bricks;
  const bands = BRUSH_PRESETS[settings.brushBandPreset] || BRUSH_PRESETS.stretcher_1;
  return bricksContourBands(strokePrimitives(points), bands, { ...opts, closed: false, centered: true }).bricks;
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
export const BRICK_SET_IDS = Object.freeze(BRICK_SETS.filter((s) => s.layout === 'bond').map((s) => s.id));
/** A Frame is rock when every band pattern is fieldstone (picking it on one band writes it on all). */
export function isRockFrame(settings) {
  const p = settings && settings.frameBandPatterns;
  return Array.isArray(p) && p.length > 0 && p.every((x) => x === 'fieldstone');
}
/** The set an element is laid with. */
export function elementSetId(settings, kind) {
  if (ROCK_SET_ID != null && ((kind === 'wall' && settings.pattern === 'fieldstone') || (kind === 'frame' && isRockFrame(settings)))) return ROCK_SET_ID;
  const own = settings.setIds && settings.setIds[kind];
  return own ?? settings.setId ?? BRICK_SET_IDS[0] ?? 1;
}
/** The settings an element is laid with: the shared ones, with that element's own set. */
export const elementSettings = (settings, kind) => ({ ...settings, setId: elementSetId(settings, kind) });

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
function _iconBricks(board, patternId, brickLengthIn, groutIn) {
  const { widthIn: w, heightIn: h } = board;
  const settings = { setId: 1, pattern: patternId, seed: 7, suppression: 0, clumping: 0, grout: { widthIn: groutIn }, brickLengthIn };
  const input = {
    boardOutline: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }],
    set: resolvedSetFor(settings), scale: scaleFor(settings), suppression: 0, clumping: 0, seed: settings.seed,
  };
  applyWallPattern(input, settings);
  return generateBricks(input).bricks;
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
  row2: { preset: 'stretcher_1', lengthIn: 2 * 0.82 },
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
// one argument only: it is passed straight to .map(), whose index must never reach the markup (a second
// `attrs` parameter once turned every pattern icon into `<polygon0 ...>` -- drawn as nothing, measured live)
const _iconPolygon = (b) => `<polygon points="${b.polygon.map((p) => `${+p.x.toFixed(3)},${+p.y.toFixed(3)}`).join(' ')}"/>`;

/** F35 item 15: a raised-accent preset's picker icon -- a stretcher wall laid by the real engine, with the
 *  bricks the preset's own rule raises (brick-accents.js accentedBrickIndices, the SAME rule the height
 *  mask applies) drawn dark with a drop shadow. The icon shows the preset's ZONE only (stretched to the
 *  whole icon), so the motif reads at icon size. A new ACCENT_PRESETS entry gets its icon for free. */
export const ACCENT_ICON_BOARD = Object.freeze({ widthIn: 3, heightIn: 1.5 });
const _accentIcons = new Map();
export function accentIconSvg(presetId, heightPx = 26) {
  const key = `${presetId}:${heightPx}`;
  if (_accentIcons.has(key)) return _accentIcons.get(key);
  const { widthIn: w, heightIn: h } = ACCENT_ICON_BOARD;
  const widthPx = Math.round((heightPx * w) / h);
  let svg = null;
  try {
    const bricks = _iconBricks(ACCENT_ICON_BOARD, 'stretcher', 0.36, 0.03);
    const raised = accentedBrickIndices(bricks, { preset: presetId }, { seed: 7, zone: [0, 1] });
    const flat = bricks.filter((b, k) => !raised.has(k)).map((b) => _iconPolygon(b)).join('');
    const up = bricks.filter((b, k) => raised.has(k));
    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
      + `<rect width="${w}" height="${h}" fill="#efe6da"/><g fill="#d07a5c">${flat}</g>`
      + `<g fill="#2b1a14" transform="translate(0.04 0.04)">${up.map((b) => _iconPolygon(b)).join('')}</g>`
      + `<g fill="#8e2f1c">${up.map((b) => _iconPolygon(b)).join('')}</g></svg>`;
  } catch (_) {
    svg = null;
  }
  _accentIcons.set(key, svg);
  return svg;
}

function applyWallPattern(input, settings) {
  const pattern = settings.pattern;
  const def = pattern && BRICK_PATTERNS[pattern];
  if (!def) return;
  if (def.kind === 'none') {
    input.skipWallFill = true;
  } else if (def.kind === 'tile2d') {
    input.set = { ...input.set, layout: pattern };
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

/** F35 item 15: shows which Wall bricks the raised accent lifts -- a dark outline + `data-brick-accent` on
 *  each, from the SAME rule the height mask applies (brick-accents.js accentedBrickIndices). 2D only. */
export const ACCENT_OUTLINE = Object.freeze({ color: '#ffc61a', widthIn: 0.05 }); // amber: reads against the photo's own dark joints
export function syncAccentHighlight(editor, accent, seed) {
  const nodes = wallBrickNodes(editor);
  const raised = accentedBrickIndices(nodes.map((n) => ({ polygon: _nodePolygon(n) })), accent, { seed: seed || 1 });
  nodes.forEach((n, k) => {
    if (raised.has(k)) {
      n.setAttribute('data-brick-accent', '1');
      n.setAttribute('stroke', ACCENT_OUTLINE.color);
      n.setAttribute('stroke-width', String(ACCENT_OUTLINE.widthIn));
    } else if (n.hasAttribute('data-brick-accent')) {
      n.removeAttribute('data-brick-accent');
      n.setAttribute('stroke', 'none');
      n.removeAttribute('stroke-width');
    }
  });
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
    if (!BRICK_RECORD_KINDS[kind]) continue;
    if (pointInPolygon(pt.x, pt.y, _nodePolygon(n))) return { id: n.getAttribute(BRICK_OWNER_ATTR), kind };
  }
  return null;
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
  for (const n of node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][${BRICK_OWNER_ATTR}="${elementId}"]`)) {
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

function _generateAndDraw(editor, settings, frameGeom, kinds = BRICK_KINDS) {
  const layer = ensureBricksLayer(editor);

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
  const exclusions = kinds.includes('wall') ? brushExclusions(editor) : [];
  if (exclusions.length) input.exclusions = exclusions;

  // Turn 195: the engine runs BEFORE anything is cleared -- if it throws, the bricks already on the
  // canvas stay exactly as they were (the caller reports the failure).
  const result = generateBricks(input);
  const bricks = result.exclusionsApplied ? result.bricks : dropExcludedWallBricks(result.bricks, exclusions);
  const { frameBricks } = result;
  for (const kind of kinds) clearGenerated(editor, layer, kind);
  applyBrickLayerTooling(layer, settings);
  const lays = (kind) => kinds.includes(kind);
  const owner = (kind) => ensureBrickRecord(editor, layer, kind); // item 22: the element that lays them
  if (lays('frame')) drawBricks(editor, layer, frameBricks, 'frame', frameSettings.setId, settings.seed, settings.reliefIn, owner('frame'));
  if (lays('wall')) drawBricks(editor, layer, bricks, 'wall', wallSettings.setId, settings.seed, settings.reliefIn, owner('wall'));
  if (lays('wall')) syncAccentHighlight(editor, settings.accent, settings.seed);
  return { wallCount: lays('wall') ? bricks.length : 0, frameCount: lays('frame') ? frameBricks.length : 0 };
}

/** `laidKey` (audit B1-B3): the caller's key for the settings this run lays. Item 22 step 3: it is stamped on
 *  each LAID element's record (BRICK_LAID_ATTR) BEFORE the undo commit, so every undo snapshot, the saved
 *  drawing and Cancel's restored document all carry the key of the bricks they hold. */
export function runBricks(editor, settings, frameGeom, { laidKey, kinds, amend } = {}) {
  const counts = _generateAndDraw(editor, settings, frameGeom, kinds);
  // item 22: each laid element's record keeps the settings it was laid with (its own, per element) and, from a
  // committed lay, the key of them (step 3). The record itself is what makes the element exist (audit B1: a Wall
  // the bands squeezed to zero bricks keeps its record, so the next lay brings it back).
  for (const kind of (kinds || BRICK_KINDS)) {
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
  const layer = ensureBricksLayer(editor);
  clearGenerated(editor, layer, 'wall');
  clearGenerated(editor, layer, 'frame');
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
  document.dispatchEvent(new CustomEvent('bricksGenerated', { detail: { groutWidthIn: settings.grout.widthIn } }));
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
    const layer = ensureBricksLayer(editor);
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
export function bricksForStroke(points, settings) {
  if (settings.strokeMode === 'grout') return [];
  const level = Number(settings.levelIn) || 0;
  const bricks = bricksForBrushStroke(points, settings, toBrickOpts(settings));
  return level ? bricks.map((b) => ({ ...b, heightOffset: (b.heightOffset || 0) + level })) : bricks;
}

export function regenerateOwnedBrickElements(editor) {
  if (!editor || !editor._sketchLayer) return;
  const layer = bricksLayerOf(editor);
  if (!layer) return;

  const children = editor._sketchLayer.children().toArray();
  const spineEls = children.filter((el) => el.attr(BRICK_ATTR) === SPINE_KIND);

  // audit C6: the striped runs' style cycle (the A/B/C picks + Use C) is an input too -- without it in the
  // fingerprint a pick change was skipped as "nothing changed" (measured live, turn 191)
  const stripeCycle = stripeCycleFor(editor._brickSettings && editor._brickSettings.stripeStyles, !!(editor._stripe && editor._stripe.three));
  const fingerprint = spineEls.map((el) => {
    const [a, b] = pieceEnds(el);
    return `${el.attr(BRICK_ELEMENT_ATTR)}|${a.x},${a.y},${b.x},${b.y}|${el.attr(STRIPE_ATTR) || ''}|${el.attr(BRICK_SETTINGS_ATTR) || ''}`;
  }).join(';') + `#${stripeCycle.map((v) => v.id).join(',')}`;
  if (fingerprint === _lastSpineFingerprint) return;
  _lastSpineFingerprint = fingerprint;

  const byElement = new Map();
  for (const el of spineEls) {
    const elementId = el.attr(BRICK_ELEMENT_ATTR);
    if (!elementId) continue;
    const [a, b] = pieceEnds(el);
    const settings = decodeBrickSettings(el.attr(BRICK_SETTINGS_ATTR));
    if (!settings) continue;
    const stripeId = el.attr(STRIPE_ATTR) || null;
    if (!byElement.has(elementId)) byElement.set(elementId, []);
    byElement.get(elementId).push({ a, b, stripeId, settings });
  }

  // only the BRUSH strokes' own bricks -- Wall/Frame bricks carry an owner too since item 22 (their record)
  children.filter((el) => el.attr(BRICK_OWNER_ATTR) && el.attr(BRICK_ATTR) === 'brush').forEach((el) => el.remove());

  for (const [elementId, segs] of byElement) {
    const chains = reconstructChains(segs);
    chains.forEach((chain, chainIdx) => {
      if (chain.points.length < 2) return;
      const settings = chain.cycleIndex == null
        ? chain.settings
        : settingsVariantForCycle(chain.settings, chain.cycleIndex, stripeCycle);
      const bricks = bricksForStroke(chain.points, settings);
      const ownerId = `${elementId}:${chainIdx}`;
      for (const b of bricks) {
        drawBrick(editor, layer, b, 'brush', settings.setId, settings.seed, settings.reliefIn).attr(BRICK_OWNER_ATTR, ownerId);
      }
    });
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('editorCommit', (e) => {
    regenerateOwnedBrickElements(e.detail && e.detail.editor);
  });
}

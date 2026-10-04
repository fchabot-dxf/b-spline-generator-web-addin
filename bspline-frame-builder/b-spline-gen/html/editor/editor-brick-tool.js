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
 * itself doesn't consult them. `grout.profile:'recessed'` is still accepted/
 * stored but has NO visual effect (joints simply sit at the base terrain
 * level, 'flush' -- a genuine carved recess needs a second, inverse-shaped
 * stamp layer at a negative depth, not built here; a named gap, not silent).
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
import { ensureActiveLayer, addLayer } from './layers.js';
import { commitEdit } from './editor-commit.js';
import { ramerDouglasPeucker } from './editor-curves.js';
import { pieceEnds } from './editor-cut-tool.js';
import { STRIPE_ATTR } from './editor-stripe-tool.js';
import { bricksAlongPath, bricksContourBands, generateBricks } from '../core/bricks/index.js';
import { brickSetById, BRICK_PATTERNS, BRUSH_PRESETS } from '../core/bricks/library.js';
import { brickFillPaint } from './editor-brick-surface.js';
import { cumulativeLengths, pointAtArcLength, inwardSignFor } from '../core/bricks/geometry.js';
import { radialSignAt } from '../core/bricks/arc-voussoir.js';

export const BRICK_ATTR = 'data-brick'; // 'brush' | 'wall' | 'frame' | 'brush-spine'
export const BRICK_GEN_ATTR = 'data-brick-gen'; // '1' on every adapter-drawn piece
export const BRICKS_LAYER_NAME = 'Bricks';

/** F35 item 5: the generic stamp-mask pipeline (main/stamp-mask-manager.js)
 *  checks this to route the Bricks layer through the brick-aware height-mask
 *  rasterizer (editor-brick-height-mask.js) instead of the generic SVG-mask
 *  one -- by NAME, matching ensureBricksLayer's own lookup (there's no
 *  reserved id scheme for named layers here). */
export function isBricksLayer(layer) {
  return !!layer && layer.name === BRICKS_LAYER_NAME;
}

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
  const existing = editor._layers.find((l) => l && l.name === BRICKS_LAYER_NAME);
  if (existing) return existing;
  return addLayer(editor, {
    name: BRICKS_LAYER_NAME,
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
  layer.carve = true;
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
function drawBrick(editor, layer, brick, kind, setId, seed, reliefIn) {
  const pts = brick.polygon.map((p) => `${p.x},${p.y}`).join(' ');
  const paint = brickFillPaint(editor, setId, brick.sampleId, brick.flip) || SET_COLORS[setId] || DEFAULT_BRICK_COLOR;
  return editor._sketchLayer
    .polygon(pts)
    .fill(paint)
    .stroke('none')
    .attr('data-layer', layer.id)
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

function drawBricks(editor, layer, bricks, kind, setId, seed, reliefIn) {
  for (const b of bricks) drawBrick(editor, layer, b, kind, setId, seed, reliefIn);
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
 *  Exported so main/brick-panel.js's own Frame-brick-length override (F35
 *  item 5 review) can start from the SAME resolved set Wall/Brush already
 *  use, instead of a second, independent `brickSetById` call that would
 *  silently drop the user's own current grout-width override. */
export function resolvedSetFor(settings) {
  const base = setForId(settings.setId);
  return { ...base, grout: { ...base.grout, widthIn: settings.grout.widthIn } };
}

function toBrickOpts(settings) {
  return {
    set: resolvedSetFor(settings),
    scale: settings.scale,
    suppression: settings.suppression,
    clumping: settings.clumping,
    seed: settings.seed,
    // F35 item 3: a Stripe run cycles this (settingsVariantForCycle below);
    // every pre-existing call site has no `profile` field at all, so this
    // keeps defaulting to bricksAlongPath's own 'bricks' -- no behavior
    // change for Wall/Frame or an un-striped Brush stroke.
    profile: settings.profile || 'bricks',
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
 *  which button the user clicked. `frameGeom` is `{path, cornerIndices,
 *  bands, arcSegments, set}` or null/undefined (no usable frame -- Wall
 *  alone fills the whole board, same as before Frame existed); its own
 *  `set` (main/brick-panel.js's resolveFrameBrickSet, F35 item 5 review) is
 *  a Frame-ONLY brick-length override, passed through generateBricks' own
 *  optional `frame.set` -- the `set` built here stays what Wall's own
 *  interior fill always used. */
export function runBricks(editor, settings, frameGeom) {
  const layer = ensureBricksLayer(editor);
  clearGenerated(editor, layer, 'wall');
  clearGenerated(editor, layer, 'frame');
  applyBrickLayerTooling(layer, settings);

  const input = {
    boardOutline: boardPolygon(editor),
    set: resolvedSetFor(settings),
    scale: settings.scale,
    suppression: settings.suppression,
    clumping: settings.clumping,
    seed: settings.seed,
  };
  if (frameGeom) input.frame = frameGeom;
  applyWallPattern(input, settings);

  const { bricks, frameBricks } = generateBricks(input);
  drawBricks(editor, layer, frameBricks, 'frame', settings.setId, settings.seed, settings.reliefIn);
  drawBricks(editor, layer, bricks, 'wall', settings.setId, settings.seed, settings.reliefIn);
  commitEdit(editor);
  notifyBricksGenerated(settings);
  return { wallCount: bricks.length, frameCount: frameBricks.length };
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

    const settings = editor._brickSettings;
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
  return editor._sketchLayer
    .line(a.x, a.y, b.x, b.y)
    .stroke({ color: '#aa4433', width: 0.06, linecap: 'round' })
    .attr('stroke-opacity', '0.15')
    .attr('data-layer', layer.id)
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
 *  colour). A declared cycle, not a hand-rolled toggle, so a future 3rd
 *  variant (Fred/advisor's own scale axis, or a real 3rd set once one
 *  exists) is one more array entry, not new branching logic. KNOWN,
 *  SCOPED-OUT gap (not silent): the user cannot yet PICK which variant each
 *  run gets -- the editor-stripe-tool.js panel's own A/B/C swatches are
 *  still generic colour pickers (meaningless for bricks); this cycle is
 *  purely automatic by the run's own position. Giving the user a real
 *  brick-thumbnail picker needs changes to that SHARED panel's own
 *  rendering, which touches every OTHER (non-brick) use of Stripe too --
 *  a separate, carefully-scoped follow-up, not attempted here. */
const STYLE_CYCLE = Object.freeze([
  { setId: 1, profile: 'bricks' },
  { setId: 3, profile: 'continuous' },
]);

function settingsVariantForCycle(baseSettings, cycleIndex) {
  const variant = STYLE_CYCLE[cycleIndex % STYLE_CYCLE.length];
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
export function regenerateOwnedBrickElements(editor) {
  if (!editor || !editor._sketchLayer) return;
  const layer = (editor._layers || []).find((l) => l && l.name === BRICKS_LAYER_NAME);
  if (!layer) return;

  const children = editor._sketchLayer.children().toArray();
  const spineEls = children.filter((el) => el.attr(BRICK_ATTR) === SPINE_KIND);

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

  children.filter((el) => el.attr(BRICK_OWNER_ATTR)).forEach((el) => el.remove());

  for (const [elementId, segs] of byElement) {
    const chains = reconstructChains(segs);
    chains.forEach((chain, chainIdx) => {
      if (chain.points.length < 2) return;
      const settings = chain.cycleIndex == null
        ? chain.settings
        : settingsVariantForCycle(chain.settings, chain.cycleIndex);
      const bricks = bricksForBrushStroke(chain.points, settings, toBrickOpts(settings));
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

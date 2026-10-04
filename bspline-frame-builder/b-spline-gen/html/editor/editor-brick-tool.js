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
 * TOOLING_DEFAULTS) -- `profile:'flat'` (core/stamp/profiles/flat.js: a
 * vertical wall + flat plateau at maxDepth, no taper) matches a brick's own
 * flat top far better than the generic vbit/ballnose stamp profiles, and
 * `edgeFilletRadius:0` keeps joints sharp. This reuses the EXISTING generic
 * SVG-rasterize-to-mask pipeline (main/stamp-mask-manager.js's own
 * updateStampMasks, which treats ANY carved layer's content this way,
 * regardless of what tool drew it) wholesale -- no bespoke brick-height
 * compositing code. KNOWN, NAMED SIMPLIFICATION (not a silent gap): every
 * brick renders at a UNIFORM depth (the layer's own `depth` field); the
 * engine's own per-brick `heightOffset` jitter and 'continuous' profile's
 * undulation (core/bricks/engine.js's sampleHeight, built for exactly this)
 * are NOT yet wired in -- that needs a brick-specific mask rasterizer
 * (sampleHeight + buildSpatialIndex per grid point) instead of the generic
 * SVG rasterizer, a real follow-up, not attempted here. Likewise
 * `grout.profile:'recessed'` is accepted/stored but has NO visual effect
 * yet (joints simply sit at the base terrain level, which is exactly
 * 'flush' -- a genuine carved recess needs a second, inverse-shaped stamp
 * layer at a negative depth, also not built here).
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
import { bricksAlongPath, generateBricks } from '../core/bricks/index.js';
import { brickSetById } from '../core/bricks/library.js';

export const BRICK_ATTR = 'data-brick'; // 'brush' | 'wall' | 'frame' | 'brush-spine'
export const BRICK_GEN_ATTR = 'data-brick-gen'; // '1' on every adapter-drawn piece
const BRICKS_LAYER_NAME = 'Bricks';

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

/** Draws one `{id, polygon:{x,y}[], ...}` brick as a filled polygon on
 *  `layer`, tagged per this file's own header convention. No stroke (a
 *  stroke would draw a visible line INSIDE the joint gaps between flush-
 *  fitting bricks, which core/bricks/ already sizes correctly via its own
 *  grout.widthIn -- adding our own outline would just redraw over that). */
function drawBrick(editor, layer, brick, kind) {
  const pts = brick.polygon.map((p) => `${p.x},${p.y}`).join(' ');
  return editor._sketchLayer
    .polygon(pts)
    .fill('#aa4433')
    .stroke('none')
    .attr('data-layer', layer.id)
    .attr(BRICK_ATTR, kind)
    .attr(BRICK_GEN_ATTR, '1');
}

function drawBricks(editor, layer, bricks, kind) {
  for (const b of bricks) drawBrick(editor, layer, b, kind);
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

function toBrickOpts(settings) {
  return {
    set: { ...setForId(settings.setId), grout: { ...setForId(settings.setId).grout, widthIn: settings.grout.widthIn } },
    scale: settings.scale,
    suppression: settings.suppression,
    clumping: settings.clumping,
    seed: settings.seed,
    // F35 item 3: a Stripe run cycles this (settingsVariantForCycle below);
    // every pre-existing call site has no `profile` field at all, so this
    // keeps defaulting to bricksAlongPath's own 'bricks' -- no behavior
    // change for Wall/Frame or an un-striped Brush stroke.
    profile: settings.profile || 'bricks',
  };
}

function setForId(id) {
  return brickSetById(id) || brickSetById(1);
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
 *  bands}` or null/undefined (no usable frame -- Wall alone fills the whole
 *  board, same as before Frame existed). */
export function runBricks(editor, settings, frameGeom) {
  const layer = ensureBricksLayer(editor);
  clearGenerated(editor, layer, 'wall');
  clearGenerated(editor, layer, 'frame');
  applyBrickLayerTooling(layer, settings);

  const set = { ...setForId(settings.setId), grout: { ...setForId(settings.setId).grout, widthIn: settings.grout.widthIn } };
  const input = {
    boardOutline: boardPolygon(editor),
    set,
    scale: settings.scale,
    suppression: settings.suppression,
    clumping: settings.clumping,
    seed: settings.seed,
  };
  if (frameGeom) input.frame = frameGeom;

  const { bricks, frameBricks } = generateBricks(input);
  drawBricks(editor, layer, frameBricks, 'frame');
  drawBricks(editor, layer, bricks, 'wall');
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

/** F35 item 3 (Fred: "stripe the spine into A/B/C runs, each run its own
 *  settings variant"): the one already-real 2-way distinction core/bricks/
 *  gives a Brush stroke today (no second declared BRICK_SETS entry exists
 *  yet to vary SET per run -- Set 2/3 are parked/empty, per library.js's own
 *  comments) is bricksAlongPath's own `profile` ('bricks' vs 'continuous').
 *  A declared cycle, not a hand-rolled toggle, so a future 3rd variant is
 *  one more array entry, not new branching logic. */
const STYLE_CYCLE = Object.freeze(['bricks', 'continuous']);

function settingsVariantForCycle(baseSettings, cycleIndex) {
  return { ...baseSettings, profile: STYLE_CYCLE[cycleIndex % STYLE_CYCLE.length] };
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
      const { bricks } = bricksAlongPath(chain.points, { ...toBrickOpts(settings), closed: false });
      const ownerId = `${elementId}:${chainIdx}`;
      for (const b of bricks) drawBrick(editor, layer, b, 'brush').attr(BRICK_OWNER_ATTR, ownerId);
    });
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('editorCommit', (e) => {
    regenerateOwnedBrickElements(e.detail && e.detail.editor);
  });
}

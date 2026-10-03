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
 */
import { ensureActiveLayer, addLayer } from './layers.js';
import { commitEdit } from './editor-commit.js';
import { bricksAlongPath, bricksFillShape, bricksContourBands } from '../core/bricks/index.js';
import { brickSetById } from '../core/bricks/library.js';

export const BRICK_ATTR = 'data-brick'; // 'brush' | 'wall' | 'frame'
export const BRICK_GEN_ATTR = 'data-brick-gen'; // '1' on every adapter-drawn piece
const BRICKS_LAYER_NAME = 'Bricks';

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
  };
}

function setForId(id) {
  return brickSetById(id) || brickSetById(1);
}

/** The Wall tool (button-driven, no drag): fills the whole board with
 *  bricks via bricksFillShape, replacing this tool's own prior output. */
export function runWallTool(editor, settings) {
  const layer = ensureBricksLayer(editor);
  clearGenerated(editor, layer, 'wall');
  applyBrickLayerTooling(layer, settings);
  const { bricks } = bricksFillShape(boardPolygon(editor), null, toBrickOpts(settings));
  drawBricks(editor, layer, bricks, 'wall');
  commitEdit(editor);
  return bricks.length;
}

/** The Frame tool (button-driven, no drag): contour bands along the
 *  CURRENT frame's own silhouette. `framePrimitives` is already a flat
 *  {x,y}[] polyline + cornerIndices (see primitivesToPolyline below) --
 *  callers resolve the actual frame contour (contour-from-frame.js's
 *  frameContourSilhouette) since that depends on frame state this module
 *  has no reason to import directly. */
export function runFrameTool(editor, settings, path, cornerIndices, bands) {
  const layer = ensureBricksLayer(editor);
  clearGenerated(editor, layer, 'frame');
  applyBrickLayerTooling(layer, settings);
  const { bricks } = bricksContourBands(path, bands, { ...toBrickOpts(settings), cornerIndices });
  drawBricks(editor, layer, bricks, 'frame');
  commitEdit(editor);
  return bricks.length;
}

/** primitives (contour-from-frame.js's own {type:'L'|'A', ...} loop) -> a
 *  flat {x,y}[] polyline + the indices of its real corners, exactly what
 *  bricksContourBands expects as (path, opts.cornerIndices). An 'L'
 *  primitive is already a straight edge (its own two endpoints are enough);
 *  an 'A' is subdivided into ARC_STEPS points so a curved frame edge still
 *  gets a reasonably smooth brick band, not one giant straight chord. */
const ARC_STEPS = 16;

export function primitivesToPolyline(primitives) {
  const points = [];
  const cornerIndices = [];
  for (const prim of primitives || []) {
    cornerIndices.push(points.length); // every primitive's own START is a declared corner
    if (prim.type === 'A') {
      for (let i = 0; i < ARC_STEPS; i++) {
        const t = prim.theta1 + (prim.dTheta * i) / ARC_STEPS;
        points.push({ x: prim.cx + prim.rx * Math.cos(t), y: prim.cy + prim.ry * Math.sin(t) });
      }
    } else {
      points.push({ x: prim.p0.x, y: prim.p0.y });
    }
  }
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
    const polyline = points.map(([x, y]) => ({ x, y }));
    const { bricks } = bricksAlongPath(polyline, { ...toBrickOpts(settings), closed: false });
    drawBricks(editor, layer, bricks, 'brush');
    commitEdit(editor);
  },
};

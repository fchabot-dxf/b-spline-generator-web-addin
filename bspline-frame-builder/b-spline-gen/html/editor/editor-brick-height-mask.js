/**
 * editor/editor-brick-height-mask.js — F35 item 5: the "brick-specific mask
 * rasterizer" editor-brick-tool.js's own header names as a real follow-up
 * ("the engine's own per-brick heightOffset jitter... are NOT yet wired in --
 * that needs a brick-specific mask rasterizer (sampleHeight + buildSpatialIndex
 * per grid point) instead of the generic SVG rasterizer"). Builds a mask in
 * the SAME {body,fillet,isStamped,metrics} shape core/stamp.js's own
 * rasterizeSvg returns, so main/stamp-mask-manager.js only needs a one-line
 * branch and core/engine/apply-stamp-layers.js's existing compositor needs
 * ZERO changes.
 *
 * Reads the Bricks layer's own CURRENT drawn polygons straight off the DOM
 * (the same authoritative source clearGenerated/regenerateOwnedBrickElements
 * already read/write), grouped by (set,seed,reliefIn) -- Wall/Frame's fire-
 * and-forget regime and Brush's own independently-regenerating elements can
 * each carry a DIFFERENT set/seed/relief snapshot (F35 item 3's own per-
 * element settings), so the DOM (every brick tagged at draw time -- see
 * editor-brick-tool.js's own drawBrick) is the only place that's always
 * current regardless of which tool drew what.
 */
import { buildSpatialIndex, sampleHeight, brickSetById, pointInPolygon } from '../core/bricks/index.js';
import { preloadSetDetail, sampleDetailAtFor } from './editor-brick-surface.js';
import { BRICK_GEN_ATTR } from './editor-brick-tool.js';
import { surfaceStyleById, styledSet, styledDetail, styleTopJitter } from './brick-surface-styles.js';

// F35 item 16 follow-up (Fred: "keep the UI responsive... yield between stages if they block the
// main thread"): at Masonry/Masonry max resolution this loop runs up to ~525,000 iterations fully
// synchronously (measured: shots/seatC/resolution_scale_grid.png) -- a plain setTimeout yield, same
// one-liner convention as core/engine/rebuild.js's own `yieldToMain`, inserted every N rows so the
// browser can actually paint a "Carving relief…" status and process input between chunks. Yielding
// changes nothing about the computed output, only how it's time-sliced -- every existing test on
// this function's own output still applies unchanged. No core/state.js import needed for a bare
// setTimeout (this file stays within the existing editor/-never-imports-core/state.js boundary).
const yieldToMain = () => new Promise((resolve) => setTimeout(resolve, 0));
const YIELD_EVERY_N_ROWS = 32;

function parsePoints(pointsAttr) {
  return (pointsAttr || '').trim().split(/\s+/).filter(Boolean).map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

/** Groups the Bricks layer's own live polygons by `${setId}:${seed}:${relief}`,
 *  reconstructing just enough of core/bricks/'s own brick shape
 *  ({id, polygon, sampleId, flip, heightOffset}) for buildSpatialIndex/
 *  sampleHeight to consume -- see this file's own header for why the DOM,
 *  not a parallel cache, is the source of truth here. */
function collectLiveBrickGroups(editor, layer) {
  const nodes = editor._sketchLayer.node.querySelectorAll(
    `[data-layer="${layer.id}"][${BRICK_GEN_ATTR}="1"]`,
  );
  const groups = new Map();
  nodes.forEach((n) => {
    const setId = Number(n.getAttribute('data-brick-set'));
    if (!Number.isFinite(setId)) return;
    const seed = Number(n.getAttribute('data-brick-seed')) || 1;
    const relief = Number(n.getAttribute('data-brick-relief')) || null;
    const key = `${setId}:${seed}:${relief}`;
    if (!groups.has(key)) groups.set(key, { setId, seed, relief, bricks: [] });
    groups.get(key).bricks.push({
      id: n.getAttribute('data-brick-id') || `${key}-${groups.get(key).bricks.length}`,
      polygon: parsePoints(n.getAttribute('points')),
      sampleId: n.getAttribute('data-brick-sample') || null,
      flip: n.getAttribute('data-brick-flip') === '1',
      heightOffset: Number(n.getAttribute('data-brick-height-offset')) || 0,
    });
  });
  return [...groups.values()];
}

/** Builds a {body,fillet,isStamped,metrics} mask -- body[k] here is
 *  sampleHeight's own absolute-inches result, NORMALISED by that group's own
 *  reliefIn so it reconstructs correctly through apply-stamp-layers.js's
 *  existing `body*layerDepth` formula (layer.depth stays plain inches,
 *  unchanged semantics -- see editor-brick-tool.js's applyBrickLayerTooling,
 *  which this file does NOT touch). `fillet` stays all-zero (bricks have no
 *  edge-fillet concept); `isStamped` follows body>0, matching every other
 *  rasterizer's own convention. */
/** F35 item 18 (1), brick top FLAT | ORGANIC: `opts.topMode === 'flat'` also returns
 *  `flatTop = { brickOf, count }` -- `brickOf[k]` = which brick covers grid point k (0..count-1),
 *  -1 for grout/outside. That is ALL Flat needs from here: the plane each brick sits on is fitted
 *  LATER, by core/engine/apply-stamp-layers.js, against the terrain as it is at THAT rebuild. Baking
 *  terrain heights into the mask instead would go stale: a terrain slider or a sculpt stroke
 *  rebuilds WITHOUT re-rasterizing masks (main/param-manager.js applyParam). body/isStamped are
 *  the same in both modes except that in Flat every point inside a brick counts as stamped, so a
 *  brick top never has a draped hole where its profile reaches 0. Organic: no flatTop, unchanged.
 *
 *  F35 item 18 (2): `opts.surfaceStyle` (brick-surface-styles.js; absent/unknown = Clean = exactly
 *  the set's own look) restyles every brick: heightProfile overrides on the set, pit contrast on the
 *  photo detail, an extra seeded per-brick top offset, and -- `jointDepthIn` -- JOINTS recessed below
 *  the ground: a non-brick point within one grout width (`opts.groutWidthIn`) of a brick, probed at
 *  the 4 axis offsets (any joint angle has one axis reaching across it). Elsewhere (no brick nearby)
 *  stays untouched, so the board outside the brickwork never sinks. */
export async function rasterizeBrickHeightMask(editor, layer, nx, nz, widthIn, heightIn, opts = {}) {
  const body = new Float32Array(nx * nz);
  const fillet = new Float32Array(nx * nz);
  const isStamped = new Uint8Array(nx * nz);
  const flat = opts.topMode === 'flat';
  const brickOf = flat ? new Int32Array(nx * nz).fill(-1) : null;
  const groups = collectLiveBrickGroups(editor, layer);
  if (!groups.length) return { body, fillet, isStamped, metrics: null, ...(flat ? { flatTop: { brickOf, count: 0 } } : {}) };

  await Promise.all(groups.map((g) => preloadSetDetail(g.setId)));

  const style = surfaceStyleById(opts.surfaceStyle);
  let brickCount = 0;
  const built = groups.map((g) => {
    const librarySet = brickSetById(g.setId) || brickSetById(1);
    const set = styledSet(g.relief ? { ...librarySet, reliefIn: g.relief } : librarySet, style);
    for (const b of g.bricks) b.heightOffset += styleTopJitter(style, g.seed, b.id);
    const cellSizeIn = Math.max(set.brickLengthIn || 1, set.brickHeightIn || 1) * 2;
    const base = brickCount;
    brickCount += g.bricks.length;
    return {
      set,
      index: buildSpatialIndex(g.bricks, cellSizeIn),
      result: { bricks: g.bricks, frameBricks: [], seed: g.seed },
      sampleDetailAt: styledDetail(sampleDetailAtFor(g.setId), style),
      // Flat: brick object -> its number across ALL groups (the brickOf value)
      brickNo: flat ? new Map(g.bricks.map((b, n) => [b, base + n])) : null,
    };
  });

  const jointDepthIn = style.jointDepthIn || 0;
  const reach = opts.groutWidthIn > 0 ? opts.groutWidthIn : ((built[0].set.grout && built[0].set.grout.widthIn) || 0.034);
  const inAnyBrick = (px, py) => built.some((g) => g.index.query(px, py).some((c) => pointInPolygon(px, py, c.polygon)));
  const isJoint = (x, y) => inAnyBrick(x + reach, y) || inAnyBrick(x - reach, y) || inAnyBrick(x, y + reach) || inAnyBrick(x, y - reach);
  // body is normalised by the depth the compositor multiplies it by (layer.depth), so the recess is
  // jointDepthIn DOWN for Raised and Carved alike
  const depthNorm = Number.isFinite(layer.depth) && Math.abs(layer.depth) > 1e-6 ? layer.depth : (built[0].set.reliefIn || 0.125);

  const iSpan = Math.max(1, nx - 1), jSpan = Math.max(1, nz - 1);
  for (let j = 0; j < nz; j++) {
    if (j > 0 && j % YIELD_EVERY_N_ROWS === 0) await yieldToMain();
    const y = heightIn * (1 - j / jSpan);
    for (let i = 0; i < nx; i++) {
      const x = (i / iSpan) * widthIn;
      const k = j * nx + i;
      for (const g of built) {
        if (flat) {
          // the SAME first-match order sampleHeight itself uses, so the brick found here is the one
          // whose profile sampleHeight returns
          const b = g.index.query(x, y).find((c) => pointInPolygon(x, y, c.polygon));
          if (!b) continue;
          brickOf[k] = g.brickNo.get(b);
          body[k] = sampleHeight(g.result, g.index, x, y, g.set, 0, g.sampleDetailAt) / (g.set.reliefIn || 1);
          isStamped[k] = 1;
          break;
        }
        const h = sampleHeight(g.result, g.index, x, y, g.set, 0, g.sampleDetailAt);
        if (h > 0) {
          body[k] = h / (g.set.reliefIn || 1);
          isStamped[k] = 1;
          break;
        }
      }
      if (jointDepthIn > 0 && !isStamped[k] && isJoint(x, y)) {
        body[k] = -jointDepthIn / depthNorm;
        isStamped[k] = 1;
      }
    }
  }
  return { body, fillet, isStamped, metrics: null, ...(flat ? { flatTop: { brickOf, count: brickCount } } : {}) };
}

/**
 * editor/brick-height-grey.js -- Fred, 2026-10-08 ("Yes, grey only"): the 2D editor shows bricks in greys from the
 * SAME height the 3D carves (core/bricks/height-grey.js HEIGHT_GREY_RAMP), per point, so each brick's relief (organic
 * top, wear, a raised accent, a Raised-brush level, the joint recess) reads like a black-and-white render of the carve.
 *
 * Source: each editor layer's cached brick mask (main/stamp-mask-manager.js sets `layer._brickMask` + `_brickDepth`;
 * editor-brick-height-mask.js builds it, with its own nx / nz). One <pattern> per layer, in board inches
 * (userSpaceOnUse over the board), holding that mask as a grey image; the layer's bricks -- and a grout with no colour
 * of its own -- are filled with it. Repainted on MASK UPDATES ONLY (stamp-mask-manager calls applyBrickHeightGreys
 * after a refresh), never per paint; the image is re-encoded only when a layer's mask object changed. Until a layer
 * has a mask (just after a lay) its bricks show NEUTRAL_BRICK_GREY.
 */
import { heightGreyPixels, NEUTRAL_BRICK_GREY } from '../core/bricks/height-grey.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const HEIGHT_GREY_DEFS_ATTR = 'data-brick-height-defs';
export const heightGreyPatternId = (layerId) => `brick-height-grey-${String(layerId).replace(/[^A-Za-z0-9_-]/g, '_')}`;
const _encoded = new WeakMap(); // mask object -> its image's data URL (the mask is replaced, never mutated, on a refresh)

function _svgRoot(editor) {
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  return node ? (node.ownerSVGElement || (node.closest && node.closest('svg'))) : null;
}
const _maskOf = (layer) => {
  const m = layer && layer._brickMask;
  return m && m.body && m.body.length && m.nx > 0 && m.nz > 0 && m.nx * m.nz === m.body.length ? m : null;
};

/** The default image encoder: RGBA pixels -> a PNG data URL (null where no canvas: a test DOM). */
export function canvasEncode(pixels, nx, nz) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = nx; cv.height = nz;
  const ctx = cv.getContext && cv.getContext('2d');
  if (!ctx || typeof ImageData === 'undefined') return null;
  ctx.putImageData(new ImageData(pixels, nx, nz), 0, 0);
  return cv.toDataURL('image/png');
}

/** The paint of layer `layerId`'s height greys, or null when it has none yet. */
export function heightGreyPaintFor(editor, layerId) {
  const root = _svgRoot(editor);
  const id = heightGreyPatternId(layerId);
  return root && root.querySelector(`#${id}`) ? `url(#${id})` : null;
}

/** Every editor layer's bricks repainted from its mask: the pattern made / refreshed, the fills pointed at it (a
 *  layer without a mask: neutral). `encode` is injectable for tests. Returns { layers, painted, encoded }. */
export function applyBrickHeightGreys(editor, { encode = canvasEncode } = {}) {
  const root = _svgRoot(editor);
  const node = editor && editor._sketchLayer && editor._sketchLayer.node;
  if (!root || !node) return { layers: 0, painted: 0, encoded: 0 };
  let defs = root.querySelector(`defs[${HEIGHT_GREY_DEFS_ATTR}]`);
  if (!defs) {
    defs = document.createElementNS(SVG_NS, 'defs');
    defs.setAttribute(HEIGHT_GREY_DEFS_ATTR, '1');
    root.insertBefore(defs, root.firstChild);
  }
  const W = Number(editor._mW) || 0, H = Number(editor._mH) || 0;
  let layers = 0, painted = 0, encoded = 0;
  for (const layer of editor._layers || []) {
    const id = heightGreyPatternId(layer.id);
    let pattern = defs.querySelector(`#${id}`);
    const mask = _maskOf(layer);
    let paint = NEUTRAL_BRICK_GREY;
    if (mask && W > 0 && H > 0) {
      let href = _encoded.get(mask);
      if (href === undefined) {
        href = encode(heightGreyPixels(mask.body, Number(layer._brickDepth) || 0, mask.nx, mask.nz), mask.nx, mask.nz);
        _encoded.set(mask, href);
        encoded++;
      }
      if (href) {
        if (!pattern) {
          pattern = document.createElementNS(SVG_NS, 'pattern');
          pattern.setAttribute('id', id);
          pattern.setAttribute('patternUnits', 'userSpaceOnUse');
          pattern.appendChild(document.createElementNS(SVG_NS, 'image'));
          defs.appendChild(pattern);
        }
        for (const [k, v] of [['x', 0], ['y', 0], ['width', W], ['height', H]]) pattern.setAttribute(k, String(v));
        const img = pattern.firstChild;
        for (const [k, v] of [['x', 0], ['y', 0], ['width', W], ['height', H], ['preserveAspectRatio', 'none']]) img.setAttribute(k, String(v));
        if (img.getAttribute('href') !== href) img.setAttribute('href', href);
        paint = `url(#${id})`;
        layers++;
      }
    }
    if (paint === NEUTRAL_BRICK_GREY && pattern) pattern.remove(); // no mask: no stale greys
    for (const el of node.querySelectorAll(`[data-brick-gen="1"][data-layer="${layer.id}"]`)) {
      if (el.hasAttribute('data-brick-set')) { el.setAttribute('fill', paint); painted++; continue; }
      // a grout with no colour of its own shows the joint's own depth (its node has no data-brick-set)
      if (el.getAttribute('data-brick') === 'grout') {
        const f = el.getAttribute('fill');
        if (!f || f === 'none' || f.startsWith('url(')) el.setAttribute('fill', paint === NEUTRAL_BRICK_GREY ? 'none' : paint);
      }
    }
  }
  return { layers, painted, encoded };
}

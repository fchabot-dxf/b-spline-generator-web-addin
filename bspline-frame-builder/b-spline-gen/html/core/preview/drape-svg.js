/**
 * SE11 — pure filter that decides which vector elements drape onto the
 * 3D relief. No Three.js, no canvas, no editor object: takes the layer
 * roster + an already-serialized sketch SVG string (editor.save()'s
 * output — a full `<svg viewBox="0 0 mW mH">` document, board-sized,
 * `data-layer` on every child) and returns a new SVG string of just the
 * qualifying elements, same viewBox. Rendering that string to a canvas
 * texture is the caller's job (core/preview/index.js) — this module only
 * decides WHAT gets drawn.
 *
 * Rule (Fred, SE11f final): draping is now INDEPENDENT of carving — a
 * layer's vectors drape when `visible && showColor` (T27's `showsColor`,
 * editor/layers.js), not `isCarved(l) && showColor` (SE11c/SE11e's rule).
 * Carving (`isCarved`) and painting (`showsColor`) are two separate
 * gates Fred can toggle independently: 3D off + palette on now paints
 * the drape flat on the un-carved relief instead of showing nothing.
 * Reads the rule through T27's own `showsColor` instead of re-stating
 * visible+showColor here — the one place the compound rule lives, per
 * that file's own header ("every gate... reads a layer through these,
 * never a raw check of its own, so the rule can't drift").
 */
import { showsColor } from '../../editor/layers.js';

function layerQualifies(layer) {
  return showsColor(layer);
}

/** An element's SE9 color: whichever of stroke/fill is real, stroke
 *  preferred — same read order as properties-shape.js's
 *  _currentElementColor, since it's the same "one color per element"
 *  fact being read back here. */
function elementColor(el) {
  const stroke = el.getAttribute('stroke');
  if (stroke && stroke !== 'none') return stroke.toLowerCase();
  const fill = el.getAttribute('fill');
  if (fill && fill !== 'none') return fill.toLowerCase();
  return null;
}

/**
 * @param {Array<{id:*, visible?:boolean, carve?:boolean, showColor?:boolean}>} editorLayers
 * @param {string} sketchSvg - editor.save()'s full SVG document string.
 * @returns {string} a board-sized SVG string of only the qualifying,
 *   coloured elements, or "" when nothing qualifies (caller treats that
 *   as "no drape" — the model looks exactly as today).
 */
export function buildDrapeSvg(editorLayers, sketchSvg) {
  if (!sketchSvg) return '';

  let doc;
  try {
    doc = new DOMParser().parseFromString(sketchSvg, 'image/svg+xml');
  } catch {
    return '';
  }
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror') return '';

  const qualifyingIds = new Set(
    (editorLayers || []).filter(layerQualifies).map(l => String(l.id))
  );
  if (qualifyingIds.size === 0) return '';

  const kept = [];
  for (const ch of Array.from(root.children)) {
    const lid = ch.getAttribute('data-layer');
    if (lid == null || !qualifyingIds.has(String(lid))) continue;
    const color = elementColor(ch);
    if (!color) continue;
    kept.push(ch);
  }
  if (kept.length === 0) return '';

  const viewBox = root.getAttribute('viewBox') || '0 0 1 1';
  const width = root.getAttribute('width') || '1';
  const height = root.getAttribute('height') || '1';
  const serializer = new XMLSerializer();
  const inner = kept.map(el => serializer.serializeToString(el)).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" preserveAspectRatio="none">${inner}</svg>`;
}

/**
 * SE11c: the drape appeared mirrored front↔back relative to the carve —
 * SE11's `texture.flipY = false` was set by reasoning about WebGL's UV
 * convention, not checked against anything, and got it backwards.
 * SE11c's FIRST attempt (also by reasoning, flipping the guess to `true`)
 * couldn't be trusted either — two wrong reasoning passes on the same
 * question is a sign to stop reasoning and go measure. Settled
 * EMPIRICALLY instead, with data, because Fusion itself was
 * session-suspended (an Autodesk account conflict, external to this
 * repo) and unavailable for a live screenshot: `scripts/smoke-editor.mjs`'s
 * `drape-align` mode draws the same asymmetric L (top + left strokes),
 * diffs the height field before/after to find the REAL carved vertices
 * (grounded in what the carve pipeline actually did, not a guess at
 * which cells the L "should" cover), and for each one reads the drape
 * texture colour at the pixel `sampleRowForV` below predicts — for BOTH
 * flipY values, plus each vertex's Y-mirrored counterpart as a control.
 * Result (isolating the confident carve core from the stamp's own edge
 * falloff, threshold 0.1 of 25521 cells): flipY=true → 100% of carved
 * vertices read red, only 66% of their mirrors do; flipY=false is the
 * exact inverse (66% real, 100% mirror — matching the mirror BETTER than
 * the real position, i.e. provably flipped). `true` is the one that
 * matches the real carve.
 *
 * Note for whoever next assumes "top-left SVG (y=0) must land at the
 * heightfield's j=0 row" (the earlier, plausible-sounding but apparently
 * incomplete reasoning behind the original `false`): this measurement
 * says otherwise — see sampleRowForV's own doc below. Something earlier
 * in the height-field pipeline (outside this module, not re-traced here)
 * evidently already flips j relative to SVG y; this constant just makes
 * the DRAPE agree with whatever that pipeline actually does, verified
 * against its real output rather than re-derived from its source.
 */
export const DRAPE_TEXTURE_FLIPY = true;

/**
 * Pure model of "given UV v, texture height texH, and flipY, which
 * texture row does the GPU sample" — NOT called by production code (the
 * GPU does the real sampling); exists so DRAPE_TEXTURE_FLIPY's
 * correctness is a checkable fact instead of a comment. The formula
 * itself is the one validated by the drape-align measurement above
 * (v=1 samples row 0 when flipY=true — the empirically-confirmed
 * mapping, not an independently re-derived WebGL spec reading).
 */
export function sampleRowForV(v, texH, flipY) {
  const rowFrac = flipY ? (1 - v) : v;
  return Math.round(rowFrac * (texH - 1));
}

/**
 * SE11e amend (Fred): the drape showed pale/white banding on steep
 * groove walls — a non-power-of-two drape canvas (the original
 * `nx * 4` / `nz * 4` sizing landed on ordinary numbers like 564×724)
 * silently disables WebGL mipmap generation for that texture, so a
 * steeply-angled wall (many texels compressed into one screen pixel)
 * falls back to a single, aliased sample instead of a properly
 * mip-filtered average — the exact "half-painted texel" symptom
 * reported. Rounding UP to the next power of two guarantees mipmaps
 * actually generate, in both WebGL1 and WebGL2, regardless of the
 * board's own grid resolution.
 */
export function nextPow2(n) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(1, n))));
}

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
 * Rule (Fred, ROADMAP "Layer toggles FINAL" + "👁 is the master"): a
 * layer's vectors drape when `visible && carve && showColor`. Seat B's
 * per-layer fields (T26/SE10, not landed yet) default to true when
 * missing, so an editor.js layer that predates them still drapes exactly
 * as before this rule existed.
 */

/** Pure-black elements are the advisor's declared default: an
 *  uncoloured layer (every element still #000000) doesn't cover the
 *  relief in black lines just because it's visible+carved. */
export const DRAPE_SKIP_COLORS = ['#000000'];

function layerQualifies(layer) {
  if (!layer) return false;
  const visible = layer.visible !== false;
  const carve = layer.carve !== false;
  const showColor = layer.showColor !== false;
  return visible && carve && showColor;
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
    if (!color || DRAPE_SKIP_COLORS.includes(color)) continue;
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

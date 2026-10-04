/**
 * editor/frame-template-icon.js -- F35 (advisor turn 203, Fred: "icons from the engine"): a frame
 * template's small icon, DRAWN from the template's own outline by the frame engine (frameCutProfile =
 * the outer edge, frameInnerProfile = the bars' inner edge), never a hand-made image -- a new template
 * gets its icon for free. Drawn at the default portrait board (Fred: portrait only) with the template's
 * declared default parameters, as one even-odd path, so the frame reads as a ring.
 */
import { normalizeFrameRecord } from '../core/frame-record.js';
import { frameCutProfile, frameInnerProfile } from './editor-frame-profile.js';
import { primitivesToPathD } from './editor-shape-lattice-generator.js';

export const TEMPLATE_ICON_BOARD = Object.freeze({ widthIn: 7, heightIn: 9 });
const _cache = new Map();

/** SVG markup for `templateId`'s icon (`size` px tall), or null for none / an outline that won't draw. */
export function templateIconSvg(defs, templateId, size = 28) {
  if (!templateId) return null;
  const key = `${templateId}:${size}`;
  if (_cache.has(key)) return _cache.get(key);
  let svg = null;
  try {
    const record = normalizeFrameRecord({ templateId }, defs);
    const outer = frameCutProfile(defs, record, TEMPLATE_ICON_BOARD);
    if (outer && outer.pathD) {
      const inner = frameInnerProfile(defs, record, TEMPLATE_ICON_BOARD);
      const innerD = inner && inner.primitives && inner.primitives.length ? primitivesToPathD(inner.primitives) : '';
      const { widthIn: w, heightIn: h } = TEMPLATE_ICON_BOARD;
      const width = Math.round((size * w) / h);
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
        + `<path d="${outer.pathD} ${innerD}" fill="#b07a4a" fill-rule="evenodd" stroke="#5c3d22" stroke-width="0.12"/></svg>`;
    }
  } catch (_) {
    svg = null;
  }
  _cache.set(key, svg);
  return svg;
}

/** Fred (turn 207): the NO-frame choice reads 'Rectangle' and shows the board's own outline -- a plain
 *  rectangle drawn in the same box, colours and stroke as the template icons (no bars: there is no frame). */
export function boardOutlineIconSvg(size = 28) {
  const { widthIn: w, heightIn: h } = TEMPLATE_ICON_BOARD;
  const width = Math.round((size * w) / h);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${size}" viewBox="0 0 ${w} ${h}" aria-hidden="true">`
    + `<rect x="0.3" y="0.3" width="${w - 0.6}" height="${h - 0.6}" fill="none" stroke="#5c3d22" stroke-width="0.4"/></svg>`;
}

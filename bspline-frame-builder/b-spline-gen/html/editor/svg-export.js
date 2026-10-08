/**
 * editor/svg-export.js -- F35 item 56: the SVG DOWNLOAD as a drawing (Fred: bricks are also a print / plot output).
 *
 * ONE file, its top-level groups declared once (SVG_EXPORT_GROUPS), each a named layer Illustrator / Inkscape list
 * (id + inkscape:label + inkscape:groupmode="layer"), stacked as the user arranged the LAYERS panel (advisor ruling):
 * the frame at the bottom, then each layer bottom to top -- its art, then each brick element on it (its bricks, its
 * grout) -- so art over or under bricks is whatever the roster says:
 *   frame  -- the frame's band (its wood colour), cut profile, inner edge and miters (editor-frame-profile.js
 *             frameVectorParts: the same parts the canvas draws);
 *   art    -- one sub-group per layer that holds art, in roster order; hidden layers included (turn 207 AMEND-3:
 *             hidden is display only, every layer exports);
 *   bricks -- one sub-group per brick ELEMENT (a Wall, a Frame, a wall area, a Brush stroke), each brick ONE filled
 *             path, its piece id kept (`<owner>:<data-brick-id>`);
 *   grout  -- one sub-group per element with a grout shape: its path (`<element>:grout`, even-odd), filled with its
 *             colour, or no fill for None.
 * The brick STYLE is declared (SVG_BRICK_EXPORT): 'grey' (the default and the only one exposed; Fred 2026-10-08,
 * "Yes, grey only" -- the old set-colour 'flat' style is gone) paints each brick ONE flat grey from its face height
 * (core/bricks/height-grey.js, the same ramp the 2D editor shows per point), its face inset by its element's Edge
 * (exact here, unlike the canvas). The face height is the one the carve uses: each layer's cached brick mask
 * (`_brickMask.faces`, editor-brick-height-mask.js -- Level, accents and style jitter applied; signed by the layer's
 * Raised / Carved depth); a brick laid since the last mask refresh is the neutral grey. A grout keeps its own colour;
 * without one it is the grey of its joints' height (Fred: "different greys for grout and brick"; the mask's `jointIn`).
 * Everything is read off the drawing and its layers' cached masks (as the height mask itself is): no app state.
 */
import { isBrickToolNode, BRICK_RECORD_ATTR, BRICK_OWNER_ATTR, BRICK_ELEMENT_ATTR } from './layers.js';
import { GROUT_INSET_ATTR } from './editor-brick-tool.js';
import { insetFace } from '../core/bricks/grout-shape.js';
import { greyOfHeight, NEUTRAL_BRICK_GREY, NEUTRAL_GROUT_GREY } from '../core/bricks/height-grey.js';
import { frameVectorParts } from './editor-frame-profile.js';
import { stripSvgjsAttributes } from '../core/svg-utils.js';

/** The brick styles a download can take. `available: false` = declared, not built yet. */
export const SVG_BRICK_EXPORT = Object.freeze({
  styles: Object.freeze({
    outline: Object.freeze({ label: 'Outlines', fill: 'none', stroke: '#000000', strokeWidthIn: 0.01 }),
    grey: Object.freeze({ label: 'Grey by height', fill: 'heightGrey' }),
    // the photo samples as embedded patterns: not built (each brick's pattern would have to travel in the file)
    textured: Object.freeze({ label: 'Textured', fill: 'pattern', available: false }),
  }),
  default: 'grey',
  exposed: Object.freeze(['grey']),
});

/** The file's group kinds. `place`: 'bottom' = once, under everything; 'layer' = at its layer's position in the roster
 *  (editor._layers, bottom to top), in this order within a layer. `per`: one group per layer / per brick element. */
export const SVG_EXPORT_GROUPS = Object.freeze([
  Object.freeze({ id: 'frame', label: 'Frame', place: 'bottom' }),
  Object.freeze({ id: 'art', label: 'Art', place: 'layer', per: 'layer' }),
  Object.freeze({ id: 'bricks', label: 'Bricks', place: 'layer', per: 'element' }),
  Object.freeze({ id: 'grout', label: 'Grout', place: 'layer', per: 'element' }),
]);
export const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

const _esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _f = (v) => +Number(v).toFixed(4);
/** A named layer group: `<g id inkscape:groupmode="layer" inkscape:label>`. */
export const layerGroup = (id, label, inner) => `<g id="${_esc(id)}" inkscape:groupmode="layer" inkscape:label="${_esc(label)}">${inner}</g>`;

const _points = (n) => (n.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number)
  .reduce((acc, v, i, a) => (i % 2 ? acc : [...acc, { x: v, y: a[i + 1] }]), []);
const _pathD = (poly) => `M${poly.map((p) => `${_f(p.x)},${_f(p.y)}`).join('L')}Z`;

function _frameGroup(editor) {
  const parts = frameVectorParts(editor);
  if (!parts) return '';
  const stroke = (d, w, cls) => `<path class="${cls}" d="${d}" fill="none" stroke="${parts.stroke}" stroke-width="${w}"/>`;
  let inner = '';
  if (parts.innerD) inner += `<path class="frame-band" d="${parts.outlineD} ${parts.innerD}" fill="${parts.wood}" fill-rule="evenodd"/>`;
  if (parts.innerD) inner += stroke(parts.innerD, 0.025, 'frame-inner-edge');
  for (const m of parts.miters) inner += stroke(m, 0.025, 'frame-miter');
  inner += stroke(parts.outlineD, 0.04, 'frame-cut-profile');
  return inner;
}

/** One layer's art nodes (no brick-tool node, no record), or [] -- in drawing order. */
function _artNodes(editor, layer) {
  return [...editor._sketchLayer.node.children].filter((n) => String(n.getAttribute('data-layer')) === String(layer.id)
    && !isBrickToolNode(n) && !n.hasAttribute(BRICK_RECORD_ATTR));
}

/** The brick elements on the drawing, in drawing order: [{ id, kind, label, bricks: [node], grout: node|null }]. */
export function brickElementsOf(editor) {
  const root = editor._sketchLayer.node;
  const byId = new Map();
  for (const n of root.querySelectorAll('[data-brick-gen="1"]')) {
    const kind = n.getAttribute('data-brick');
    const owner = n.getAttribute(BRICK_OWNER_ATTR) || `${kind}`;
    const id = owner.split(':')[0];
    if (!byId.has(id)) byId.set(id, { id, kind: null, bricks: [], grout: null });
    const el = byId.get(id);
    if (kind === 'grout') el.grout = n;
    else { el.bricks.push(n); el.kind = el.kind || kind; }
  }
  const counts = {};
  const isArea = (id) => !!root.querySelector(`[${BRICK_RECORD_ATTR}="wall-area"][${BRICK_ELEMENT_ATTR}="${id}"]`);
  return [...byId.values()].filter((e) => e.bricks.length).map((e) => {
    const base = e.kind === 'wall' ? (isArea(e.id) ? 'Wall area' : 'Wall') : e.kind === 'frame' ? 'Frame' : 'Brush stroke';
    counts[base] = (counts[base] || 0) + 1;
    return { ...e, label: base === 'Wall' || base === 'Frame' ? base : `${base} ${counts[base]}` };
  });
}

/** Each brick's face height (inches, signed by its layer's Raised / Carved depth), keyed `<owner or kind>:<id>`, from
 *  every layer's cached brick mask. */
function _faceHeights(editor) {
  const out = new Map();
  for (const l of editor._layers || []) {
    const faces = l && l._brickMask && l._brickMask.faces;
    if (!faces) continue;
    const sign = Number(l._brickDepth) < 0 ? -1 : 1;
    for (const [k, h] of Object.entries(faces)) out.set(k, sign * h);
  }
  return out;
}

function _groutGrey(editor, layerId) {
  const l = (editor._layers || []).find((x) => x && String(x.id) === String(layerId));
  const j = l && l._brickMask ? l._brickMask.jointIn : null;
  return Number.isFinite(j) ? greyOfHeight((Number(l._brickDepth) < 0 ? -1 : 1) * j) : NEUTRAL_GROUT_GREY;
}

function _brickPath(n, inset, style, faceHeights) {
  const face = insetFace(_points(n), inset);
  if (!face) return ''; // an Edge that swallows the brick: no face, all joint
  const owner = n.getAttribute(BRICK_OWNER_ATTR) || n.getAttribute('data-brick');
  const brickId = n.getAttribute('data-brick-id') || '';
  const setId = n.getAttribute('data-brick-set') || '';
  const h = faceHeights.get(`${owner}:${brickId}`);
  const paint = style.fill === 'heightGrey'
    ? `fill="${h === undefined ? NEUTRAL_BRICK_GREY : greyOfHeight(h)}"`
    : `fill="none" stroke="${style.stroke}" stroke-width="${style.strokeWidthIn}"`;
  return `<path id="${_esc(`${owner}:${brickId}`)}" data-brick-id="${_esc(brickId)}" data-brick-set="${_esc(setId)}" d="${_pathD(face)}" ${paint}/>`;
}

/** Every group's markup for a download in `styleId` (SVG_BRICK_EXPORT), stacked per SVG_EXPORT_GROUPS. */
export function svgDownloadGroups(editor, styleId = SVG_BRICK_EXPORT.default) {
  const style = SVG_BRICK_EXPORT.styles[styleId];
  if (!style || style.available === false) throw new Error(`SVG download style "${styleId}" is not available`);
  const elements = editor._sketchLayer ? brickElementsOf(editor) : [];
  const faceHeights = _faceHeights(editor);
  const layerOf = (e) => String(e.bricks[0].getAttribute('data-layer'));
  const roster = (editor._layers || []).map((l) => String(l.id));
  const groupFor = {
    art: (layer) => {
      const nodes = _artNodes(editor, layer);
      return nodes.length ? [layerGroup(`art:${layer.id}`, layer.name || `Layer ${layer.id}`, stripSvgjsAttributes(nodes.map((n) => n.outerHTML).join('')))] : [];
    },
    bricks: (layer) => elements.filter((e) => layerOf(e) === String(layer.id)).map((e) => {
      const inset = e.grout ? Number(e.grout.getAttribute(GROUT_INSET_ATTR)) || 0 : 0;
      return layerGroup(`bricks:${e.id}`, e.label, e.bricks.map((n) => _brickPath(n, inset, style, faceHeights)).join(''));
    }),
    grout: (layer) => elements.filter((e) => e.grout && layerOf(e) === String(layer.id)).map((e) => {
      const g = e.grout;
      // a grout colour of its own wins; none (on the canvas: the height greys, a url into the editor's defs) = the grey of
      // its joints' height on its layer, signed by Raised / Carved
      const own = g.getAttribute('fill');
      const fill = own && own !== 'none' && !own.startsWith('url(') ? own : _groutGrey(editor, g.getAttribute('data-layer'));
      return layerGroup(`grout:${e.id}`, `${e.label} grout`, `<path id="${_esc(g.getAttribute('id') || `${e.id}:grout`)}" d="${g.getAttribute('d') || ''}" fill="${fill}" fill-rule="evenodd"/>`);
    }),
  };
  const out = [];
  for (const kind of SVG_EXPORT_GROUPS.filter((k) => k.place === 'bottom')) {
    if (kind.id === 'frame') { const f = _frameGroup(editor); if (f) out.push(layerGroup('frame', kind.label, f)); }
  }
  // the roster, bottom to top; an element on a layer the roster lacks goes on top (never dropped)
  const layers = [...(editor._layers || []), ...[...new Set(elements.map(layerOf))].filter((id) => !roster.includes(id)).map((id) => ({ id, name: `Layer ${id}` }))];
  for (const layer of layers) {
    for (const kind of SVG_EXPORT_GROUPS.filter((k) => k.place === 'layer')) out.push(...groupFor[kind.id](layer));
  }
  return out.join('');
}

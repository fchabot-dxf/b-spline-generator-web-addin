/**
 * editor/svg-export.js -- F35 item 56: the SVG DOWNLOAD as a drawing (Fred: bricks are also a print / plot output).
 *
 * ONE file, its top-level groups declared once (SVG_EXPORT_GROUPS), each a named layer Illustrator / Inkscape list
 * (id + inkscape:label + inkscape:groupmode="layer"):
 *   frame  -- the frame's band (its wood colour), cut profile, inner edge and miters (editor-frame-profile.js
 *             frameVectorParts: the same parts the canvas draws);
 *   art    -- one sub-group per layer that holds art, in roster order; hidden layers included (turn 207 AMEND-3:
 *             hidden is display only, every layer exports);
 *   bricks -- one sub-group per brick ELEMENT (a Wall, a Frame, a wall area, a Brush stroke), each brick ONE filled
 *             path, its piece id kept (`<owner>:<data-brick-id>`);
 *   grout  -- one sub-group per element with a grout shape: its path (`<element>:grout`, even-odd), filled with its
 *             colour, or no fill for None.
 * The brick STYLE is declared (SVG_BRICK_EXPORT): 'flat' (the default and the only one exposed) paints each brick in
 * its set's declared faceColor (library.js), its face inset by its element's Edge (exact here, unlike the canvas); the
 * photo fill patterns live outside the drawing, which is why the old download's bricks rendered black / empty
 * elsewhere (seat C's measurement: 151 fills pointing at 0 embedded patterns).
 * Everything is read off the drawing (the DOM is the source of truth, as for the height mask): no app state.
 */
import { isBrickToolNode, BRICK_RECORD_ATTR, BRICK_OWNER_ATTR, BRICK_ELEMENT_ATTR } from './layers.js';
import { GROUT_INSET_ATTR } from './editor-brick-tool.js';
import { insetFace } from '../core/bricks/grout-shape.js';
import { BRICK_SETS } from '../core/bricks/library.js';
import { frameVectorParts } from './editor-frame-profile.js';
import { stripSvgjsAttributes } from '../core/svg-utils.js';

/** The brick styles a download can take. `available: false` = declared, not built yet. */
export const SVG_BRICK_EXPORT = Object.freeze({
  styles: Object.freeze({
    outline: Object.freeze({ label: 'Outlines', fill: 'none', stroke: '#000000', strokeWidthIn: 0.01 }),
    flat: Object.freeze({ label: 'Flat colours', fill: 'faceColor' }),
    // the photo samples as embedded patterns: not built (each brick's pattern would have to travel in the file)
    textured: Object.freeze({ label: 'Textured', fill: 'pattern', available: false }),
  }),
  default: 'flat',
  exposed: Object.freeze(['flat']),
});

/** The file's top-level groups, bottom to top. `per`: what each sub-group is. */
export const SVG_EXPORT_GROUPS = Object.freeze([
  Object.freeze({ id: 'frame', label: 'Frame' }),
  Object.freeze({ id: 'art', label: 'Art', per: 'layer' }),
  Object.freeze({ id: 'bricks', label: 'Bricks', per: 'element' }),
  Object.freeze({ id: 'grout', label: 'Grout', per: 'element' }),
]);
export const INKSCAPE_NS = 'http://www.inkscape.org/namespaces/inkscape';

const _esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const _f = (v) => +Number(v).toFixed(4);
/** A named layer group: `<g id inkscape:groupmode="layer" inkscape:label>`. */
export const layerGroup = (id, label, inner) => `<g id="${_esc(id)}" inkscape:groupmode="layer" inkscape:label="${_esc(label)}">${inner}</g>`;

const FACE_COLORS = Object.freeze(Object.fromEntries(BRICK_SETS.map((s) => [s.id, s.faceColor])));
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

function _artGroups(editor) {
  const root = editor._sketchLayer.node;
  const out = [];
  for (const layer of editor._layers || []) {
    const nodes = [...root.children].filter((n) => String(n.getAttribute('data-layer')) === String(layer.id)
      && !isBrickToolNode(n) && !n.hasAttribute(BRICK_RECORD_ATTR));
    if (!nodes.length) continue;
    out.push(layerGroup(`art:${layer.id}`, layer.name || `Layer ${layer.id}`, stripSvgjsAttributes(nodes.map((n) => n.outerHTML).join(''))));
  }
  return out.join('');
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

function _brickPath(n, inset, style) {
  const face = insetFace(_points(n), inset);
  if (!face) return ''; // an Edge that swallows the brick: no face, all joint
  const owner = n.getAttribute(BRICK_OWNER_ATTR) || n.getAttribute('data-brick');
  const brickId = n.getAttribute('data-brick-id') || '';
  const setId = n.getAttribute('data-brick-set') || '';
  const paint = style.fill === 'faceColor'
    ? `fill="${FACE_COLORS[Number(setId)] || FACE_COLORS[1]}"`
    : `fill="none" stroke="${style.stroke}" stroke-width="${style.strokeWidthIn}"`;
  return `<path id="${_esc(`${owner}:${brickId}`)}" data-brick-id="${_esc(brickId)}" data-brick-set="${_esc(setId)}" d="${_pathD(face)}" ${paint}/>`;
}

/** The four groups' markup for a download in `styleId` (SVG_BRICK_EXPORT). */
export function svgDownloadGroups(editor, styleId = SVG_BRICK_EXPORT.default) {
  const style = SVG_BRICK_EXPORT.styles[styleId];
  if (!style || style.available === false) throw new Error(`SVG download style "${styleId}" is not available`);
  const elements = editor._sketchLayer ? brickElementsOf(editor) : [];
  const bodies = {
    frame: () => _frameGroup(editor),
    art: () => _artGroups(editor),
    bricks: () => elements.map((e) => {
      const inset = e.grout ? Number(e.grout.getAttribute(GROUT_INSET_ATTR)) || 0 : 0;
      return layerGroup(`bricks:${e.id}`, e.label, e.bricks.map((n) => _brickPath(n, inset, style)).join(''));
    }).join(''),
    grout: () => elements.filter((e) => e.grout).map((e) => {
      const g = e.grout;
      const fill = g.getAttribute('fill') && g.getAttribute('fill') !== 'none' ? g.getAttribute('fill') : 'none';
      return layerGroup(`grout:${e.id}`, `${e.label} grout`, `<path id="${_esc(g.getAttribute('id') || `${e.id}:grout`)}" d="${g.getAttribute('d') || ''}" fill="${fill}" fill-rule="evenodd"/>`);
    }).join(''),
  };
  return SVG_EXPORT_GROUPS.map((grp) => layerGroup(grp.id, grp.label, bodies[grp.id]())).join('');
}

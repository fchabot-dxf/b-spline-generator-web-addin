/**
 * F35 item 31b: the pattern builder at 1/2 and 1/4 brick. A Wall accent tile at a fraction of a brick lays through the
 * engine's accentCuts (seat B T86-26): the bricks are CUT at the tile's cells, every piece comes back accentMarked, the
 * mark is kept on the drawn brick (editor-only), and the 2D outline + the height mask read it. Unit 1 / a preset / no
 * accent send no key (today's lay, byte-identical). Real engine, fake editor (as wall-areas).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-surface.js', () => ({ preloadSetDetail: vi.fn(async () => {}), sampleDetailAtFor: vi.fn(() => undefined), brickFillPaint: vi.fn(() => null) }));
const engineOpts = vi.hoisted(() => ({ without: [] })); // the mock-base rule: both states of 'accentCuts'
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, get ENGINE_OPTIONS() { return actual.ENGINE_OPTIONS.filter((o) => !engineOpts.without.includes(o)); } };
});

import { runBricks, syncAccentHighlight, BRICK_GEN_ATTR, ACCENT_OUTLINE, ACCENT_FLAG_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { stripEditorOnlyBrickAttrs } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { buildDrapeSvg } from '../bspline-frame-builder/b-spline-gen/html/core/preview/drape-svg.js';
import { accentCutsFor, accentedBrickIndices, ACCENT_MARK_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/brick-accents.js';
import { rasterizeBrickHeightMask } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js';
import { BRICK_EDITOR_ONLY_ATTRS } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
    addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c),
    fill: () => api, stroke: () => api }; return api; };
  const svgEl = (tag) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return el; };
  return {
    _draw: {}, _mW: 7, _mH: 9, _activeLayer: '0', _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _sketchLayer: { node, children: () => Object.assign([], { toArray: () => [] }) /* svg.js: an array (item 64: a kind layer runs addLayer) */,
      group: () => wrap(svgEl('g')), polygon: (pts) => { const el = svgEl('polygon'); el.setAttribute('points', pts); return wrap(el); }, path: (d) => { const el = svgEl('path'); el.setAttribute('d', d); return wrap(el); } },
  };
}
// a 2 x 4 tile at 1/2 brick: row 0 (the bottom course) marks cells 0-1 (one brick-length), row 1 marks cell 1 only (a half)
const TILE = { rows: 2, cols: 4, cells: [[true, true, false, false], [false, true, false, false]] };
const tileAccent = (unit) => ({ preset: 'tile', tile: { ...TILE, unit, base: 'stretcher' }, levelIn: 0.0625, clicks: [] });
const S = (accent) => ({ ...P.brickSettings, pattern: 'stretcher', wallRotationDeg: 0, accent });
const wallNodes = (ed) => [...ed._sketchLayer.node.querySelectorAll(`[${BRICK_GEN_ATTR}="1"][data-brick="wall"]`)];
const widthOf = (n) => { const xs = n.getAttribute('points').trim().split(/\s+/).map((p) => Number(p.split(',')[0])); return Math.max(...xs) - Math.min(...xs); };
beforeEach(() => { engineOpts.without = []; });

describe('31b: accentCutsFor -- the engine input, declared once', () => {
  it('a tile at 1/2 or 1/4 -> { unit, tile }; unit 1, a preset, none -> null (no key)', () => {
    expect(accentCutsFor(tileAccent(0.5))).toEqual({ unit: 0.5, tile: { rows: 2, cols: 4, cells: TILE.cells } });
    expect(accentCutsFor(tileAccent(0.25)).unit).toBe(0.25);
    expect(accentCutsFor(tileAccent(1))).toBeNull();
    expect(accentCutsFor({ preset: 'checker' })).toBeNull();
    expect(accentCutsFor({ preset: 'none' })).toBeNull();
    expect(accentCutsFor(undefined)).toBeNull();
  });
  it('the mark is editor-only: never baked into Send / the download', () => {
    expect(BRICK_EDITOR_ONLY_ATTRS.wall).toContain(ACCENT_MARK_ATTR);
  });
});

describe('31b: the wall lays CUT at 1/2 (real engine)', () => {
  it('unit 1/2: bricks cut at the cells, every wall piece carries the engine mark, the outline = exactly the marked ones', () => {
    const ed = fakeEditor();
    runBricks(ed, S(tileAccent(0.5)), null);
    const nodes = wallNodes(ed);
    expect(nodes.length).toBeGreaterThan(50);
    expect(nodes.every((n) => ['0', '1'].includes(n.getAttribute(ACCENT_MARK_ATTR)))).toBe(true);
    const marked = nodes.filter((n) => n.getAttribute(ACCENT_MARK_ATTR) === '1');
    expect(marked.length).toBeGreaterThan(5);
    // row 1 marks one cell: a half-brick piece (the whole brick there was cut in two)
    const L = Math.max(...nodes.map(widthOf));
    expect(nodes.some((n) => widthOf(n) < 0.55 * L && widthOf(n) > 0.3 * L)).toBe(true);
    expect(syncAccentHighlight(ed, tileAccent(0.5), 1)).toBe(marked.length);
    expect(nodes.filter((n) => n.getAttribute('data-brick-accent') === '1')).toEqual(marked);
  });
  it('unit 1: no cut, no mark -- the same bricks as no accent (byte-identical lay)', () => {
    const a = fakeEditor(), b = fakeEditor();
    runBricks(a, S(tileAccent(1)), null);
    runBricks(b, S({ preset: 'none', levelIn: 0.0625, clicks: [] }), null);
    expect(wallNodes(a).map((n) => n.getAttribute('points'))).toEqual(wallNodes(b).map((n) => n.getAttribute('points')));
    expect(wallNodes(a).some((n) => n.hasAttribute(ACCENT_MARK_ATTR))).toBe(false);
  });
  it('hidden until the engine lists accentCuts: no key sent, whole bricks', () => {
    engineOpts.without = ['accentCuts'];
    const a = fakeEditor(), b = fakeEditor();
    runBricks(a, S(tileAccent(0.5)), null);
    runBricks(b, S({ preset: 'none', levelIn: 0.0625, clicks: [] }), null);
    expect(wallNodes(a).map((n) => n.getAttribute('points'))).toEqual(wallNodes(b).map((n) => n.getAttribute('points')));
    expect(wallNodes(a).some((n) => n.hasAttribute(ACCENT_MARK_ATTR))).toBe(false);
  });
});

describe('31b: the marks win over the grid rule wherever the accent is cut', () => {
  it('accentedBrickIndices returns the engine-marked bricks for a cut tile', () => {
    const sq = (x) => ({ polygon: [{ x, y: 0 }, { x: x + 0.4, y: 0 }, { x: x + 0.4, y: 0.3 }, { x, y: 0.3 }] });
    const bricks = [{ ...sq(0), accentMarked: false }, { ...sq(0.5), accentMarked: true }, { ...sq(1), accentMarked: false }];
    expect([...accentedBrickIndices(bricks, tileAccent(0.5))]).toEqual([1]);
  });
  it('the height mask raises the marked pieces only', async () => {
    const MW = 4, MH = 2, NX = 81, NZ = 41;
    const K = (x, y) => Math.round((1 - y / MH) * (NZ - 1)) * NX + Math.round((x / MW) * (NX - 1));
    const root = document.createElement('div');
    for (const [i, mark] of [[0, '1'], [1, '0']]) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      for (const [k, v] of [['points', `${0.4 + i * 1.6},0.6 ${1.8 + i * 1.6},0.6 ${1.8 + i * 1.6},1.4 ${0.4 + i * 1.6},1.4`], ['data-layer', 'L'], [BRICK_GEN_ATTR, '1'],
        ['data-brick-set', '1'], ['data-brick-seed', '1'], ['data-brick-relief', '0.125'], ['data-brick', 'wall'], ['data-brick-id', `w${i}`], [ACCENT_MARK_ATTR, mark]]) p.setAttribute(k, v);
      root.appendChild(p);
    }
    const mask = (accent) => rasterizeBrickHeightMask({ _sketchLayer: { node: root } }, { id: 'L', depth: 0.125 }, NX, NZ, MW, MH, { accent });
    const flat = await mask(undefined), m = await mask(tileAccent(0.5));
    expect(m.body[K(1.1, 1)]).toBeGreaterThan(flat.body[K(1.1, 1)]);
    expect(m.body[K(2.7, 1)]).toBeCloseTo(flat.body[K(2.7, 1)], 6);
  });
});

describe('item 49: the accent outline is editor-only -- never in the drawing, the 3D drape, Send or the download', () => {
  const yellow = new RegExp(ACCENT_OUTLINE.color, 'i');
  it('marked bricks carry only the inert flag; the serialized drawing and its 3D drape hold no outline colour', () => {
    const ed = fakeEditor();
    runBricks(ed, S(tileAccent(0.5)), null);
    const marked = syncAccentHighlight(ed, tileAccent(0.5), 1);
    expect(marked).toBeGreaterThan(5);
    const nodes = wallNodes(ed);
    expect(nodes.filter((n) => n.getAttribute(ACCENT_FLAG_ATTR) === '1')).toHaveLength(marked);
    expect(nodes.some((n) => yellow.test(n.getAttribute('stroke') || ''))).toBe(false);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 9">${ed._sketchLayer.node.innerHTML}</svg>`;
    expect(yellow.test(svg)).toBe(false);
    const layerId = nodes[0].getAttribute('data-layer');
    expect(yellow.test(buildDrapeSvg([{ id: layerId, name: 'L', visible: true, showColor: true }], svg) || '')).toBe(false);
  });
  it('the outline is ONE rule of the live page, from ACCENT_OUTLINE', () => {
    const ed = fakeEditor();
    runBricks(ed, S(tileAccent(0.5)), null);
    syncAccentHighlight(ed, tileAccent(0.5), 1);
    const rule = document.getElementById('brickAccentOutlineStyle');
    expect(rule && rule.textContent).toContain(`[${ACCENT_FLAG_ATTR}="1"]`);
    expect(rule.textContent).toContain(ACCENT_OUTLINE.color);
    syncAccentHighlight(ed, tileAccent(0.5), 1);
    expect(document.querySelectorAll('#brickAccentOutlineStyle')).toHaveLength(1);
  });
  it('a board saved before item 49 (the old stroke attribute) loses it on the next sync', () => {
    const ed = fakeEditor();
    runBricks(ed, S(tileAccent(0.5)), null);
    for (const n of wallNodes(ed)) { n.setAttribute('stroke', ACCENT_OUTLINE.color); n.setAttribute('stroke-width', '0.05'); }
    syncAccentHighlight(ed, tileAccent(0.5), 1);
    expect(wallNodes(ed).some((n) => yellow.test(n.getAttribute('stroke') || ''))).toBe(false);
  });
  it('Send and the download strip the flag (every brick kind)', () => {
    for (const kind of ['wall', 'frame', 'brush']) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      el.setAttribute('data-brick', kind); el.setAttribute(ACCENT_FLAG_ATTR, '1');
      stripEditorOnlyBrickAttrs(el);
      expect(el.hasAttribute(ACCENT_FLAG_ATTR), kind).toBe(false);
    }
  });
});

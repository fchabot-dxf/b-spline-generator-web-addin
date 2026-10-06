/**
 * F35 item 22 SLICE 3 (+ item 64): a new Wall / Frame / Brush element goes on its KIND's own layer (item 64, Fred: "make
 * wall and frame use their own layers"; was slice 3's "the active layer") and stays on its own layer through re-lays; any layer may hold brick elements beside its art; the height
 * combine is per layer (the art -> rasterizeSvg at the layer's own depth/profile, the bricks -> the brick mask at
 * the bricks' own depth, as a second pass); getLayerSvg leaves the brick-tool nodes out of the art; Send's Bricks
 * sketch collects every layer's pieces; Move to layer moves a whole element; Clear finds bricks on any layer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  const sq = (x, id) => ({ id, polygon: [{ x, y: 0 }, { x: x + 1, y: 0 }, { x: x + 1, y: 0.3 }, { x, y: 0.3 }] });
  return { ...actual, generateBricks: vi.fn(() => ({ bricks: [sq(1, 'w1'), sq(3, 'w2')], frameBricks: [sq(5, 'f1')] })) };
});
const masks = vi.hoisted(() => ({ svg: [], brick: [] }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/stamp.js', () => ({
  rasterizeSvg: vi.fn(async (svg, nx, nz, blur, w, h, profile, depth) => { masks.svg.push({ svg, profile, depth }); return { body: new Float32Array(nx * nz).fill(0.5), fillet: new Float32Array(nx * nz), isStamped: new Uint8Array(nx * nz), metrics: null }; }),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-height-mask.js', () => ({
  rasterizeBrickHeightMask: vi.fn(async (editor, layer, nx, nz) => { masks.brick.push({ id: layer.id, depth: layer.depth }); return { body: new Float32Array(nx * nz).fill(1), fillet: new Float32Array(nx * nz), isStamped: new Uint8Array(nx * nz), metrics: null }; }),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', () => ({ scheduleRebuild: vi.fn(), rebuild: vi.fn() }));

import {
  runBricks, brickRecordNode, elementLayer, layerHasBrickPieces, brickPieceLayers, brickDepth, brickElementNodes,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { getLayerSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-io.js';
import { clearBrickElements, clearArtworkLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-clear.js';
import { CONTEXT_MENU_ITEMS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-context-menu.js';
import { updateStampMasks } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

/** An SVG.js-shaped sketch layer over a real DOM node; the ACTIVE layer is the art layer '0', no brick layer. */
function fakeEditor({ kindOn0 = null } = {}) {
  const node = document.createElement('div');
  const wrap = (el) => {
    const api = {
      node: el, type: el.tagName.toLowerCase(),
      fill: () => api, stroke: () => api,
      attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
      addClass: (c) => { el.classList.add(c); return api; },
      removeClass: (c) => { el.classList.remove(c); return api; },
      hasClass: (c) => el.classList.contains(c),
      remove: () => { el.remove(); return api; },
    };
    return api;
  };
  const make = (tag) => () => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return wrap(el); };
  return {
    _draw: {}, _mW: 7, _mH: 9, _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true, depth: 0.25, profile: 'vbit', ...(kindOn0 ? { brickKind: kindOn0 } : {}) }, { id: '5', name: 'Layer 2', visible: true, depth: 0.1 }],
    _sketchLayer: {
      node,
      polygon: (pts) => { const w = make('polygon')(); w.node.setAttribute('points', pts); return w; },
      rect: () => make('rect')(),
      line: () => make('line')(),
      group: make('g'),
      children: () => { const arr = [...node.children].map(wrap); return { toArray: () => arr, forEach: (f) => arr.forEach(f), map: (f) => arr.map(f) }; },
    },
  };
}
const q = (ed, sel) => [...ed._sketchLayer.node.querySelectorAll(sel)];
const art = (ed, layerId) => { const r = ed._sketchLayer.rect(); r.attr('data-layer', layerId).attr('x', 1).attr('y', 1).attr('width', 1).attr('height', 1); return r; };

const kindLayer = (ed, kind) => ed._layers.find((l) => l.brickKind === kind);
describe('item 64: a new element goes on its KIND\u2019s own layer and stays on its own layer', () => {
  it('a Wall + Frame lay creates the "Wall" and "Frame" layers (not the active one); records too; a second lay reuses them', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    expect(ed._layers.map((l) => l.name)).toEqual(['Layer 1', 'Layer 2', 'Wall', 'Frame']);
    for (const kind of ['wall', 'frame']) {
      const id = kindLayer(ed, kind).id;
      expect(q(ed, `[data-brick="${kind}"]`).every((n) => n.getAttribute('data-layer') === id)).toBe(true);
      expect(brickRecordNode(ed, kind).getAttribute('data-layer')).toBe(id);
    }
    expect(ed._activeLayer).toBe('0'); // the user's active layer is left alone
    runBricks(ed, P.brickSettings, null);
    expect(ed._layers).toHaveLength(4); // reused, not duplicated
  });
  it('a kind layer is found by its declared brickKind, never by its name (renamed, it is still the Wall\u2019s)', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    kindLayer(ed, 'wall').name = 'My bricks';
    q(ed, '[data-brick-record], [data-brick-gen="1"]').forEach((n) => n.remove()); // a NEW wall element
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    expect(ed._layers.filter((l) => l.brickKind === 'wall')).toHaveLength(1);
    expect(brickRecordNode(ed, 'wall').getAttribute('data-layer')).toBe(kindLayer(ed, 'wall').id);
  });
  it('a re-lay keeps each element on ITS layer, whatever is active now; a new element takes its kind\u2019s layer', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    const wallId = kindLayer(ed, 'wall').id;
    // the wall moved by hand to layer '5' stays there through a re-lay
    q(ed, '[data-brick="wall"], [data-brick-record="wall-full"]').forEach((n) => n.setAttribute('data-layer', '5'));
    ed._activeLayer = '0';
    runBricks(ed, P.brickSettings, null); // the wall re-lays; the frame is NEW
    expect(q(ed, '[data-brick="wall"]').every((n) => n.getAttribute('data-layer') === '5')).toBe(true);
    const frameId = kindLayer(ed, 'frame').id;
    expect(q(ed, '[data-brick="frame"]').every((n) => n.getAttribute('data-layer') === frameId)).toBe(true);
    expect(elementLayer(ed, 'wall').id).toBe('5');
    expect(elementLayer(ed, 'frame').id).toBe(frameId);
    expect(wallId).not.toBe('5');
  });
  it('an art layer that holds bricks keeps its OWN tooling (the bricks never write its depth)', () => {
    const ed = fakeEditor();
    runBricks(ed, { ...P.brickSettings, reliefIn: 0.2, invert: true }, null);
    expect(ed._layers[0].depth).toBe(0.25);
    expect(brickDepth({ reliefIn: 0.2, invert: true })).toBe(-0.2);
    expect(brickDepth({ reliefIn: 0.2 })).toBe(0.2);
  });
});

describe('item 22 slice 3: art and bricks on one layer stay apart', () => {
  it('getLayerSvg = the ART only (no pieces, no spines); bricks: "only" = the brick-tool nodes only', () => {
    const ed = fakeEditor({ kindOn0: 'wall' }); // item 64: art + the wall on one layer
    art(ed, '0');
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    ed._sketchLayer.line().attr('data-layer', '0').attr('data-brick', 'brush-spine');
    const a = getLayerSvg(ed, '0', 96);
    expect(a).toContain('<rect');
    expect(a).not.toContain('data-brick');
    const b = getLayerSvg(ed, '0', 96, { bricks: 'only' });
    expect(b).toContain('data-brick-gen="1"');
    expect(b).not.toContain('<rect');
    expect(layerHasBrickPieces(ed, '0')).toBe(true);
    expect(layerHasBrickPieces(ed, '5')).toBe(false);
  });

  it('the height combine is PER LAYER: art mask at the layer depth + a brick mask at the bricks’ depth', async () => {
    const ed = fakeEditor({ kindOn0: 'wall' }); // item 64: art + the wall on one layer
    art(ed, '0');
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    window.svgEditor = ed;
    masks.svg.length = 0; masks.brick.length = 0;
    P.brickSettings = { ...P.brickSettings, reliefIn: 0.125, invert: true };
    await updateStampMasks(9, 7);
    expect(masks.svg).toHaveLength(1); // the art, once, without the bricks
    expect(masks.svg[0].svg).not.toContain('data-brick');
    expect(masks.svg[0].depth).toBe(0.25);
    expect(masks.brick).toEqual([{ id: '0', depth: -0.125 }]); // Carved: the bricks' own depth, not 0.25
    const layer = ed._layers[0];
    expect(layer._mask && layer._brickMask).toBeTruthy();
    // the compositor: the layer's art pass, THEN its brick pass (own id, own depth, Flat, no fillet)
    const passes = _collectStampPasses();
    expect(passes.map((p) => [p.id, p.depth, p.profile])).toEqual([['0', 0.25, 'vbit'], ['0#bricks', -0.125, 'flat']]);
    expect(passes[1].edgeFilletRadius).toBe(0);
    window.svgEditor = null;
  });

  it('a layer with ONLY bricks: no art mask, its brick pass alone', async () => {
    const ed = fakeEditor({ kindOn0: 'wall' });
    runBricks(ed, P.brickSettings, null, { kinds: ['wall'] });
    window.svgEditor = ed;
    masks.svg.length = 0;
    await updateStampMasks(9, 7);
    expect(masks.svg).toHaveLength(0);
    expect(_collectStampPasses().map((p) => p.id)).toEqual(['0#bricks']);
    window.svgEditor = null;
  });
});

describe('item 22 slice 3: an element moves as ONE', () => {
  const moveTo = (ed, selection, layerId) => {
    const item = CONTEXT_MENU_ITEMS.find((i) => i.id === 'move-to-layer');
    item.submenu(ed, { selection }).find((s) => s.label === ed._layers.find((l) => l.id === layerId).name).run();
  };
  it('one Wall brick picked -> the record + EVERY wall brick move; the Frame stays', () => {
    const ed = fakeEditor();
    runBricks(ed, P.brickSettings, null);
    const frameId = elementLayer(ed, 'frame').id; // item 64: the Frame's own layer
    const one = ed._sketchLayer.children().toArray().find((c) => c.attr('data-brick') === 'wall');
    moveTo(ed, [one], '5');
    expect(q(ed, '[data-brick="wall"]').every((n) => n.getAttribute('data-layer') === '5')).toBe(true);
    expect(brickRecordNode(ed, 'wall').getAttribute('data-layer')).toBe('5');
    expect(q(ed, '[data-brick="frame"]').every((n) => n.getAttribute('data-layer') === frameId)).toBe(true);
    expect(elementLayer(ed, 'wall').id).toBe('5'); // and it re-lays there
  });
  it('a Brush piece -> its stroke’s spine segments + all its pieces; plain art moves alone', () => {
    const ed = fakeEditor();
    const seg = (n) => ed._sketchLayer.line().attr('data-layer', '0').attr('data-brick', 'brush-spine').attr('data-brick-element', 'beA').attr('data-n', n);
    seg(1); seg(2);
    for (const i of [0, 1]) ed._sketchLayer.polygon('0,0 1,0 1,1').attr('data-layer', '0').attr('data-brick', 'brush').attr('data-brick-gen', '1').attr('data-brick-owner', `beA:${i}`);
    const other = ed._sketchLayer.polygon('0,0 1,0 1,1').attr('data-layer', '0').attr('data-brick', 'brush').attr('data-brick-gen', '1').attr('data-brick-owner', 'beB:0');
    const piece = ed._sketchLayer.children().toArray().find((c) => c.attr('data-brick-owner') === 'beA:1');
    expect(brickElementNodes(ed, piece.node)).toHaveLength(4);
    moveTo(ed, [piece], '5');
    expect(q(ed, '[data-brick-element="beA"], [data-brick-owner^="beA:"]').every((n) => n.getAttribute('data-layer') === '5')).toBe(true);
    expect(other.attr('data-layer')).toBe('0');
    const r = art(ed, '0');
    expect(brickElementNodes(ed, r.node)).toEqual([r.node]);
  });
});

describe('item 22 slice 3: Clear finds bricks on any layer', () => {
  it('Clear bricks removes every brick-element node (pieces, spines, records) and keeps the art beside them', () => {
    const ed = fakeEditor();
    art(ed, '0');
    runBricks(ed, P.brickSettings, null);
    ed._sketchLayer.line().attr('data-layer', '0').attr('data-brick', 'brush-spine');
    clearBrickElements(ed);
    expect(q(ed, '[data-brick], [data-brick-record]')).toHaveLength(0);
    expect(q(ed, 'rect')).toHaveLength(1);
  });
  it('Clear artwork removes the art and keeps a layer that holds bricks (with its bricks)', () => {
    const ed = fakeEditor();
    art(ed, '0'); art(ed, '5');
    runBricks(ed, P.brickSettings, null);
    clearArtworkLayers(ed);
    expect(q(ed, 'rect')).toHaveLength(0);
    expect(q(ed, '[data-brick-gen="1"]').length).toBeGreaterThan(0);
    // item 64: the bricks are on the Wall / Frame layers (kept); both art layers held art only (gone)
    expect(ed._layers.map((l) => l.name)).toEqual(['Wall', 'Frame']);
  });
  it('audit v3 #1: a kept plain layer holding bricks becomes the active one -- no second "Layer 1"', () => {
    const ed = fakeEditor();
    art(ed, '0'); art(ed, '5');
    runBricks(ed, P.brickSettings, null);
    clearArtworkLayers(ed);
    // item 64: the kept layers are the kind layers; one of them becomes the active one -- still no new "Layer 1"
    expect(ed._layers.map((l) => l.name)).toEqual(['Wall', 'Frame']);
    expect(ed._layers.map((l) => l.id)).toContain(ed._activeLayer);
  });
});

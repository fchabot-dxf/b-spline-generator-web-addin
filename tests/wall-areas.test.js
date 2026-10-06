/**
 * F35 item 22 slice 2: painted WALL AREAS (editor side). Each area is a record (its strokes, paint order, own
 * settings); once any exists only the areas get wall bricks -- one generateBricks call per area with its strokes as
 * wallRegion and every NEWER area's strokes as minus (newest wins); clearing them returns to the full fill.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-commit.js', () => ({ commitEdit: vi.fn() }));
const SQ = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 1.5 }, { x: 1, y: 1.5 }];
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, generateBricks: vi.fn((input) => ({
    bricks: !input || input.skipWallFill ? [] : [{ id: 'b0', polygon: SQ, sampleId: 0, flip: false, heightOffset: 0 }], frameBricks: [],
    ...(input && Array.isArray(input.exclusions) ? { exclusionsApplied: true } : {}) })) }; // as the engine reports it
});

import {
  runBricks, addWallAreaStroke, clearWallAreas, wallAreaRecords, brickRecordNode, withWallFields, WALL_AREA_FIELDS,
  BRICK_RECORD_KINDS, BRICK_LAID_ATTR, brickWallAreaHandler,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';
import { generateBricks } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function fakeEditor() {
  const node = document.createElement('div');
  const wrap = (el) => { const api = { node: el, attr: (k, v) => { if (v === undefined) return el.getAttribute(k); el.setAttribute(k, String(v)); return api; },
    addClass: (c) => { el.classList.add(c); return api; }, removeClass: (c) => { el.classList.remove(c); return api; }, hasClass: (c) => el.classList.contains(c),
    fill: () => api, stroke: () => api }; return api; };
  const svgEl = (tag) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); node.appendChild(el); return el; };
  return {
    _draw: {}, _mW: 7, _mH: 9,
    _activeLayer: '0',
    _layers: [{ id: '0', name: 'Layer 1', visible: true }, { id: '1', name: 'Layer 2', visible: true }],
    _sketchLayer: { node, children: () => Object.assign([], { toArray: () => [] }) /* svg.js: an array (item 64: a kind layer runs addLayer) */,
      group: () => wrap(svgEl('g')), polygon: (pts) => { const el = svgEl('polygon'); el.setAttribute('points', pts); return wrap(el); } },
  };
}
const S = () => ({ ...P.brickSettings, pattern: 'stretcher', wallRotationDeg: 0 });
const stroke = (x) => ({ points: [{ x, y: 2 }, { x: x + 1, y: 2 }], widthIn: 1 });
const wallCalls = () => generateBricks.mock.calls.map((c) => c[0]).filter((i) => i.wallRegion);
const fullRecord = (ed) => ed._sketchLayer.node.querySelector(`[data-brick-record="${BRICK_RECORD_KINDS.wall}"]`);
const owned = (ed, id) => ed._sketchLayer.node.querySelectorAll(`[data-brick="wall"][data-brick-owner="${id}"]`).length;
beforeEach(() => generateBricks.mockClear());

describe('slice 2: wall-area records', () => {
  it('the first area replaces the whole-board wall record; areas keep their paint order; a stroke into an area appends', () => {
    const ed = fakeEditor();
    runBricks(ed, S(), null);
    expect(fullRecord(ed)).not.toBeNull();
    const a = addWallAreaStroke(ed, stroke(1), S());
    expect(fullRecord(ed)).toBeNull();
    const b = addWallAreaStroke(ed, stroke(3), S());
    addWallAreaStroke(ed, stroke(5), S(), a);
    const areas = wallAreaRecords(ed);
    expect(areas.map((r) => [r.id, r.seq, r.strokes.length])).toEqual([[a, 1, 2], [b, 2, 1]]);
    expect(brickRecordNode(ed, 'wall')).toBe(areas[1].node); // the newest stands for the wall
  });
  // F35 item 64 (supersedes slice 2's "the layer active when it was painted"): an area is a Wall element, so it goes on
  // the Wall kind layer, whatever is active
  it('item 64: an area is laid on the Wall layer, whatever layer is active', () => {
    const ed = fakeEditor();
    ed._activeLayer = '1';
    const a = addWallAreaStroke(ed, stroke(1), S());
    const layer = wallAreaRecords(ed)[0].layer;
    expect(layer.brickKind).toBe('wall');
    expect(layer.id).not.toBe('1');
    runBricks(ed, S(), null);
    expect(ed._sketchLayer.node.querySelector(`[data-brick-owner="${a}"]`).getAttribute('data-layer')).toBe(layer.id);
  });
});

describe('slice 2: laying the areas', () => {
  it('no area: one engine call, no wallRegion (today)', () => {
    runBricks(fakeEditor(), S(), null);
    expect(generateBricks).toHaveBeenCalledTimes(1);
    expect('wallRegion' in generateBricks.mock.calls[0][0]).toBe(false);
  });
  it('areas: the main call skips the wall fill; one call per area (newest first), its strokes minus every NEWER area, the newer laid bricks as drop exclusions', () => {
    const ed = fakeEditor();
    const a = addWallAreaStroke(ed, stroke(1), S());
    const b = addWallAreaStroke(ed, stroke(3), S());
    const counts = runBricks(ed, S(), null);
    expect(generateBricks.mock.calls[0][0].skipWallFill).toBe(true);
    const recs = wallAreaRecords(ed);
    expect(wallCalls().map((i) => i.wallRegion)).toEqual([
      { strokes: recs[1].strokes, minus: [] },
      { strokes: recs[0].strokes, minus: recs[1].strokes },
    ]);
    expect([owned(ed, a), owned(ed, b)]).toEqual([1, 1]);
    // T86 18c: laid NEWEST first; the older area gets the newer one's laid bricks as DROP exclusions
    const calls = wallCalls();
    expect(calls[0].wallRegion.strokes).toEqual(recs[1].strokes);
    expect(calls[0].exclusions).toBeUndefined();
    expect(calls[1].exclusions).toEqual([{ polygon: SQ, drop: true }]);
    expect(counts.wallCount).toBe(2);
    expect(fullRecord(ed)).toBeNull();
  });
  it('each area is laid with its OWN snapshot; the selected one with the current settings, which it then keeps', () => {
    const ed = fakeEditor();
    addWallAreaStroke(ed, stroke(1), { ...S(), wallRotationDeg: 45 });
    const b = addWallAreaStroke(ed, stroke(3), S());
    ed._brickWallAreaId = b;
    runBricks(ed, { ...S(), wallRotationDeg: 90 }, null, { laidKey: 'K' });
    expect(wallCalls().map((i) => i.rotationDeg)).toEqual([90, 45]); // newest first
    const recs = wallAreaRecords(ed);
    expect(recs.map((r) => r.settings.wallRotationDeg)).toEqual([45, 90]);
    expect(recs.map((r) => r.node.getAttribute(BRICK_LAID_ATTR))).toEqual(['K', 'K']);
  });
  it('clearing every area returns to the full fill (a whole-board record again)', () => {
    const ed = fakeEditor();
    addWallAreaStroke(ed, stroke(1), S());
    runBricks(ed, S(), null);
    expect(clearWallAreas(ed)).toBe(1);
    generateBricks.mockClear();
    runBricks(ed, S(), null);
    expect(generateBricks).toHaveBeenCalledTimes(1);
    expect('wallRegion' in generateBricks.mock.calls[0][0]).toBe(false);
    expect(fullRecord(ed)).not.toBeNull();
    expect(wallAreaRecords(ed)).toEqual([]);
  });
  it('withWallFields takes only the declared per-wall fields from a snapshot', () => {
    const out = withWallFields({ pattern: 'stretcher', seed: 1, setIds: { wall: 1, frame: 2 } },
      { pattern: 'herringbone', seed: 9, setIds: { wall: 3, frame: 4 } });
    expect(out).toEqual({ pattern: 'herringbone', seed: 1, setIds: { wall: 3, frame: 2 } });
    expect(WALL_AREA_FIELDS).toContain('wallRotationDeg');
  });
});

describe('slice 2: the Area gesture', () => {
  it('a drag hands its points to editor._brickWallArea on release (a preview while dragging, gone after)', () => {
    const ed = fakeEditor();
    const preview = { attr: vi.fn((k) => (k === 'd' ? 'M 0 0' : preview)), remove: vi.fn() };
    preview.fill = () => preview; preview.stroke = () => preview;
    ed._highlightLayer = { path: vi.fn(() => preview) };
    ed._brickWallArea = vi.fn();
    brickWallAreaHandler.start(ed, { x: 1, y: 1 });
    brickWallAreaHandler.update(ed, { x: 2, y: 1 });
    brickWallAreaHandler.finish(ed);
    expect(ed._brickWallArea).toHaveBeenCalledWith([{ x: 1, y: 1 }, { x: 2, y: 1 }]);
    expect(preview.remove).toHaveBeenCalled();
  });
});

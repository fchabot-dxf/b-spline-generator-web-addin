/**
 * F35 item 60 (seat A's brick e2e, measured app-side too: a raised brush stroke overlapped 3-5 frame stones, up to
 * 0.48 in2, and the 3D added the raise onto the stone). The engine's 18c drop rule, exported as dropTouching
 * (core/bricks/fill-shape.js, the same test cutExclusions applies to the wall): a stroke brick touching a laid FRAME
 * piece (grown by the joint) is dropped whole, never cut. regenerateOwnedBrickElements passes the frame pieces.
 */
import { describe, it, expect } from 'vitest';
import { dropTouching, brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js';
import { regenerateOwnedBrickElements, BRICKS_LAYER_NAME, BRICK_ATTR, BRICK_ELEMENT_ATTR, BRICK_SETTINGS_ATTR, BRICK_OWNER_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-brick-tool.js';

const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const SET = { ...brickSetById(1), grout: { ...brickSetById(1).grout, widthIn: 0.05 } };

describe('dropTouching (core/bricks): the 18c drop rule for bricks laid outside the wall fill', () => {
  const frame = { polygon: rect(2, 0, 3, 1), drop: true };
  it('a brick over a drop exclusion goes whole; one clear of it stays', () => {
    const over = { id: 'a', polygon: rect(2.5, 0.2, 3.5, 0.6) }, clear = { id: 'b', polygon: rect(4, 0.2, 5, 0.6) };
    expect(dropTouching([over, clear], [frame], SET).map((b) => b.id)).toEqual(['b']);
  });
  it('the exclusion is grown by the joint: a brick within one joint of it goes, one past it stays', () => {
    const near = { id: 'near', polygon: rect(3.03, 0.2, 4, 0.6) }, far = { id: 'far', polygon: rect(3.08, 0.2, 4, 0.6) };
    expect(dropTouching([near, far], [frame], SET).map((b) => b.id)).toEqual(['far']);
  });
  it('a cut exclusion (no drop flag) and no exclusions leave the bricks as they are', () => {
    const bricks = [{ id: 'a', polygon: rect(2.5, 0.2, 3.5, 0.6) }];
    expect(dropTouching(bricks, [{ polygon: frame.polygon }], SET)).toBe(bricks);
    expect(dropTouching(bricks, [], SET)).toBe(bricks);
  });
});

// a minimal svg.js-like editor (as bricks-regen-perf.test.js), whose node answers the FRAME pieces query
const SETTINGS = JSON.stringify({ setId: 1, scale: 1, suppression: 0, clumping: 0, seed: 1, reliefIn: 0.125, profile: 'bricks', orientation: 'stretcher', grout: { widthIn: 0.05 } });
function editorWith(framePolygons) {
  let elements = [];
  const frameNodes = framePolygons.map((p) => ({ getAttribute: (k) => (k === 'points' ? p.map((q) => `${q.x},${q.y}`).join(' ') : null) }));
  const make = (type) => {
    const el = { type, _attrs: {}, fill() { return el; }, stroke() { return el; },
      attr(k, ...rest) { if (rest.length === 0) return el._attrs[k]; el._attrs[k] = rest[0]; return el; },
      _classes: new Set(), addClass(c) { el._classes.add(c); return el; }, removeClass(c) { el._classes.delete(c); return el; },
      remove() { elements = elements.filter((e) => e !== el); },
      plot(pts) { el._attrs.points = pts.map(([x, y]) => `${x},${y}`).join(' '); return el; } };
    el.node = { getAttribute: (k) => el._attrs[k] ?? null, setAttribute: (k, v) => { el._attrs[k] = v; } };
    elements.push(el);
    return el;
  };
  const attrs = { [BRICK_ATTR]: 'brush-spine', [BRICK_ELEMENT_ATTR]: 's1', [BRICK_SETTINGS_ATTR]: SETTINGS, 'data-layer': 'L1' };
  const coords = { x1: 0.2, y1: 0.5, x2: 5.8, y2: 0.5 };
  elements.push({ type: 'line', node: { getAttribute: (k) => (k in coords ? coords[k] : (attrs[k] ?? null)) }, attr: (k) => attrs[k] ?? null });
  const editor = {
    _layers: [{ id: 'L1', name: BRICKS_LAYER_NAME, holdsBricks: true }],
    _sketchLayer: {
      children() { const a = elements.slice(); a.toArray = () => a; return a; },
      polygon(pts) { const el = make('polygon'); el._attrs.points = pts; return el; }, // drawBrick passes the points string
      path() { return make('path'); },
      // a laid frame leaves its record with a laid key (the strokes' fingerprint reads it: a frame re-lay re-lays them)
      node: { closest: () => null, querySelectorAll: (sel) => (sel.includes('"frame"') ? frameNodes : []),
        querySelector: (sel) => (framePolygons.length && sel.includes('data-brick-record') && sel.includes('frame')
          ? { getAttribute: (k) => (k === 'data-brick-laid' ? 'frame-laid-key' : null) } : null) },
    },
  };
  return { editor, owned: () => elements.filter((e) => e.attr && e.attr(BRICK_OWNER_ATTR)) };
}
const box = (el) => {
  const pts = String(el._attrs.points || '').trim().split(/\s+/).filter(Boolean).map((s) => s.split(',').map(Number));
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])) };
};

describe('regenerateOwnedBrickElements: a stroke keeps clear of the laid frame pieces', () => {
  it('no stroke brick lies over the frame piece; without the frame the stroke runs through', () => {
    const free = editorWith([]);
    regenerateOwnedBrickElements(free.editor);
    const across = free.owned().filter((el) => { const b = box(el); return b.x1 > 2.6 && b.x0 < 3.4; });
    expect(across.length).toBeGreaterThan(0); // the stroke does cross x 2.6..3.4 on its own

    const framed = editorWith([rect(2.6, 0, 3.4, 1)]);
    regenerateOwnedBrickElements(framed.editor);
    const over = framed.owned().filter((el) => { const b = box(el); return b.x1 > 2.6 && b.x0 < 3.4; });
    expect(framed.owned().length).toBeGreaterThan(0);
    expect(over).toEqual([]);
    expect(framed.owned().length).toBeLessThan(free.owned().length);
  });
});

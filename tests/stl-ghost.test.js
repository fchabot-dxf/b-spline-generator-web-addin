/**
 * STL-RELIEF slice 2: the ghost's geometry and its colour coding (core/stl/ghost.js), on real meshes and the real record shape.
 */
import { describe, it, expect } from 'vitest';
import { indexMesh, encodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { normaliseStlLayer } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import {
  ghostGeometry, surfaceAt, openEdgeVertices, updateStlGhosts, ghostState, STL_GHOST_COLOURS, STL_GHOST_KINDS,
  STL_OPEN_LOOP_MIN_CELLS,
} from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';

const tri = (a, b, c) => [...a, ...b, ...c];
function pyramid({ base = true } = {}) {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  const t = [tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T)];
  if (base) t.push(tri(A, C, B), tri(A, D, C));
  return Float32Array.from(t.flat());
}
const GRID = { nx: 41, nz: 41, widthIn: 20, heightIn: 20 };
const FLAT = (z) => new Float32Array(GRID.nx * GRID.nz).fill(z);
const rec = (extra = {}, soup = pyramid()) => ({ ...normaliseStlLayer({ id: 'g', unitIn: 1, mesh: encodeMesh(indexMesh(soup)) }), ...extra });
const colourOf = (g, v) => Array.from(g.colours.slice(v * 3, v * 3 + 3)).map((x) => +x.toFixed(3));
const same = (c) => c.map((x) => +x.toFixed(3));
const kindOf = (g, v) => STL_GHOST_KINDS[g.kinds[v]];
/** the vertex index at the highest z (the apex) / the lowest */
const vertexAt = (g, pick) => { let best = 0; for (let v = 1; v < g.positions.length / 3; v++) if (pick(g.positions[v * 3 + 2], g.positions[best * 3 + 2])) best = v; return best; };
const apexOf = (g) => vertexAt(g, (a, b) => a > b);

describe('surfaceAt', () => {
  it('samples the height field bilinearly in the scene frame (x right, y UP the screen) and clamps to the board', () => {
    const h = Float32Array.from({ length: GRID.nx * GRID.nz }, (_, k) => (k % GRID.nx) * 0.5); // rises with x: 0 .. 20
    expect(surfaceAt(h, GRID, -10, 0)).toBeCloseTo(0, 6);
    expect(surfaceAt(h, GRID, 0, 0)).toBeCloseTo(10, 6);
    expect(surfaceAt(h, GRID, 0.25, 7)).toBeCloseTo(10.25, 6); // between columns
    expect(surfaceAt(h, GRID, 99, 0)).toBeCloseTo(20, 6);
    // rises with the ROW = UP the screen (core/preview/terrain-mesh.js buildHeightField: row j at y = -H/2 + j*dy)
    const v = Float32Array.from({ length: GRID.nx * GRID.nz }, (_, k) => Math.floor(k / GRID.nx));
    expect(surfaceAt(v, GRID, 0, 10)).toBeCloseTo(40, 6); // y = +10 is the top of the view = the LAST row (40)
    expect(surfaceAt(v, GRID, 0, -10)).toBeCloseTo(0, 6); // y = -10 is the bottom = row 0
    expect(surfaceAt(v, GRID, 0, 3)).toBeCloseTo(26, 6);  // y = +3: row (3 + 10) / 0.5 = 26
  });
});

describe('ghostGeometry', () => {
  it('sits on the surface under its centre; the Z offset lifts or sinks it', () => {
    const g = ghostGeometry(rec(), FLAT(3), GRID);
    expect(g.positions[apexOf(g) * 3 + 2]).toBeCloseTo(3 + 4, 3);
    const lowest = vertexAt(g, (a, b) => a < b);
    expect(g.positions[lowest * 3 + 2]).toBeCloseTo(3, 3);
    const sunk = ghostGeometry(rec({ position: { x: 0, y: 0, z: -2 } }), FLAT(3), GRID);
    expect(sunk.positions[apexOf(sunk) * 3 + 2]).toBeCloseTo(3 + 4 - 2, 3);
  });
  it('kinds: above the surface = shows, below = buried, at it = meets (the intersection band)', () => {
    const sunk = ghostGeometry(rec({ position: { x: 0, y: 0, z: -2 } }), FLAT(0), GRID);
    expect(kindOf(sunk, apexOf(sunk))).toBe('shows');
    expect(kindOf(sunk, vertexAt(sunk, (a, b) => a < b))).toBe('buried');
    const flush = ghostGeometry(rec(), FLAT(0), GRID);
    expect(kindOf(flush, vertexAt(flush, (a, b) => a < b))).toBe('meets'); // the base rests ON the surface
    expect(sunk.counts.shows + sunk.counts.buried + sunk.counts.meets + sunk.counts.overhang + sunk.counts.open).toBe(5);
  });
  // Fred 2026-11-22 ("only keep red"): an open edge counts only ABOVE the surface -- an open back resting on it never shows
  it('an open edge ABOVE the surface is marked open (a hole); one resting on the surface is not; a closed mesh has none', () => {
    const resting = ghostGeometry(rec({}, pyramid({ base: false })), FLAT(0), GRID);
    expect(resting.counts.open).toBe(0); // the open base outline lies ON the surface
    const open = ghostGeometry(rec({ position: { x: 0, y: 0, z: 0.5 } }, pyramid({ base: false })), FLAT(0), GRID);
    expect(open.counts.open).toBe(4); // floated: the four base corners are an open outline above the surface
    expect(ghostGeometry(rec(), FLAT(0), GRID).counts.open).toBe(0);
    expect(Array.from(openEdgeVertices(indexMesh(pyramid({ base: false }))))).toContain(1);
  });
  // Fred 2026-11-22: red spots were scan noise -- only an open LOOP larger than a grid cell (STL_OPEN_LOOP_MIN_CELLS) is red
  it('a sub-cell scan crack above the surface stays stone; a hole larger than a grid cell is red', () => {
    // a closed mesh: a 10 x 10 in top of 40 x 40 quads (0.25 in, half the 0.5 in grid cell) + a fan to a point 1 in below
    const crackedPlate = (holes) => {
      const n = 40, s = 10, top = (i, j) => [-s / 2 + (i / n) * s, -s / 2 + (j / n) * s, 1], apex = [0, 0, 0], t = [];
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        if (holes(i, j)) continue;
        t.push(tri(top(i, j), top(i + 1, j), top(i + 1, j + 1)), tri(top(i, j), top(i + 1, j + 1), top(i, j + 1)));
      }
      const ring = [];
      for (let i = 0; i < n; i++) ring.push(top(i, 0));
      for (let j = 0; j < n; j++) ring.push(top(n, j));
      for (let i = n; i > 0; i--) ring.push(top(i, n));
      for (let j = n; j > 0; j--) ring.push(top(0, j));
      for (let k = 0; k < ring.length; k++) t.push(tri(ring[k], ring[(k + 1) % ring.length], apex));
      return Float32Array.from(t.flat());
    };
    const at = (soup) => ghostGeometry(rec({ position: { x: 0, y: 0, z: 0.5 } }, soup), FLAT(0), GRID);
    expect(at(crackedPlate(() => false)).counts.open).toBe(0);                   // closed: nothing open
    const crack = at(crackedPlate((i, j) => i === 20 && j === 20));                // one 0.25 in quad missing
    expect(Array.from(openEdgeVertices(indexMesh(crackedPlate((i, j) => i === 20 && j === 20)))).filter(Boolean)).toHaveLength(4);
    expect(crack.counts.open).toBe(0);                                            // under a cell: stone
    for (let v = 0; v < crack.kinds.length; v++) expect(colourOf(crack, v)).toEqual(same(STL_GHOST_COLOURS.shows));
    const hole = at(crackedPlate((i, j) => i >= 10 && i < 16 && j >= 10 && j < 16)); // a 1.5 in hole: three cells
    expect(hole.counts.open).toBe(4 * 6);                                          // its whole rim is red
    expect(STL_OPEN_LOOP_MIN_CELLS).toBe(1);                                       // the one declared threshold
  });
  it('above the surface, a face that looks down is marked overhang (a top-down stamp loses it); the underside ON the surface is not', () => {
    const openUp = pyramid({ base: false });
    const flipped = ghostGeometry(rec({ rotation: { x: 180, y: 0, z: 0 }, position: { x: 0, y: 0, z: 0.5 } }, openUp), FLAT(0), GRID);
    expect(flipped.counts.overhang).toBeGreaterThan(0); // every slope of the turned-over open pyramid looks down
    const up = ghostGeometry(rec({ position: { x: 0, y: 0, z: 0.5 } }, openUp), FLAT(0), GRID);
    expect(up.counts.overhang).toBe(0);                  // right way up, every slope looks up
    const closedOnSurface = ghostGeometry(rec(), FLAT(0), GRID);
    expect(closedOnSurface.counts.overhang).toBe(0);     // the closed base rests on the surface: not an overhang
    const closedFloating = ghostGeometry(rec({ position: { x: 0, y: 0, z: 0.5 } }), FLAT(0), GRID);
    expect(closedFloating.counts.overhang).toBeGreaterThan(0); // floated above it, its underside does look down
  });
  it('the look (Fred 2026-11-22 "only keep red"): one plain stone colour for every kind, red only on an open edge', () => {
    const open = ghostGeometry(rec({ position: { x: 0, y: 0, z: -2 } }, pyramid({ base: false })), FLAT(0), GRID);
    const floated = ghostGeometry(rec({ position: { x: 0, y: 0, z: 0.5 } }, pyramid({ base: false })), FLAT(0), GRID);
    const flush = ghostGeometry(rec(), FLAT(0), GRID);
    const stone = colourOf(open, apexOf(open));
    for (const g of [open, floated, flush]) {
      for (let v = 0; v < g.kinds.length; v++) {
        if (kindOf(g, v) === 'open') expect(colourOf(g, v)).toEqual([0.9, 0.2, 0.2]);
        else expect(colourOf(g, v), kindOf(g, v)).toEqual(stone);
      }
    }
    expect(stone).toEqual([0.78, 0.72, 0.63]);
    expect(floated.counts.open).toBeGreaterThan(0);
  });
  it('without heights it sits on z = 0 and still renders', () => {
    const g = ghostGeometry(rec(), null, GRID);
    expect(g.positions[apexOf(g) * 3 + 2]).toBeCloseTo(4, 3);
  });
});

describe('updateStlGhosts', () => {
  const fakePreview = () => ({ calls: [], setStlGhosts(l) { this.calls.push(l); } });
  it('hands the preview one ghost per enabled STL; none, hidden or heightless = an empty list', () => {
    const p = fakePreview();
    updateStlGhosts(p, [rec(), rec({ id: 'off', enabled: false })], FLAT(0), GRID);
    expect(p.calls.at(-1)).toHaveLength(1);
    updateStlGhosts(p, [], FLAT(0), GRID);
    expect(p.calls.at(-1)).toEqual([]);
    updateStlGhosts(p, [rec()], null, GRID);
    expect(p.calls.at(-1)).toEqual([]);
    ghostState.visible = false;
    updateStlGhosts(p, [rec()], FLAT(0), GRID);
    expect(p.calls.at(-1)).toEqual([]);
    ghostState.visible = true;
  });
  it('a bad stored mesh shows no ghost and does not throw; a preview without the method is ignored', () => {
    const p = fakePreview();
    updateStlGhosts(p, [{ id: 'bad', enabled: true, mesh: { v: 99 } }, rec()], FLAT(0), GRID);
    expect(p.calls.at(-1)).toHaveLength(1);
    expect(() => updateStlGhosts({}, [rec()], FLAT(0), GRID)).not.toThrow();
    expect(() => updateStlGhosts(null, [rec()], FLAT(0), GRID)).not.toThrow();
  });
});

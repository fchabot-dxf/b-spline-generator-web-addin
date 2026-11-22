/**
 * STL-RELIEF slice 2: the ghost's geometry and its colour coding (core/stl/ghost.js), on real meshes and the real record shape.
 */
import { describe, it, expect } from 'vitest';
import { indexMesh, encodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { normaliseStlLayer } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import {
  ghostGeometry, surfaceAt, openEdgeVertices, updateStlGhosts, ghostState, STL_GHOST_COLOURS,
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
    const v = Float32Array.from({ length: GRID.nx * GRID.nz }, (_, k) => Math.floor(k / GRID.nx)); // rises with the ROW (down the screen)
    expect(surfaceAt(v, GRID, 0, 10)).toBeCloseTo(0, 6);   // y = +10 is the top row
    expect(surfaceAt(v, GRID, 0, -10)).toBeCloseTo(40, 6); // y = -10 is the bottom row
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
  it('colours: above the surface = shows, below = buried, at it = meets (the intersection band)', () => {
    const sunk = ghostGeometry(rec({ position: { x: 0, y: 0, z: -2 } }), FLAT(0), GRID);
    expect(colourOf(sunk, apexOf(sunk))).toEqual(same(STL_GHOST_COLOURS.shows));
    expect(colourOf(sunk, vertexAt(sunk, (a, b) => a < b))).toEqual(same(STL_GHOST_COLOURS.buried));
    const flush = ghostGeometry(rec(), FLAT(0), GRID);
    expect(colourOf(flush, vertexAt(flush, (a, b) => a < b))).toEqual(same(STL_GHOST_COLOURS.meets)); // the base rests ON the surface
    expect(sunk.counts.shows + sunk.counts.buried + sunk.counts.meets + sunk.counts.overhang + sunk.counts.open).toBe(5);
  });
  it('an open edge is marked open (a hole); a closed mesh has none', () => {
    const open = ghostGeometry(rec({}, pyramid({ base: false })), FLAT(0), GRID);
    expect(open.counts.open).toBe(4); // the four base corners: the open outline
    expect(ghostGeometry(rec(), FLAT(0), GRID).counts.open).toBe(0);
    expect(Array.from(openEdgeVertices(indexMesh(pyramid({ base: false }))))).toContain(1);
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

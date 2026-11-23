/**
 * Fred 2026-11-22 (live site, board 'claude 47', 7 x 12, template_3 Tapered Hourglass): the STL ghost hung past the frame's
 * waist notch over empty space while the terrain itself was trimmed. The ghost is now trimmed to the SAME outline the terrain
 * preview is (core/preview/index.js _trimPoly, set by _applyFrame from frameLoopsWorld(spec, grid).panel): the REAL
 * TerrainPreview _applyFrame + setStlGhosts + refreshFrame on a FakeTHREE, a real ghost (ghostGeometry) of a plate larger than
 * the board.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameLoopsWorld, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { TerrainPreview } from '../bspline-frame-builder/b-spline-gen/html/core/preview/index.js';
import { indexMesh, encodeMesh } from '../bspline-frame-builder/b-spline-gen/html/core/stl/mesh.js';
import { normaliseStlLayer } from '../bspline-frame-builder/b-spline-gen/html/core/stl/layer.js';
import { ghostGeometry } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import { trimGhost } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost-trim.js';
import { FakeTHREE, carvedPanel } from './helpers/drawn-panel.js';

const W = 7, H = 12, NX = 71, NZ = 121;
const GRID = { nx: NX, nz: NZ, widthIn: W, heightIn: H };
const FLAT = new Float32Array(NX * NZ).fill(0.5);

/** A wavy plate 8.4 x 13.4 in (past the 7 x 12 board on every side), 42 x 67 quads: a real ghost with fine triangles. */
function plateRecord(id = 'plate') {
  const nx = 42, ny = 67, sx = 8.4, sy = 13.4, soup = [];
  const p = (i, j) => { const x = -sx / 2 + (i / nx) * sx, y = -sy / 2 + (j / ny) * sy; return [x, y, 0.2 + 0.1 * Math.sin(x) * Math.cos(y)]; };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) soup.push(...p(i, j), ...p(i + 1, j), ...p(i + 1, j + 1), ...p(i, j), ...p(i + 1, j + 1), ...p(i, j + 1));
  return normaliseStlLayer({ id, unitIn: 1, mesh: encodeMesh(indexMesh(Float32Array.from(soup))) });
}

/** The THREE the preview needs here: FakeTHREE (the trim) + the ghost's materials / mesh fields. */
const THREE = {
  ...FakeTHREE,
  // the ghost passes a BufferAttribute to setIndex (FakeTHREE's takes a plain array)
  BufferGeometry: class extends FakeTHREE.BufferGeometry { setIndex(ix) { super.setIndex(ix && ix.array ? ix.array : ix); } },
  Mesh: class extends FakeTHREE.Mesh { constructor(g, m) { super(g, m); this.userData = {}; this.children = []; } add(c) { this.children.push(c); } },
  MeshLambertMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
  MeshBasicMaterial: class { constructor(o) { Object.assign(this, o); } dispose() {} },
};

function preview(templateId) {
  const { mesh, grid } = carvedPanel(W, H, NX, NZ, () => 2, 1.5);
  const scene = { objs: new Set(), add(o) { this.objs.add(o); }, remove(o) { this.objs.delete(o); } };
  const gizmo = { got: null, setGhosts(list) { this.got = list; } };
  const h = Object.assign(Object.create(TerrainPreview.prototype), {
    _THREE: THREE, _scene: scene, _mesh: mesh, _lastGrid: grid, _frameMeshes: [], _frameRimDrapeMesh: null,
    _leaders: { setData() {} }, _worstPts: [], _stlGizmo: gizmo, _needsRender: false,
  });
  const spec = templateId ? frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId }), { widthIn: W, heightIn: H }) : null;
  h._frameProvider = () => spec;
  h._applyFrame();
  return { h, spec, grid, gizmo };
}
const centroidsOf = (m) => {
  const pos = m.geometry.attributes.position.array, ix = m.geometry.index.array, out = [];
  for (let t = 0; t < ix.length; t += 3) out.push([0, 1].map((k) => (pos[ix[t] * 3 + k] + pos[ix[t + 1] * 3 + k] + pos[ix[t + 2] * 3 + k]) / 3));
  return out;
};

describe('the STL ghost is trimmed to the terrain\'s own outline (template_3, 7 x 12)', () => {
  it('no ghost triangle centroid lies outside the trim outline; the ghost really crossed it before the trim', () => {
    const { h, spec, grid, gizmo } = preview('template_3');
    const poly = frameLoopsWorld(spec, grid).panel;
    expect(h._trimPoly).toEqual(poly); // the ONE outline: the terrain's trim loop
    const g = ghostGeometry(plateRecord(), FLAT, GRID);
    const outsideBefore = centroidsOf({ geometry: { attributes: { position: { array: g.positions } }, index: { array: g.indices } } })
      .filter(([x, y]) => !pointInPolygon(x, y, poly)).length;
    expect(outsideBefore).toBeGreaterThan(100); // the plate hangs past the waist notch and the board edges
    h.setStlGhosts([g]);
    expect(h._stlGhosts).toHaveLength(1);
    const cs = centroidsOf(h._stlGhosts[0]);
    expect(cs.length).toBeGreaterThan(0);
    expect(cs.filter(([x, y]) => !pointInPolygon(x, y, poly))).toEqual([]);
    // the gizmo picks / places on the SAME trimmed ghost
    expect(gizmo.got[0].indices.length).toBe(h._stlGhosts[0].geometry.index.array.length);
    expect(gizmo.got[0].positions.length).toBe(h._stlGhosts[0].geometry.attributes.position.array.length);
  });

  it('no frame template: the ghost is the whole ghost (the board rectangle trims nothing)', () => {
    const { h } = preview(null);
    expect(h._trimPoly).toBe(null);
    const g = ghostGeometry(plateRecord(), FLAT, GRID);
    h.setStlGhosts([g]);
    expect(Array.from(h._stlGhosts[0].geometry.index.array)).toEqual(Array.from(g.indices));
  });

  it('a frame change alone (refreshFrame) re-trims the ghosts already shown', () => {
    const { h, grid } = preview(null);
    const spec = frameSolidSpec(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_3' }), { widthIn: W, heightIn: H });
    const g = ghostGeometry(plateRecord(), FLAT, GRID);
    h.setStlGhosts([g]);
    const full = h._stlGhosts[0].geometry.index.array.length;
    h._frameProvider = () => spec;
    h.refreshFrame();
    const poly = frameLoopsWorld(spec, grid).panel;
    expect(h._stlGhosts[0].geometry.index.array.length).toBeLessThan(full);
    expect(centroidsOf(h._stlGhosts[0]).filter(([x, y]) => !pointInPolygon(x, y, poly))).toEqual([]);
  });

  it('trimGhost: the meet line is recomputed from the kept triangles only', () => {
    const { spec, grid } = preview('template_3');
    const poly = frameLoopsWorld(spec, grid).panel;
    const g = ghostGeometry({ ...plateRecord(), position: { x: 0, y: 0, z: -0.1 } }, FLAT, GRID); // half sunk: it meets the surface
    expect(g.meetLine.length).toBeGreaterThan(0);
    const t = trimGhost(g, poly);
    expect(t.meetLine.length).toBeGreaterThan(0);
    expect(t.meetLine.length).toBeLessThan(g.meetLine.length);
    // every kept segment comes from a kept triangle: its midpoint is no further than one plate quad (0.2 in) outside
    const inOrNear = (x, y) => pointInPolygon(x, y, poly) || [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]].some(([dx, dy]) => pointInPolygon(x + dx, y + dy, poly));
    for (let i = 0; i < t.meetLine.length; i += 6) expect(inOrNear((t.meetLine[i] + t.meetLine[i + 3]) / 2, (t.meetLine[i + 1] + t.meetLine[i + 4]) / 2)).toBe(true);
    expect(trimGhost(g, null)).toBe(g);
  });
});

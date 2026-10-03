/**
 * SE11e — TerrainPreview._rebuildDrapeMesh / setDrapeTexture
 * (core/preview/index.js). The drape moved from a material property on
 * the terrain mesh itself (SE11's `map`, SE11b's `emissiveMap` — both
 * proven wrong: multiply vanishes into dark carve-groove vertex colours,
 * additive light can never show black) to a SEPARATE overlay mesh
 * sharing the terrain's own geometry. Amend 1 made that overlay unlit
 * (MeshBasicMaterial) — fixed "black invisible" but read as a flat
 * sticker, not shaded surface colour; amend 2 made it LIT
 * (MeshPhongMaterial, matching the terrain's own specular/shininess/
 * flatShading) instead. This file pins the parts of that change that
 * are pure object-wiring, testable without a real WebGL context: does
 * the overlay mesh get the SAME geometry reference (not a copy), the
 * right material settings, and correct add/remove/dispose lifecycle.
 *
 * `TerrainPreview.prototype._rebuildDrapeMesh.call(mockThis)` — the REAL
 * method, not a reimplementation — against a minimal mock `this` (the
 * class can't be constructed here: its constructor needs `window.THREE`
 * plus a real WebGLRenderer/canvas, none of which exist in this test
 * environment). Same "real class via .call(), not a copy of its logic"
 * convention as editor-session.test.js's setStrokeWidth tests and
 * editor-select-many.test.js's _selectMany tests.
 *
 * NOT covered here (needs a real browser, not vitest/happy-dom):
 * `buildDrapeTexture`'s own transparency — `canvas.getContext('2d')`
 * returns null in this environment (confirmed directly: a throwaway
 * probe asserting `ctx === null` passed), the same established gap
 * `bakeSvgForCarving` etc. have always had. Proven live in Fusion
 * instead — see WORK-LOG SE11e (the diagnostic there counts painted
 * (non-transparent) pixels directly on the real rendered canvas).
 */
import { describe, it, expect } from 'vitest';
import { TerrainPreview } from '../bspline-frame-builder/b-spline-gen/html/core/preview/index.js';

function mockTHREE() {
  return {
    MeshPhongMaterial: class {
      constructor(opts) { Object.assign(this, opts); this._disposed = false; }
      dispose() { this._disposed = true; }
    },
    Mesh: class {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
        this.visible = true;
      }
    },
    // H23 item 67: _rebuildDrapeMesh's own 'Colour edges' OFF path builds a
    // wrapper BufferGeometry (shared attributes, a top-cap-only index) —
    // minimal real-shaped stand-in, not a reimplementation of THREE's own.
    BufferGeometry: class {
      constructor() { this.attributes = {}; this.index = null; }
      setAttribute(k, a) { this.attributes[k] = a; }
      setIndex(ix) { this.index = ix; }
    },
  };
}

function mockPreview({ mesh = null, drapeTexture = null, meshIsSolid = false, colourEdges = true, lastNx = 0, lastNz = 0 } = {}) {
  const addCalls = [];
  const removeCalls = [];
  return {
    _THREE: mockTHREE(),
    _scene: { add: (o) => addCalls.push(o), remove: (o) => removeCalls.push(o) },
    _mesh: mesh,
    _drapeMesh: null,
    _drapeTexture: drapeTexture,
    _addCalls: addCalls,
    _removeCalls: removeCalls,
    // The real method, not a reimplementation — setDrapeTexture calls
    // this._rebuildDrapeMesh() internally, and `this` there is this mock.
    _rebuildDrapeMesh: TerrainPreview.prototype._rebuildDrapeMesh,
    // H23 item 67: _rebuildDrapeMesh now delegates its own material recipe
    // to this (shared with the frame rim's own overlay) — same convention,
    // the real method against this mock, not a reimplementation.
    _drapeOverlayMaterial: TerrainPreview.prototype._drapeOverlayMaterial,
    _meshIsSolid: meshIsSolid,
    _colourEdges: colourEdges,
    _lastNx: lastNx,
    _lastNz: lastNz,
  };
}

const rebuild = (preview) => TerrainPreview.prototype._rebuildDrapeMesh.call(preview);

describe('_rebuildDrapeMesh: geometry sharing (the core SE11e property)', () => {
  it('the overlay mesh SHARES the terrain geometry object — same reference, not a copy', () => {
    const geometry = { id: 'shared-geometry' };
    const preview = mockPreview({
      mesh: { geometry, material: { side: 1 }, visible: true },
      drapeTexture: { id: 'tex' },
    });
    rebuild(preview);
    expect(preview._drapeMesh).not.toBeNull();
    expect(preview._drapeMesh.geometry).toBe(geometry);
  });

  it('non-vacuous: a DIFFERENT geometry object (even if structurally identical) is NOT the same reference', () => {
    const geometryA = { id: 'a' };
    const geometryB = { id: 'a' }; // same shape, different object
    const preview = mockPreview({
      mesh: { geometry: geometryA, material: { side: 1 }, visible: true },
      drapeTexture: { id: 'tex' },
    });
    rebuild(preview);
    expect(preview._drapeMesh.geometry).toBe(geometryA);
    expect(preview._drapeMesh.geometry).not.toBe(geometryB);
  });
});

describe('_rebuildDrapeMesh: material settings match the dispatch\'s exact values', () => {
  it('LIT MeshPhongMaterial: map, transparent, depthWrite, polygonOffset factor/units, and the terrain\'s own side (amend 2: shaded, not unlit)', () => {
    const texture = { id: 'tex' };
    const preview = mockPreview({
      mesh: { geometry: {}, material: { side: 'double-side-marker' }, visible: true },
      drapeTexture: texture,
    });
    rebuild(preview);
    const mat = preview._drapeMesh.material;
    expect(mat.map).toBe(texture);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.polygonOffset).toBe(true);
    expect(mat.polygonOffsetFactor).toBe(-1);
    expect(mat.polygonOffsetUnits).toBe(-1);
    expect(mat.side).toBe('double-side-marker');
  });

  it('mirrors the terrain\'s own specular/shininess/flatShading, and uses a neutral white base color (so the drape colour itself, not a tint, comes from the texture)', () => {
    const texture = { id: 'tex' };
    const specularMarker = { r: 1, g: 1, clone() { return this; } };
    const preview = mockPreview({
      mesh: {
        geometry: {},
        material: {
          side: 2,
          specular: specularMarker,
          shininess: 42,
          flatShading: true,
        },
        visible: true,
      },
      drapeTexture: texture,
    });
    rebuild(preview);
    const mat = preview._drapeMesh.material;
    expect(mat.color).toBe(0xffffff);
    expect(mat.vertexColors).toBeFalsy();
    expect(mat.specular).toBe(specularMarker);
    expect(mat.shininess).toBe(42);
    expect(mat.flatShading).toBe(true);
  });

  it('non-vacuous: a DIFFERENT terrain material\'s shininess/flatShading propagates too (not a hardcoded constant)', () => {
    const preview = mockPreview({
      mesh: {
        geometry: {},
        material: { side: 1, specular: null, shininess: 7, flatShading: false },
        visible: true,
      },
      drapeTexture: { id: 'tex' },
    });
    rebuild(preview);
    const mat = preview._drapeMesh.material;
    expect(mat.shininess).toBe(7);
    expect(mat.flatShading).toBe(false);
  });
});

describe('_rebuildDrapeMesh: scene lifecycle', () => {
  it('adds the new drape mesh to the scene', () => {
    const preview = mockPreview({
      mesh: { geometry: {}, material: { side: 1 }, visible: true },
      drapeTexture: { id: 'tex' },
    });
    rebuild(preview);
    expect(preview._addCalls).toContain(preview._drapeMesh);
  });

  it('removes AND disposes any existing drape mesh before creating the new one — no leak, no duplicate overlay', () => {
    const preview = mockPreview({
      mesh: { geometry: {}, material: { side: 1 }, visible: true },
      drapeTexture: { id: 'tex' },
    });
    const oldMat = { disposed: false, dispose() { this.disposed = true; } };
    const oldMesh = { material: oldMat };
    preview._drapeMesh = oldMesh;
    rebuild(preview);
    expect(preview._removeCalls).toContain(oldMesh);
    expect(oldMat.disposed).toBe(true);
    expect(preview._drapeMesh).not.toBe(oldMesh);
  });

  it('no drape texture: removes any existing overlay and leaves it removed (does not rebuild one)', () => {
    const preview = mockPreview({
      mesh: { geometry: {}, material: { side: 1 }, visible: true },
      drapeTexture: null,
    });
    const oldMesh = { material: { dispose() {} } };
    preview._drapeMesh = oldMesh;
    rebuild(preview);
    expect(preview._drapeMesh).toBeNull();
    expect(preview._removeCalls).toContain(oldMesh);
    expect(preview._addCalls).toEqual([]);
  });

  it('no terrain mesh yet: leaves the overlay removed (nothing to share geometry with)', () => {
    const preview = mockPreview({ mesh: null, drapeTexture: { id: 'tex' } });
    rebuild(preview);
    expect(preview._drapeMesh).toBeNull();
    expect(preview._addCalls).toEqual([]);
  });
});

/**
 * H23 item 67 ('Colour edges' toggle): OFF, on a SOLID mesh (one with side
 * walls), swaps the overlay to a top-cap-only index so the drape stops
 * showing on the walls (they fall back to the plain terrain mesh
 * underneath) while the top/bottom caps keep it, same as always.
 */
describe('_rebuildDrapeMesh: the colourEdges toggle (H23 item 67)', () => {
  const geometry = { attributes: { position: { id: 'pos' }, uv: { id: 'uv' } }, index: { array: [0, 1, 2, 3, 4, 5, /* wall faces */ 6, 7, 8] } };

  it('ON (default): the overlay shares the FULL mesh geometry, same as before this item', () => {
    const preview = mockPreview({ mesh: { geometry, material: { side: 1 }, visible: true }, drapeTexture: { id: 'tex' }, meshIsSolid: true, colourEdges: true });
    rebuild(preview);
    expect(preview._drapeMesh.geometry).toBe(geometry);
  });

  it('OFF, solid mesh: the overlay gets a DIFFERENT geometry object (not the shared full one), carrying a top-cap-only index', () => {
    const preview = mockPreview({ mesh: { geometry, material: { side: 1 }, visible: true }, drapeTexture: { id: 'tex' }, meshIsSolid: true, colourEdges: false, lastNx: 3, lastNz: 3 });
    rebuild(preview);
    expect(preview._drapeMesh.geometry).not.toBe(geometry);
    // the wrapper SHARES the same position/uv attribute objects (no copy)
    expect(preview._drapeMesh.geometry.attributes.position).toBe(geometry.attributes.position);
    expect(preview._drapeMesh.geometry.attributes.uv).toBe(geometry.attributes.uv);
    // its own index is top-cap-only (3x3 grid: (3-1)*(3-1)=4 quads x 6 indices x 2 caps = 48, no wall faces)
    expect(preview._drapeMesh.geometry.index.length).toBe(48);
  });

  it('OFF, NOT a solid mesh (no walls to begin with, e.g. buildTopOnlyMesh): the overlay still shares the full geometry unchanged -- nothing to exclude', () => {
    const preview = mockPreview({ mesh: { geometry, material: { side: 1 }, visible: true }, drapeTexture: { id: 'tex' }, meshIsSolid: false, colourEdges: false });
    rebuild(preview);
    expect(preview._drapeMesh.geometry).toBe(geometry);
  });

  it('non-vacuous: flipping colourEdges back ON (same solid mesh) restores the full shared geometry', () => {
    const preview = mockPreview({ mesh: { geometry, material: { side: 1 }, visible: true }, drapeTexture: { id: 'tex' }, meshIsSolid: true, colourEdges: false, lastNx: 3, lastNz: 3 });
    rebuild(preview);
    expect(preview._drapeMesh.geometry).not.toBe(geometry);
    preview._colourEdges = true;
    rebuild(preview);
    expect(preview._drapeMesh.geometry).toBe(geometry);
  });
});

describe('setDrapeTexture: disposes the previous texture and delegates to _rebuildDrapeMesh', () => {
  it('disposes the OLD texture when a new one replaces it', () => {
    const oldTexture = { disposed: false, dispose() { this.disposed = true; } };
    const newTexture = { id: 'new' };
    const preview = mockPreview({ mesh: { geometry: {}, material: { side: 1 }, visible: true } });
    preview._drapeTexture = oldTexture;
    TerrainPreview.prototype.setDrapeTexture.call(preview, newTexture);
    expect(oldTexture.disposed).toBe(true);
    expect(preview._drapeTexture).toBe(newTexture);
    expect(preview._drapeMesh.material.map).toBe(newTexture);
  });

  it('clearing with null disposes the current texture and removes the overlay mesh', () => {
    const oldTexture = { disposed: false, dispose() { this.disposed = true; } };
    const preview = mockPreview({ mesh: { geometry: {}, material: { side: 1 }, visible: true } });
    preview._drapeTexture = oldTexture;
    TerrainPreview.prototype.setDrapeTexture.call(preview, null);
    expect(oldTexture.disposed).toBe(true);
    expect(preview._drapeTexture).toBeNull();
    expect(preview._drapeMesh).toBeNull();
  });
});

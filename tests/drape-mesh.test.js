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
  };
}

function mockPreview({ mesh = null, drapeTexture = null } = {}) {
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

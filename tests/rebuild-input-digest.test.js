/**
 * Item 69 (seat E, measured: 30 sidebar controls rebuilt the 3D without changing it, 1.1-8.2 s at CPU x4, no card):
 * a build whose declared inputs equal the last completed build's is skipped (core/engine/rebuild.js
 * rebuildInputDigest). The inputs are everything a build reads: all of P minus REBUILD_INERT_KEYS, the sculpt deltas,
 * the editor layers, the grid, the preview, the Photo filter's decode state.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { P, DEFAULT, setPreDelta } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { rebuildInputDigest, REBUILD_INERT_KEYS } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';

const HTML = path.resolve(process.cwd(), 'bspline-frame-builder/b-spline-gen/html');
const saved = {};
afterEach(() => { for (const [k, v] of Object.entries(saved)) P[k] = v; setPreDelta(null); window.svgEditor = undefined; });
const setP = (k, v) => { if (!(k in saved)) saved[k] = P[k]; P[k] = v; };

describe('item 69: the rebuild input digest', () => {
  it('is stable for the same inputs', () => {
    expect(rebuildInputDigest(null, 10, 10)).toBe(rebuildInputDigest(null, 10, 10));
  });

  it('ignores the inert keys (sculpt tool / brush, decal opacity)', () => {
    const d0 = rebuildInputDigest(null, 10, 10);
    setP('sculptTopRadius', 3.5); setP('activeSculptLayer', 'top'); setP('decalOpacity', 0.3);
    expect(rebuildInputDigest(null, 10, 10)).toBe(d0);
  });

  it('changes with any other P key, the grid, the sculpt delta contents and the editor layers', () => {
    const d0 = rebuildInputDigest(null, 10, 10);
    setP('smoothIntensity', (P.smoothIntensity || 0) + 0.25);
    const d1 = rebuildInputDigest(null, 10, 10);
    expect(d1).not.toBe(d0);
    expect(rebuildInputDigest(null, 11, 10)).not.toBe(d1);
    const delta = new Float32Array(100); setPreDelta(delta);
    const d2 = rebuildInputDigest(null, 10, 10);
    delta[5] = 0.01; // a sculpt stroke edits the delta IN PLACE
    expect(rebuildInputDigest(null, 10, 10)).not.toBe(d2);
    window.svgEditor = { _layers: [{ id: '0', carve: true, _mask: { body: new Float32Array(4) } }] };
    const d3 = rebuildInputDigest(null, 10, 10);
    window.svgEditor._layers[0]._mask = { body: new Float32Array(4) }; // a remask: a new mask object
    expect(rebuildInputDigest(null, 10, 10)).not.toBe(d3);
  });

  it('every inert key is a real P key (a misnamed one would silently exempt nothing)', () => {
    for (const k of REBUILD_INERT_KEYS) expect(k in DEFAULT, k).toBe(true);
  });

  it('no build module reads an inert key (else it is an input, not inert)', () => {
    const files = ['core/terrain.js', 'core/sculpt.js', ...readdirSync(path.join(HTML, 'core/engine')).map((f) => `core/engine/${f}`),
      ...readdirSync(path.join(HTML, 'core/noise')).filter((f) => f.endsWith('.js')).map((f) => `core/noise/${f}`)];
    for (const f of files) {
      const src = readFileSync(path.join(HTML, f), 'utf8').replace(/REBUILD_INERT_KEYS = new Set\(\[[\s\S]*?\]\);/, '');
      for (const k of REBUILD_INERT_KEYS) expect(src.includes(k), `${f} reads ${k}`).toBe(false);
    }
  });
});

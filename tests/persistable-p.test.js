/**
 * BG1 — regression guard for `persistableP` (core/state.js).
 *
 * `persistableP` is the ONE declared serializer `saveLastSession`,
 * `history.takeSnapshot`, and the Project Manager's `buildSnapshot` all go
 * through — it strips each stamp layer's `.mask` (a Float32Array does not
 * survive `JSON.stringify` intact: it round-trips as `{"0":v,"1":v,...}`, an
 * object, not an array) while leaving every other field untouched, and it
 * must not mutate its input. This guards exactly the corruption A5a-1 found
 * (`core/history.js`'s `takeSnapshot` used to skip this strip entirely).
 */
import { describe, it, expect } from 'vitest';
import { persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function makeP() {
  return {
    widthIn: 24,
    stampLayers: [
      {
        id: 'layer0', name: 'Layer 1', svg: '<svg/>',
        mask: new Float32Array([1, 2, 3]),
        depth: 0.25, profile: 'vbit', enabled: true,
      },
      {
        id: 'layer1', name: 'Layer 2', svg: null,
        mask: new Float32Array([4, 5]),
        depth: -0.5, profile: 'ballnose', enabled: false,
      },
    ],
  };
}

describe('persistableP', () => {
  it('nulls every stampLayer mask', () => {
    const out = persistableP(makeP());
    expect(out.stampLayers[0].mask).toBeNull();
    expect(out.stampLayers[1].mask).toBeNull();
  });

  it('leaves every other field untouched', () => {
    const out = persistableP(makeP());
    expect(out.stampLayers[0]).toMatchObject({
      id: 'layer0', name: 'Layer 1', svg: '<svg/>',
      depth: 0.25, profile: 'vbit', enabled: true,
    });
    expect(out.stampLayers[1]).toMatchObject({
      id: 'layer1', name: 'Layer 2', svg: null,
      depth: -0.5, profile: 'ballnose', enabled: false,
    });
    expect(out.widthIn).toBe(24);
  });

  it('does not mutate its input', () => {
    const input = makeP();
    persistableP(input);
    expect(input.stampLayers[0].mask).toBeInstanceOf(Float32Array);
    expect(input.stampLayers[0].mask[0]).toBe(1);
    expect(input.stampLayers[1].mask).toBeInstanceOf(Float32Array);
  });

  it('produces JSON with no mask blob — the exact A5a-1 corruption', () => {
    const out = persistableP(makeP());
    const json = JSON.stringify(out);
    // A leaked Float32Array serializes as {"0":1,"1":2,"2":3,...} — assert
    // that shape is absent, not just that SOME "mask" substring is missing.
    expect(json).not.toMatch(/"mask":\{"0":/);
    expect(json).toContain('"mask":null');
  });
});

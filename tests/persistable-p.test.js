/**
 * SE4c — regression guard for `persistableP` (core/state.js) after the
 * mirror retirement (SE4-MIRROR-RETIREMENT-DESIGN.md).
 *
 * Before SE4, `persistableP` stripped each stamp layer's `.mask` (a
 * Float32Array does not survive `JSON.stringify` intact: it round-trips as
 * `{"0":v,"1":v,...}`, an object, not an array) — the fix for the exact
 * corruption A5a-1 found (`core/history.js`'s `takeSnapshot` used to skip
 * this strip entirely). SE4c dropped `.mask`/`.svg` from the stampLayers
 * shape itself (content lives only on `editor._layers[i]._mask` /
 * `P.editorSvg` now), so there is nothing left to strip — `persistableP`
 * is identity on layers. This guards THAT invariant: a plain copy, no
 * mutation of the input, and every field carried through untouched.
 */
import { describe, it, expect } from 'vitest';
import { persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';

function makeP() {
  return {
    widthIn: 24,
    stampLayers: [
      { id: 'layer0', name: 'Layer 1', depth: 0.25, profile: 'vbit', enabled: true },
      { id: 'layer1', name: 'Layer 2', depth: -0.5, profile: 'ballnose', enabled: false },
    ],
  };
}

describe('persistableP', () => {
  it('leaves every stampLayer field untouched', () => {
    const out = persistableP(makeP());
    expect(out.stampLayers[0]).toEqual({
      id: 'layer0', name: 'Layer 1', depth: 0.25, profile: 'vbit', enabled: true,
    });
    expect(out.stampLayers[1]).toEqual({
      id: 'layer1', name: 'Layer 2', depth: -0.5, profile: 'ballnose', enabled: false,
    });
    expect(out.widthIn).toBe(24);
  });

  it('copies the layers array and each layer object rather than aliasing them', () => {
    const input = makeP();
    const out = persistableP(input);
    expect(out.stampLayers).not.toBe(input.stampLayers);
    expect(out.stampLayers[0]).not.toBe(input.stampLayers[0]);
  });

  it('does not mutate its input', () => {
    const input = makeP();
    const before = JSON.stringify(input);
    persistableP(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('produces JSON with no mask blob anywhere — the field no longer exists to leak', () => {
    const out = persistableP(makeP());
    const json = JSON.stringify(out);
    // A leaked Float32Array serializes as {"0":1,"1":2,"2":3,...}. There's
    // no `.mask` field in the shape at all any more, so this can't recur —
    // asserted directly rather than assumed from the shape change.
    expect(json).not.toMatch(/"mask"/);
  });
});

/**
 * H22 item 3 (second instance named in H22 item 2's sweep):
 * stamp-mask-manager.js's updateStampMasks looked up P.stampLayers[idx] by
 * POSITION — idx being the editor layer's raw position in editor._layers.
 * P.stampLayers is 3 fixed legacy tooling-default slots; a fresh roster's
 * editor layer ids are '0'/'1'/'2'/... in CREATION order (the same
 * correspondence app-init.js's MIGRATIONS already relies on), so a layer's
 * id IS its legacy slot index — but its ARRAY POSITION is not, once the
 * roster is reordered (H22 item 1) or an earlier layer is deleted.
 *
 * Fix: resolveLegacyStampLayer(eLayer) looks up P.stampLayers by
 * Number(eLayer.id), never by position.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { resolveLegacyStampLayer } from '../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js';

describe('resolveLegacyStampLayer', () => {
  beforeEach(() => {
    // Matches core/state.js's real DEFAULT.stampLayers shape/values.
    P.stampLayers = [
      { id: 'layer0', name: 'Layer 1', depth: 0.25 },
      { id: 'layer1', name: 'Layer 2', depth: -0.5 },
      { id: 'layer2', name: 'Layer 3', depth: 0.75 },
    ];
  });

  it('resolves each editor layer\'s OWN legacy slot by id, not by its position among carved/visible layers', () => {
    // An earlier layer being deleted shifts everyone after it back by one
    // array position without changing their ids -- position-based lookup
    // would have given the id-'2' layer P.stampLayers[1] here instead of
    // its own [2].
    const layers = [
      { id: '1', name: 'B' }, // used to be _layers[1]; now _layers[0] after '0' was deleted
      { id: '2', name: 'C' }, // used to be _layers[2]; now _layers[1]
    ];

    expect(resolveLegacyStampLayer(layers[0]).depth).toBe(-0.5); // id '1' -> P.stampLayers[1] ("Layer 2")
    expect(resolveLegacyStampLayer(layers[1]).depth).toBe(0.75); // id '2' -> P.stampLayers[2] ("Layer 3")
  });

  it('returns {} for a layer whose id has no corresponding legacy slot (created after the first 3, e.g. via Shape Lattice)', () => {
    expect(resolveLegacyStampLayer({ id: '7' })).toEqual({});
  });

  it('returns {} for a non-numeric id (e.g. a pattern-generated kind-layer id) rather than crashing or matching the wrong slot', () => {
    expect(resolveLegacyStampLayer({ id: 'rails' })).toEqual({});
  });

  it('returns {} when P.stampLayers itself is empty/absent', () => {
    P.stampLayers = [];
    expect(resolveLegacyStampLayer({ id: '0' })).toEqual({});
  });
});

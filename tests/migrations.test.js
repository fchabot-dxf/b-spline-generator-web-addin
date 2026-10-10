/**
 * SE4c — MIGRATIONS / runMigrations (main/app-init.js).
 *
 * A pre-SE4 save carried each stamp layer's drawing as a `.svg` field on
 * its own P.stampLayers entry. SE4c retired that field from the shape
 * entirely — content now lives only in the unified editor document
 * (P.editorSvg). The `legacy-stamp-svg` migration is the one-time bridge:
 * on load, if a save still has the old shape, synthesize an editor
 * document from it, populate P.editorSvg, and strip the legacy fields.
 *
 * Three things are guarded here, matching the dispatch's own verify list:
 *  1. A single legacy layer migrates: editorSvg gets populated once, the
 *     legacy field is gone.
 *  2. A two-layer legacy save: EACH layer's content lands under its own
 *     data-layer group (not just the first — the design's own risk note,
 *     since editorRestoreSvg's old `.find()` fallback only ever picked
 *     the first).
 *  3. Running migrations twice is a no-op (idempotent on the new shape).
 */
import { describe, it, expect } from 'vitest';
import { runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';

function svgWith(inner) {
  return `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

describe('runMigrations: legacy-stamp-svg', () => {
  it('migrates a single legacy layer into P.editorSvg and strips the legacy fields', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), mask: 'stale', depth: 0.25, enabled: true },
      ],
    };

    runMigrations(P);

    expect(P.editorSvg).toBeTruthy();
    expect(P.editorSvg).toContain('data-layer="0"');
    expect(P.editorSvg).toContain('<rect');
    expect(P.stampLayers[0].svg).toBeUndefined();
    expect(P.stampLayers[0].mask).toBeUndefined();
    // Tooling untouched.
    expect(P.stampLayers[0].depth).toBe(0.25);
    expect(P.stampLayers[0].enabled).toBe(true);

    // The roster carried in data-editor-layers describes both layers by
    // POSITION (id "0"), not the legacy P.stampLayers id ("layer0") —
    // parse it out rather than assume the string shape.
    const root = new DOMParser().parseFromString(P.editorSvg, 'image/svg+xml').documentElement;
    const roster = JSON.parse(root.getAttribute('data-editor-layers'));
    expect(roster).toHaveLength(1);
    expect(roster[0].id).toBe('0');
    expect(roster[0].depth).toBe(0.25);
  });

  it('migrates EVERY legacy layer with content into its own data-layer group, not just the first', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), depth: 0.25 },
        { id: 'layer1', name: 'Layer 2', svg: svgWith('<circle r="2"/>'), depth: 0.5 },
      ],
    };

    runMigrations(P);

    const root = new DOMParser().parseFromString(P.editorSvg, 'image/svg+xml').documentElement;
    const children = Array.from(root.children);
    const layer0Children = children.filter(ch => ch.getAttribute('data-layer') === '0');
    const layer1Children = children.filter(ch => ch.getAttribute('data-layer') === '1');

    expect(layer0Children).toHaveLength(1);
    expect(layer0Children[0].tagName.toLowerCase()).toBe('rect');
    expect(layer1Children).toHaveLength(1);
    expect(layer1Children[0].tagName.toLowerCase()).toBe('circle');

    expect(P.stampLayers[0].svg).toBeUndefined();
    expect(P.stampLayers[1].svg).toBeUndefined();

    const roster = JSON.parse(root.getAttribute('data-editor-layers'));
    expect(roster.map(l => l.id)).toEqual(['0', '1']);
  });

  it('gives an empty legacy layer (no .svg) its own roster entry with no content, keeping position alignment', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), depth: 0.25 },
        { id: 'layer1', name: 'Layer 2', svg: null, depth: 0.5 },
      ],
    };

    runMigrations(P);

    const root = new DOMParser().parseFromString(P.editorSvg, 'image/svg+xml').documentElement;
    const roster = JSON.parse(root.getAttribute('data-editor-layers'));
    expect(roster).toHaveLength(2);
    expect(roster[1].id).toBe('1');
    expect(Array.from(root.children).some(ch => ch.getAttribute('data-layer') === '1')).toBe(false);
  });

  it('is a no-op the second time (idempotent)', () => {
    const P = {
      editorSvg: null,
      stampLayers: [
        { id: 'layer0', name: 'Layer 1', svg: svgWith('<rect width="1" height="1"/>'), depth: 0.25 },
      ],
    };

    runMigrations(P);
    const first = P.editorSvg;

    runMigrations(P);

    expect(P.editorSvg).toBe(first);
  });

  it('does nothing when there is no legacy content to migrate', () => {
    const P = { editorSvg: null, stampLayers: [{ id: 'layer0', name: 'Layer 1', depth: 0.25 }] };
    runMigrations(P);
    expect(P.editorSvg).toBeNull();
  });

  it('does nothing when P.editorSvg is already populated, even if a legacy field is still present', () => {
    const P = {
      editorSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      stampLayers: [{ id: 'layer0', svg: svgWith('<rect/>'), depth: 0.25 }],
    };
    runMigrations(P);
    expect(P.editorSvg).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(P.stampLayers[0].svg).toBeTruthy(); // untouched — when() gated on !editorSvg
  });
});

/**
 * SE10 AMEND — layer-carve-flag. Before SE10, `visible === false` ALSO
 * meant "don't carve" (there was no other switch). editor/layers.js's own
 * applyToolingDefaults fills a MISSING `carve` with a flat
 * TOOLING_DEFAULTS.carve (true) on restore, which would silently start
 * carving a layer the user had deliberately hidden pre-SE10. This
 * migration gives every already-saved layer its correct HISTORICAL carve
 * value (carve = it was visible) before that flat default ever applies.
 */
describe('runMigrations: layer-carve-flag', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('a hidden layer missing carve gets carve:false (its historical behavior)', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].carve).toBe(false);
  });

  it('a shown layer missing carve gets carve:true', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: true }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].carve).toBe(true);
  });

  it('a layer that already HAS carve is left exactly as saved, not overridden from visible', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false, carve: true }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].carve).toBe(true); // NOT flipped to false by visible
  });

  it('mixed roster: only the layer missing carve is touched', () => {
    const P = {
      editorSvg: editorSvgWithLayers([
        { id: '0', name: 'Layer 1', visible: true },               // missing carve -> gets true
        { id: '1', name: 'Layer 2', visible: false, carve: true },  // already set -> untouched
      ]),
    };
    runMigrations(P);
    const roster = rosterOf(P);
    expect(roster[0].carve).toBe(true);
    expect(roster[1].carve).toBe(true);
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false }]) };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });

  it('does nothing when every layer already has carve', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', visible: false, carve: false }]) };
    const before = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(before);
  });

  it('does nothing (does not throw) when there is no data-editor-layers roster at all', () => {
    const P = { editorSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' };
    expect(() => runMigrations(P)).not.toThrow();
    expect(P.editorSvg).toBe('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  });
});

/**
 * NODE-D — node-radius-to-diameter. A lattice layer's own `.pattern.
 * widths.nodeRadius` (OLD meaning: a radius) becomes `.pattern.widths.
 * nodeDiameter` (NEW meaning: a diameter, doubled) so an already-saved
 * CUSTOM node size survives the rename — the PATTERN_DEFAULTS.widths
 * merge every reader already does would otherwise silently substitute
 * the NEW default for a missing `nodeDiameter` key instead of converting
 * the old value.
 */
describe('runMigrations: node-radius-to-diameter', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('a layer with an old nodeRadius gets nodeDiameter = 2x it, and nodeRadius is removed', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { widths: { rails: 0.3, nodeRadius: 0.1 } } }]) };
    runMigrations(P);
    const widths = rosterOf(P)[0].pattern.widths;
    expect(widths.nodeDiameter).toBeCloseTo(0.2, 10);
    expect(widths.nodeRadius).toBeUndefined();
    expect(widths.rails).toBe(0.3); // untouched
  });

  it('a layer that already has nodeDiameter is left exactly as saved, never re-derived from a stale nodeRadius', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { widths: { nodeRadius: 0.1, nodeDiameter: 0.5 } } }]) };
    runMigrations(P);
    expect(rosterOf(P)[0].pattern.widths.nodeDiameter).toBe(0.5); // NOT 0.2
  });

  it('a layer with no pattern (a plain non-lattice layer) is left untouched, no throw', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1' }]) };
    expect(() => runMigrations(P)).not.toThrow();
    expect(rosterOf(P)[0].pattern).toBeUndefined();
  });

  it('mixed roster: only the layer with a stale nodeRadius is converted', () => {
    const P = {
      editorSvg: editorSvgWithLayers([
        { id: '0', name: 'Layer 1', pattern: { widths: { nodeRadius: 0.2 } } }, // converts to 0.4
        { id: '1', name: 'Layer 2', pattern: { widths: { nodeDiameter: 0.15 } } }, // already migrated, untouched
        { id: '2', name: 'Layer 3' }, // no pattern at all, untouched
      ]),
    };
    runMigrations(P);
    const roster = rosterOf(P);
    expect(roster[0].pattern.widths.nodeDiameter).toBeCloseTo(0.4, 10);
    expect(roster[1].pattern.widths.nodeDiameter).toBe(0.15);
    expect(roster[2].pattern).toBeUndefined();
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { widths: { nodeRadius: 0.1 } } }]) };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });
});

/**
 * T74 AMEND 1 — border-to-contour-width. The separate "Border" clone
 * feature (`.pattern.boundary.border = {enabled, width, color}`) is
 * retired; its ONE surviving concept, width, becomes `.pattern.contour.
 * width` (colour was already redundant with `.pattern.colors.contour`,
 * dropped here). The merged on/off toggle is `.pattern.contour.show`:
 * since an enabled Border was "the thing actually drawn" even when the
 * SE14b contour segments themselves were hidden, an enabled old Border
 * wins the merge, so a document that used to show something visually
 * keeps showing it after migration.
 */
describe('runMigrations: border-to-contour-width', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('Border ON with an explicit width becomes contour.width, contour.show forced true, boundary.border removed', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{
        id: '0', name: 'Layer 1',
        pattern: { boundary: { border: { enabled: true, width: 0.3, color: '#ff0000' } }, contour: { show: false, segmentColors: [] } },
      }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.contour.width).toBe(0.3);
    expect(pat.contour.show).toBe(true); // Border was the thing actually drawn -- wins the merge
    expect(pat.contour.segmentColors).toEqual([]); // untouched, non-border fields survive
    expect(pat.boundary.border).toBeUndefined();
  });

  it('Border OFF with contour.show already true: stays shown, width stays auto (null)', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{
        id: '0', name: 'Layer 1',
        pattern: { boundary: { border: { enabled: false, width: null, color: null } }, contour: { show: true } },
      }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.contour.width).toBeNull();
    expect(pat.contour.show).toBe(true);
    expect(pat.boundary.border).toBeUndefined();
  });

  it('Border OFF with contour.show already false: nothing was visibly drawn before, stays hidden', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{
        id: '0', name: 'Layer 1',
        pattern: { boundary: { border: { enabled: false, width: null, color: null } }, contour: { show: false } },
      }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.contour.show).toBe(false);
    expect(pat.boundary.border).toBeUndefined();
  });

  it('a layer with no boundary.border at all (already-current shape) is left untouched, no throw', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { contour: { show: true, width: 0.2, segmentColors: [] } } }]) };
    expect(() => runMigrations(P)).not.toThrow();
    expect(rosterOf(P)[0].pattern.contour).toEqual({ show: true, width: 0.2, segmentColors: [] });
  });

  it('a layer with no pattern (a plain non-lattice layer) is left untouched, no throw', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1' }]) };
    expect(() => runMigrations(P)).not.toThrow();
    expect(rosterOf(P)[0].pattern).toBeUndefined();
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{
        id: '0', name: 'Layer 1',
        pattern: { boundary: { border: { enabled: true, width: 0.3, color: '#ff0000' } }, contour: { show: false } },
      }]),
    };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });
});

/**
 * T75 (LAT-SIZE) — box-lattice-margin-to-size. The advisor's own decision
 * B: ONE shared `PATTERN.size` (real inches) concept for BOTH lattice
 * tools, retiring the old `PATTERN.margin` (lattice CELLS, box Lattice
 * only) as a driver entirely. An already-saved BOX LATTICE pattern's own
 * margin+spacing converts to an EQUIVALENT explicit `size` exactly once,
 * so an existing save's own rendered extent never moves.
 */
describe('runMigrations: box-lattice-margin-to-size', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('an old save with margin=1 at spacing=0.25 on a 7x9 board converts to size = 6.5 x 8.5 (the SAME real-inches extent the old cell-margin formula already produced, 1e-9)', () => {
    const P = {
      widthIn: 7, heightIn: 9,
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { spacing: 0.25, margin: 1 } }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.size.width).toBeCloseTo(6.5, 9); // 7 - 2*(1*0.25)
    expect(pat.size.height).toBeCloseTo(8.5, 9); // 9 - 2*(1*0.25)
    expect(pat.margin).toBeUndefined(); // retired key, deleted after conversion
  });

  it('an old save with NEITHER margin nor spacing stored (both implicit defaults) converts using the historical defaults (margin=1, spacing=0.25) — the same as if they\'d been written out explicitly', () => {
    const P = {
      widthIn: 7, heightIn: 9,
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { rails: { every: 2, offset: 0 } } }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.size.width).toBeCloseTo(6.5, 9);
    expect(pat.size.height).toBeCloseTo(8.5, 9);
  });

  it('a NON-default margin (2 cells) converts losslessly too, not just the default', () => {
    const P = {
      widthIn: 10, heightIn: 10,
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { spacing: 0.5, margin: 2 } }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    // margin(cells)*spacing = 2*0.5 = 1in per side, 2in total, each axis.
    expect(pat.size.width).toBeCloseTo(8, 9);
    expect(pat.size.height).toBeCloseTo(8, 9);
  });

  it('a Shape Lattice pattern (extent.mode==="boundary") is left completely untouched — its own region mechanism is unrelated to margin/size entirely', () => {
    const P = {
      widthIn: 7, heightIn: 9,
      editorSvg: editorSvgWithLayers([{
        id: '0', name: 'Layer 1',
        pattern: { spacing: 0.25, margin: 1, extent: { mode: 'boundary' }, shape: { source: 'generated', preset: 'hourglass' } },
      }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.size).toBeUndefined(); // never migrated -- reads PATTERN_DEFAULTS.size (null/null) naturally
    expect(pat.margin).toBe(1); // untouched, not even deleted
  });

  it('a layer that already has a size is left exactly as saved, never re-derived from a stale margin', () => {
    const P = {
      widthIn: 7, heightIn: 9,
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { spacing: 0.25, margin: 1, size: { width: 5, height: 5 } } }]),
    };
    runMigrations(P);
    const pat = rosterOf(P)[0].pattern;
    expect(pat.size).toEqual({ width: 5, height: 5 });
  });

  it('a layer with no pattern (a plain non-lattice layer) is left untouched, no throw', () => {
    const P = { widthIn: 7, heightIn: 9, editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1' }]) };
    expect(() => runMigrations(P)).not.toThrow();
    expect(rosterOf(P)[0].pattern).toBeUndefined();
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = {
      widthIn: 7, heightIn: 9,
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { spacing: 0.25, margin: 1 } }]),
    };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });
});

describe('runMigrations: removed-noise-type-to-default (T78 item 10: Biomechanical removed)', () => {
  it('the registry no longer has the Biomechanical filter, and the default filter is in it', async () => {
    const { NoiseModes, NoiseList } = await import('../bspline-frame-builder/b-spline-gen/html/core/noise/index.js');
    const { DEFAULT } = await import('../bspline-frame-builder/b-spline-gen/html/core/state.js');
    expect('xeno' in NoiseModes).toBe(false);
    expect(NoiseList.some((m) => m.id === 'xeno' || /iomechanical/i.test(m.label))).toBe(false);
    expect(DEFAULT.noiseType in NoiseModes).toBe(true);
  });

  it('an old saved xeno project loads with the default filter; its xeno tweaks go, other filters\' tweaks stay', async () => {
    const { DEFAULT } = await import('../bspline-frame-builder/b-spline-gen/html/core/state.js');
    const P = {
      noiseType: 'xeno',
      filterTweaks: { xeno: { spineStrength: 0.9, plateStrength: 0.4 }, chest: { ribAngle: -12 } },
    };
    runMigrations(P);
    expect(P.noiseType).toBe(DEFAULT.noiseType);
    expect(P.filterTweaks.xeno).toBeUndefined();
    expect(P.filterTweaks.chest).toEqual({ ribAngle: -12 });
  });

  it('the migrated project generates terrain without error', async () => {
    const { NoiseModes } = await import('../bspline-frame-builder/b-spline-gen/html/core/noise/index.js');
    const { PerlinNoise } = await import('../bspline-frame-builder/b-spline-gen/html/core/noise.js');
    const P = { noiseType: 'xeno', filterTweaks: { xeno: { spineStrength: 0.9 } } };
    runMigrations(P);
    const fn = NoiseModes[P.noiseType];
    const refs = { noiseFine: new PerlinNoise(1), noiseWarp: new PerlinNoise(2), noiseCoarse: new PerlinNoise(3) };
    const params = { scale: 3.7, octaves: 4, roughness: 0.5, warpIntensity: 1, tweaks: P.filterTweaks[P.noiseType] ?? {} };
    expect(() => {
      for (let i = 0; i < 5; i++) expect(Number.isFinite(fn(i / 4, 0.5, 7 / 9, params, refs))).toBe(true);
    }).not.toThrow();
  });

  it('filters that still exist are left alone, and running twice is a no-op', () => {
    const P = { noiseType: 'chest', filterTweaks: { chest: { ribAngle: 5 } } };
    runMigrations(P);
    runMigrations(P);
    // (2026-10-10: 'photo-mirror-mode' decides the photo mirror mode of any board that has none: no photo -> 'mirror')
    expect(P).toEqual({ noiseType: 'chest', filterTweaks: { chest: { ribAngle: 5 } }, photoMirrorMode: 'whole', photoOrientation: 'upright' });
  });
});

/**
 * F26 — contour-from-frame-outer-edge. `.pattern.contour.fromFrame.distance`'s
 * reference point moved from the frame's INNER edge (the cut profile offset
 * inward by `frame_thickness`) to its OUTER edge directly. `distanceRef:
 * 'outer'` is the declared marker a pattern carries once it is in the new
 * scheme; a saved `distance` without it gets `+= frame_thickness` once (the
 * project's own frame record, `P.frame`) so the contour's ACTUAL drawn
 * position does not move on load.
 */
describe('runMigrations: contour-from-frame-outer-edge', () => {
  function editorSvgWithLayers(roster) {
    const attr = JSON.stringify(roster).replace(/"/g, '&quot;');
    return `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${attr}"></svg>`;
  }
  function rosterOf(p) {
    const root = new DOMParser().parseFromString(p.editorSvg, 'image/svg+xml').documentElement;
    return JSON.parse(root.getAttribute('data-editor-layers'));
  }

  it('an old distance (no distanceRef) gets += the project\'s own frame_thickness, and is marked outer', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { contour: { fromFrame: { on: true, distance: 0.25 } } } } ]),
      frame: { templateId: 'template_1', params: { frame_thickness: 0.5 } },
    };
    runMigrations(P);
    const ff = rosterOf(P)[0].pattern.contour.fromFrame;
    expect(ff.distance).toBeCloseTo(0.75, 10); // 0.25 (old, from the inner edge) + 0.5 (frame_thickness)
    expect(ff.distanceRef).toBe('outer');
    expect(ff.on).toBe(true); // untouched
  });

  it('no frame on record: falls back to the template\'s own shared declared default (0.75), not 0 or a throw', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { contour: { fromFrame: { on: false, distance: 0.1 } } } }]) };
    expect(() => runMigrations(P)).not.toThrow();
    const ff = rosterOf(P)[0].pattern.contour.fromFrame;
    expect(ff.distance).toBeCloseTo(0.85, 10); // 0.1 + 0.75
    expect(ff.distanceRef).toBe('outer');
  });

  it('a pattern already marked distanceRef: outer (a fresh save, or already migrated) is left exactly as saved', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { contour: { fromFrame: { on: true, distance: -0.25, distanceRef: 'outer' } } } }]),
      frame: { templateId: 'template_1', params: { frame_thickness: 0.5 } },
    };
    runMigrations(P);
    const ff = rosterOf(P)[0].pattern.contour.fromFrame;
    expect(ff.distance).toBe(-0.25); // NOT re-converted (would otherwise become 0.25)
  });

  it('a layer with no fromFrame at all (contour off, or no frame ever used) is left untouched, no throw', () => {
    const P = { editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { contour: { show: true } } }]) };
    expect(() => runMigrations(P)).not.toThrow();
    expect(rosterOf(P)[0].pattern.contour.fromFrame).toBeUndefined();
  });

  it('mixed roster: only the unmigrated layer converts', () => {
    const P = {
      editorSvg: editorSvgWithLayers([
        { id: '0', name: 'Layer 1', pattern: { contour: { fromFrame: { on: true, distance: 0.25 } } } }, // converts
        { id: '1', name: 'Layer 2', pattern: { contour: { fromFrame: { on: true, distance: 0.5, distanceRef: 'outer' } } } }, // already migrated
        { id: '2', name: 'Layer 3', pattern: { contour: { show: true } } }, // no fromFrame at all
      ]),
      frame: { templateId: 'template_1', params: { frame_thickness: 0.5 } },
    };
    runMigrations(P);
    const roster = rosterOf(P);
    expect(roster[0].pattern.contour.fromFrame.distance).toBeCloseTo(0.75, 10);
    expect(roster[1].pattern.contour.fromFrame.distance).toBe(0.5); // untouched
    expect(roster[2].pattern.contour.fromFrame).toBeUndefined();
  });

  it('is idempotent — running twice does not change the result', () => {
    const P = {
      editorSvg: editorSvgWithLayers([{ id: '0', name: 'Layer 1', pattern: { contour: { fromFrame: { on: true, distance: 0.25 } } } }]),
      frame: { templateId: 'template_1', params: { frame_thickness: 0.5 } },
    };
    runMigrations(P);
    const first = P.editorSvg;
    runMigrations(P);
    expect(P.editorSvg).toBe(first);
  });
});

describe('runMigrations: brick-scale-to-brickLengthIn (F35 item 16)', () => {
  it('converts a legacy scale into brickLengthIn, relative to the active set\'s own declared length, and strips both legacy fields', () => {
    // Set 1's own declared brickLengthIn is 0.75 (core/bricks/library.js) -- scale 2 on Set 1 means
    // the board was showing 1.5in bricks; that's what must survive the migration unchanged.
    const P = { brickSettings: { setId: 1, scale: 2, frameBrickLengthIn: 1.1, grout: { widthIn: 0.06 } } };
    runMigrations(P);
    expect(P.brickSettings.brickLengthIn).toBeCloseTo(1.5, 9);
    expect(P.brickSettings.scale).toBeUndefined();
    expect(P.brickSettings.frameBrickLengthIn).toBeUndefined();
  });

  it('uses Set 3\'s own declared length (1.1) when that was the active set, not Set 1\'s', () => {
    const P = { brickSettings: { setId: 3, scale: 0.5, grout: { widthIn: 0.06 } } };
    runMigrations(P);
    expect(P.brickSettings.brickLengthIn).toBeCloseTo(0.55, 9);
  });

  it('a save that already has brickLengthIn is left completely alone (not re-derived from a stale scale)', () => {
    const P = { brickSettings: { setId: 1, scale: 2, brickLengthIn: 3, grout: { widthIn: 0.06 } } };
    runMigrations(P);
    expect(P.brickSettings.brickLengthIn).toBe(3);
  });

  it('a fresh save with no brickSettings at all, or no legacy scale field, is a safe no-op', () => {
    expect(() => runMigrations({})).not.toThrow();
    const P = { brickSettings: { setId: 1, brickLengthIn: 0.75, grout: { widthIn: 0.06 } } };
    runMigrations(P);
    expect(P.brickSettings.brickLengthIn).toBe(0.75);
  });
});

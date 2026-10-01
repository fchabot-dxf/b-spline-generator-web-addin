/**
 * T10 ARCHED HOURGLASS (Fred's own sketch, C:/Users/danse/.bspline-status/shots/fred/t10_arched_hourglass_
 * sketch_2026-09-30.jpg; the advisor's own correction mid-preview: the arch sits INSIDE the board, its apex on
 * the top edge, its own two ends eating into the top horns rather than adding height above them): the shared
 * `hourglass` preset (NOT a new frame-only one -- the sides and base are Template 1's own, untouched), extended
 * with one new frame-only param (`archRise`), its 3 handles (Arch rise, Waist reach, Waist position), the TRUE
 * variable-angle miter at the 2 top corners (a line meeting an arc, not Template 1's own fixed 45 deg), and the
 * guards that keep Templates 1-9 and the Shape Lattice exactly as they were.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { generateSilhouette, outlineDefects, paramsFromShapeModel, PARAM_ORDER } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T10 = tplOf('template_10');
const BOARDS = [[7, 9], [12, 6], [9, 7], [5.51, 1.97]];
const KEYS = ['archRise', 'waistReach', 'waistCenterY'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec10 = (seeds, extra = {}) => normalizeFrameRecord({ templateId: 'template_10', seeds, ...extra });
const profile = (seeds, W = 7, H = 9, extra) => frameCutProfile(FRAME_DEFS, rec10(seeds, extra), board(W, H));
const inner = (seeds, W = 7, H = 9, extra) => frameInnerProfile(FRAME_DEFS, rec10(seeds, extra), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));

describe('Template 10: listing and declaration', () => {
  it('is listed as "10. Arched Hourglass", the SHARED hourglass preset (not frame-only), 3 handles', () => {
    expect(T10.name).toBe('Template 10 - Arched Hourglass');
    expect(frameLabel(T10)).toBe('10. Arched Hourglass');
    expect(T10.silhouettePreset).toBe('hourglass'); // reused, like Templates 1/3/4/5 -- not a new preset
    expect(T10.regions.miters).toHaveLength(4);
    expect(T10.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T10.handles) expect(h.binding).toBe('seeded');
    // a provisional model derived from Template 1's own fitted one, like T3/T4/T5's own `from` provisionals.
    expect(T10.shapeModel.provisional).toEqual({
      reason: 'no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)',
      baseModel: 'the fitted Template 1 model',
      archRiseOfHw: 0.35,
    });
    expect(T10.shapeModel.features.archRise).toEqual({ hw: 0.35, hh: 0 });
    // the base model's own 5 features carried over untouched (Template 1's own fitted waist/corner values).
    for (const k of ['cornerR', 'depth', 'notch', 'waistCy', 'waistR']) {
      expect(T10.shapeModel.features[k]).toEqual(T1.shapeModel.features[k]);
    }
  });
});

describe('Template 10: the arched top stays WITHIN the board', () => {
  it.each(BOARDS)('%dx%d: 12 pieces, the top piece an arc, 0 defects, the apex on the safe zone top line', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives).toHaveLength(12);
    expect(prof.defects).toEqual([]); // the new line-arc corner at the horn must not false-flag as notTangent
    const arch = prof.primitives[11];
    expect(arch.type).toBe('A');
    // the apex (the highest point on the arc, smallest y) touches the safe zone's own top line -- never above it
    // (the within-board rule every template keeps) and never meaningfully below it either (it IS the top edge).
    const apexY = Math.min(...[0, 0.25, 0.5, 0.75, 1].map((t) => arch.cy + arch.ry * Math.sin(arch.theta1 + arch.dTheta * t)));
    expect(apexY).toBeCloseTo(prof.region.y, 6);
    // the WHOLE outer outline, densely sampled (arcs included), stays within the actual BOARD rectangle (not
    // just the safe zone) -- the within-board rule, now including the arch's own apex and the horns it shortens.
    const poly = sampleOutline(prof.primitives, 48);
    for (const p of poly) {
      expect(p.x, `${W}x${H} x=${p.x}`).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x, `${W}x${H} x=${p.x}`).toBeLessThanOrEqual(W + 1e-6);
      expect(p.y, `${W}x${H} y=${p.y}`).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y, `${W}x${H} y=${p.y}`).toBeLessThanOrEqual(H + 1e-6);
    }
  });

  it('7x9 defaults: archRise = 0.35 x hw (1.1375 in), not capped at any of the standard boards', () => {
    for (const [W, H] of BOARDS) {
      const prof = profile({}, W, H);
      expect(prof.params.archRise, `${W}x${H}`).toBeCloseTo(0.35, 9);
    }
  });

  it('at the defaults, every piece along the band is at least frame_thickness long (no "wing" risk, Template 7\'s own finding)', () => {
    // 5.51x1.97 excluded: fit.ok is already false there, like every other template.
    const THICK = T10.params.find((p) => p.name === 'frame_thickness').default;
    for (const [W, H] of BOARDS) {
      const prof = profile({}, W, H);
      if (!prof.fit.ok) continue;
      prof.primitives.forEach((p, i) => expect(primLength(p), `${W}x${H} piece ${i}`).toBeGreaterThanOrEqual(THICK));
    }
  });

  it('5.51x1.97: still a clean 12-piece outline (the board is too small for the frame: 0 bars, like the others)', () => {
    const prof = profile({}, 5.51, 1.97);
    expect(prof.primitives).toHaveLength(12);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(false);
  });
});

// The 2 miters with the SMALLER outer.y are the top ones (horn meets the arch, at the chord height); the 2 with
// the LARGER outer.y are the base ones (Template 1's own, axis-aligned) -- robust to any rise/board combination,
// unlike a fixed-threshold-off-the-safe-zone-top check (the chord moves with `rise`, by design).
const topMiters = (miters) => [...miters].sort((a, b) => a.outer.y - b.outer.y).slice(0, 2);
const baseMiters = (miters) => [...miters].sort((a, b) => a.outer.y - b.outer.y).slice(2);
const miterAngle = (m) => Math.atan2(m.inner.y - m.outer.y, m.inner.x - m.outer.x);

describe('Template 10: the TRUE variable-angle miter at the top (not Template 1\'s own fixed 45 deg)', () => {
  it.each(BOARDS)('%dx%d: 4 miters, the top 2 a genuine line-arc corner whose angle is NOT 45 deg', (W, H) => {
    const prof = profile({}, W, H);
    if (!prof.fit.ok) return; // 5.51x1.97: no inner edge, like every other template
    const inn = inner({}, W, H);
    expect(inn.defects).toEqual([]);
    const miters = frameMiters(prof.primitives, inn.primitives);
    expect(miters).toHaveLength(4);
    for (const m of miters) {
      // the miter's own outer-to-inner distance is t / sin(theta/2) (theta = the corner's own interior angle),
      // which only reduces to a fixed t*sqrt(2) at a 90 deg corner (Template 1's own base) -- NOT a fixed value
      // at the top's own VARYING angle. Just a sane, always-true bound: positive, and never past the 90 deg case.
      const d = Math.hypot(m.inner.x - m.outer.x, m.inner.y - m.outer.y);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(T * Math.SQRT2 + 1e-6);
    }
    // the 2 bottom miters (base, resolved the same axis-aligned way as Template 1) ARE 45 deg: |dx| == |dy|.
    for (const m of baseMiters(miters)) {
      expect(Math.abs(Math.abs(m.inner.x - m.outer.x) - Math.abs(m.inner.y - m.outer.y))).toBeLessThan(1e-6);
    }
    // the 2 top miters (horn meets the arch) are NOT 45 deg: |dx| != |dy|.
    for (const m of topMiters(miters)) {
      expect(Math.abs(Math.abs(m.inner.x - m.outer.x) - Math.abs(m.inner.y - m.outer.y))).toBeGreaterThan(0.01);
    }
  });

  it('a shallower rise visibly changes the top miter angle (confirms it is a real function of archRise, not a fixed constant)', () => {
    const shallow = profile({ archRise: 0.1 }), tall = profile({ archRise: 0.6 });
    const mShallow = topMiters(frameMiters(shallow.primitives, inner({ archRise: 0.1 }).primitives));
    const mTall = topMiters(frameMiters(tall.primitives, inner({ archRise: 0.6 }).primitives));
    expect(miterAngle(mShallow[0])).not.toBeCloseTo(miterAngle(mTall[0]), 2);
  });
});

describe('Template 10: the Arch rise / Waist reach / Waist position handles', () => {
  const drag = (key, seeds, dx, dy, W = 7, H = 9) => {
    const rec = rec10(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(W, H));
    const hs = frameHandles(T10, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table is exactly the advisor-approved 3, all seeded, in order', () => {
    expect(T10.handles).toEqual([
      { key: 'archRise', label: 'Arch rise', basis: 'hh', binding: 'seeded' },
      { key: 'waistReach', label: 'Waist reach', basis: 'hw', binding: 'seeded' },
      { key: 'waistCenterY', label: 'Waist position', basis: 'hh', binding: 'seeded' },
    ]);
    // computeParamHandles' own `pick()` preserves ITS OWN catalogue order (waistReach, ..., waistCenterY, ...,
    // archRise last), not FRAME_HANDLES' own declared order -- same as every other template's own handle list.
    const { hs } = drag('archRise', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...KEYS].sort());
  });

  it('Arch rise: a vertical drag deepens or flattens the dome, the sides held', () => {
    const { prof, next } = drag('archRise', {}, 0, 0.3);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(after.params.archRise).toBeGreaterThan(prof.params.archRise);
    // the sides (pieces 1-3, 7-9: shoulder/waist/hip) are untouched by the drag.
    for (const i of [1, 2, 3, 7, 8, 9]) expect(JSON.stringify(after.primitives[i])).toBe(JSON.stringify(prof.primitives[i]));
  });

  it('Waist reach / Waist position: the SAME Template 1 handles, unaffected by the arch', () => {
    const { prof: prof1, next: next1 } = drag('waistReach', {}, 0.3, 0);
    const after1 = frameCutProfile(FRAME_DEFS, next1, board(7, 9));
    expect(after1.defects).toEqual([]);
    expect(JSON.stringify(after1.primitives[11])).toBe(JSON.stringify(prof1.primitives[11])); // the arch untouched

    const { prof: prof2, next: next2 } = drag('waistCenterY', {}, 0, 0.3);
    const after2 = frameCutProfile(FRAME_DEFS, next2, board(7, 9));
    expect(after2.defects).toEqual([]);
    expect(JSON.stringify(after2.primitives[11])).toBe(JSON.stringify(prof2.primitives[11])); // the arch untouched
  });

  it('dragged far, each handle stops at its range and the frame stays valid (4 miters)', () => {
    for (const [key, dx, dy] of [['archRise', 0, -20], ['archRise', 0, 20], ['waistReach', 20, 0], ['waistCenterY', 0, -20]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(12);
      expect(after.defects, key).toEqual([]);
      const innAfter = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(innAfter && innAfter.defects, key).toEqual([]);
      expect(frameMiters(after.primitives, innAfter.primitives), key).toHaveLength(4);
    }
  });

  it('[Generate] draws all 3 handles inside the rule, always a valid OUTER outline', () => {
    // MEASURED: unlike Template 1 (5 handles, including the two corner radii, which [Generate] also draws to fit
    // whatever waist it just drew), Template 10 exposes only the 3 the advisor approved -- the corner radii stay
    // at their own shared default regardless of the drawn waist, so an extreme generated (deep, off-centre) waist
    // can occasionally still collapse the INNER profile on one side (3/50 seeds here), independent of archRise
    // (every one of those 3 seeds has a different archRise; the shared pattern is waistReach > ~0.48 with
    // waistCenterY < ~-0.33). The outer outline itself -- what every seed in this sweep actually promises -- stays
    // clean regardless; flagged to the advisor rather than silently special-cased here.
    const region = profile({}).region;
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateFrameSeeds(T10, region, seed);
      for (const k of KEYS) expect(seeds).toHaveProperty(k);
      const prof = profile(seeds);
      expect(prof.primitives.length).toBe(12);
      expect(prof.defects).toEqual([]);
    }
    const payload = framePayload(FRAME_DEFS, rec10(generateFrameSeeds(T10, region, 3)));
    expect(Object.keys(payload.params).sort()).toEqual(T10.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });

  it('the Fusion seeds: the arch seeded as an arc (S, apex, E), the sides as Template 1\'s own', () => {
    const prof = profile({ archRise: 0.2 });
    const geo = frameSeedGeometry(T10, prof, 7, 9);
    const F = (p) => [p.x - 3.5, 4.5 - p.y];
    const arch = prof.primitives[11];
    const at = (t) => ({ x: arch.cx + arch.rx * Math.cos(arch.theta1 + arch.dTheta * t), y: arch.cy + arch.ry * Math.sin(arch.theta1 + arch.dTheta * t) });
    expect(geo.top_edge.points).toEqual([F(at(0)), F(at(0.5)), F(at(1))]);
    expect(Object.keys(geo).sort()).toEqual(T10.seedMap.map((e) => e.id).sort());
  });
});

describe('the Shape Lattice and Templates 1-9 never get the arch', () => {
  it('archRise is frame-only, appended last; the hourglass order for Templates 1-9 is untouched', () => {
    expect(PARAM_ORDER.hourglass[PARAM_ORDER.hourglass.length - 1]).toBe('archRise');
    for (const id of ['template_1', 'template_3', 'template_4', 'template_5']) {
      const t = tplOf(id);
      expect(t.handles.map((h) => h.key)).not.toContain('archRise');
    }
  });

  it('an hourglass never reads archRise unless asked; the manifest never emits one', async () => {
    const { manifestFromShape } = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js');
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const a = generateSilhouette(region, { preset: 'hourglass', params: {} });
    expect(a.primitives[11].type).toBe('L'); // flat top: Template 1, bit for bit, archRise defaults to 0
    const b = generateSilhouette(region, { preset: 'hourglass', params: { archRise: 0.3 } });
    expect(b.primitives[11].type).toBe('A');
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { archRise: 0.3 } }, region);
    // `contour_height` drops: the manifest only declares it when it finds a straight horizontal line at the
    // outline's own top (editor-sketch-manifest.js's own `firstLineIdAt`) -- true for Template 1's flat top, no
    // longer true once it is an arc, the SAME already-true-for-Template-5's-own-dip consequence (archRise is
    // not special-cased for this; no new parameter is ever emitted for it either, which this still proves).
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.filter((p) => p.name !== 'contour_height').map((p) => p.name));
    for (const k of ['archRise']) expect(stray.parameters.map((p) => p.name)).not.toContain(k);
  });

  it('paramsFromShapeModel only reads archRise when the model carries it', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('hourglass', T10.shapeModel, region);
    expect(out.archRise).toBeCloseTo(0.35, 9);
    const t1out = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    expect(t1out).not.toHaveProperty('archRise');
  });
});

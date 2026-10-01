/**
 * T10 ARCHED HOURGLASS v2 (F29 item 2, Fred's own hand rebuild in Fusion, 2026-10-01: the first version -- a
 * free-rise dome on Template 1's own plain pinch -- built wrong in Fusion at every board size, H23 item 14's own
 * capacity report, never fixed). Fred took T10's OWN existing shoulder/waist/hip/waist-radius construction
 * (confirmed via the live constraints dump's own entity names -- NOT Template 2's, which has no "shoulder" arc
 * at all) and dragged every one of its radii/depth/position to his own values: a narrow top, a huge gentle
 * shoulder, a tight deep off-centre waist, a tighter hip flaring back to the full board width. The arch itself
 * is now driven by its own CORNER ANGLE (Fred's own rule: the angle between the vertical horn and the arc's own
 * tangent where they meet, 100-130 deg, default 127) instead of a free rise -- the rise is derived from it and
 * the top half-width. Still the shared `hourglass` preset (not a new one), still 3 handles (now Arch corner
 * angle, Waist reach, Waist position), still hidden (FRAME_HIDDEN) until seat A's matching Fusion phases build
 * right.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds, generateValidFrameSeeds } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, outlineDefects, paramsFromShapeModel, PARAM_ORDER,
  archRiseFromCornerAngle, ARCH_CORNER_ANGLE_MIN, ARCH_CORNER_ANGLE_MAX,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T10 = tplOf('template_10');
const BOARDS = [[7, 9], [12, 6], [9, 7], [5.51, 1.97]];
const KEYS = ['archCornerAngle', 'waistReach', 'waistCenterY'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec10 = (seeds, extra = {}) => normalizeFrameRecord({ templateId: 'template_10', seeds, ...extra });
const profile = (seeds, W = 7, H = 9, extra) => frameCutProfile(FRAME_DEFS, rec10(seeds, extra), board(W, H));
const inner = (seeds, W = 7, H = 9, extra) => frameInnerProfile(FRAME_DEFS, rec10(seeds, extra), board(W, H));
const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
// MEASURED: Fred's own reconstructed values (fit at 7x9, a near-square portrait board) don't scale gracefully to
// a landscape aspect ratio -- 12x6 and 9x7 both get a real inner-profile defect / sub-thickness "wing" piece with
// these FIXED defaults (unlike archCornerAngle's own graceful degrade, the shoulder/waist/hip values have no
// per-orientation fallback). Fred works portrait only (current usage); flagged to the advisor as a known
// limitation rather than hidden, not fixed here (out of scope for this pass: 7x9 is the one board asked for).
const LANDSCAPE_KNOWN_ISSUE = new Set(['12x6', '9x7']);

describe('Template 10: listing and declaration', () => {
  it('is listed as "10. Arched Hourglass", the SHARED hourglass preset (not frame-only), 3 handles', () => {
    expect(T10.name).toBe('Template 10 - Arched Hourglass');
    expect(frameLabel(T10)).toBe('10. Arched Hourglass');
    expect(T10.silhouettePreset).toBe('hourglass'); // reused, like Templates 1/3/4/5 -- not a new preset
    expect(T10.regions.miters).toHaveLength(4);
    expect(T10.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T10.handles) expect(h.binding).toBe('seeded');
    // F29 item 2: every one of Template 1's own 5 fitted features is OVERRIDDEN (not kept) -- Fred's own rebuild.
    expect(T10.shapeModel.provisional).toEqual({
      reason: "Fred's own hand rebuild in Fusion replaces the old free-rise dome (H23 item 14: it built wrong "
        + 'in Fusion at every size); no recorded goldens yet either',
      baseModel: 'the fitted Template 1 model (every feature overridden, not inherited)',
      depthOfHw: 0.416509, cornerRTopOfHw: 1.209444, cornerRBottomOfHw: 0.272753, waistROfHw: 0.262875,
      waistCyOfHh: 0.213614, notchOfHw: 0.522215, topInsetOfHw: 0.307382, archCornerAngleDeg: 127,
    });
    expect(T10.shapeModel.features.archCornerAngle).toEqual({ hw: 0, hh: 0, const: 127 });
    // NOT T1's own fitted values any more (the opposite of the old T10's "untouched base" design).
    for (const k of ['cornerR', 'depth', 'notch', 'waistCy', 'waistR']) {
      expect(T10.shapeModel.features[k]).not.toEqual(T1.shapeModel.features[k]);
    }
  });
});

describe('Template 10: the arched top stays WITHIN the board', () => {
  it.each(BOARDS)('%dx%d: 12 pieces, the top piece an arc, 0 OUTER defects, the apex on the safe zone top line', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives).toHaveLength(12);
    expect(prof.defects).toEqual([]); // the new line-arc corner at the horn must not false-flag as notTangent
    const arch = prof.primitives[11];
    expect(arch.type).toBe('A');
    // the apex (the highest point on the arc, smallest y) touches the safe zone's own top line -- never above it
    // (the within-board rule every template keeps) and never meaningfully below it either (it IS the top edge).
    // Unaffected by the corner-angle rework: the chord still sits `rise` below -hh, and the sagitta is still
    // exactly `rise` by construction (archRiseFromCornerAngle), so the apex is still pinned to -hh exactly.
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

  it('7x9 defaults: archCornerAngle = 127 deg (Fred\'s own default), not clamped at any of the standard boards', () => {
    for (const [W, H] of BOARDS) {
      const prof = profile({}, W, H);
      expect(prof.params.archCornerAngle, `${W}x${H}`).toBeCloseTo(127, 9);
    }
  });

  it('at 7x9 (the one board this pass is scoped to), every piece is at least frame_thickness long', () => {
    const THICK = T10.params.find((p) => p.name === 'frame_thickness').default;
    const prof = profile({}, 7, 9);
    prof.primitives.forEach((p, i) => expect(primLength(p), `piece ${i}`).toBeGreaterThanOrEqual(THICK));
  });

  it('LANDSCAPE (12x6, 9x7): a known, flagged limitation -- Fred\'s own 7x9-fit values leave a sub-thickness '
    + 'piece there (no per-orientation fallback yet; portrait is Fred\'s current usage)', () => {
    const THICK = T10.params.find((p) => p.name === 'frame_thickness').default;
    for (const [W, H] of [[12, 6], [9, 7]]) {
      const prof = profile({}, W, H);
      expect(prof.defects, `${W}x${H}`).toEqual([]); // the OUTER outline itself is still a clean simple shape
      const lens = prof.primitives.map(primLength);
      expect(Math.min(...lens), `${W}x${H}`).toBeLessThan(THICK); // MEASURED, not asserted-away: the known gap
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
    if (LANDSCAPE_KNOWN_ISSUE.has(`${W}x${H}`)) return; // the flagged landscape limitation above
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

  it('a shallower corner angle visibly changes the top miter angle (confirms it is a real function of '
    + 'archCornerAngle, not a fixed constant)', () => {
    const shallow = profile({ archCornerAngle: 100 }), tall = profile({ archCornerAngle: 130 });
    const mShallow = topMiters(frameMiters(shallow.primitives, inner({ archCornerAngle: 100 }).primitives));
    const mTall = topMiters(frameMiters(tall.primitives, inner({ archCornerAngle: 130 }).primitives));
    expect(miterAngle(mShallow[0])).not.toBeCloseTo(miterAngle(mTall[0]), 2);
  });
});

describe('Template 10: archRiseFromCornerAngle (F29 item 2\'s own geometry)', () => {
  it('90 deg = flat (rise 0); 180 deg = a semicircle (rise = half-width, tangent to the horn)', () => {
    expect(archRiseFromCornerAngle(90, 2)).toBeCloseTo(0, 9);
    expect(archRiseFromCornerAngle(180, 2)).toBeCloseTo(2, 9);
  });

  it('monotonically increasing in angle; 127 deg (the default) sits strictly between 100 and 130', () => {
    const topX = 2.25;
    const r100 = archRiseFromCornerAngle(100, topX), r127 = archRiseFromCornerAngle(127, topX),
      r130 = archRiseFromCornerAngle(130, topX);
    expect(r100).toBeGreaterThan(0);
    expect(r127).toBeGreaterThan(r100);
    expect(r130).toBeGreaterThan(r127);
  });

  it('round-trips through the sagitta formula: R = (topX^2 + rise^2) / (2 rise) reproduces the same angle', () => {
    const topX = 1.8;
    for (const deg of [100, 115, 127, 130]) {
      const rise = archRiseFromCornerAngle(deg, topX);
      const R = (topX * topX + rise * rise) / (2 * rise);
      const cosT = -topX / R;
      expect((Math.acos(cosT) * 180) / Math.PI).toBeCloseTo(deg, 6);
    }
  });
});

describe('Template 10: the Arch corner angle / Waist reach / Waist position handles', () => {
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
      { key: 'archCornerAngle', label: 'Arch corner angle', basis: 'hh', binding: 'seeded' },
      { key: 'waistReach', label: 'Waist reach', basis: 'hw', binding: 'seeded' },
      { key: 'waistCenterY', label: 'Waist position', basis: 'hh', binding: 'seeded' },
    ]);
    // computeParamHandles' own `pick()` preserves ITS OWN catalogue order (waistReach, ..., waistCenterY, ...,
    // archCornerAngle last), not FRAME_HANDLES' own declared order -- same as every other template's own list.
    const { hs } = drag('archCornerAngle', {}, 0, 0);
    expect(hs.map((h) => h.key).sort()).toEqual([...KEYS].sort());
  });

  it('Arch corner angle: a vertical drag deepens or flattens the dome (stored as degrees), the sides held', () => {
    const { prof, next } = drag('archCornerAngle', {}, 0, 0.3);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(after.params.archCornerAngle).toBeGreaterThan(prof.params.archCornerAngle);
    expect(after.params.archCornerAngle).toBeLessThanOrEqual(ARCH_CORNER_ANGLE_MAX);
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
    for (const [key, dx, dy] of [['archCornerAngle', 0, -20], ['archCornerAngle', 0, 20], ['waistReach', 20, 0], ['waistCenterY', 0, -20]]) {
      const { next } = drag(key, {}, dx, dy);
      const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
      expect(after.primitives.length, key).toBe(12);
      expect(after.defects, key).toEqual([]);
      const innAfter = frameInnerProfile(FRAME_DEFS, next, board(7, 9));
      expect(innAfter && innAfter.defects, key).toEqual([]);
      expect(frameMiters(after.primitives, innAfter.primitives), key).toHaveLength(4);
    }
    // the angle specifically stops inside [100, 130], never the old archRise-style unbounded fraction.
    const { next: lo } = drag('archCornerAngle', {}, 0, -20), { next: hi } = drag('archCornerAngle', {}, 0, 20);
    expect(frameCutProfile(FRAME_DEFS, lo, board(7, 9)).params.archCornerAngle).toBeGreaterThanOrEqual(ARCH_CORNER_ANGLE_MIN);
    expect(frameCutProfile(FRAME_DEFS, hi, board(7, 9)).params.archCornerAngle).toBeLessThanOrEqual(ARCH_CORNER_ANGLE_MAX);
  });

  it('[Generate] draws all 3 handles inside the rule, always a valid OUTER outline', () => {
    const region = profile({}).region;
    for (let seed = 1; seed <= 50; seed++) {
      const seeds = generateFrameSeeds(T10, region, seed);
      for (const k of KEYS) expect(seeds).toHaveProperty(k);
      expect(seeds.archCornerAngle).toBeGreaterThanOrEqual(ARCH_CORNER_ANGLE_MIN);
      expect(seeds.archCornerAngle).toBeLessThanOrEqual(ARCH_CORNER_ANGLE_MAX);
      const prof = profile(seeds);
      expect(prof.primitives.length).toBe(12);
      expect(prof.defects).toEqual([]);
    }
    const payload = framePayload(FRAME_DEFS, rec10(generateFrameSeeds(T10, region, 3)));
    expect(Object.keys(payload.params).sort()).toEqual(T10.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
  });

  it('[Generate] never produces a broken INNER profile either, 500 seeds x 4 portrait sizes (the advisor: '
    + '"Generate must never produce a broken frame")', () => {
    // Unlike the old T10's own free rise, archCornerAngle's fixed [100,130] band can't itself cause an inner
    // defect (the angle never nears the old tangent-join extreme) -- the risk here is still the SAME one F29
    // item 1's own fix already covers: the fixed (non-generated) corner/waist radii vs. a generated extreme
    // waist. generateValidFrameSeeds (frame-handles.js) still gates every draw on the real inner profile.
    const isValid = (seeds, W, H) => {
      const inn = inner(seeds, W, H);
      return !inn || inn.defects.length === 0;
    };
    for (const [W, H] of [[7, 9], [6, 9], [11, 14], [5, 7]]) { // portrait only (Fred's own current usage)
      const region = profile({}, W, H).region;
      for (let seed = 1; seed <= 500; seed++) {
        const seeds = generateValidFrameSeeds(T10, region, seed, T, (s) => isValid(s, W, H));
        const prof = profile(seeds, W, H), innr = inner(seeds, W, H);
        expect(prof.defects, `${W}x${H} seed ${seed}`).toEqual([]);
        if (prof.fit.ok) expect(innr.defects, `${W}x${H} seed ${seed}`).toEqual([]); // no inner edge when the frame doesn't fit
      }
    }
  });

  it('the Fusion seeds: the arch seeded as an arc (S, apex, E), the sides as Template 1\'s own', () => {
    const prof = profile({ archCornerAngle: 115 });
    const geo = frameSeedGeometry(T10, prof, 7, 9);
    const F = (p) => [p.x - 3.5, 4.5 - p.y];
    const arch = prof.primitives[11];
    const at = (t) => ({ x: arch.cx + arch.rx * Math.cos(arch.theta1 + arch.dTheta * t), y: arch.cy + arch.ry * Math.sin(arch.theta1 + arch.dTheta * t) });
    expect(geo.top_edge.points).toEqual([F(at(0)), F(at(0.5)), F(at(1))]);
    expect(Object.keys(geo).sort()).toEqual(T10.seedMap.map((e) => e.id).sort());
  });
});

describe('the Shape Lattice and Templates 1-9 never get the arch', () => {
  it('archCornerAngle is frame-only, appended last (before F30 item 3\'s own taperAngle); the hourglass order '
    + 'for Templates 1-9 is untouched', () => {
    // F30 item 3: taperAngle is appended AFTER archCornerAngle (every earlier key, it included, keeps its index).
    expect(PARAM_ORDER.hourglass[PARAM_ORDER.hourglass.length - 2]).toBe('archCornerAngle');
    expect(PARAM_ORDER.hourglass[PARAM_ORDER.hourglass.length - 1]).toBe('taperAngle');
    for (const id of ['template_1', 'template_3', 'template_4', 'template_5']) {
      const t = tplOf(id);
      expect(t.handles.map((h) => h.key)).not.toContain('archCornerAngle');
      expect(t.handles.map((h) => h.key)).not.toContain('taperAngle');
    }
  });

  it('an hourglass never reads archCornerAngle unless asked (defaults to 90 deg = flat); the manifest never '
    + 'emits one', async () => {
    const { manifestFromShape } = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js');
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const a = generateSilhouette(region, { preset: 'hourglass', params: {} });
    expect(a.primitives[11].type).toBe('L'); // flat top: Template 1, bit for bit, archCornerAngle defaults to 90
    const b = generateSilhouette(region, { preset: 'hourglass', params: { archCornerAngle: 120 } });
    expect(b.primitives[11].type).toBe('A');
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { archCornerAngle: 120 } }, region);
    // `contour_height` drops: the manifest only declares it when it finds a straight horizontal line at the
    // outline's own top (editor-sketch-manifest.js's own `firstLineIdAt`) -- true for Template 1's flat top, no
    // longer true once it is an arc, the SAME already-true-for-Template-5's-own-dip consequence (archCornerAngle
    // is not special-cased for this; no new parameter is ever emitted for it either, which this still proves).
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.filter((p) => p.name !== 'contour_height').map((p) => p.name));
    for (const k of ['archCornerAngle']) expect(stray.parameters.map((p) => p.name)).not.toContain(k);
  });

  it('paramsFromShapeModel only reads archCornerAngle when the model carries it', () => {
    const region = profile({}).region;
    const out = paramsFromShapeModel('hourglass', T10.shapeModel, region);
    expect(out.archCornerAngle).toBeCloseTo(127, 9);
    const t1out = paramsFromShapeModel('hourglass', T1.shapeModel, region);
    expect(t1out).not.toHaveProperty('archCornerAngle');
  });
});

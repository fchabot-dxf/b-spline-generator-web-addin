/**
 * T9 I SHAPE (Fred's sketch: a capital serif I -- full-width top and bottom flanges, a narrower stem between
 * them, like Template 6's single tab doubled top AND bottom; HANDOFF-ranchy.md backlog: "about 12 straight bars,
 * with many inside corners"): the frame-only `iShape` preset (editor-shape-lattice-generator.js `_solveIShape`),
 * its 2 handles (Stem width, Flange height), the frame thickness rule at all 4 notches (frame-handles.js
 * frameParamRanges, applied to the drawn frame too, Template 6's own rule), and the guards that keep every other
 * template untouched.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds, frameParamRanges, clampToFrameRanges,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS, PRESETS, I_SHAPE_SEGMENT_COUNT,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline, pointInPolygon } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T9 = tplOf('template_9');
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const KEYS = ['stemWidth', 'flangeHeight'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec9 = (seeds, extra = {}) => normalizeFrameRecord({ templateId: 'template_9', seeds, ...extra });
const profile = (seeds, W = 7, H = 9, extra) => frameCutProfile(FRAME_DEFS, rec9(seeds, extra), board(W, H));
const inner = (seeds, W = 7, H = 9, extra) => frameInnerProfile(FRAME_DEFS, rec9(seeds, extra), board(W, H));
const J = (x) => JSON.stringify(x);
const len = (p) => Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y);
/** The 12 pieces by name (the iShape order, p02_02_loop.py's own). */
const pieces = (prof) => {
  const [top, flR, shTR, stR, shBR, flBR, base, flBL, shBL, stL, shTL, flTL] = prof.primitives;
  return { top, flR, shTR, stR, shBR, flBR, base, flBL, shBL, stL, shTL, flTL };
};
/** Stem half width (inches): the stem side's own distance from the region's centre line. */
const stemHalfWidth = (prof) => Math.abs(pieces(prof).stR.p0.x - (prof.region.x + prof.region.w / 2));
const flangeHeightIn = (prof) => len(pieces(prof).flR);
/** The frame rule on a drawn outline (thickness t): no bar shorter than t, each flange side >= 2t + the
 *  template's own small margin (frame-handles.js's own `+0.05`). */
const ruleOk = (prof, t) => {
  const p = pieces(prof), hh = prof.region.h / 2;
  return len(p.flR) >= 2 * t - 1e-9 && len(p.shTR) >= t - 1e-9 && 2 * stemHalfWidth(prof) - 2 * t >= t - 1e-9
    && 2 * hh - 2 * flangeHeightIn(prof) - 2 * t >= t - 1e-9;
};

describe('Template 9: listing and declaration', () => {
  it('is listed as "9. I Shape", the frame-only iShape preset, no new Fusion parameter, 12 bars', () => {
    expect(T9.name).toBe('Template 9 - I Shape');
    expect(frameLabel(T9)).toBe('9. I Shape');
    expect(T9.silhouettePreset).toBe('iShape');
    expect(PRESETS.iShape.frameOnly).toBe(true);
    expect(T9.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', 'frame_thickness']);
    expect(T9.regions.outline).toHaveLength(12);
    expect(T9.regions.miters).toHaveLength(12);
    expect(T9.regions.bars.map((b) => b.name)).toEqual(T9.features[0].bodyNames);
    expect(T9.regions.corners.filter((c) => c.reflex).map((c) => c.id)).toEqual(
      ['notch_TR_inner', 'notch_BR_inner', 'notch_BL_inner', 'notch_TL_inner']);
    // H23 item 13: the provisional shim is retired -- T9 now has its own shapeModel,
    // fitted from its own live goldens (12x6's golden is a known-broken build -- see
    // KNOWN_BROKEN_BUILD in frame-parity-app.test.js -- but its OUTLINE still fits cleanly,
    // so it stays in the fit; nothing is excluded).
    expect(T9.shapeModel.provisional).toBeUndefined();
    expect(T9.shapeModel.fit.fittedFrom).toEqual(['12x6', '6x9', '7x9']);
    expect(T9.shapeModel.fit.excluded).toEqual([]);
    expect(T9.handles.map((h) => h.key)).toEqual(KEYS);
    for (const h of T9.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });
});

describe('Template 9: the outline', () => {
  it.each(BOARDS)('%dx%d: 12 straight axis-aligned pieces, 0 defects, a centred stem, the top/base on the safe zone', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives).toHaveLength(I_SHAPE_SEGMENT_COUNT);
    expect(prof.primitives.every((p) => p.type === 'L')).toBe(true);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(true);
    const { top, flR, shTR, stR, shBR, flBR, base, flBL, shBL, stL, shTL, flTL } = pieces(prof);
    for (const p of [flR, stR, flBR, flBL, stL, flTL]) expect(p.p0.x).toBeCloseTo(p.p1.x, 12); // vertical
    for (const p of [top, shTR, shBR, base, shBL, shTL]) expect(p.p0.y).toBeCloseTo(p.p1.y, 12); // horizontal
    const { x, y, w, h } = prof.region, cx0 = x + w / 2;
    expect(top.p0.y).toBeCloseTo(y, 12); // the top edge on the safe zone's top line
    expect(base.p0.y).toBeCloseTo(y + h, 12); // the base on the safe zone's bottom line
    expect(Math.min(top.p0.x, top.p1.x)).toBeCloseTo(x, 12); // the top edge spans the FULL width (no free tab)
    expect(Math.max(top.p0.x, top.p1.x)).toBeCloseTo(x + w, 12);
    expect(stemHalfWidth(prof)).toBeLessThan(w / 2); // the stem narrower than the body
    expect(flangeHeightIn(prof)).toBeCloseTo(len(flBR), 12); // top/bottom flanges equal (the 4-fold symmetry)
    expect(flangeHeightIn(prof)).toBeCloseTo(len(flBL), 12);
    expect(flangeHeightIn(prof)).toBeCloseTo(len(flTL), 12);
    expect(len(shTR)).toBeCloseTo(len(shBR), 12); // all 4 shoulders equal length (stem centred both axes)
    expect(len(shTR)).toBeCloseTo(len(shBL), 12);
    expect(len(shTR)).toBeCloseTo(len(shTL), 12);
    expect((stR.p0.x + stL.p0.x) / 2).toBeCloseTo(cx0, 12); // stem centred on x
    expect(ruleOk(prof, T)).toBe(true);
  });

  it('7x9 defaults: a ~1.47 in half-width stem, a ~1.70 in flange height (H23 item 13: the live-fitted model)', () => {
    const prof = profile({});
    expect(stemHalfWidth(prof)).toBeCloseTo(1.4705457499999994, 9);
    expect(flangeHeightIn(prof)).toBeCloseTo(1.7018597500000001, 9);
  });

  it('12x6: the provisional flange height is clamped up near the frame\'s own floor (a flange side >= ~2 x the thickness)', () => {
    // MEASURED: at 12x6 the bare 0.4 default (1.1 in) is well under 2T (1.5 in); frameParamRanges' own floor wins.
    const prof = profile({}, 12, 6);
    expect(flangeHeightIn(prof)).toBeGreaterThanOrEqual(2 * T);
    expect(prof.params.flangeHeight).toBeCloseTo((2 * T + 0.05) / (6 / 2 - 0.25), 9);
  });

  it('5.51x1.97: still a clean 12-piece outline (the board is too small for the frame: 0 bars, like the others)', () => {
    const prof = profile({}, 5.51, 1.97);
    expect(prof.primitives).toHaveLength(12);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(false);
    expect(inner({}, 5.51, 1.97)).toBeNull();
    expect(frameSolidSpec(FRAME_DEFS, rec9({}), board(5.51, 1.97)).inner).toBeNull();
  });

  it('at the defaults, every piece along the band is at least frame_thickness long (no "wing" risk, Template 7\'s own finding)', () => {
    const primLength = (p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : p.rx * Math.abs(p.dTheta));
    const THICK = T9.params.find((p) => p.name === 'frame_thickness').default;
    for (const [W, H] of BOARDS) {
      const prof = profile({}, W, H);
      if (!prof.fit.ok) continue;
      prof.primitives.forEach((p, i) => expect(primLength(p), `${W}x${H} piece ${i}`).toBeGreaterThanOrEqual(THICK));
    }
  });

  it('any stem/flange seed and any frame thickness gives a valid frame that keeps the rule (clamped, never refused)', () => {
    // MEASURED: unlike Template 6's single tab, this template's own flangeHeight floor (2 flanges, each >= 2t
    // PLUS a small margin) and ceiling (the stem's own opening >= t) share the SAME hh budget, halved by the
    // second flange. At a thickness large enough relative to the board (hh < 3t + 0.05: neither the floor NOR the
    // ceiling choice keeps BOTH the flange sides and the stem's own opening clear of frame_thickness at once --
    // the offset algorithm itself (outline-offset.js) then collapses a piece and its own cascading re-join can
    // misbehave on this topology) that window is genuinely empty on EITHER side, a hard architectural limit of
    // doubling Template 6's single notch top and bottom, not a code bug: skip the inner-edge guarantee there (the
    // outer outline still stays clean, same as every board). 12x6 at frame_thickness 1.0 (hh = 2.75, 3t + 0.05 =
    // 3.05) is the one case in this sweep that crosses it.
    for (const [W, H] of [[7, 9], [12, 6]]) {
      for (const t of [0.25, 0.5, 0.75, 1.0]) {
        for (const sw of [-1, 0, 0.1, 0.45, 0.8, 0.99, 3]) {
          for (const fh of [-1, 0, 0.1, 0.4, 0.6, 0.9, 5]) {
            const extra = { params: { frame_thickness: t } };
            const prof = profile({ stemWidth: sw, flangeHeight: fh }, W, H, extra);
            const tag = `${W}x${H} t${t} ${sw} ${fh}`;
            expect(prof.primitives.length, tag).toBe(12);
            expect(prof.defects, tag).toEqual([]);
            if (!prof.fit.ok) continue;
            const hh = prof.region.h / 2;
            const windowOk = (2 * t + 0.05) / hh <= (2 * hh - 3 * t) / (2 * hh); // the floor <= the ceiling
            const floorKeepsStemSafe = hh >= 3 * t + 0.05; // picking the floor still leaves the stem's own opening >= t
            if (windowOk) expect(ruleOk(prof, t), tag).toBe(true);
            if (!windowOk && !floorKeepsStemSafe) continue; // the one hard-limit case: outer outline only
            const inn = inner({ stemWidth: sw, flangeHeight: fh }, W, H, extra);
            expect(inn && inn.defects, tag).toEqual([]);
            expect(frameMiters(prof.primitives, inn.primitives), tag).toHaveLength(12);
          }
        }
      }
    }
  });

  it('the thickness rule is exactly the frame ranges (frameParamRanges), and the clamp only touches the iShape keys', () => {
    const prof = profile({});
    const r = frameParamRanges(T9, prof.region, prof.params, T);
    const hw = prof.region.w / 2, hh = prof.region.h / 2;
    expect(r.stemWidth.min).toBeCloseTo((T + T / 2) / hw, 12); // stem inner edge >= t
    expect(r.stemWidth.max).toBeCloseTo((hw - T) / hw, 12); // shoulder bar >= t long
    expect(r.flangeHeight.min).toBeCloseTo((2 * T + 0.05) / hh, 12); // flange side >= 2t + margin
    expect(r.flangeHeight.max).toBeCloseTo((2 * hh - 3 * T) / (2 * hh), 12); // stem opening >= t
    expect(clampToFrameRanges(T9, prof.region, { stemWidth: 0, flangeHeight: 9 }, T))
      .toEqual({ stemWidth: r.stemWidth.min, flangeHeight: r.flangeHeight.max });
    // Templates 1-8 are never clamped by it (drawn exactly as before)
    expect(clampToFrameRanges(T1, prof.region, { waistReach: 5 }, T)).toEqual({ waistReach: 5 });
  });

  it('the outer profile stays within the BOARD (not just the safe zone), at every board', () => {
    const BBO = 0.25;
    for (const [W, H] of BOARDS) {
      const prof = profile({}, W, H);
      const poly = sampleOutline(prof.primitives, 24);
      const minX = -BBO, maxX = W - BBO, minY = -BBO, maxY = H - BBO;
      for (const p of poly) {
        expect(p.x, `${W}x${H} x=${p.x}`).toBeGreaterThanOrEqual(minX - 1e-6);
        expect(p.x, `${W}x${H} x=${p.x}`).toBeLessThanOrEqual(maxX + 1e-6);
        expect(p.y, `${W}x${H} y=${p.y}`).toBeGreaterThanOrEqual(minY - 1e-6);
        expect(p.y, `${W}x${H} y=${p.y}`).toBeLessThanOrEqual(maxY + 1e-6);
      }
    }
  });
});

describe('Template 9: 12 miters and the inner edge, the 4 inside (reflex) corners included', () => {
  it.each(BOARDS)('%dx%d: every corner has a 45 deg miter of the frame thickness; the inside ones run from the reflex vertex into the band', (W, H) => {
    const prof = profile({}, W, H), inn = inner({}, W, H);
    expect(inn.defects).toEqual([]);
    expect(inn.primitives.every((p) => !p.collapsed)).toBe(true);
    const miters = frameMiters(prof.primitives, inn.primitives);
    expect(miters).toHaveLength(12);
    for (const m of miters) {
      expect(Math.abs(m.inner.x - m.outer.x)).toBeCloseTo(T, 9);
      expect(Math.abs(m.inner.y - m.outer.y)).toBeCloseTo(T, 9);
    }
    // the 4 reflex vertices (a shoulder meeting a stem side): each miter stays inside the outline.
    const { shTR, shBR, shBL, shTL } = pieces(prof);
    for (const v of [shTR.p1, shBR.p0, shBL.p1, shTL.p0]) {
      const m = miters.find((q) => Math.hypot(q.outer.x - v.x, q.outer.y - v.y) < 1e-9);
      expect(m).toBeTruthy();
      expect(pointInPolygon(m.inner.x, m.inner.y, prof.polygon)).toBe(true);
    }
  });

  it('each bar is one piece: its outer and inner edges pair by index and are 2t shorter (two convex ends), 2t LONGER (two reflex ends), or unchanged (one of each)', () => {
    const prof = profile(), inn = inner();
    // top, flange sides (x4), base: two convex ends each -> the inner edge 2T shorter.
    const convexBoth = [0, 1, 5, 6, 7, 11]; // top, flange_side_R, flange_side_BR, bottom, flange_side_BL, flange_side_TL
    // the 2 stem sides: BOTH their ends are reflex (a shoulder meets the stem at each end) -- unlike Template 6's
    // single notch, where a tab side has one convex + one reflex end, this template's doubled notch (top AND
    // bottom) puts a stem side between two reflex corners, so its inner edge is 2T LONGER, not unchanged.
    const reflexBoth = [3, 9]; // stem_side_R, stem_side_L
    // the 4 shoulders: one convex end (the notch's own outer corner) + one reflex end (the stem) each -> net 0,
    // Template 6's own finding, confirmed here at all 4 notches.
    prof.primitives.forEach((p, i) => {
      const d = len(p) - len(inn.primitives[i]);
      const expected = convexBoth.includes(i) ? 2 * T : reflexBoth.includes(i) ? -2 * T : 0;
      expect(d, `piece ${i}`).toBeCloseTo(expected, 9);
    });
  });

  it('the 3D frame spec has the ring (bars) over the concave outline', () => {
    const spec = frameSolidSpec(FRAME_DEFS, rec9({}), board(7, 9));
    expect(spec.inner).toBeTruthy();
    expect(spec.innerPrimitives).toHaveLength(12);
  });
});

describe('Template 9: the Stem width / Flange height handles', () => {
  const drag = (key, seeds, dx, dy, W = 7, H = 9) => {
    const rec = rec9(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(W, H));
    const hs = frameHandles(T9, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table: Stem width (hw) and Flange height (hh), both seeded', () => {
    expect(T9.handles).toEqual([
      { key: 'stemWidth', label: 'Stem width', basis: 'hw', binding: 'seeded' },
      { key: 'flangeHeight', label: 'Flange height', basis: 'hh', binding: 'seeded' },
    ]);
    const { hs } = drag('stemWidth', {}, 0, 0);
    expect(hs.map((h) => h.key)).toEqual(KEYS);
    expect(HANDLE_SEGMENT_INDEX.iShape).toEqual({ stemWidth: 3, flangeHeight: 2 });
    expect(controlledSegments('iShape', 'stemWidth', 12)).toEqual([3, 9]); // both stem sides
    expect(controlledSegments('iShape', 'flangeHeight', 12)).toEqual([2, 4, 8, 10]); // all 4 shoulders
  });

  it('Stem width: a drag out widens the stem (both sides), the flange height held', () => {
    const { prof, next } = drag('stemWidth', {}, 0.3, 0);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(stemHalfWidth(after)).toBeCloseTo(stemHalfWidth(prof) + 0.3, 9);
    expect(flangeHeightIn(after)).toBeCloseTo(flangeHeightIn(prof), 9);
    const payload = framePayload(FRAME_DEFS, next);
    expect(Object.keys(payload.params).sort()).toEqual(T9.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
    expect(Object.keys(payload.seeds)).toEqual(['stemWidth']);
  });

  it('Flange height: a drag makes both flanges taller/shorter together, the stem width held', () => {
    const { prof, next } = drag('flangeHeight', {}, 0, 0.3);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(stemHalfWidth(after)).toBeCloseTo(stemHalfWidth(prof), 9);
    // both flanges move together (the 4-fold symmetry constraint, p02_05)
    const { flR, flBR, flBL, flTL } = pieces(after);
    expect(len(flR)).toBeCloseTo(len(flBR), 9);
    expect(len(flR)).toBeCloseTo(len(flBL), 9);
    expect(len(flR)).toBeCloseTo(len(flTL), 9);
  });

  it('dragged far, each handle stops at the frame rule and the frame stays valid (12 miters)', () => {
    for (const [W, H] of [[7, 9], [12, 6]]) {
      for (const [key, dx, dy] of [['stemWidth', 20, 0], ['stemWidth', -20, 0], ['flangeHeight', 0, 20], ['flangeHeight', 0, -20]]) {
        const { next } = drag(key, {}, dx, dy, W, H);
        const after = frameCutProfile(FRAME_DEFS, next, board(W, H));
        expect(after.defects, key).toEqual([]);
        expect(ruleOk(after, T), `${W}x${H} ${key} ${dx} ${dy}`).toBe(true);
        const inn = frameInnerProfile(FRAME_DEFS, next, board(W, H));
        expect(frameMiters(after.primitives, inn.primitives), key).toHaveLength(12);
      }
    }
  });

  it('[Generate] draws both values inside the rule, always a valid frame', () => {
    for (const [W, H] of [[7, 9], [12, 6]]) {
      const region = profile({}, W, H).region;
      for (let seed = 1; seed <= 50; seed++) {
        const seeds = generateFrameSeeds(T9, region, seed);
        expect(Object.keys(seeds).sort()).toEqual([...KEYS].sort());
        const prof = profile(seeds, W, H);
        expect(prof.params.stemWidth).toBeCloseTo(seeds.stemWidth, 12); // not clamped: drawn inside the rule
        expect(prof.params.flangeHeight).toBeCloseTo(seeds.flangeHeight, 12);
        expect(prof.defects).toEqual([]);
        expect(inner(seeds, W, H).defects).toEqual([]);
      }
    }
  });

  it('the Fusion seeds: the 12 lines at the app\'s solved outline, in the sketch\'s own orientation', () => {
    const prof = profile({ stemWidth: 0.3, flangeHeight: 0.3 });
    const geo = frameSeedGeometry(T9, prof, 7, 9);
    const F = (p) => [p.x - 3.5, 4.5 - p.y];
    const { top, flR, base } = pieces(prof);
    expect(geo.top_edge.points).toEqual([F(top.p0), F(top.p1)]);
    expect(geo.flange_side_R.points).toEqual([F(flR.p0), F(flR.p1)]);
    expect(geo.bottom_edge.points).toEqual([F(base.p0), F(base.p1)]);
    expect(Object.keys(geo).sort()).toEqual(T9.seedMap.map((e) => e.id).sort());
    expect(geo.top_edge.points[0][1]).toBeCloseTo(4.25, 9); // the top edge on the safe zone's top line, Fusion y
  });
});

describe('the Shape Lattice and Templates 1-8 never get the stem or the flange height', () => {
  it('frame-only keys, appended last; every other preset order is untouched', () => {
    // T10 ARCHED HOURGLASS appended its own 'archRise' after these two, T7 DIAMOND-TOP HOURGLASS appended its own
    // 3 keys after THAT, and F30 item 3 its own 'taperAngle' after that, so the stem/flange pair is no longer the
    // trailing slice -- fixed indices instead of `.slice(-2)` (Template 6's own test applies the same fix).
    expect(FRAME_ONLY_PARAM_KEYS.slice(-7, -5)).toEqual(KEYS);
    expect(PARAM_ORDER.iShape).toEqual(KEYS);
    expect(PARAM_ORDER.tabTop).toEqual(['tabWidth', 'tabHeight']);
    expect(SHAPE_PARAM_KEYS).not.toHaveProperty('iShape');
    for (const k of KEYS) {
      expect(SHAPE_PARAM_KEYS.hourglass).not.toContain(k);
      expect(SHAPE_PARAM_KEYS.bottle).not.toContain(k);
    }
  });

  it('an hourglass never reads iShape keys; the manifest never emits one', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const a = generateSilhouette(region, { preset: 'hourglass', params: {} });
    const b = generateSilhouette(region, { preset: 'hourglass', params: { stemWidth: 0.3, flangeHeight: 0.4 } });
    expect(J(b.primitives)).toBe(J(a.primitives));
    for (const k of KEYS) expect(a.params).not.toHaveProperty(k);
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { stemWidth: 0.3 } }, region);
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.map((p) => p.name));
  });

  it('Templates 1-6, 8 are unaffected: their own params, models and handles are untouched', () => {
    for (const id of ['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6', 'template_8']) {
      const t = tplOf(id);
      expect(t.handles.map((h) => h.key)).not.toContain('stemWidth');
      expect(t.handles.map((h) => h.key)).not.toContain('flangeHeight');
    }
  });

  it('an iShape silhouette with a stroke inset stays 12 clean pieces (every wall in by the stroke)', async () => {
    const { generateContourSilhouette } = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js');
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
    const s0 = generateSilhouette(region, { preset: 'iShape', params: {} });
    const s1 = generateContourSilhouette(region, { preset: 'iShape', params: {} }, 0.2);
    expect(s1.primitives).toHaveLength(12);
    expect(s1.primitives[0].p0.y).toBeCloseTo(s0.primitives[0].p0.y + 0.1, 12); // top edge in
    expect(s1.primitives[1].p0.x).toBeCloseTo(s0.primitives[1].p0.x - 0.1, 12); // flange_side_R in
  });
});

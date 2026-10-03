/**
 * T6 TAB TOP (Fred's sketch: a rectangle with a narrower rectangular tab centred on top, like a battery): the first
 * frame with more than 4 bars and with INSIDE (reflex, 270 deg) corners. 8 straight pieces, 8 corners, 8 mitered
 * bars. The app side: the frame-only `tabTop` preset (editor-shape-lattice-generator.js), its "Tab width" / "Tab
 * height" handles, the frame thickness rule (frame-handles.js frameParamRanges, applied to the drawn frame too), the
 * generic miters / inner edge / 3D ring at the reflex corners, and the Shape Lattice "from frame" contour.
 */
import { describe, it, expect } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { normalizeFrameRecord, framePayload } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, frameSolidSpec } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds, frameParamRanges, clampToFrameRanges,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, generateContourSilhouette, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS, PRESETS,
  TAB_TOP_SEGMENT_COUNT, primitiveToPathD, joinSegmentPathsIntoClosedD,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  computeParamHandles, HANDLE_SEGMENT_INDEX, controlledSegments, mirrorSegmentIndex,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { manifestFromShape } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-sketch-manifest.js';
import { frameContourSilhouette } from '../bspline-frame-builder/b-spline-gen/html/editor/contour-from-frame.js';
import { frameLabel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { computePattern, _resolveExtent, PATTERN_DEFAULTS } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { insetGeneratedPresetPathDToPrimitives } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-boundary.js';
import { sampleOutline, pointInPolygon, clipPanelToOutline } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { distToPrimitive } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-primitives.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T1 = tplOf('template_1'), T6 = tplOf('template_6');
const BOARDS = [[7, 9], [12, 6], [9, 12], [8, 8]];
const TAB = ['tabWidth', 'tabHeight'];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec6 = (seeds, extra = {}) => normalizeFrameRecord({ templateId: 'template_6', seeds, ...extra });
const profile = (seeds, W = 7, H = 9, extra) => frameCutProfile(FRAME_DEFS, rec6(seeds, extra), board(W, H));
const inner = (seeds, W = 7, H = 9, extra) => frameInnerProfile(FRAME_DEFS, rec6(seeds, extra), board(W, H));
const J = (x) => JSON.stringify(x);
const len = (p) => Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y);
/** The 8 pieces by name (the tabTop order). */
const pieces = (prof) => {
  const [tabR, shR, sideR, base, sideL, shL, tabL, top] = prof.primitives;
  return { tabR, shR, sideR, base, sideL, shL, tabL, top };
};
/** Tab half width, tab height, shoulder length (inches) of a drawn outline. */
const measure = (prof) => {
  const p = pieces(prof);
  return { a: len(p.top) / 2, h: len(p.tabR), shoulder: len(p.shR), side: len(p.sideR), base: len(p.base) };
};
/** The frame rule on a drawn outline + its inner edge (thickness t): no bar shorter than t, tab sides >= 2t. */
const ruleOk = (prof, t) => {
  const m = measure(prof), region = prof.region;
  return m.h >= 2 * t - 1e-9 && m.shoulder >= t - 1e-9 && 2 * m.a - 2 * t >= t - 1e-9 && region.h - m.h - 2 * t >= t - 1e-9;
};

describe('Template 6: listing and declaration', () => {
  it('is listed as "6. Tab Top", the frame-only tabTop preset, no new parameter, 8 bars', () => {
    expect(T6.name).toBe('Template 6 - Tab Top');
    expect(frameLabel(T6)).toBe('6. Tab Top');
    // string-sorted labels: "10."/"11."/"12."/"13."/"16."/"17." lexicographically precede "2." (all start "1").
    expect(FRAME_DEFS.templates.map(frameLabel)).toEqual(['1. Hourglass', '10. Arched Hourglass', '11. Hourglass Roof',
      '12. Hourglass - Tapered sides', '13. Narrow Neck - Tapered sides',
      '16. Arched Funnel', '17. Tulip', // T84 item 3
      '2. Narrow Neck',
      '3. Tapered Hourglass', '4. Offset Hourglass', '5. Hourglass Dipped Top', '6. Tab Top',
      '7. Diamond-top Hourglass', '8. Dipped Top + Left-Only Wave', '9. I Shape']);
    expect(T6.silhouettePreset).toBe('tabTop');
    expect(PRESETS.tabTop.frameOnly).toBe(true);
    expect(T6.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', 'frame_thickness']);
    expect(T6.regions.miters).toHaveLength(8);
    expect(T6.regions.bars.map((b) => b.name)).toEqual(T6.features[0].bodyNames);
    expect(T6.regions.corners.filter((c) => c.reflex).map((c) => c.id)).toEqual(['inside_R', 'inside_L']);
    // H23 item 4: the provisional shim is retired -- T6 now has its own
    // shapeModel fitted from live Fusion goldens (all 3 golden sizes were
    // valid for its extractor, none excluded).
    expect(T6.shapeModel.provisional).toBeUndefined();
    expect(T6.shapeModel.fit.fittedFrom).toEqual(['12x6', '5.51x1.97', '7x9']);
    expect(T6.shapeModel.fit.excluded).toEqual([]);
  });
});

describe('Template 6: the outline', () => {
  it.each(BOARDS)('%dx%d: 8 straight axis-aligned pieces, 0 defects, a centred tab on top, the base and sides on the safe zone', (W, H) => {
    const prof = profile({}, W, H);
    expect(prof.primitives).toHaveLength(TAB_TOP_SEGMENT_COUNT);
    expect(prof.primitives.every((p) => p.type === 'L')).toBe(true);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(true);
    const { tabR, shR, sideR, base, sideL, shL, tabL, top } = pieces(prof);
    const { x, y, w, h } = prof.region, cx0 = x + w / 2;
    for (const p of [tabR, sideR, sideL, tabL]) expect(p.p0.x).toBeCloseTo(p.p1.x, 12); // vertical
    for (const p of [shR, base, shL, top]) expect(p.p0.y).toBeCloseTo(p.p1.y, 12); // horizontal
    expect(top.p0.y).toBeCloseTo(y, 12); // the tab top on the safe zone's top edge
    expect(base.p0.y).toBeCloseTo(y + h, 12);
    expect(sideR.p0.x).toBeCloseTo(x + w, 12);
    expect(sideL.p0.x).toBeCloseTo(x, 12);
    expect((top.p0.x + top.p1.x) / 2).toBeCloseTo(cx0, 12); // centred
    expect(shR.p0.y).toBeCloseTo(shL.p0.y, 12); // symmetric shoulders
    expect(len(tabR)).toBeCloseTo(len(tabL), 12);
    expect(len(top)).toBeLessThan(w); // narrower than the body
    expect(ruleOk(prof, T)).toBe(true);
  });

  it('7x9 defaults: a ~3.19 in wide, ~2.156 in tall tab (H23 item 4: now the FITTED model, not the old provisional 0.5 hw / 0.5 hh estimate)', () => {
    const m = measure(profile({}));
    expect(m.a).toBeCloseTo(1.595537, 9);
    expect(m.h).toBeCloseTo(2.15568275, 9);
  });

  it('12x6: the provisional 1.375 in tab height is clamped up to 2 x the frame thickness (a tab side >= 2t)', () => {
    const prof = profile({}, 12, 6);
    expect(measure(prof).h).toBeCloseTo(2 * T, 9);
    expect(prof.params.tabHeight).toBeCloseTo(1.5 / 2.75, 12);
  });

  it('5.51x1.97: still a clean 8-piece outline; the board is too small for the frame (0 bars, like the others)', () => {
    const prof = profile({}, 5.51, 1.97);
    expect(prof.primitives).toHaveLength(8);
    expect(prof.defects).toEqual([]);
    expect(prof.fit.ok).toBe(false);
    expect(inner({}, 5.51, 1.97)).toBeNull();
    expect(frameSolidSpec(FRAME_DEFS, rec6({}), board(5.51, 1.97)).inner).toBeNull();
  });

  it('any tab seed and any frame thickness gives a valid frame that keeps the rule (clamped, never refused)', () => {
    for (const [W, H] of [[7, 9], [12, 6]]) {
      for (const t of [0.25, 0.5, 0.75, 1.0]) {
        for (const w of [-1, 0, 0.2, 0.5, 0.8, 0.99, 3]) {
          for (const h of [-1, 0, 0.1, 0.5, 1.2, 1.9, 5]) {
            const extra = { params: { frame_thickness: t } };
            const prof = profile({ tabWidth: w, tabHeight: h }, W, H, extra);
            const tag = `${W}x${H} t${t} ${w} ${h}`;
            expect(prof.primitives.length, tag).toBe(8);
            expect(prof.defects, tag).toEqual([]);
            if (!prof.fit.ok) continue;
            expect(ruleOk(prof, t), tag).toBe(true);
            const inn = inner({ tabWidth: w, tabHeight: h }, W, H, extra);
            expect(inn && inn.defects, tag).toEqual([]);
            expect(frameMiters(prof.primitives, inn.primitives), tag).toHaveLength(8);
          }
        }
      }
    }
  });

  it('the thickness rule is exactly the frame ranges (frameParamRanges), and the clamp only touches the tab keys', () => {
    const prof = profile({});
    const r = frameParamRanges(T6, prof.region, prof.params, T);
    const hw = prof.region.w / 2, hh = prof.region.h / 2;
    expect(r.tabWidth.min).toBeCloseTo((T + T / 2) / hw, 12); // tab top inner edge >= t
    expect(r.tabWidth.max).toBeCloseTo((hw - T) / hw, 12); // shoulder bar >= t long
    expect(r.tabHeight.min).toBeCloseTo((2 * T) / hh, 12); // tab side >= 2t
    expect(r.tabHeight.max).toBeCloseTo((2 * hh - 3 * T) / hh, 12); // body opening >= t
    expect(clampToFrameRanges(T6, prof.region, { tabWidth: 0, tabHeight: 9 }, T)).toEqual({ tabWidth: r.tabWidth.min, tabHeight: r.tabHeight.max });
    // Templates 1-5 are never clamped by it (drawn exactly as before)
    expect(clampToFrameRanges(T1, prof.region, { waistReach: 5 }, T)).toEqual({ waistReach: 5 });
  });
});

describe('Template 6: 8 miters and the inner edge, the two inside corners included', () => {
  it.each(BOARDS)('%dx%d: every corner has a 45 deg miter of the frame thickness; the inside ones run from the reflex vertex into the band', (W, H) => {
    const prof = profile({}, W, H), inn = inner({}, W, H);
    expect(inn.defects).toEqual([]);
    expect(inn.primitives.every((p) => !p.collapsed)).toBe(true);
    const miters = frameMiters(prof.primitives, inn.primitives);
    expect(miters).toHaveLength(8);
    for (const m of miters) {
      expect(Math.abs(m.inner.x - m.outer.x)).toBeCloseTo(T, 9);
      expect(Math.abs(m.inner.y - m.outer.y)).toBeCloseTo(T, 9);
    }
    // the two reflex vertices (a shoulder meeting a tab side): their miters point DOWN (y down) and toward the centre
    const { shR, shL } = pieces(prof), cx0 = prof.region.x + prof.region.w / 2;
    for (const v of [shR.p0, shL.p1]) {
      const m = miters.find((q) => Math.hypot(q.outer.x - v.x, q.outer.y - v.y) < 1e-9);
      expect(m).toBeTruthy();
      expect(m.inner.y - m.outer.y).toBeCloseTo(T, 9); // below the shoulder
      expect(Math.sign(m.inner.x - m.outer.x)).toBe(Math.sign(cx0 - m.outer.x)); // inside the tab column
      expect(pointInPolygon(m.inner.x, m.inner.y, prof.polygon)).toBe(true);
    }
  });

  it('each bar is one piece: its outer and inner edges pair by index and are equally long (a parallelogram) or 2t apart (a trapezoid)', () => {
    const prof = profile({}), inn = inner({});
    const convexBoth = [2, 3, 4, 7]; // side R, base, side L, tab top: two convex corners each -> the inner edge 2t shorter
    prof.primitives.forEach((p, i) => {
      const d = len(p) - len(inn.primitives[i]);
      expect(d, `piece ${i}`).toBeCloseTo(convexBoth.includes(i) ? 2 * T : 0, 9); // a shoulder or tab side: a parallelogram
    });
  });

  it('the 3D frame spec has the ring (bars) and trims the panel on the concave outline', () => {
    const spec = frameSolidSpec(FRAME_DEFS, rec6({}), board(7, 9));
    expect(spec.inner).toBeTruthy();
    expect(spec.innerPrimitives).toHaveLength(8);
  });

  it('the panel trim keeps both pieces of a triangle a reflex vertex lies ON (7x9, 0.05 in cells: the diagonal)', () => {
    // the right inside corner (world, y up) sits exactly on the diagonal of a 0.05 in grid square
    const hw = 3.25, hh = 4.25, a = 1.625, ys = 2.125;
    const poly = [[a, hh], [-a, hh], [-a, ys], [-hw, ys], [-hw, -hh], [hw, -hh], [hw, ys], [a, ys]].map(([x, y]) => ({ x, y }));
    for (const [x0, y0] of [[1.6, 2.1], [-1.65, 2.1]]) {
      const P = [x0, y0, 0, x0 + 0.05, y0, 0, x0, y0 + 0.05, 0, x0 + 0.05, y0 + 0.05, 0];
      const index = x0 > 0 ? [0, 1, 2, 2, 1, 3] : [0, 1, 3, 0, 3, 2]; // the diagonal through the vertex either way
      const { kept, rim } = clipPanelToOutline(P, index, poly, {}, 0.05);
      const tri2 = (Q, i, j, k) => Math.abs((Q[j * 3] - Q[i * 3]) * (Q[k * 3 + 1] - Q[i * 3 + 1]) - (Q[k * 3] - Q[i * 3]) * (Q[j * 3 + 1] - Q[i * 3 + 1])) / 2;
      let area = 0;
      for (let k = 0; k < kept.length; k += 3) area += tri2(P, kept[k], kept[k + 1], kept[k + 2]); // a triangle wholly inside
      for (let k = 0; k < rim.index.length; k += 3) {
        const [p, q, r] = [0, 1, 2].map((j) => rim.index[k + j] * 3);
        area += Math.abs((rim.position[q] - rim.position[p]) * (rim.position[r + 1] - rim.position[p + 1])
          - (rim.position[r] - rim.position[p]) * (rim.position[q + 1] - rim.position[p + 1])) / 2;
      }
      expect(area).toBeCloseTo(0.05 * 0.05 * 0.75, 12); // the square minus the notch quarter, nothing lost or added
    }
  });
});

describe('Template 6: the Tab width / Tab height handles', () => {
  const drag = (key, seeds, dx, dy, W = 7, H = 9) => {
    const rec = rec6(seeds);
    const prof = frameCutProfile(FRAME_DEFS, rec, board(W, H));
    const hs = frameHandles(T6, prof);
    const h = hs.find((q) => q.key === key);
    const pt = { x: h.anchor.x + dx, y: h.anchor.y + dy };
    return { h, hs, prof, rec, next: normalizeFrameRecord({ ...rec, ...handleDragPatch(rec, h, pt, prof.region) }) };
  };

  it('the table: Tab width (hw) and Tab height (hh), both seeded; each highlights its piece and its mirror', () => {
    expect(T6.handles).toEqual([
      { key: 'tabWidth', label: 'Tab width', basis: 'hw', binding: 'seeded' },
      { key: 'tabHeight', label: 'Tab height', basis: 'hh', binding: 'seeded' },
    ]);
    const { hs } = drag('tabWidth', {}, 0, 0);
    expect(hs.map((h) => h.key)).toEqual(TAB);
    expect(hs.map((h) => [h.axis, h.handleKind])).toEqual([['x', 'position'], ['y', 'position']]);
    expect(HANDLE_SEGMENT_INDEX.tabTop).toEqual({ tabWidth: 0, tabHeight: 1 });
    expect(controlledSegments('tabTop', 'tabWidth', 8)).toEqual([0, 6]);
    expect(controlledSegments('tabTop', 'tabHeight', 8)).toEqual([1, 5]);
    expect([...Array(8).keys()].map((i) => mirrorSegmentIndex(i, 8))).toEqual([6, 5, 4, 3, 2, 1, 0, 7]);
  });

  it('Tab width: a square on the right tab side; a drag out widens the tab (both sides), the height held', () => {
    const { h, prof, next } = drag('tabWidth', {}, 0.3, 0);
    const { tabR } = pieces(prof);
    expect(h.anchor.x).toBeCloseTo(tabR.p0.x, 12);
    expect(h.anchor.y).toBeCloseTo((tabR.p0.y + tabR.p1.y) / 2, 12);
    expect(next.params).toEqual({});
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(after.defects).toEqual([]);
    expect(measure(after).a).toBeCloseTo(measure(prof).a + 0.3, 9);
    expect(measure(after).h).toBeCloseTo(measure(prof).h, 9);
    const payload = framePayload(FRAME_DEFS, next);
    expect(Object.keys(payload.params).sort()).toEqual(T6.params.filter((p) => p.owner === 'frame').map((p) => p.name).sort());
    expect(Object.keys(payload.seeds)).toEqual(['tabWidth']);
  });

  it('Tab height: a square on the right shoulder; a drag down makes the tab taller, the width held', () => {
    const { h, prof, next } = drag('tabHeight', {}, 0, 0.4);
    const { shR } = pieces(prof);
    expect(h.anchor.y).toBeCloseTo(shR.p0.y, 12);
    expect(h.anchor.x).toBeCloseTo((shR.p0.x + shR.p1.x) / 2, 12);
    const after = frameCutProfile(FRAME_DEFS, next, board(7, 9));
    expect(measure(after).h).toBeCloseTo(measure(prof).h + 0.4, 9);
    expect(measure(after).a).toBeCloseTo(measure(prof).a, 9);
  });

  it('dragged far, each handle stops at the frame rule and the frame stays valid (8 miters)', () => {
    for (const [W, H] of [[7, 9], [12, 6]]) {
      for (const [key, dx, dy] of [['tabWidth', 20, 0], ['tabWidth', -20, 0], ['tabHeight', 0, 20], ['tabHeight', 0, -20]]) {
        const { next } = drag(key, {}, dx, dy, W, H);
        const after = frameCutProfile(FRAME_DEFS, next, board(W, H));
        expect(after.defects, key).toEqual([]);
        expect(ruleOk(after, T), `${W}x${H} ${key} ${dx} ${dy}`).toBe(true);
        const inn = frameInnerProfile(FRAME_DEFS, next, board(W, H));
        expect(frameMiters(after.primitives, inn.primitives), key).toHaveLength(8);
      }
    }
  });

  it('[Generate] draws both tab values inside the rule, always a valid frame', () => {
    for (const [W, H] of [[7, 9], [12, 6]]) {
      const region = profile({}, W, H).region;
      for (let seed = 1; seed <= 60; seed++) {
        const seeds = generateFrameSeeds(T6, region, seed);
        expect(Object.keys(seeds).sort()).toEqual([...TAB].sort());
        const prof = profile(seeds, W, H);
        expect(prof.params.tabWidth).toBeCloseTo(seeds.tabWidth, 12); // not clamped: drawn inside the rule
        expect(prof.params.tabHeight).toBeCloseTo(seeds.tabHeight, 12);
        expect(prof.defects).toEqual([]);
        expect(inner(seeds, W, H).defects).toEqual([]);
      }
    }
  });

  it('the Fusion seeds: the 8 lines at the app\'s solved outline, in the sketch\'s own orientation', () => {
    const prof = profile({ tabWidth: 0.6, tabHeight: 0.4 });
    const geo = frameSeedGeometry(T6, prof, 7, 9);
    const F = (p) => [p.x - 3.5, 4.5 - p.y];
    const { top, tabR, base } = pieces(prof);
    expect(geo.tab_top.points).toEqual([F(top.p0), F(top.p1)]);
    expect(geo.tab_side_R.points).toEqual([F(tabR.p0), F(tabR.p1)]);
    expect(geo.bottom_edge.points).toEqual([F(base.p0), F(base.p1)]);
    expect(Object.keys(geo).sort()).toEqual(T6.seedMap.map((e) => e.id).sort());
    expect(geo.tab_top.points[0][0]).toBeCloseTo(-0.6 * 3.25, 9); // tab top-left, Fusion x
    expect(geo.tab_top.points[0][1]).toBeCloseTo(4.25, 9); // on the safe zone's top
  });
});

describe('Shape Lattice "from frame" follows the 8-corner contour', () => {
  const frame = (seeds = {}, W = 7, H = 9) => ({ defs: FRAME_DEFS, record: rec6(seeds), board: board(W, H) });

  it.each(BOARDS)('%dx%d: the offset contour keeps the 8 pieces (the 2 inside corners included) and its mirror table', (W, H) => {
    const sil = frameContourSilhouette(frame({}, W, H), 0.25, 0.1);
    expect(sil.error).toBeUndefined();
    expect(sil.primitives).toHaveLength(8);
    expect(sil.mirror).toEqual([6, 5, 4, 3, 2, 1, 0, 7]);
    const outer = profile({}, W, H).polygon;
    for (const p of sil.primitives) expect(pointInPolygon(p.p0.x, p.p0.y, outer)).toBe(true);
  });

  it('the Fusion manifest pairs the mirrored pieces by that table', () => {
    const sil = frameContourSilhouette(frame(), 0.25, 0.1);
    const m = manifestFromShape({ preset: 'hourglass', params: {} }, sil.region, { silhouette: sil });
    const eq = m.constraints.filter((c) => c.type === 'Equal').map((c) => c.targets.join('-')).sort();
    expect(eq).toEqual(['seg0-seg6', 'seg1-seg5', 'seg2-seg4']);
  });

  // The T5 containment approach: every rail, tie and node inside the from-frame contour (the boundary exactly as
  // the app resolves it), over boards, tab sizes, seeds, rail modes and both orientations. A rail row crossing the
  // tab and the shoulders meets the contour 4 times: two pieces, never one across the notch.
  const STROKE = 0.25, SPACING = PATTERN_DEFAULTS.spacing;
  const EPS = 1e-3; // the boundary the lattice clips to is the contour's own path d, written to 3 decimals
  const boundaryOf = (sil) => insetGeneratedPresetPathDToPrimitives(joinSegmentPathsIntoClosedD(sil.primitives.map((p) => primitiveToPathD(p))), 0);
  const inside = (q, poly, prims) => pointInPolygon(q.x, q.y, poly) || prims.some((p) => distToPrimitive(q, p) < 1e-6);
  const CASES = [];
  for (const [W, H] of [[7, 9], [12, 6]]) {
    for (const seeds of [{}, { tabWidth: 0.35, tabHeight: 0.9 }, { tabWidth: 0.75, tabHeight: 0.3 }]) {
      for (const d of [0, 0.25, 0.6]) CASES.push([W, H, seeds, d]);
    }
  }
  it.each(CASES)('%dx%d %j distance %s: 0 pieces outside the contour', (W, H, seeds, d) => {
    const sil = frameContourSilhouette(frame(seeds, W, H), d, STROKE);
    expect(sil.error).toBeUndefined();
    const prims = boundaryOf(sil);
    expect(prims).toHaveLength(sil.primitives.length);
    const poly = sampleOutline(prims, 96);
    const shoulderY = sil.primitives[1].p0.y, topY = sil.primitives[7].p0.y;
    let splitRows = 0;
    for (let seed = 1; seed <= 4; seed++) {
      for (const orientation of ['horizontal', 'vertical']) {
        for (const rails of [PATTERN_DEFAULTS.rails, { ...PATTERN_DEFAULTS.rails, spacing: 0.5 }, { mode: 'count', count: [9, 11] }]) {
          const PATTERN = { ...PATTERN_DEFAULTS, seed, orientation, rails, boundary: { ...PATTERN_DEFAULTS.boundary, endRule: 'on-boundary' }, extent: { mode: 'boundary' } };
          const { segments, nodePoints } = computePattern(PATTERN, { extent: _resolveExtent(null, PATTERN, prims) });
          const W2 = (p) => ({ x: p.i * SPACING, y: p.j * SPACING });
          for (const g of segments) {
            const a = W2(g.a), b = W2(g.b);
            for (let t = 0; t <= 1.0001; t += 0.02) {
              const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
              expect(inside(q, poly, prims), `${g.kind} seed ${seed} ${orientation} at ${q.x.toFixed(3)},${q.y.toFixed(3)}`).toBe(true);
            }
          }
          for (const n of nodePoints) expect(inside(W2(n), poly, prims), `node seed ${seed}`).toBe(true);
          if (orientation === 'vertical') {
            // a vertical rail column outside the tab but under the shoulders: it stops at the shoulder (never up into
            // the notch beside the tab)
            for (const g of segments.filter((x) => x.kind === 'rail')) {
              const x = g.a.i * SPACING, ys = [g.a.j * SPACING, g.b.j * SPACING];
              if (x < sil.primitives[6].p0.x - EPS || x > sil.primitives[0].p0.x + EPS) {
                expect(Math.min(...ys)).toBeGreaterThanOrEqual(shoulderY - EPS);
              }
            }
          } else {
            const rows = new Map();
            for (const g of segments.filter((x) => x.kind === 'rail')) {
              const y = g.a.j * SPACING;
              if (y > topY + EPS && y < shoulderY - EPS) rows.set(y, [...(rows.get(y) || []), g]);
            }
            for (const [, ps] of rows) {
              // a row inside the tab's height stays inside the tab
              for (const g of ps) for (const i of [g.a.i, g.b.i]) {
                expect(i * SPACING).toBeGreaterThanOrEqual(sil.primitives[6].p0.x - EPS);
                expect(i * SPACING).toBeLessThanOrEqual(sil.primitives[0].p0.x + EPS);
              }
              splitRows++;
            }
          }
        }
      }
    }
    if (shoulderY - topY > 4 * SPACING * 4) expect(splitRows).toBeGreaterThan(0);
  });
});

describe('the Shape Lattice and Templates 1-5 never get the tab', () => {
  it('frame-only keys, appended last; the hourglass / bottle orders are untouched', () => {
    // T8 DIPPED TOP + LEFT-ONLY WAVE appended its own 5 keys after these two (FRAME_ONLY_PARAM_KEYS' own doc
    // comment), so TAB's own pair is no longer the trailing slice -- fixed indices instead of `.slice(-2)`.
    expect(FRAME_ONLY_PARAM_KEYS.slice(5, 7)).toEqual(TAB);
    expect(PARAM_ORDER.tabTop).toEqual(TAB);
    // F30 item 3 appended its own 'taperAngle' after archRise (hourglass) and at the end (bottle).
    expect(PARAM_ORDER.hourglass).toEqual(['waistCenterY', 'waistReach', 'cornerRadius', 'waistRadius', 'cornerRadiusTop',
      'cornerRadiusBottom', 'topInset', 'waistCenterYLeft', 'waistReachLeft', 'topDipWidth', 'topDipDepth', 'archRise', 'taperAngle']);
    expect(PARAM_ORDER.bottle).toEqual(['neckWidth', 'skeletonX', 'neckLength', 'bodyRadius', 'taperAngle']);
    for (const k of TAB) {
      expect(SHAPE_PARAM_KEYS.hourglass).not.toContain(k);
      expect(SHAPE_PARAM_KEYS.bottle).not.toContain(k);
    }
    expect(SHAPE_PARAM_KEYS).not.toHaveProperty('tabTop');
  });

  it('an hourglass never reads tab keys; the manifest never emits one', () => {
    const region = { x: 0, y: 0, w: 6, h: 8 };
    const a = generateSilhouette(region, { preset: 'hourglass', params: {} });
    const b = generateSilhouette(region, { preset: 'hourglass', params: { tabWidth: 0.3, tabHeight: 0.4 } });
    expect(J(b.primitives)).toBe(J(a.primitives));
    for (const k of TAB) expect(a.params).not.toHaveProperty(k);
    const plain = manifestFromShape({ preset: 'hourglass', params: {} }, region);
    const stray = manifestFromShape({ preset: 'hourglass', params: { tabWidth: 0.3 } }, region);
    expect(stray.parameters.map((p) => p.name)).toEqual(plain.parameters.map((p) => p.name));
    expect(computeParamHandles('hourglass', region, a.params).map((h) => h.key).filter((k) => TAB.includes(k))).toEqual([]);
  });

  it('a tabTop silhouette with a stroke inset stays 8 clean pieces (every wall in by the stroke)', () => {
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
    const s0 = generateSilhouette(region, { preset: 'tabTop', params: {} });
    const s1 = generateContourSilhouette(region, { preset: 'tabTop', params: {} }, 0.2);
    expect(s1.primitives).toHaveLength(8);
    expect(s1.primitives[7].p0.y).toBeCloseTo(s0.primitives[7].p0.y + 0.1, 12);
    expect(s1.primitives[0].p0.x).toBeCloseTo(s0.primitives[0].p0.x - 0.1, 12);
    expect(s1.primitives[1].p0.y).toBeCloseTo(s0.primitives[1].p0.y + 0.1, 12);
  });
});

/**
 * Template 20 TRAPEZOID (Fred 2026-11-22: "a simple trapezoid frame template, possible to set narrow side up or
 * down simply"; amended the same day: "irregular taper sides too"). The frame-only `trapezoid` preset
 * (editor-shape-lattice-generator.js `_solveTrapezoid`): four straight pieces, the two horizontal sides parallel on
 * the safe zone's top / bottom lines, the wide side the full safe-zone width, the NARROW side set by two
 * independent values -- Left inset / Right inset, each the narrow end's distance in from its wide-side corner
 * (stored as a fraction of hw like every other seeded handle; shown as % of the wide side) -- a Symmetric link
 * (default on: moving one moves the other) and one switch, Narrow side Up | Down (default Up). Every joint mitred:
 * the miter bisects each corner's ACTUAL angle (the angles differ when the insets do).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord, framePayload, getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile, frameMiters, frameSolidSpec, frameSeedSafeMax, frameGenerateFailure } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  frameHandles, handleDragPatch, frameSeedGeometry, generateFrameSeeds, frameParamRanges, linkedSeedPatch, frameShapeControls,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import {
  generateSilhouette, generateContourSilhouette, PARAM_ORDER, SHAPE_PARAM_KEYS, FRAME_ONLY_PARAM_KEYS, PRESETS, TRAPEZOID_SEGMENT_COUNT,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import { frameLabel, initFramePanel, syncFramePanel } from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';
import { sampleOutline, pointInPolygon, frameLoopsWorld } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { HANDLE_SEGMENT_INDEX, controlledSegments } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-interaction.js';
import { familyForTemplate, framePresetsForTemplate } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/frame-families.js';
import { FRAME_PRESETS, brickSetById } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
import { bricksContourBands } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/contour-bands.js';
import { templateIconSvg } from '../bspline-frame-builder/b-spline-gen/html/editor/frame-template-icon.js';
import { setPaintScheduler } from '../bspline-frame-builder/b-spline-gen/html/core/loading-signal.js';

const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const T20 = tplOf('template_20');
const BOARDS = [[7, 9], [6, 9], [9, 12], [8, 8]];
const T = 0.75; // the default frame thickness
const board = (W, H) => ({ widthIn: W, heightIn: H });
const rec = (seeds = {}, extra = {}) => normalizeFrameRecord({ templateId: 'template_20', seeds, ...extra });
const profile = (seeds, W = 7, H = 9, extra) => frameCutProfile(FRAME_DEFS, rec(seeds, extra), board(W, H));
const inner = (seeds, W = 7, H = 9, extra) => frameInnerProfile(FRAME_DEFS, rec(seeds, extra), board(W, H));
/** The 4 corners TL, TR, BR, BL (each piece's own start, the piece order top, side R, bottom, side L). */
const corners = (prof) => prof.primitives.map((p) => [p.p0.x, p.p0.y]);
const expectCorners = (got, want) => got.forEach((c, i) => {
  expect(c[0], `corner ${i} x`).toBeCloseTo(want[i][0], 12);
  expect(c[1], `corner ${i} y`).toBeCloseTo(want[i][1], 12);
});
const unit = (v) => { const n = Math.hypot(v.x, v.y); return { x: v.x / n, y: v.y / n }; };
const angle = (u, v) => (Math.acos(Math.max(-1, Math.min(1, u.x * v.x + u.y * v.y))) * 180) / Math.PI;
// 7x9: the safe zone is x 0.25..6.75, y 0.25..8.75 (board coordinates, y down); 15% of the 6.5 in wide side = 0.975
const UP_15 = [[1.225, 0.25], [5.775, 0.25], [6.75, 8.75], [0.25, 8.75]];
const DOWN_15 = [[0.25, 0.25], [6.75, 0.25], [5.775, 8.75], [1.225, 8.75]];
const UP_0_30 = [[0.25, 0.25], [4.8, 0.25], [6.75, 8.75], [0.25, 8.75]]; // left 0% (vertical), right 30% = 1.95 in
const DOWN_0_30 = [[0.25, 0.25], [6.75, 0.25], [4.8, 8.75], [0.25, 8.75]];

describe('Template 20: listing and declaration', () => {
  it('is listed as "20. Trapezoid", the frame-only trapezoid preset, no new Fusion parameter, 4 mitred bars', () => {
    expect(T20.name).toBe('Template 20 - Trapezoid');
    expect(frameLabel(T20)).toBe('20. Trapezoid');
    expect(T20.silhouettePreset).toBe('trapezoid');
    expect(T20.hidden).toBe(false);
    expect(PRESETS.trapezoid.frameOnly).toBe(true);
    expect(T20.params.map((p) => p.name)).toEqual(['widthIn', 'heightIn', 'boundingboxoffset', 'frame_thickness']);
    expect(T20.regions.outline).toEqual(['proj_top_edge', 'proj_side_R', 'proj_bottom_edge', 'proj_side_L']);
    expect(T20.regions.miters).toHaveLength(4);
    expect(T20.regions.bars.map((b) => b.name)).toEqual(['frame_top', 'frame_right', 'frame_bottom', 'frame_left']);
    expect(T20.regions.bars.map((b) => b.name)).toEqual(T20.features[0].bodyNames);
    expect(T20.handles.map((h) => h.key)).toEqual(['leftInset', 'rightInset', 'insetLink', 'narrowSide']);
    for (const h of T20.handles) expect(h.binding).toBe('seeded'); // never a Fusion user parameter
  });

  it('its model is provisional (no live goldens yet): each narrow end 0.3 x hw = 15% of the wide side in', () => {
    expect(T20.shapeModel.provisional).toBeDefined();
    expect(T20.shapeModel.features).toEqual({ leftInset: { hw: 0.3, hh: 0 }, rightInset: { hw: 0.3, hh: 0 } });
  });

  it('the declared controls: two sliders 0..45 % of the wide side, a Symmetric link (on), Narrow side Up | Down (Up)', () => {
    const c = frameShapeControls(T20);
    expect(c.map((x) => [x.key, x.control.kind])).toEqual([['leftInset', 'slider'], ['rightInset', 'slider'], ['insetLink', 'check'], ['narrowSide', 'switch']]);
    expect(c[0].control).toMatchObject({ unit: '%', scale: 50, min: 0, max: 45, step: 1 });
    expect(c[2].control).toMatchObject({ default: 1, links: ['leftInset', 'rightInset'] });
    expect(c[3].control).toMatchObject({ default: 1, options: [{ value: 1, label: 'Up' }, { value: -1, label: 'Down' }] });
    // every other template declares no control: their Frame tabs are unchanged
    for (const t of FRAME_DEFS.templates) if (t.id !== 'template_20') expect(frameShapeControls(t), t.id).toEqual([]);
  });
});

describe('Template 20: the outline (corner points exact)', () => {
  it('default (no seeds) = symmetric 15/15, narrow side UP', () => expectCorners(corners(profile({})), UP_15));
  it('symmetric 15/15 Up, explicit', () => expectCorners(corners(profile({ leftInset: 0.3, rightInset: 0.3, narrowSide: 1 })), UP_15));
  it('symmetric 15/15 Down', () => expectCorners(corners(profile({ narrowSide: -1 })), DOWN_15));
  it('asymmetric 0/30 Up: the left side vertical (a right-angle trapezoid)', () => {
    const prof = profile({ leftInset: 0, rightInset: 0.6, insetLink: 0 });
    expectCorners(corners(prof), UP_0_30);
    const sideL = prof.primitives[3];
    expect(sideL.p0.x).toBeCloseTo(sideL.p1.x, 12);
  });
  it('asymmetric 0/30 Down', () => expectCorners(corners(profile({ leftInset: 0, rightInset: 0.6, insetLink: 0, narrowSide: -1 })), DOWN_0_30));

  it.each(BOARDS)('%dx%d: 4 straight pieces, 0 defects, the top and bottom horizontal on the safe zone, the wide side full width', (W, H) => {
    for (const narrowSide of [1, -1]) for (const [l, r] of [[0.3, 0.3], [0, 0.6], [0.5, 0.1]]) {
      const prof = profile({ leftInset: l, rightInset: r, insetLink: 0, narrowSide }, W, H);
      const tag = `${W}x${H} ${narrowSide} ${l}/${r}`;
      expect(prof.primitives, tag).toHaveLength(TRAPEZOID_SEGMENT_COUNT);
      expect(prof.primitives.every((p) => p.type === 'L'), tag).toBe(true);
      expect(prof.defects, tag).toEqual([]);
      const [top, , bottom] = prof.primitives, { x, y, w, h } = prof.region;
      expect(top.p0.y, tag).toBeCloseTo(y, 12); expect(top.p1.y, tag).toBeCloseTo(y, 12);
      expect(bottom.p0.y, tag).toBeCloseTo(y + h, 12); expect(bottom.p1.y, tag).toBeCloseTo(y + h, 12);
      const wide = narrowSide > 0 ? bottom : top, narrow = narrowSide > 0 ? top : bottom;
      expect(Math.abs(wide.p1.x - wide.p0.x), tag).toBeCloseTo(w, 12);
      expect(Math.abs(narrow.p1.x - narrow.p0.x), tag).toBeCloseTo(w - (l + r) * (w / 2), 12);
      for (const p of sampleOutline(prof.primitives, 8)) { // within the safe zone, so within the board
        expect(p.x).toBeGreaterThanOrEqual(x - 1e-9); expect(p.x).toBeLessThanOrEqual(x + w + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(y - 1e-9); expect(p.y).toBeLessThanOrEqual(y + h + 1e-9);
      }
    }
  });

  it('Up <-> Down flips ONLY the narrow side: the same left / right insets, mirrored top to bottom', () => {
    for (const [l, r] of [[0.3, 0.3], [0, 0.6], [0.5, 0.1], [0.9, 0.9]]) {
      const up = corners(profile({ leftInset: l, rightInset: r, insetLink: 0 })), down = corners(profile({ leftInset: l, rightInset: r, insetLink: 0, narrowSide: -1 }));
      // TL<->BL, TR<->BR; x kept, y mirrored about the board's own centre line (y = 4.5)
      expectCorners(down, [up[3], up[2], up[1], up[0]].map(([x, y]) => [x, 9 - y]));
    }
  });

  it('the stroke-inset contour (bricks from-frame contour) is the same trapezoid moved in by the stroke everywhere', () => {
    const region = { x: 0.25, y: 0.25, w: 6.5, h: 8.5 };
    const shape = { preset: 'trapezoid', params: { leftInset: 0, rightInset: 0.6 } };
    const s0 = generateSilhouette(region, shape), s1 = generateContourSilhouette(region, shape, 0.2);
    expect(s1.primitives).toHaveLength(4);
    expect(s1.primitives[0].p0.y).toBeCloseTo(s0.primitives[0].p0.y + 0.1, 12); // the top in
    expect(s1.primitives[2].p0.y).toBeCloseTo(s0.primitives[2].p0.y - 0.1, 12); // the bottom in
    expect(s1.primitives[3].p0.x).toBeCloseTo(s0.primitives[3].p0.x + 0.1, 12); // the vertical left side in
    // the slanted right side moved in by exactly 0.1 along its own normal
    const a = s0.primitives[1], b = s1.primitives[1], d = unit({ x: a.p1.x - a.p0.x, y: a.p1.y - a.p0.y });
    const off = (b.p0.x - a.p0.x) * -d.y + (b.p0.y - a.p0.y) * d.x;
    expect(Math.abs(off)).toBeCloseTo(0.1, 12);
  });
});

describe('Template 20: 4 miters, each bisecting its own corner angle', () => {
  it.each([['15/15 Up', {}], ['15/15 Down', { narrowSide: -1 }], ['0/30 Up', { leftInset: 0, rightInset: 0.6, insetLink: 0 }],
    ['0/30 Down', { leftInset: 0, rightInset: 0.6, insetLink: 0, narrowSide: -1 }], ['40/5 Up', { leftInset: 0.8, rightInset: 0.1, insetLink: 0 }]])(
    '%s: outer -> inner corner splits the angle in two equal halves, length t / sin(angle / 2)', (_tag, seeds) => {
      const prof = profile(seeds), inn = inner(seeds);
      expect(inn.defects).toEqual([]);
      const miters = frameMiters(prof.primitives, inn.primitives);
      expect(miters).toHaveLength(4);
      const angles = miters.map((m) => {
        const a = prof.primitives[m.aIdx], b = prof.primitives[m.bIdx];
        const back = unit({ x: a.p0.x - a.p1.x, y: a.p0.y - a.p1.y }), fwd = unit({ x: b.p1.x - b.p0.x, y: b.p1.y - b.p0.y });
        const mv = unit({ x: m.inner.x - m.outer.x, y: m.inner.y - m.outer.y });
        const th = angle(back, fwd);
        expect(angle(mv, back)).toBeCloseTo(th / 2, 9);
        expect(angle(mv, fwd)).toBeCloseTo(th / 2, 9);
        expect(Math.hypot(m.inner.x - m.outer.x, m.inner.y - m.outer.y)).toBeCloseTo(T / Math.sin((th * Math.PI) / 360), 9);
        expect(pointInPolygon(m.inner.x, m.inner.y, prof.polygon)).toBe(true);
        return th;
      });
      expect(angles.reduce((s, a) => s + a, 0)).toBeCloseTo(360, 9);
    });

  it('0/30: the angles really differ (two square corners on the vertical side, acute + obtuse on the slanted one)', () => {
    const seeds = { leftInset: 0, rightInset: 0.6, insetLink: 0 };
    const prof = profile(seeds);
    const th = frameMiters(prof.primitives, inner(seeds).primitives).map((m) => {
      const a = prof.primitives[m.aIdx], b = prof.primitives[m.bIdx];
      return angle(unit({ x: a.p0.x - a.p1.x, y: a.p0.y - a.p1.y }), unit({ x: b.p1.x - b.p0.x, y: b.p1.y - b.p0.y }));
    });
    expect(th[0]).toBeCloseTo(90, 9); // TL
    expect(th[3]).toBeCloseTo(90, 9); // BL
    expect(th[1]).toBeGreaterThan(90); // TR obtuse
    expect(th[2]).toBeLessThan(90); // BR acute
  });

  it('the inner edge is a trapezoid too: top / bottom horizontal, t in from the outline', () => {
    const inn = inner({ narrowSide: -1 });
    const [top, , bottom] = inn.primitives;
    expect(top.p0.y).toBeCloseTo(0.25 + T, 12); expect(top.p1.y).toBeCloseTo(0.25 + T, 12);
    expect(bottom.p0.y).toBeCloseTo(8.75 - T, 12); expect(bottom.p1.y).toBeCloseTo(8.75 - T, 12);
  });
});

describe('Template 20: the 3D panel trim', () => {
  const loops = (seeds) => frameLoopsWorld(frameSolidSpec(FRAME_DEFS, rec(seeds), board(7, 9)), { W: 7, H: 9, nx: 71, nz: 91 });
  it('the ring (bars) over the outline, 4 inner pieces', () => {
    const spec = frameSolidSpec(FRAME_DEFS, rec({}), board(7, 9));
    expect(spec.inner).toBeTruthy();
    expect(spec.innerPrimitives).toHaveLength(4);
  });
  it('Up trims the two TOP board corners off the panel, Down the two BOTTOM ones; 0/30 keeps the vertical side', () => {
    // world coordinates: x right, y UP, board centre at 0 (frame-mesh toWorld)
    const inside = (l, x, y) => pointInPolygon(x, y, l.panel);
    const up = loops({}), down = loops({ narrowSide: -1 }), asym = loops({ leftInset: 0, rightInset: 0.6, insetLink: 0 });
    for (const sx of [-1, 1]) {
      expect(inside(up, sx * 3.0, 4.0), `up top ${sx}`).toBe(false);
      expect(inside(up, sx * 3.0, -4.0), `up bottom ${sx}`).toBe(true);
      expect(inside(down, sx * 3.0, 4.0), `down top ${sx}`).toBe(true);
      expect(inside(down, sx * 3.0, -4.0), `down bottom ${sx}`).toBe(false);
    }
    expect(inside(asym, -3.0, 4.0)).toBe(true); // the vertical left side: the top-left corner stays
    expect(inside(asym, 3.0, 4.0)).toBe(false); // the 30% right inset trims the top-right one
  });
});

describe('Template 20: the record (persisted seeds)', () => {
  it('round-trips through save / load: insets, link and narrow side kept, unknown keys dropped', () => {
    const seeds = { leftInset: 0, rightInset: 0.6, insetLink: 0, narrowSide: -1 };
    const r = rec({ ...seeds, stemWidth: 0.4 });
    expect(r.seeds).toEqual(seeds);
    expect(normalizeFrameRecord(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(framePayload(FRAME_DEFS, r).seeds).toEqual(seeds);
  });
  it('an absent value = the declared default (15/15, linked, Up) -- a saved trapezoid lays exactly the same', () => {
    expect(rec({}).seeds).toEqual({});
    expectCorners(corners(profile({})), corners(profile({ leftInset: 0.3, rightInset: 0.3, insetLink: 1, narrowSide: 1 })));
  });
  it('the Fusion seeds: the 4 lines at the app\'s solved outline (Fusion inches, centred, y up)', () => {
    const prof = profile({ leftInset: 0, rightInset: 0.6, insetLink: 0, narrowSide: -1 });
    const geo = frameSeedGeometry(T20, prof, 7, 9);
    expect(Object.keys(geo)).toEqual(['top_edge', 'side_R', 'bottom_edge', 'side_L']);
    const F = ([x, y]) => [x - 3.5, 4.5 - y];
    const c = DOWN_0_30.map(F);
    const close = (got, want) => got.forEach((p, i) => p.forEach((v, k) => expect(v).toBeCloseTo(want[i][k], 12)));
    close(geo.top_edge.points, [c[0], c[1]]); close(geo.side_R.points, [c[1], c[2]]);
    close(geo.bottom_edge.points, [c[2], c[3]]); close(geo.side_L.points, [c[3], c[0]]);
  });
});

describe('Template 20: the Symmetric link', () => {
  it('on (the default): moving one inset moves the other to the same value', () => {
    expect(linkedSeedPatch(T20, {}, { leftInset: 0.5 })).toEqual({ leftInset: 0.5, rightInset: 0.5 });
    expect(linkedSeedPatch(T20, { insetLink: 1 }, { rightInset: 0.1 })).toEqual({ leftInset: 0.1, rightInset: 0.1 });
  });
  it('off: each inset on its own; turning it on alone moves nothing', () => {
    expect(linkedSeedPatch(T20, { insetLink: 0 }, { leftInset: 0.5 })).toEqual({ leftInset: 0.5 });
    expect(linkedSeedPatch(T20, { leftInset: 0, rightInset: 0.6, insetLink: 0 }, { insetLink: 1 })).toEqual({ insetLink: 1 });
    expect(linkedSeedPatch(T20, {}, { narrowSide: -1 })).toEqual({ narrowSide: -1 });
  });
  it('a canvas drag of the Left inset square writes both when linked, one when not', () => {
    const drag = (seeds, dx) => {
      const r = rec(seeds), prof = frameCutProfile(FRAME_DEFS, r, board(7, 9));
      const h = frameHandles(T20, prof).find((q) => q.key === 'leftInset');
      return handleDragPatch(r, h, { x: h.anchor.x + dx, y: h.anchor.y }, prof.region);
    };
    const linked = drag({}, 0.325); // +0.1 hw
    expect(linked.seeds.leftInset).toBeCloseTo(0.4, 12);
    expect(linked.seeds.rightInset).toBeCloseTo(0.4, 12);
    const free = drag({ insetLink: 0 }, 0.325);
    expect(free.seeds.leftInset).toBeCloseTo(0.4, 12);
    expect(free.seeds).not.toHaveProperty('rightInset');
  });
  it('[Generate] keeps the link and the narrow side; linked = symmetric, unlinked = each drawn on its own', () => {
    const region = profile({}).region;
    for (let seed = 1; seed <= 20; seed++) {
      const linked = generateFrameSeeds(T20, region, seed, T, { narrowSide: -1 });
      expect(linked.leftInset).toBe(linked.rightInset);
      expect(linked.narrowSide).toBe(-1);
      expect(linked).not.toHaveProperty('insetLink'); // nothing to keep: the default
      const free = generateFrameSeeds(T20, region, seed, T, { insetLink: 0 });
      expect(free.insetLink).toBe(0);
      expect(free).not.toHaveProperty('narrowSide');
      for (const s of [linked, free]) for (const k of ['leftInset', 'rightInset']) {
        expect(s[k]).toBeGreaterThanOrEqual(0); expect(s[k]).toBeLessThanOrEqual(0.6); // the declared Generate band
      }
    }
    const drawn = new Set(Array.from({ length: 20 }, (_, i) => { const s = generateFrameSeeds(T20, region, i + 1, T, { insetLink: 0 }); return s.leftInset === s.rightInset; }));
    expect(drawn.has(false)).toBe(true);
  });
});

describe('Template 20: the on-canvas handles', () => {
  it('two squares (Left / Right inset) at the narrow side\'s two ends; the link and the switch get none', () => {
    for (const narrowSide of [1, -1]) {
      const prof = profile({ narrowSide });
      const hs = frameHandles(T20, prof);
      expect(hs.map((h) => h.key)).toEqual(['leftInset', 'rightInset']);
      const [tl, tr, br, bl] = corners(prof);
      const [a, b] = narrowSide > 0 ? [tl, tr] : [bl, br];
      expect([hs[0].anchor.x, hs[0].anchor.y]).toEqual(a);
      expect([hs[1].anchor.x, hs[1].anchor.y]).toEqual(b);
    }
    expect(HANDLE_SEGMENT_INDEX.trapezoid).toEqual({ leftInset: 3, rightInset: 1 });
    expect(controlledSegments('trapezoid', 'leftInset', 4)).toEqual([3]);
    expect(controlledSegments('trapezoid', 'rightInset', 4)).toEqual([1]);
  });
  it('the slider travel is the declared feasible range: 0 .. 45 % of the wide side (0 .. 0.9 hw), no frame-thickness clamp', () => {
    const prof = profile({});
    const r = frameParamRanges(T20, prof.region, prof.params, T);
    expect(r.leftInset).toEqual({ min: 0, max: 0.9 });
    expect(r.rightInset).toEqual({ min: 0, max: 0.9 });
    expect(r.narrowSide).toEqual({ min: -1, max: 1 });
  });
});

describe('Template 20: the brick frame bands (families SUGGEST, never hide)', () => {
  it('is in the straight top / bottom family (with Templates 12 / 13\'s tapered sides); every preset stays listed', () => {
    expect(familyForTemplate('template_20').id).toBe('family_1_hourglass_neck');
    const list = Object.keys(FRAME_PRESETS).map((id) => ({ id, label: id }));
    const out = framePresetsForTemplate('template_20', list);
    expect(out.map((p) => p.id).sort()).toEqual(list.map((p) => p.id).sort());
  });
  it('lays the family\'s suggested bands inside the board, narrow side Up and Down', () => {
    const set = brickSetById(1);
    for (const narrowSide of [1, -1]) {
      const prof = profile({ narrowSide });
      const n = prof.primitives.length;
      const prims = prof.primitives.map((p, i) => ({ type: 'line', p0: p.p0, p1: prof.primitives[(i + 1) % n].p0 }));
      for (const pid of ['single_soldier', 'soldier_stretcher', 'three_band']) {
        const res = bricksContourBands(prims, FRAME_PRESETS[pid], { set, seed: 1 });
        expect(res.bricks.length, `${pid} ${narrowSide}`).toBeGreaterThan(0);
        for (const b of res.bricks) for (const pt of b.polygon) {
          expect(pt.x).toBeGreaterThanOrEqual(-0.02); expect(pt.x).toBeLessThanOrEqual(7.02);
          expect(pt.y).toBeGreaterThanOrEqual(-0.02); expect(pt.y).toBeLessThanOrEqual(9.02);
        }
      }
    }
  });
});

describe('the picker icon, and every other template untouched', () => {
  it('the template picker draws its icon from the engine, like every template', () => {
    expect(templateIconSvg(FRAME_DEFS, 'template_20')).toMatch(/^<svg[^>]*viewBox="0 0 7 9"/);
    expect(templateIconSvg(FRAME_DEFS, 'template_20')).not.toBe(templateIconSvg(FRAME_DEFS, 'template_6'));
  });
  it('frame-only keys: the Shape Lattice and every other preset never get them', () => {
    expect(PARAM_ORDER.trapezoid).toEqual(['leftInset', 'rightInset', 'narrowSide', 'insetLink']);
    for (const k of ['leftInset', 'rightInset', 'narrowSide']) expect(FRAME_ONLY_PARAM_KEYS).toContain(k);
    expect(SHAPE_PARAM_KEYS).not.toHaveProperty('trapezoid');
    for (const t of FRAME_DEFS.templates) if (t.id !== 'template_20') {
      for (const k of ['leftInset', 'rightInset', 'insetLink', 'narrowSide']) expect(t.handles.map((h) => h.key), t.id).not.toContain(k);
    }
  });
});

const FIXTURE = `
  <input id="widthIn" value="7"><input id="heightIn" value="9">
  <span id="frameSummary"></span><div id="framePanelHeader" class="collapsed"></div>
  <select id="frameTemplate"></select>
  <div id="frameSettings"><div id="frameThicknessRow"><input id="frameThickness" type="number"></div><input id="frameBottomZ"><input id="frameTrimOffset" type="number"><select id="frameAppearance"></select>
    <div id="frameShapeControls"></div><div id="frameFitWarning"></div><button id="btnEditFrameShape"></button></div>
  <button id="btnStampEdit"></button>
  <button id="editorTabFrame"></button><button id="editorTabArtwork" class="active"></button>
  <div id="editorFrameShield" style="display:none"></div>
  <aside id="editorFramePanel" style="display:none"><select id="editorFrameTemplate"></select><div id="editorFrameShapeControls"></div></aside>
  <aside id="editorLayersPanel"></aside>`;

describe("Template 20: the inset sliders stop just before the narrow side's mitres overlap (Fred-approved 2026-11-22)", () => {
  // The first failing inset MEASURED before this rule (both insets equal, 1 % steps): 7x9 41 %, 6x9 38 %, 9x12 43 % at
  // t 0.75; 29 / 24 / 35 % at t 1.5 -- each mitresCollide. The stop must sit just below: inside [first - 1, first).
  const failure = (r, W, H) => {
    const prof = frameCutProfile(FRAME_DEFS, r, board(W, H));
    return frameGenerateFailure(FRAME_DEFS, r, board(W, H), T20, prof.region, r.params.frame_thickness ?? T)(r.seeds);
  };
  it.each([[7, 9, 0.75, 41], [6, 9, 0.75, 38], [9, 12, 0.75, 43], [7, 9, 1.5, 29], [6, 9, 1.5, 24], [9, 12, 1.5, 35]])(
    '%dx%d at t %s: the linked (Symmetric) max is just below %d percent, safe at the max, colliding just past it', (W, H, t, first) => {
      const r = rec({}, { params: { frame_thickness: t } });
      const max = frameSeedSafeMax(FRAME_DEFS, r, board(W, H), 'leftInset');
      expect(max * 50).toBeLessThan(first);
      expect(max * 50).toBeGreaterThanOrEqual(first - 1);
      expect(frameSeedSafeMax(FRAME_DEFS, r, board(W, H), 'rightInset')).toBeCloseTo(max, 9); // the joint max
      const at = rec({ leftInset: max, rightInset: max }, { params: { frame_thickness: t } });
      expect(failure(at, W, H)).toBeNull();
      expect(failure(rec({ leftInset: max + 0.005, rightInset: max + 0.005 }, { params: { frame_thickness: t } }), W, H)).toBe('mitersCollide');
    });

  it("asymmetric (link off): each end's max depends on the OTHER inset and the narrow side", () => {
    const p = { params: { frame_thickness: 1.5 } }; // 7x9, t 1.5
    const r0 = rec({ leftInset: 0, rightInset: 0.6, insetLink: 0 }, p); // right 30 %
    const maxL = frameSeedSafeMax(FRAME_DEFS, r0, board(7, 9), 'leftInset');
    const linkedMax = frameSeedSafeMax(FRAME_DEFS, rec({}, p), board(7, 9), 'leftInset');
    expect(maxL * 50).toBeGreaterThan(26.5); expect(maxL * 50).toBeLessThan(27.5); // MEASURED 27.06 % (linked: 28.53 %)
    expect(maxL).toBeLessThan(linkedMax); // a different pair, a different stop
    expect(failure(rec({ leftInset: maxL, rightInset: 0.6, insetLink: 0 }, p), 7, 9)).toBeNull();
    expect(failure(rec({ leftInset: maxL + 0.005, rightInset: 0.6, insetLink: 0 }, p), 7, 9)).toBe('mitersCollide');
    // the other inset sets the stop: with the right end at 10 % the left one runs its whole 45 % travel
    expect(frameSeedSafeMax(FRAME_DEFS, rec({ leftInset: 0, rightInset: 0.2, insetLink: 0 }, p), board(7, 9), 'leftInset')).toBe(0.9);
    // Down: the same stop (the narrow side mirrored, the same mitres)
    expect(frameSeedSafeMax(FRAME_DEFS, rec({ leftInset: 0, rightInset: 0.6, insetLink: 0, narrowSide: -1 }, p), board(7, 9), 'leftInset')).toBeCloseTo(maxL, 6);
  });

  it("a saved inset above today's max is NOT rewritten on load: the record and the drawn shape keep it", () => {
    const saved = { leftInset: 0.88, rightInset: 0.88 }; // 44 %, past the 7x9 / t 1.5 stop (~28 %)
    const r = normalizeFrameRecord(JSON.parse(JSON.stringify({ templateId: 'template_20', seeds: saved, params: { frame_thickness: 1.5 } })));
    expect(r.seeds).toEqual(saved);
    expect(frameCutProfile(FRAME_DEFS, r, board(7, 9)).params.leftInset).toBe(0.88);
    expect(frameSeedSafeMax(FRAME_DEFS, r, board(7, 9), 'leftInset') * 50).toBeLessThan(29);
  });

  it('no other template declares the stop (their panels have no slider at all)', () => {
    for (const t of FRAME_DEFS.templates) for (const h of t.handles) if (h.control?.stopBeforeOverlap) expect(t.id).toBe('template_20');
    expect(T20.handles.filter((h) => h.control?.stopBeforeOverlap).map((h) => h.key)).toEqual(['leftInset', 'rightInset']);
  });
});

describe('the Frame panel shows the declared controls (sidebar + Frame tab, two views of one record)', () => {
  let root;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = FIXTURE;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    window.svgEditor = null;
    setPaintScheduler((cb) => cb()); // a control's edit runs its loading stage first: paint it at once here
    initFramePanel();
  });
  afterEach(() => { root.remove(); setPaintScheduler(null); });

  it('none for a template without controls; the trapezoid\'s four for Template 20, in both views', () => {
    setFrameRecord({ templateId: 'template_1' }); syncFramePanel();
    expect(document.querySelectorAll('#frameShapeControls [data-shape-key]')).toHaveLength(0);
    expect(document.getElementById('editorFrameShapeControls').style.display).toBe('none');
    setFrameRecord({ templateId: 'template_20' }); syncFramePanel();
    for (const id of ['frameShapeControls', 'editorFrameShapeControls']) {
      const box = document.getElementById(id);
      expect([...box.querySelectorAll('[data-shape-key]')].map((e) => e.dataset.shapeKey)).toEqual(['leftInset', 'rightInset', 'insetLink', 'narrowSide']);
      expect(box.querySelector('[data-shape-key="leftInset"] input[type="range"]').value).toBe('15');
      expect(box.querySelector('[data-shape-key="insetLink"] input[type="checkbox"]').checked).toBe(true);
      expect(box.querySelector('[data-shape-key="narrowSide"] button[aria-pressed="true"]').textContent).toBe('Up');
    }
  });

  it('Down, then a linked slider move, then unlinked: each is one record write through the link rule', () => {
    setFrameRecord({ templateId: 'template_20' }); syncFramePanel();
    const box = document.getElementById('editorFrameShapeControls');
    [...box.querySelectorAll('[data-shape-key="narrowSide"] button')].find((b) => b.textContent === 'Down').click();
    expect(getFrameRecord().seeds).toEqual({ narrowSide: -1 });
    const left = box.querySelector('[data-shape-key="leftInset"] input[type="range"]');
    left.value = '20'; left.dispatchEvent(new Event('change'));
    expect(getFrameRecord().seeds.leftInset).toBeCloseTo(0.4, 12);
    expect(getFrameRecord().seeds.rightInset).toBeCloseTo(0.4, 12);
    const link = box.querySelector('[data-shape-key="insetLink"] input[type="checkbox"]');
    link.checked = false; link.dispatchEvent(new Event('change'));
    const right = box.querySelector('[data-shape-key="rightInset"] input[type="range"]');
    right.value = '0'; right.dispatchEvent(new Event('change'));
    expect(getFrameRecord().seeds).toEqual({ narrowSide: -1, leftInset: 0.4, rightInset: 0, insetLink: 0 });
    // the sidebar view follows the same record
    expect(document.querySelector('#frameShapeControls [data-shape-key="rightInset"] input[type="range"]').value).toBe('0');
    expect(document.querySelector('#frameShapeControls [data-shape-key="narrowSide"] button[aria-pressed="true"]').textContent).toBe('Down');
  });
  it('the slider ends at the stop (re-read on a thickness change); a saved value past it shows pinned and stays saved', () => {
    setFrameRecord({ templateId: 'template_20' }); syncFramePanel();
    const left = () => document.querySelector('#editorFrameShapeControls [data-shape-key="leftInset"] input[type="range"]');
    const want = (t) => String(Math.floor(frameSeedSafeMax(FRAME_DEFS, getFrameRecord(), board(7, 9), 'leftInset') * 50 + 1e-9));
    expect(left().max).toBe(want());
    expect(Number(left().max)).toBeLessThan(41);
    setFrameRecord({ params: { frame_thickness: 1.5 } }); syncFramePanel();
    expect(left().max).toBe(want());
    expect(Number(left().max)).toBeLessThan(29);
    setFrameRecord({ seeds: { leftInset: 0.88, rightInset: 0.88 } }); syncFramePanel(); // e.g. a board loaded / resized smaller
    expect(left().value).toBe(left().max); // pinned at its end
    expect(document.querySelector('#editorFrameShapeControls [data-shape-key="leftInset"] .frame-shape-value').textContent).toBe('44%');
    expect(getFrameRecord().seeds).toEqual({ leftInset: 0.88, rightInset: 0.88 }); // never rewritten by the panel
    // a user drag to the end writes the stop (linked: both)
    left().value = left().max; left().dispatchEvent(new Event('change'));
    expect(getFrameRecord().seeds.leftInset * 50).toBeCloseTo(Number(left().max), 9);
    expect(getFrameRecord().seeds.rightInset).toBe(getFrameRecord().seeds.leftInset);
  });
});

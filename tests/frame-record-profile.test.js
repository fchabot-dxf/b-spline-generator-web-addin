/**
 * FB-APP S2 (F6): the persisted frame record (design §3.2) and the editor's
 * cut profile (§3.0 headline).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  FRAME_DEFS, defaultFrameRecord, normalizeFrameRecord, getFrameRecord, setFrameRecord,
} from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { P, persistableP, saveLastSession, loadLastSession } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  frameCutProfile, frameFit, drawFrameProfile, setFrameProfileProvider, FRAME_PROFILE_GROUP_ID, frameInnerProfile, frameMiters,
  FRAME_OUTLINE_COLOR, INACTIVE_LAYER_OPACITY, setEditorFocus, FRAME_CUTAWAY_GROUP_ID,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { frameColorFor } from '../bspline-frame-builder/b-spline-gen/html/core/color-utils.js';

const T1 = 'template_1', T2 = 'template_2', T3 = 'template_3', T4 = 'template_4', T5 = 'template_5';

describe('frame record', () => {
  beforeEach(() => { P.frame = null; });

  it('defaults to NO frame (Q2)', () => {
    expect(defaultFrameRecord()).toMatchObject({ templateId: null, frameBottomZ: -1, appearance: '3D Ash - Unfinished', params: {} });
    expect(getFrameRecord().templateId).toBeNull();
  });

  it('an old project (no frame key) reads as no frame', () => {
    expect(normalizeFrameRecord(undefined).templateId).toBeNull();
    expect(normalizeFrameRecord({}).templateId).toBeNull();
  });

  it('never keeps a half-valid record', () => {
    const r = normalizeFrameRecord({
      templateId: 'template_99', frameBottomZ: 'deep', appearance: '3D Oak', params: { frame_thickness: 0.5 },
    });
    expect(r).toEqual(defaultFrameRecord());
    const ok = normalizeFrameRecord({ templateId: T1, params: { frame_thickness: '0.5', widthIn: 30, bogus: 1 } });
    expect(ok.params).toEqual({ frame_thickness: 0.5 }); // board-owned and undeclared keys are dropped
  });

  it('round trip: set frame -> project snapshot (JSON) -> load -> record intact', () => {
    setFrameRecord({ templateId: T2, frameBottomZ: -0.75, appearance: '3D Oak - Painted' });
    const saved = JSON.parse(JSON.stringify({ P: persistableP() }));
    P.frame = null; // "new session"
    P.frame = saved.P.frame; // the project load's own restore loop (applySnapshot) writes P[k] back
    expect(getFrameRecord()).toMatchObject({ templateId: T2, frameBottomZ: -0.75, appearance: '3D Oak - Painted' });
  });

  it('round trip through the last-session store (localStorage)', () => {
    setFrameRecord({ templateId: T1, frameBottomZ: -1.25 });
    saveLastSession();
    P.frame = null;
    expect(loadLastSession()).toBe(true);
    expect(getFrameRecord()).toMatchObject({ templateId: T1, frameBottomZ: -1.25 });
  });
});

describe('cut profile', () => {
  const board = { widthIn: 7, heightIn: 9 };

  it('no frame -> no profile', () => {
    expect(frameCutProfile(FRAME_DEFS, defaultFrameRecord(), board)).toBeNull();
  });

  it.each([T1, T2, T3, T4, T5])('%s on 7x9: a clean outline inside the safe zone', (id) => {
    const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id }), board);
    expect(prof.defects).toEqual([]);
    expect(prof.region).toEqual({ x: 0.25, y: 0.25, w: 6.5, h: 8.5 });
    expect(prof.fit.ok).toBe(true);
    expect(prof.pathD.startsWith('M')).toBe(true);
  });

  it('the fit rule agrees with every live-recorded Fusion golden (0 bars <=> too small)', () => {
    const dir = 'tests/fixtures/frame-parity/';
    for (const f of ['template_1_7x9', 'template_1_5.51x1.97', 'template_1_12x6', 'template_2_7x9', 'template_2_5.51x1.97', 'template_2_12x6']) {
      const g = JSON.parse(readFileSync(`${dir}${f}.json`, 'utf-8'));
      expect(frameFit(g.meta.widthIn, g.meta.heightIn, 0.75, 0.25).ok).toBe(Object.keys(g.bars).length === 4);
    }
  });

  it('T1 7x9 approximates Fusion\'s own solved outline (declared, fitted params; S4 tightens this)', () => {
    // Fusion is centred + y-up; the app is top-left + y-down: map the golden's
    // waist pinch (innermost x of the right waist arc) into board coordinates.
    const g = JSON.parse(readFileSync('tests/fixtures/frame-parity/template_1_7x9.json', 'utf-8')).sketch2_shape_outline;
    const fusionPinchX = 3.5 + (g.arc_waist_R.center[0] - g.arc_waist_R.radius);
    const prof = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: T1 }), board);
    const waist = prof.primitives.filter((p) => p.type === 'A')[1];
    // MEASURED: 0.0013 in at 7x9 (shoulder radius 0.6175 vs Fusion 0.6242). At 12x6 the
    // fitted params do NOT hold (pinch 0.44 in off, shoulder radius 1.09 vs 0.42): Fusion's
    // solve is not scale-invariant. That is S4's parity job, not asserted here.
    expect(Math.abs((waist.cx - waist.rx) - fusionPinchX)).toBeLessThan(0.02);
  });
});

// ---------------------------------------------------------------- drawing
function mockEditor() {
  const calls = [];
  const node = (kind) => {
    const n = {
      kind, children: [], attrs: {}, cls: [],
      id(v) { n.attrs.id = v; return n; }, attr(k, v) { n.attrs[k] = v; return n; },
      fill(v) { n.attrs.fill = v; return n; }, stroke(v) { n.attrs.stroke = v; return n; },
      addClass(c) { n.cls.push(c); return n; },
      path(d) { const c = node('path'); c.attrs.d = d; n.children.push(c); calls.push('path'); return c; },
      circle(dia) { const c = node('circle'); c.attrs.r = dia / 2; n.children.push(c); return c; },
      rect(w, h) { const c = node('rect'); c.attrs.width = w; c.attrs.height = h; c.move = () => c; n.children.push(c); return c; }, // F27 item 2: a position handle's square
      center(x, y) { n.attrs.cx = x; n.attrs.cy = y; return n; },
      group() { const c = node('g'); n.children.push(c); c.parent = n; return c; },
      remove() { if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n); },
      findOne(sel) { return n.children.find((c) => '#' + c.attrs.id === sel) || null; },
    };
    return n;
  };
  const bg = node('bg');
  const sketch = node('sketch');
  return { editor: { _bgLayer: bg, _sketchLayer: sketch, _mW: 7, _mH: 9 }, bg, sketch };
}

describe('drawFrameProfile (editor background)', () => {
  it('draws the shaded cut-away + the profile in the BACKGROUND layer only (artwork untouched)', () => {
    const { editor, bg, sketch } = mockEditor();
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: T1 }) }));
    const prof = drawFrameProfile(editor);
    const g = bg.findOne('#' + FRAME_PROFILE_GROUP_ID);
    expect(g).toBeTruthy();
    // F8 (Fred): the frame band (thickness), its inner edge and the 4 miters, under the profile outline.
    expect(g.children.map((c) => c.cls[0])).toEqual(['frame-band', 'frame-inner-edge',
      'frame-miter', 'frame-miter', 'frame-miter', 'frame-miter', 'frame-cut-profile']);
    // Fred: "when a frame exists make the outside of the frame darker" -- the cut-away is its own group, drawn
    // just before the profile group and never faded by the focus rule (which only sets the profile group's opacity).
    const cut = bg.findOne('#' + FRAME_CUTAWAY_GROUP_ID);
    expect(cut.children.map((c) => c.cls[0])).toEqual(['frame-cutaway']);
    expect(bg.children.indexOf(cut)).toBe(bg.children.indexOf(g) - 1);
    expect(cut.attrs.opacity).toBeUndefined();
    expect(cut.children[0].attrs['fill-rule']).toBe('evenodd');
    expect(cut.children[0].attrs.d.startsWith('M0 0 H7 V9 H0 Z ')).toBe(true);
    expect(sketch.children).toEqual([]);
    expect(editor._frameProfile).toBe(prof);
  });

  it('redraws in place (one group), and removes it when the frame is set to none', () => {
    const { editor, bg } = mockEditor();
    let rec = normalizeFrameRecord({ templateId: T1 });
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: rec }));
    drawFrameProfile(editor);
    drawFrameProfile(editor);
    expect(bg.children.filter((c) => c.attrs.id === FRAME_PROFILE_GROUP_ID)).toHaveLength(1);
    rec = defaultFrameRecord();
    expect(drawFrameProfile(editor)).toBeNull();
    expect(bg.findOne('#' + FRAME_PROFILE_GROUP_ID)).toBeNull();
  });

  it('never draws a looped outline (the F5 guard gates the drawing)', () => {
    const { editor, bg } = mockEditor();
    const broken = JSON.parse(JSON.stringify(FRAME_DEFS));
    // A declared shape the solver would clamp is fine; force a defect by a
    // degenerate board narrower than twice the offset.
    setFrameProfileProvider(() => ({ defs: broken, record: normalizeFrameRecord({ templateId: T1 }, broken) }));
    editor._mW = 0.4; editor._mH = 0.4;
    const prof = drawFrameProfile(editor);
    expect(prof.defects.length).toBeGreaterThan(0);
    expect(bg.findOne('#' + FRAME_PROFILE_GROUP_ID)).toBeNull();
  });
});

describe('frame thickness + miters (F8, Fred)', () => {
  it.each([T1, T2, T3, T4, T5])('%s: 4 miters, from each outer corner to its inner corner (the frame thickness down, and inward)', (id) => {
    const r = normalizeFrameRecord({ templateId: id });
    const outer = frameCutProfile(FRAME_DEFS, r, { widthIn: 7, heightIn: 9 });
    const inner = frameInnerProfile(FRAME_DEFS, r, { widthIn: 7, heightIn: 9 });
    const miters = frameMiters(outer.primitives, inner.primitives);
    expect(miters).toHaveLength(4);
    for (const m of miters) {
      expect(Math.abs(m.inner.y - m.outer.y)).toBeCloseTo(0.75, 9); // frame_thickness 0.75 in
      expect(Math.abs(Math.abs(m.inner.x - m.outer.x))).toBeGreaterThan(0); // runs inward, not along an edge
    }
  });
});

describe('frame lines + the focus rule (F8, Fred)', () => {
  const drawn = (tab) => {
    const { editor, bg, sketch } = mockEditor();
    if (tab) setEditorFocus(editor, tab);
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record: normalizeFrameRecord({ templateId: T1 }) }));
    drawFrameProfile(editor);
    return { editor, g: bg.findOne('#' + FRAME_PROFILE_GROUP_ID), sketch };
  };

  it('every frame line (outline, inner edge, miters) is drawn in the ONE declared colour', () => {
    const { g } = drawn();
    const stroked = g.children.filter((c) => c.attrs.stroke);
    expect(stroked.map((c) => c.cls[0]).sort()).toEqual(['frame-cut-profile', 'frame-inner-edge',
      'frame-miter', 'frame-miter', 'frame-miter', 'frame-miter']);
    expect(new Set(stroked.map((c) => c.attrs.stroke.color))).toEqual(new Set([FRAME_OUTLINE_COLOR]));
  });

  it('H8: the frame band is filled with the wood\'s own declared FRAME_COLORS entry, not the raw board colour', () => {
    const { g } = drawn();
    const band = g.children.find((c) => c.cls[0] === 'frame-band');
    const boardHex = FRAME_DEFS.appearance.previewColors['3D Ash - Unfinished']; // default appearance (T1, no override)
    expect(band.attrs.fill.color).toBe(frameColorFor('3D Ash - Unfinished', boardHex));
    expect(band.attrs.fill.color).not.toBe(boardHex);
  });

  it('Artwork tab: the frame is the faded one; Frame tab: the artwork is, with the SAME declared value', () => {
    const art = drawn('artwork');
    expect(art.g.attrs.opacity).toBe(INACTIVE_LAYER_OPACITY);
    expect(art.sketch.attrs.opacity).toBe(null);
    const frame = drawn('frame');
    expect(frame.g.attrs.opacity).toBeUndefined(); // full
    expect(frame.sketch.attrs.opacity).toBe(INACTIVE_LAYER_OPACITY);
    // switching back on the same editor restores both
    setEditorFocus(frame.editor, 'artwork');
    expect([frame.g.attrs.opacity, frame.sketch.attrs.opacity]).toEqual([INACTIVE_LAYER_OPACITY, null]);
  });
});

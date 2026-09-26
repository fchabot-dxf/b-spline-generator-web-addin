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
  frameCutProfile, frameFit, drawFrameProfile, setFrameProfileProvider, FRAME_PROFILE_GROUP_ID,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';

const T1 = 'template_1', T2 = 'template_2';

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
    setFrameRecord({ templateId: T2, frameBottomZ: -0.75, appearance: '3D Cherry - Unfinished' });
    const saved = JSON.parse(JSON.stringify({ P: persistableP() }));
    P.frame = null; // "new session"
    P.frame = saved.P.frame; // the project load's own restore loop (applySnapshot) writes P[k] back
    expect(getFrameRecord()).toMatchObject({ templateId: T2, frameBottomZ: -0.75, appearance: '3D Cherry - Unfinished' });
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

  it.each([T1, T2])('%s on 7x9: a clean outline inside the safe zone', (id) => {
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
    expect(g.children.map((c) => c.cls[0])).toEqual(['frame-cutaway', 'frame-cut-profile']);
    expect(g.children[0].attrs['fill-rule']).toBe('evenodd');
    expect(g.children[0].attrs.d.startsWith('M0 0 H7 V9 H0 Z ')).toBe(true);
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

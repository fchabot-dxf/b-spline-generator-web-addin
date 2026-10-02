/**
 * FB-APP F13 (FRAME-GEN): the Frame tab's [Generate] draws a seeded random
 * frame shape (every declared seeded handle inside its feasible range, in
 * PARAM_ORDER) as the handles' SEEDS; the handles then tweak it; Undo steps
 * back (generate and tweak are each a step); a template change resets.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P, persistableP, setIsFusionMode } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { normalizeFrameRecord, getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { frameCutProfile, frameInnerProfile } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import {
  generateFrameSeeds, generateValidFrameSeeds, frameHandleTable, frameSeedGeometry, frameHandles, frameParamRanges,
  FRAME_GEN_BAND, FRAME_MIN_OPENING_IN,
} from '../bspline-frame-builder/b-spline-gen/html/editor/frame-handles.js';
import { feasibleParamRanges } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-shape-lattice-generator.js';
import {
  initFramePanel, setEditorTab, generateFrame, undoFrame, frameHistoryDepth, sendFrame,
} from '../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const tplOf = (id) => FRAME_DEFS.templates.find((t) => t.id === id);
const regionOf = (id) => frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id }), BOARD).region;

describe.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5'])('%s: the frame opening rule', (id) => {
  it('a handle drag can not close the frame opening at the pinch (the inner edge stays one open loop)', () => {
    const tpl = tplOf(id);
    const rec = normalizeFrameRecord({ templateId: id });
    const prof = frameCutProfile(FRAME_DEFS, rec, BOARD);
    const key = tpl.silhouettePreset === 'bottle' ? 'neckWidth' : 'waistReach';
    const h = frameHandles(tpl, prof, 0.75).find((q) => q.key === key);
    // drag all the way past the centreline: the pinch as tight as the handle allows
    const v = h.valueFromWorld({ x: prof.region.x + prof.region.w / 2, y: h.anchor.y });
    const r = frameParamRanges(tpl, prof.region, prof.params, 0.75)[key];
    expect(v).toBeCloseTo(key === 'waistReach' ? r.max : r.min, 12);
    const seeded = normalizeFrameRecord({ templateId: id, seeds: { [key]: v } });
    const inner = frameInnerProfile(FRAME_DEFS, seeded, BOARD);
    expect(inner.defects).toEqual([]);
    const opening = key === 'waistReach' ? 2 * (prof.region.w / 2 * (1 - v) - 0.75) : 2 * (prof.region.w / 2 * v - 0.75);
    expect(opening).toBeCloseTo(FRAME_MIN_OPENING_IN, 9);
  });
});

describe.each(['template_1', 'template_2', 'template_3', 'template_4', 'template_5', 'template_6'])('%s: [Generate] shapes', (id) => {
  const tpl = tplOf(id), region = regionOf(id);
  const keys = frameHandleTable(tpl).filter((h) => h.binding === 'seeded').map((h) => h.key).sort();

  it('200 generates are all valid frames, each value honoured inside its feasible range', () => {
    const bad = [];
    const shapes = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      const seeds = generateFrameSeeds(tpl, region, seed);
      expect(Object.keys(seeds).sort()).toEqual(keys);
      const rec = normalizeFrameRecord({ templateId: id, seeds });
      const prof = frameCutProfile(FRAME_DEFS, rec, BOARD);
      const inner = frameInnerProfile(FRAME_DEFS, rec, BOARD);
      const ranges = feasibleParamRanges(tpl.silhouettePreset, region, prof.params);
      const clamped = keys.filter((k) => Math.abs(prof.params[k] - seeds[k]) > 1e-9
        || prof.params[k] < ranges[k].min - 1e-9 || prof.params[k] > ranges[k].max + 1e-9);
      if (prof.defects.length || !inner || inner.defects.length || clamped.length) {
        bad.push({ seed, outline: prof.defects[0], inner: inner ? inner.defects[0] : 'none', clamped });
      }
      shapes.add(prof.pathD);
    }
    expect(bad).toEqual([]);
    expect(shapes.size).toBe(200); // every press is a new shape
  });

  it('the same seed gives the same shape; values stay inside the declared generation band', () => {
    expect(generateFrameSeeds(tpl, region, 1234)).toEqual(generateFrameSeeds(tpl, region, 1234));
    expect(generateFrameSeeds(tpl, region, 1234)).not.toEqual(generateFrameSeeds(tpl, region, 1235));
    const base = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: id }), BOARD).params;
    const first = tpl.handles.find((h) => h.binding === 'seeded').key; // the first in PARAM_ORDER has no earlier generated value
    const r = frameParamRanges(tpl, region, base, 0.75)[first];
    for (let seed = 1; seed <= 50; seed++) {
      const v = generateFrameSeeds(tpl, region, seed)[first];
      expect(v).toBeGreaterThanOrEqual(r.min + (r.max - r.min) * FRAME_GEN_BAND[0] - 1e-9);
      expect(v).toBeLessThanOrEqual(r.min + (r.max - r.min) * FRAME_GEN_BAND[1] + 1e-9);
    }
  });
});

/**
 * F23 HANDLE-REACH (Fred, iPad, Frame tab, Hourglass: "shouldn't the handle
 * and geometry allow the handle to go further and make the arc wider" ->
 * "hip and shoulder"): T1's Shoulder/Hip (cornerRadiusTop/cornerRadiusBottom)
 * no longer clamp manual drags to a declared UI band ([0.04, 0.95], pre-F23)
 * -- only to the real outline geometry (editor-shape-lattice-generator.js's
 * own HANDLE-REACH tests prove the new bound is the true tangency/validity
 * limit). [Generate] must still stay inside its own declared band regardless
 * -- the SAME band-only-governs-Generate split as `waistReach`/`neckWidth`.
 */
describe('F23 HANDLE-REACH: Shoulder/Hip reach the true limit; Generate stays banded', () => {
  const tpl = tplOf('template_1'), region = regionOf('template_1');

  it.each(['cornerRadiusTop', 'cornerRadiusBottom'])('a manual drag on %s can reach past the old [0.04, 0.95] band', (key) => {
    const rec = normalizeFrameRecord({ templateId: 'template_1' });
    const prof = frameCutProfile(FRAME_DEFS, rec, BOARD);
    const h = frameHandles(tpl, prof, 0.75).find((q) => q.key === key);
    const r = frameParamRanges(tpl, prof.region, prof.params, 0.75)[key];
    expect(r.max).toBeGreaterThan(0.95); // the true ceiling now exceeds the old declared UI band
    // drag far past the old 0.95 ceiling (cornerRadiusTop/Bottom increase as
    // world x DECREASES, per this handle's own valueFromWorld): the handle
    // clamps to the NEW (wider) max, not 0.95.
    const far = { x: h.anchor.x - prof.region.w * 4, y: h.anchor.y };
    const v = h.valueFromWorld(far);
    expect(v).toBeCloseTo(r.max, 9);
    expect(v).toBeGreaterThan(0.95);
  });

  it('200 [Generate]s keep cornerRadiusTop/Bottom inside the declared 0.1-0.9 band, not the widened outline limit', () => {
    for (const key of ['cornerRadiusTop', 'cornerRadiusBottom']) {
      for (let seed = 1; seed <= 200; seed++) {
        const seeds = generateFrameSeeds(tpl, region, seed);
        const rec = normalizeFrameRecord({ templateId: 'template_1', seeds });
        const prof = frameCutProfile(FRAME_DEFS, rec, BOARD);
        const r = frameParamRanges(tpl, prof.region, prof.params, 0.75)[key];
        const v = seeds[key];
        expect(v).toBeGreaterThanOrEqual(r.min + (r.max - r.min) * FRAME_GEN_BAND[0] - 1e-9);
        expect(v).toBeLessThanOrEqual(r.min + (r.max - r.min) * FRAME_GEN_BAND[1] + 1e-9);
      }
    }
  });
});

// ---------------------------------------------------------------- the Frame tab flow
function mockCanvasEditor() {
  const node = () => {
    const n = { children: [], attrs: {} };
    const self = (f) => (...a) => { f(...a); return n; };
    Object.assign(n, {
      id: self((v) => { n.attrs.id = v; }), attr: self((k, v) => { n.attrs[k] = v; }), fill: self(() => {}),
      stroke: self(() => {}), addClass: self(() => {}), center: self(() => {}),
      path: () => { const c = node(); n.children.push(c); return c; },
      circle: () => { const c = node(); n.children.push(c); return c; },
      rect: () => { const c = node(); c.move = () => c; n.children.push(c); return c; }, // F27 item 2: a position handle's square
      group: () => { const c = node(); c.parent = n; n.children.push(c); return c; },
      remove: () => { if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n); },
      findOne: (sel) => n.children.find((c) => '#' + c.attrs.id === sel) || null,
    });
    return n;
  };
  const PX = 100;
  return { _bgLayer: node(), _sketchLayer: node(), _mW: 7, _mH: 9, PX, _getMousePoint: (e) => ({ x: e.clientX / PX, y: e.clientY / PX }) };
}

describe('Frame tab: Generate, tweak, save/reload, Undo', () => {
  let root, ed;
  beforeEach(() => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select><div id="frameSettings"><select id="frameAppearance"></select></div>
      <button id="btnStampEdit"></button><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"><select id="editorFrameTemplate"></select>
        <button id="editorFrameGenerate"></button><button id="editorFrameUndo" disabled></button></aside>
      <aside id="editorLayersPanel"></aside><div id="fusion-status"></div>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    while (frameHistoryDepth()) undoFrame(); // a clean history per test
    ed = mockCanvasEditor();
    window.svgEditor = ed;
    initFramePanel();
    setFrameRecord({ templateId: 'template_1' });
    setEditorTab('frame');
  });
  afterEach(() => { setEditorTab('artwork'); root.remove(); window.svgEditor = null; P.frame = null; delete window.adsk; setIsFusionMode(false); });

  const fire = (type, x, y) => document.getElementById('editorFrameShield')
    .dispatchEvent(new MouseEvent(type, { clientX: x * ed.PX, clientY: y * ed.PX, bubbles: true, cancelable: true }));

  it('Generate writes the seeds + the seed, the drawn handles sit on the generated shape', () => {
    document.getElementById('editorFrameGenerate').click();
    const rec = getFrameRecord();
    expect(Number.isInteger(rec.genSeed)).toBe(true);
    // H23 item 21: [Generate] (frame-panel.js's own generateFrame) retries a bad draw against the real inner
    // profile AND every outer piece staying >= frame_thickness (the "no wing" rule, generalized from T10's own
    // finding) -- the bare generateFrameSeeds() (no retry) is no longer guaranteed to match its first attempt.
    const region = regionOf('template_1'), tpl = tplOf('template_1'), t = 0.75;
    const isValid = (s) => {
      const inner = frameInnerProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1', seeds: s }), BOARD);
      if (inner && inner.defects.length > 0) return false;
      const outer = frameCutProfile(FRAME_DEFS, normalizeFrameRecord({ templateId: 'template_1', seeds: s }), BOARD);
      return outer.primitives.every((p) => (p.type === 'L' ? Math.hypot(p.p1.x - p.p0.x, p.p1.y - p.p0.y) : Math.abs(p.rx * p.dTheta)) >= t);
    };
    expect(rec.seeds).toEqual(generateValidFrameSeeds(tpl, region, rec.genSeed, t, isValid));
    expect(ed._frameProfile.params.waistReach).toBeCloseTo(rec.seeds.waistReach, 9); // what is drawn IS the record
    expect(document.getElementById('editorFrameUndo').disabled).toBe(false);
  });

  it('a tweak persists through save -> reload; Undo steps back: tweak, then generate', () => {
    const before = JSON.parse(JSON.stringify(getFrameRecord()));
    generateFrame(4242);
    const generated = JSON.parse(JSON.stringify(getFrameRecord()));
    const h = ed._frameHandles.find((q) => q.key === 'waistCenterY');
    const to = { x: h.anchor.x, y: h.anchor.y + 0.3 };
    fire('pointerdown', h.anchor.x + 0.02, h.anchor.y); fire('pointermove', to.x, to.y); fire('pointerup', to.x, to.y);
    const tweaked = JSON.parse(JSON.stringify(getFrameRecord()));
    expect(tweaked.seeds.waistCenterY).not.toBeCloseTo(generated.seeds.waistCenterY, 6);
    expect(tweaked.seeds.waistReach).toBe(generated.seeds.waistReach); // only the dragged value changed
    expect(tweaked.genSeed).toBe(4242); // still that generated shape, tweaked
    const saved = JSON.parse(JSON.stringify({ P: persistableP() }));
    P.frame = null; P.frame = saved.P.frame;
    expect(getFrameRecord()).toEqual(tweaked);
    expect(undoFrame()).toBe(true);
    expect(getFrameRecord()).toEqual(generated);
    // Ctrl+Z in the Frame tab is the frame's undo
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    expect(getFrameRecord()).toEqual(before);
    expect(undoFrame()).toBe(false);
    expect(document.getElementById('editorFrameUndo').disabled).toBe(true);
  });

  it('a template change resets the generated shape; Undo brings it back', () => {
    generateFrame(99);
    const generated = JSON.parse(JSON.stringify(getFrameRecord()));
    const sel = document.getElementById('editorFrameTemplate');
    sel.value = 'template_2'; sel.dispatchEvent(new Event('change'));
    expect(getFrameRecord()).toMatchObject({ templateId: 'template_2', seeds: {}, genSeed: null });
    undoFrame();
    expect(getFrameRecord()).toEqual(generated);
  });

  it('[Send frame] sends exactly the shown shape (its seed geometry)', () => {
    window.adsk = { fusionSendData: vi.fn() };
    setIsFusionMode(true);
    generateFrame(7);
    sendFrame();
    const [, json] = window.adsk.fusionSendData.mock.calls.find(([a]) => a === 'send_frame');
    const sent = JSON.parse(json);
    const shown = frameSeedGeometry(tplOf('template_1'), ed._frameProfile, 7, 9);
    expect(sent.seeds).toEqual(getFrameRecord().seeds);
    for (const [k, v] of Object.entries(shown)) {
      if (v.points) v.points.forEach((p, i) => p.forEach((c, j) => expect(sent.seedGeometry[k].points[i][j]).toBeCloseTo(c, 12)));
      else expect(sent.seedGeometry[k].radius).toBeCloseTo(v.radius, 12);
    }
  });
});

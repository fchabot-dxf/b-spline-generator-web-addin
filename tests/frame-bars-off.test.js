/**
 * Bars Off (Fred 2026-11-23: "a version of a board WITHOUT the wood frame, but with the board's outline CUT TO THE
 * FRAME'S SHAPE"). The frame record's `bars` (stored only as false; absent = on) removes the wood bars everywhere they
 * are drawn or built -- the 3D bars and window bars, the 2D wood band / inner edge / miters / joint markers, the SVG
 * download's band, the joint blank line, the Send payload says so -- while the board's outline (the panel trim, the
 * cutaway) and the inset window's HOLE stay exactly as they are. Saved boards (no `bars` key) are pinned unchanged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import FRAME_DEFS from '../bspline-frame-builder/b-spline-gen/html/data/frame-defs.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import {
  normalizeFrameRecord, framePayload, getFrameRecord, setFrameRecord,
} from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import {
  frameSolidSpec, frameCutProfile, drawFrameProfile, setFrameProfileProvider, frameVectorParts,
} from '../bspline-frame-builder/b-spline-gen/html/editor/editor-frame-profile.js';
import { applyFrameToPanel, frameLoopsWorld } from '../bspline-frame-builder/b-spline-gen/html/core/preview/frame-mesh.js';
import { FakeTHREE, carvedPanel } from './helpers/drawn-panel.js';

const BOARD = { widthIn: 7, heightIn: 9 };
const rec = (id, extra = {}) => normalizeFrameRecord({ templateId: id, ...extra });
const WINDOW = { enabled: true, cx: 0, cy: 0, w: 3, h: 3 };
const hash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const panel = () => carvedPanel(7, 9, 71, 91, () => 2, 1.5);

/** Area of the triangles `index` names in `pos` (x, y only). */
function area(pos, index) {
  let s = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    s += Math.abs((pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[c] - pos[a]) * (pos[b + 1] - pos[a + 1])) / 2;
  }
  return s;
}
/** The panel's TOP surface area after the trim (kept + rim triangles facing up: z above the flat underside). */
function topArea(mesh, extra) {
  const pos = mesh.geometry.attributes.position.array, ix = Array.from(mesh.geometry.index.array);
  const up = (P2, I) => { const o = []; for (let t = 0; t < I.length; t += 3) if (P2[I[t] * 3 + 2] > 1 && P2[I[t + 1] * 3 + 2] > 1 && P2[I[t + 2] * 3 + 2] > 1) o.push(I[t], I[t + 1], I[t + 2]); return o; };
  const rim = extra.find((m) => m.name === 'frame-panel-rim');
  const rp = rim.geometry.attributes.position.array, ri = Array.from(rim.geometry.index.array);
  return area(pos, up(pos, ix)) + area(rp, up(rp, ri));
}
const loopArea = (p) => Math.abs(p.reduce((s, q, i) => s + q.x * p[(i + 1) % p.length].y - p[(i + 1) % p.length].x * q.y, 0)) / 2;

describe('the record: `bars` is stored only as false (absent = on)', () => {
  it('an old record has no bars key; false is kept; anything else reads as on (absent)', () => {
    expect('bars' in rec('template_1')).toBe(false);
    expect(rec('template_1', { bars: false }).bars).toBe(false);
    for (const v of [true, 'false', 0, null, undefined]) expect('bars' in rec('template_1', { bars: v })).toBe(false);
  });

  it('the Send payload carries bars:false only when off; an old record\'s payload has no bars key', () => {
    expect('bars' in framePayload(FRAME_DEFS, rec('template_1'))).toBe(false);
    expect(framePayload(FRAME_DEFS, rec('template_1', { bars: false })).bars).toBe(false);
  });

  it('a template change keeps it (record-level, like the inset window); Rectangle keeps it too', () => {
    P.frame = null;
    setFrameRecord({ templateId: 'template_1', bars: false });
    setFrameRecord({ templateId: 'template_18' });
    expect(getFrameRecord().bars).toBe(false);
    setFrameRecord({ templateId: null });
    expect(getFrameRecord().bars).toBe(false);
    setFrameRecord({ templateId: 'template_1', bars: true });
    expect('bars' in getFrameRecord()).toBe(false);
    P.frame = null;
  });
});

describe('saved boards do not change (pinned on 68937a66, before Bars Off existed)', () => {
  // [record, Send payload, 3D spec] hashes of a record with a lip and an inset window, 7 x 9
  const PINS = {
    template_1: ['4a78306b2efdbe5d', 'c013ad7f93f8cdf4', '0323e557a931da3b'],
    template_10: ['e4c18f63f284c134', 'd46d27c4b11cc63f', 'bf1431ab9c59e224'],
    template_18: ['ced55b1ae4018c8d', 'f6b6969af1f0b907', '81beb88418dd78f1'],
    template_20: ['4a1264d2f6b8f386', '81fee7fa276f0396', '0d9eb6181a74c7b5'],
  };
  it.each(Object.keys(PINS))('%s: record, payload and 3D spec are byte-identical', (id) => {
    const r = normalizeFrameRecord({ templateId: id, panelLip: 0.0625, insetWindow: WINDOW });
    expect([hash(r), hash(framePayload(FRAME_DEFS, r)), hash(frameSolidSpec(FRAME_DEFS, r, BOARD))]).toEqual(PINS[id]);
  });
});

describe('3D: no bars, the panel still cut to the frame\'s OUTER outline', () => {
  it.each(['template_1', 'template_10', 'template_18', 'template_20'])('%s: no frame-bars; the panel covers the whole outline', (id) => {
    const on = panel(), off = panel();
    const extraOn = applyFrameToPanel(FakeTHREE, on.mesh, on.grid, frameSolidSpec(FRAME_DEFS, rec(id), BOARD));
    const specOff = frameSolidSpec(FRAME_DEFS, rec(id, { bars: false }), BOARD);
    const extraOff = applyFrameToPanel(FakeTHREE, off.mesh, off.grid, specOff);
    expect(extraOn.map((m) => m.name)).toContain('frame-bars');
    expect(extraOff.map((m) => m.name)).toEqual(['frame-panel-rim', 'frame-panel-wall']);
    expect(specOff.innerPrimitives).toBeNull();
    // the outline is the same one, and the panel runs right out to it (not to the bars' opening)
    expect(specOff.outerPrimitives).toEqual(frameCutProfile(FRAME_DEFS, rec(id), BOARD).primitives);
    const outline = loopArea(frameLoopsWorld(specOff, off.grid).outer);
    expect(topArea(off.mesh, extraOff)).toBeCloseTo(outline, 1);
    expect(topArea(off.mesh, extraOff)).toBeCloseTo(topArea(on.mesh, extraOn), 1);
  });

  it('inset window + bars off: the window\'s HOLE and its wall stay, its bars go', () => {
    const on = panel(), off = panel();
    const extraOn = applyFrameToPanel(FakeTHREE, on.mesh, on.grid, frameSolidSpec(FRAME_DEFS, rec('template_1', { insetWindow: WINDOW }), BOARD));
    const extraOff = applyFrameToPanel(FakeTHREE, off.mesh, off.grid, frameSolidSpec(FRAME_DEFS, rec('template_1', { insetWindow: WINDOW, bars: false }), BOARD));
    expect(extraOn.map((m) => m.name)).toContain('frame-window-bars');
    const names = extraOff.map((m) => m.name);
    expect(names).not.toContain('frame-window-bars');
    expect(names).not.toContain('frame-bars');
    expect(names).toContain('frame-window-wall');
    expect(topArea(off.mesh, extraOff)).toBeCloseTo(topArea(on.mesh, extraOn), 1); // the same hole is cut
  });
});

/** A minimal SVG.js-like layer that records each element's classes. */
function mockEditor() {
  const node = () => {
    const n = { kids: [], attrs: {}, classes: [] };
    const self = (f) => (...a) => { f(...a); return n; };
    Object.assign(n, {
      id: self((v) => { n.attrs.id = v; }), attr: self((k, v) => { n.attrs[k] = v; }), fill: self(() => {}), stroke: self(() => {}),
      addClass: self((c) => { n.classes.push(c); }), center: self(() => {}),
      path: () => { const c = node(); n.kids.push(c); return c; },
      circle: () => { const c = node(); n.kids.push(c); return c; },
      rect: () => { const c = node(); c.move = () => c; n.kids.push(c); return c; },
      group: () => { const c = node(); c.parent = n; n.kids.push(c); return c; },
      remove: () => { if (n.parent) n.parent.kids = n.parent.kids.filter((x) => x !== n); },
      findOne: (sel) => n.kids.find((c) => '#' + c.attrs.id === sel) || null,
    });
    return n;
  };
  return { _bgLayer: node(), _mW: 7, _mH: 9 };
}
const classesOf = (n) => [...n.classes, ...n.kids.flatMap(classesOf)];

describe('2D editor and the SVG download', () => {
  afterEach(() => setFrameProfileProvider(null));
  it('bars off: no wood band, inner edge or miters; the outline and its cutaway stay', () => {
    let record = rec('template_1');
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record }));
    const ed = mockEditor();
    drawFrameProfile(ed);
    const on = classesOf(ed._bgLayer);
    expect(on).toEqual(expect.arrayContaining(['frame-band', 'frame-inner-edge', 'frame-miter', 'frame-cut-profile', 'frame-cutaway']));
    record = rec('template_1', { bars: false });
    drawFrameProfile(ed);
    const off = classesOf(ed._bgLayer);
    for (const c of ['frame-band', 'frame-inner-edge', 'frame-miter']) expect(off).not.toContain(c);
    expect(off).toEqual(expect.arrayContaining(['frame-cut-profile', 'frame-cutaway']));
    expect(ed._frameProfile.primitives).toEqual(frameCutProfile(FRAME_DEFS, record, BOARD).primitives);
  });

  it('bars off: the joint markers go (a Flask, Frame tab)', () => {
    let record = rec('template_15');
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record }));
    const ed = { ...mockEditor(), _editorTab: 'frame' };
    drawFrameProfile(ed);
    expect(ed._frameJoinMarkers.length).toBeGreaterThan(0);
    record = rec('template_15', { bars: false });
    drawFrameProfile(ed);
    expect(ed._frameJoinMarkers).toEqual([]);
  });

  it('the SVG download: the outline only (no band, no miters)', () => {
    let record = rec('template_1');
    setFrameProfileProvider(() => ({ defs: FRAME_DEFS, record }));
    const ed = mockEditor();
    expect(frameVectorParts(ed).innerD).toBeTruthy();
    record = rec('template_1', { bars: false });
    const parts = frameVectorParts(ed);
    expect(parts.innerD).toBeNull();
    expect(parts.miters).toEqual([]);
    expect(parts.outlineD).toBe(frameCutProfile(FRAME_DEFS, record, BOARD).pathD);
  });
});

describe('the declared Bars switch (sidebar Wood frame section + the Frame tab panel)', () => {
  let root;
  let mod;
  beforeEach(async () => {
    root = document.createElement('div');
    root.innerHTML = `<input id="widthIn" value="7"><input id="heightIn" value="9">
      <select id="frameTemplate"></select>
      <div id="frameSettings"><div id="frameBarsSwitch"></div><div id="frameThicknessRow"><input id="frameThickness"></div>
        <div id="frameBottomZRow"><input id="frameBottomZ"></div><div id="frameAppearanceRow"><select id="frameAppearance"></select></div></div>
      <button id="btnStampEdit"></button><div id="editorSVGContainer"></div><div id="editorFrameShield"></div>
      <aside id="editorFramePanel"><div id="editorFrameBarsSwitch" style="display:none;"></div>
        <label id="editorFrameThicknessRow"><input id="editorFrameThickness"></label></aside><aside id="editorLayersPanel"></aside>
      <div id="frameFitWarning"></div><div id="frameJoinInfo"></div>`;
    document.body.appendChild(root);
    P.frame = null; P.widthIn = 7; P.heightIn = 9;
    mod = await import('../bspline-frame-builder/b-spline-gen/html/main/frame-panel.js');
    mod.initFramePanel();
  });
  afterEach(() => { root.remove(); P.frame = null; });

  const buttons = (id) => [...document.getElementById(id).querySelectorAll('button')];
  const pressed = (id) => buttons(id).find((b) => b.getAttribute('aria-pressed') === 'true')?.textContent;

  it('is declared once, drawn in both hosts, hidden with the Rectangle choice', () => {
    const sw = mod.FRAME_RECORD_SWITCHES.find((s) => s.key === 'bars');
    expect(sw.hosts).toEqual(['frameBarsSwitch', 'editorFrameBarsSwitch']);
    expect(sw.options.map((o) => o.label)).toEqual(['On', 'Off (shape only)']);
    expect(document.getElementById('editorFrameBarsSwitch').style.display).toBe('none'); // Rectangle: nothing to switch
    expect(document.getElementById('frameSettings').style.display).toBe('none');
    mod.editFrameNow({ templateId: 'template_1' });
    for (const id of sw.hosts) {
      expect(document.getElementById(id).style.display).not.toBe('none');
      expect(buttons(id).map((b) => b.textContent)).toEqual(['On', 'Off (shape only)']);
      expect(pressed(id)).toBe('On');
    }
  });

  it('Off then On: one undo step each, the template unchanged, both views follow, bar rows dimmed while off', async () => {
    mod.editFrameNow({ templateId: 'template_1' });
    const depth = mod.frameHistoryDepth();
    buttons('frameBarsSwitch')[1].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(getFrameRecord().bars).toBe(false);
    expect(getFrameRecord().templateId).toBe('template_1');
    expect(mod.frameHistoryDepth()).toBe(depth + 1);
    expect(pressed('editorFrameBarsSwitch')).toBe('Off (shape only)');
    for (const id of ['frameThicknessRow', 'frameBottomZRow', 'frameAppearanceRow', 'editorFrameThicknessRow']) {
      expect(document.getElementById(id).style.opacity).toBe(String(mod.FRAME_SWITCH_DIM_OPACITY));
    }
    buttons('editorFrameBarsSwitch')[0].click();
    await new Promise((r) => setTimeout(r, 0));
    expect('bars' in getFrameRecord()).toBe(false);
    expect(mod.frameHistoryDepth()).toBe(depth + 2);
    expect(pressed('frameBarsSwitch')).toBe('On');
    expect(document.getElementById('frameThicknessRow').style.opacity).toBe('');
  });

  it('bars off hides the fit warning (it is about the bars)', () => {
    mod.editFrameNow({ templateId: 'template_1', params: { frame_thickness: 1.5 }, }); // too thick for 7 x 9 with its trim
    P.widthIn = 3; P.heightIn = 3; mod.syncFramePanel();
    expect(document.getElementById('frameFitWarning').style.display).toBe('');
    mod.editFrameNow({ bars: false });
    expect(document.getElementById('frameFitWarning').style.display).toBe('none');
  });
});

/**
 * DRAW-STAMP worker U (Fred 2026-11-22: per-layer settings are EDITED IN THE EDITOR, SUMMARISED IN THE SIDEBAR).
 * The Draw layers' stamp settings (Relief + Height, Tool Profile, V-Bit Angle, Fusion Geometry, Transform, Blur,
 * Smoothing, Smooth-the-terrain, Edge Fillet, Fillet Sharpness, the metrics readout) live in ONE 'Stamp' branch of the
 * Draw tab's collapse tree (main/draw-tree.js); the sidebar keeps Open Editor and SVG Blueprint (a whole-layer action);
 * the layer list and its one-line read-only summary per layer moved into the LAYERS stack (Fred 2026-11-23,
 * main/layer-stack.js: the open Draw card). The REAL palette markup, the REAL app binders
 * (main/ui-bindings.js bindControls -> applyParam + main/stamp/*), the REAL layer list (editor/layers.js).
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

// the 3D side of a stamp edit (mask raster + rebuild) is not what this file measures: stubbed, the UI path is real
vi.mock('../bspline-frame-builder/b-spline-gen/html/main/stamp-mask-manager.js', async (orig) => ({
  ...(await orig()), updateStampMasks: vi.fn(), refreshAllStampMasks: vi.fn(),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/engine.js', async (orig) => ({
  ...(await orig()), scheduleRebuild: vi.fn(), rebuild: vi.fn(),
}));
// the ONE stamp target (advisor amendment 2026-11-22), spied but real: every read / write must reach it
vi.mock('../bspline-frame-builder/b-spline-gen/html/core/stamp/target.js', async (orig) => {
  const m = await orig();
  return { ...m, stampTarget: vi.fn(m.stampTarget) };
});
import * as targetMod from '../bspline-frame-builder/b-spline-gen/html/core/stamp/target.js';

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { bindControls } from '../bspline-frame-builder/b-spline-gen/html/main/ui-bindings.js';
import { initArtTabs } from '../bspline-frame-builder/b-spline-gen/html/main/art-tabs.js';
import { DRAW_TREE_OPEN_KEY, drawBranchDomId, initDrawTree } from '../bspline-frame-builder/b-spline-gen/html/main/draw-tree.js';
import { setEditorTab } from '../bspline-frame-builder/b-spline-gen/html/main/editor-tabs.js';
import { addLayer, setActiveLayer } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { setSectionReadOnly } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { _collectStampPasses } from '../bspline-frame-builder/b-spline-gen/html/core/engine/rebuild.js';
import { syncLayerLocks } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-lock.js';
import * as jobLock from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-lock.js';
import { jobProjectOf, deriveJobSteps, defaultJobOrder } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { initLayerStack, openLayerStackItem } from '../bspline-frame-builder/b-spline-gen/html/main/layer-stack.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.lastIndexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
const $ = (id) => document.getElementById(id);
const stampBranch = () => $(drawBranchDomId('stamp'));
/** A moved control, found INSIDE the Draw tab's Stamp branch (null when it lives anywhere else). */
const inStamp = (id) => stampBranch()?.querySelector(`[id="${id}"]`) || null;
const type = (id, v) => { const el = inStamp(id); el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
const pick = (id, v) => { const el = inStamp(id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
const tick = (id, on) => { const el = inStamp(id); el.checked = on; el.dispatchEvent(new Event('change', { bubbles: true })); };

/** Every control the brief moves (ids unchanged). */
const MOVED = [
  'stampReliefToggle', 'stampBtnReliefRaised', 'stampBtnReliefCarved', 'stampHeight', 'stampHeightSlider', 'stampDepth', 'stampDepthSlider',
  'stampProfile', 'vBitAngleContainer', 'stampVBitAngle',
  'stampFusionGeometry-centerline', 'stampFusionGeometry-outline', 'stampFusionGeometry-both', 'stampFusionGeometryHint',
  'stampTx', 'stampTxSlider', 'stampTy', 'stampTySlider', 'stampRotation', 'stampRotationSlider', 'stampScale', 'stampScaleSlider',
  'stampMirrorX', 'stampMirrorY',
  'stampBlur', 'stampBlurSlider', 'stampSmoothingRadius', 'stampSmoothingRadiusSlider',
  'stampTextureSuppression', 'stampTextureSuppressionSlider', 'stampEdgeFilletRadius', 'stampEdgeFilletRadiusSlider',
  'stampFilletPower', 'stampFilletPowerSlider', 'stampMetrics',
];
/** What stays in the sidebar's VECTOR STAMPING panel: Open SVG Editor (its layer list + '+' moved into the LAYERS stack, Fred
 *  2026-11-23, main/layer-stack.js; its per-layer SVG Blueprint is hosted by an open Draw card, parked meanwhile). */
const SIDEBAR_KEPT = ['btnStampEdit'];
const BLUEPRINT = ['btnStampChoose', 'btnStampClear', 'stampUpload', 'stampFileName'];

let editor, lines, text, start;
// the app boots ONCE (bindControls / the tree add document listeners, as in the app); each test starts from the same
// two layers' values, Lines selected, nothing locked
beforeAll(() => {
  try { localStorage.removeItem(DRAW_TREE_OPEN_KEY); } catch (_) { /* blocked */ }
  document.body.innerHTML = BODY;
  editor = { _layers: [], _activeLayer: null, _currentMode: 'select', _sketchLayer: null, _notifyChange: vi.fn(), pushState() {} };
  window.svgEditor = editor;
  // two REAL editor layers (addLayer: the identity fields + TOOLING_DEFAULTS), then their own tooling
  lines = addLayer(editor, { name: 'Lines', skipUndo: true });
  text = addLayer(editor, { name: 'Text', skipUndo: true, depth: -0.1, profile: 'ballnose', blur: 2, edgeFilletRadius: 0.05 });
  start = { lines: { ...lines }, text: { ...text } };
  P.activeLayerIdx = 0;
  initArtTabs();
  initDrawTree();
  bindControls({});
  setEditorTab('artwork');
});
beforeEach(() => {
  window.svgEditor = editor;
  for (const [l, s] of [[lines, start.lines], [text, start.text]]) { for (const k of Object.keys(l)) delete l[k]; Object.assign(l, s); }
  setSectionReadOnly('stamp-panel', false);
  setActiveLayer(editor, text.id); // a real switch, so the controls re-read Lines below
  setActiveLayer(editor, lines.id);
});

describe('the Stamp branch of the Draw tree holds every moved control', () => {
  it('a Stamp branch exists in the Draw tab drawer', () => {
    expect(stampBranch(), '#drawBranch_stamp').not.toBeNull();
    expect($('drawDrawerTree').contains(stampBranch())).toBe(true);
  });
  it.each(MOVED)('#%s exists exactly once, inside the Stamp branch, not in the sidebar', (id) => {
    expect(document.querySelectorAll(`[id="${id}"]`).length).toBe(1);
    expect(inStamp(id), `#${id} in the Stamp branch`).not.toBeNull();
    expect(document.querySelector('.panel-stamp').contains($(id))).toBe(false);
  });
  it.each(SIDEBAR_KEPT)('#%s stays in the sidebar VECTOR STAMPING panel', (id) => {
    expect(document.querySelector('.panel-stamp').contains($(id))).toBe(true);
  });
  it.each(BLUEPRINT)('#%s is the SVG Blueprint\'s (#stampBlueprint: a Draw card hosts it), once', (id) => {
    expect(document.querySelectorAll(`[id="${id}"]`)).toHaveLength(1);
    expect($('stampBlueprint').contains($(id))).toBe(true);
  });
  it('the whole-layer settings are marked as such (Transform in the editor, SVG Blueprint in the sidebar)', () => {
    expect(inStamp('stampTx').closest('[data-stamp-scope="layer"]')).not.toBeNull();
    expect($('btnStampChoose').closest('[data-stamp-scope="layer"]')).not.toBeNull();
    expect(inStamp('stampProfile').closest('[data-stamp-scope="layer"]')).toBeNull();
  });
});

describe('a moved control writes the SELECTED layer exactly as the sidebar did', () => {
  it('Relief Carved + Height 0.4 -> depth -0.4 (layer + P.stampDepth mirror); Raised flips it back', () => {
    inStamp('stampBtnReliefCarved').click();
    type('stampHeight', 0.4);
    expect(lines.depth).toBe(-0.4);
    expect(P.stampDepth).toBe(-0.4);
    inStamp('stampBtnReliefRaised').click();
    expect(lines.depth).toBe(0.4);
    expect(text.depth).toBe(-0.1); // the other layer untouched
  });
  it('profile, V-bit angle, blur, smoothing, suppression, fillet radius + sharpness', () => {
    pick('stampProfile', 'vbit');
    type('stampVBitAngle', 60);
    type('stampBlur', 3);
    type('stampSmoothingRadius', 7);
    type('stampTextureSuppression', 0.4);
    type('stampEdgeFilletRadius', 0.12);
    type('stampFilletPower', 3.1);
    expect(lines).toMatchObject({ profile: 'vbit', angle: 60, blur: 3, smoothing: 7, suppression: 0.4, edgeFilletRadius: 0.12, filletPower: 3.1 });
    pick('stampProfile', 'flat');
    expect(lines.profile).toBe('flat');
    expect(inStamp('vBitAngleContainer').style.display).toBe('none');
  });
  it('Fusion Geometry and the layer Transform', () => {
    inStamp('stampFusionGeometry-outline').click();
    type('stampTx', 1.5);
    type('stampRotation', 30);
    tick('stampMirrorX', true);
    expect(lines).toMatchObject({ fusionGeometry: 'outline', tx: 1.5, rotation: 30, mirrorX: true });
    expect(text).toMatchObject({ fusionGeometry: 'centerline', tx: 0, rotation: 0, mirrorX: false });
  });
});

describe('every moved control reads and writes through the ONE stamp target (core/stamp/target.js)', () => {
  it.each([
    ['Height (P key, applyParam)', () => type('stampHeight', 0.2)],
    ['Blur (P key, applyParam)', () => type('stampBlur', 4)],
    ['Fusion Geometry (layer-only)', () => inStamp('stampFusionGeometry-both').click()],
    ['Offset X (layer-only)', () => type('stampTx', 0.5)],
    ['Mirror Y (layer-only)', () => tick('stampMirrorY', true)],
    ['a layer switch (the read)', () => setActiveLayer(editor, text.id)],
  ])('%s goes through stampTarget()', (_, act) => {
    targetMod.stampTarget.mockClear();
    act();
    expect(targetMod.stampTarget).toHaveBeenCalled();
  });
});

describe('selecting another editor layer shows ITS values', () => {
  it('Text layer: Carved, 0.1, Ballnose, blur 2, fillet 0.05', () => {
    setActiveLayer(editor, text.id);
    expect(inStamp('stampBtnReliefCarved').classList.contains('active')).toBe(true);
    expect(inStamp('stampBtnReliefRaised').classList.contains('active')).toBe(false);
    expect(inStamp('stampHeight').value).toBe('0.1');
    expect(inStamp('stampProfile').value).toBe('ballnose');
    expect(inStamp('stampBlur').value).toBe('2');
    expect(inStamp('stampEdgeFilletRadius').value).toBe('0.05');
    // and an edit now lands on Text, not Lines
    type('stampBlur', 5);
    expect(text.blur).toBe(5);
    expect(lines.blur).toBe(0);
  });
});

// the sidebar's layer rows moved into the LAYERS stack (Fred 2026-11-23): each Draw layer's open card shows the same line
const card = (layer) => document.querySelector(`#layerStackList [data-stack-key="layer:${layer.id}"]`);
const closeCards = () => { for (const c of document.querySelectorAll('#layerStackList > .layer-card:not(.collapsed)')) c.querySelector('.layer-card-name').click(); };
describe('the layer stack: a Draw card shows its layer\'s one-line read-only summary', () => {
  beforeAll(() => { initLayerStack(); });
  afterEach(() => closeCards()); // the hosted settings go back to the Stamp branch (the later blocks find them there)
  const summaryOf = (layer) => {
    openLayerStackItem(`layer:${layer.id}`); // opening a Draw card makes its layer the active one
    const text = card(layer)?.querySelector('.layer-card-summary')?.textContent;
    closeCards();
    return text;
  };
  it('each row reads its layer: "Raised 0.25 in · V-bit 90°" / "Carved 0.1 in · Ballnose"', () => {
    expect(summaryOf(lines)).toBe('Raised 0.25 in · V-bit 90°');
    expect(summaryOf(text)).toBe('Carved 0.1 in · Ballnose');
  });
  it('updates when a moved control changes the layer, and on a layer switch', () => {
    inStamp('stampBtnReliefCarved').click();
    type('stampHeight', 0.125);
    expect(summaryOf(lines)).toBe('Carved 0.125 in · V-bit 90°');
    setActiveLayer(editor, lines.id);
    type('stampVBitAngle', 60);
    expect(summaryOf(lines)).toBe('Carved 0.125 in · V-bit 60°');
    setActiveLayer(editor, lines.id);
    type('stampHeight', 0);
    expect(summaryOf(lines)).toBe('Flat');
    setActiveLayer(editor, text.id);
    expect(summaryOf(lines)).toBe('Flat');
    expect(summaryOf(text)).toBe('Carved 0.1 in · Ballnose');
  });
  it('the summary holds no control (read-only)', () => {
    openLayerStackItem(`layer:${lines.id}`);
    expect(card(lines).querySelector('.layer-card-summary').querySelector('input, select, button')).toBeNull();
  });
});

// Fred 2026-11-23 ("are layers expandable into their full previous panel fields?"): an open Draw card holds the layer's
// full stamp settings (the moved controls, MOVED from the Stamp branch, never copied) and its SVG Blueprint
describe('the layer stack: an open Draw card holds that layer\'s full stamp settings', () => {
  afterEach(() => closeCards());
  it('opening Text\'s card: every moved control and the Blueprint inside it, once; editing Height there writes TEXT', () => {
    openLayerStackItem(`layer:${text.id}`);
    for (const id of [...MOVED, ...BLUEPRINT]) {
      expect(document.querySelectorAll(`[id="${id}"]`), id).toHaveLength(1);
      expect(card(text).contains($(id)), `${id} in Text's card`).toBe(true);
    }
    const h = $('stampHeight'); h.value = '0.3'; h.dispatchEvent(new Event('input', { bubbles: true })); h.dispatchEvent(new Event('change', { bubbles: true }));
    expect(text.depth).toBe(-0.3); // Text is Carved: the height keeps its sign
    expect(lines.depth).toBe(start.lines.depth);
    expect(card(text).querySelector('.layer-card-summary').textContent).toBe('Carved 0.3 in · Ballnose');
  });
  it('closing the card puts the settings back in the Draw tab\'s Stamp branch (and the Blueprint in its park)', () => {
    openLayerStackItem(`layer:${lines.id}`);
    closeCards();
    for (const id of MOVED) expect(inStamp(id), id).not.toBeNull();
    expect($('layerStackPark').contains($('stampBlueprint'))).toBe(true);
  });
});
describe('job-timeline lock: a locked vector layer keeps its moved settings read-only', () => {
  function lockLines() {
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    const head = order.indexOf(steps.find((s) => s.kind === 'vector' && s.layerId === lines.id).id) + 1;
    return { steps, order, head: Math.min(head, order.indexOf(steps.find((s) => s.kind === 'vector' && s.layerId === text.id).id)) };
  }
  it('Lines locked + selected: every moved control in the Stamp branch is disabled; Text selected: enabled again', () => {
    expect(typeof jobLock.syncStampTabLock).toBe('function');
    const { steps, order, head } = lockLines();
    syncLayerLocks(steps, order, head, editor);
    expect(lines.jobLocked).toBe(true);
    expect(text.jobLocked).toBe(false);
    jobLock.syncStampTabLock(steps, order, head, editor, () => {}, document);
    const controls = [...stampBranch().querySelector('.drawer-branch-body').querySelectorAll('input, select, button')]
      .filter((el) => !el.closest('.job-lock-banner'));
    expect(controls.length).toBeGreaterThan(20);
    for (const el of controls) expect(el.disabled, el.id || el.className).toBe(true);
    expect(stampBranch().textContent).toContain('Lines is cut');
    setActiveLayer(editor, text.id);
    jobLock.syncStampTabLock(steps, order, head, editor, () => {}, document);
    for (const el of controls) expect(el.disabled, el.id || el.className).toBe(false);
  });
});

describe('saved boards unchanged: the stamp passes pin', () => {
  // what the sidebar wrote onto each layer for these edits (the stored fields, unchanged by the move)
  const SIDEBAR_WROTE = {
    Lines: { depth: -0.3, profile: 'vbit', angle: 60, blur: 1, smoothing: 9, suppression: 0.3, edgeFilletRadius: 0.1, filletPower: 3 },
    Text: { depth: 0.2, profile: 'ballnose', blur: 2, smoothing: 15, suppression: 0.15, edgeFilletRadius: 0.05, filletPower: 2.2 },
  };
  const passesOf = (ed) => {
    window.svgEditor = ed;
    return _collectStampPasses(0, 0).map(({ mask, ...rest }) => rest);
  };
  it('passes from the moved controls === passes from the same fields written directly (and the pinned literal)', () => {
    // the moved controls, on the real editor layer set
    setActiveLayer(editor, lines.id);
    inStamp('stampBtnReliefCarved').click();
    type('stampHeight', 0.3);
    type('stampVBitAngle', 60);
    type('stampBlur', 1);
    type('stampSmoothingRadius', 9);
    type('stampTextureSuppression', 0.3);
    type('stampEdgeFilletRadius', 0.1);
    type('stampFilletPower', 3);
    setActiveLayer(editor, text.id);
    inStamp('stampBtnReliefRaised').click();
    type('stampHeight', 0.2);
    for (const l of editor._layers) l._mask = new Float32Array(4);
    const viaEditor = passesOf(editor);
    // the same board, its fields written as the sidebar wrote them
    const direct = { _layers: [], _activeLayer: null, _notifyChange() {} };
    window.svgEditor = direct;
    for (const name of ['Lines', 'Text']) addLayer(direct, { name, skipUndo: true, ...SIDEBAR_WROTE[name] });
    for (const l of direct._layers) l._mask = new Float32Array(4);
    expect(viaEditor).toEqual(passesOf(direct));
    // Fred 2026-11-23: every pass carries its Thicken placement (core/stamp/placement.js); a layer without the field reads
    // 'withSurface' = Before thicken, the stamp exactly as before (tests/placement-all-layers.test.js)
    expect(viaEditor).toEqual([
      { id: lines.id, kind: 'art', name: 'Lines', enabled: true, svg: '1', depth: -0.3, profile: 'vbit', suppression: 0.3, smoothing: 9, edgeFilletRadius: 0.1, filletPower: 3, placement: 'withSurface' },
      { id: text.id, kind: 'art', name: 'Text', enabled: true, svg: '1', depth: 0.2, profile: 'ballnose', suppression: 0.15, smoothing: 15, edgeFilletRadius: 0.05, filletPower: 2.2, placement: 'withSurface' },
    ]);
  });
});

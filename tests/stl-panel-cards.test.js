/**
 * STL-PANEL worker P (Fred 2026-11-22: "STL params are too many for the panel; can each STL collapse its settings"): every STL is a
 * CARD (a header row: enable box, name, stock warning, delete, chevron); only the open card holds the settings (the ONE #stlActive
 * block, moved, never duplicated); one card open at a time; the settings fold in the declared STL_GROUPS (Place open by default).
 * The real panel on the real palette shell, real binary STLs, the real stock report and the real history call (counted).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { scheduleUndoSnapshot } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { setStlStockReport } from '../bspline-frame-builder/b-spline-gen/html/core/stl/stock.js';
import { ghostState } from '../bspline-frame-builder/b-spline-gen/html/core/stl/ghost.js';
import {
  STL_CONTROLS, STL_ACTIONS, STL_GROUPS, renderStlPanel, bindStlPanel, syncStlPanel, addStlFromBuffer, setStlField,
  pickStlLayer, activeStlLayer, _resetStlPanelForTests,
} from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

vi.mock('../bspline-frame-builder/b-spline-gen/html/core/history.js', () => ({ scheduleUndoSnapshot: vi.fn() }));

const tri = (a, b, c) => [...a, ...b, ...c];
function pyramid() {
  const A = [-5, -5, 0], B = [5, -5, 0], C = [5, 5, 0], D = [-5, 5, 0], T = [0, 0, 4];
  return Float32Array.from([tri(A, B, T), tri(B, C, T), tri(C, D, T), tri(D, A, T), tri(A, C, B), tri(A, D, C)].flat());
}
function binaryStl(soup) {
  const n = soup.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
  dv.setUint32(80, n, true);
  for (let t = 0; t < n; t++) for (let k = 0; k < 9; k++) dv.setFloat32(84 + t * 50 + 12 + k * 4, soup[t * 9 + k], true);
  return buf;
}
const $ = (id) => document.getElementById(id);
const card = (id) => document.querySelector(`[data-stl-card="${id}"]`);
const body = (id) => card(id)?.querySelector('.stl-card-body');
const group = (g) => document.querySelector(`[data-stl-group="${g}"]`);
const saved = {};

beforeEach(() => {
  Object.assign(saved, { stl: P.stlLayers, w: P.widthIn, h: P.heightIn });
  P.widthIn = 7; P.heightIn = 9; delete P.stlLayers;
  document.body.innerHTML = '<div id="stlLayerBody"></div>';
  _resetStlPanelForTests();
  setStlStockReport({});
  ghostState.visible = true;
  scheduleUndoSnapshot.mockClear();
  renderStlPanel($('stlLayerBody'));
  bindStlPanel({});
});
afterEach(() => {
  if (saved.stl === undefined) delete P.stlLayers; else P.stlLayers = saved.stl;
  P.widthIn = saved.w; P.heightIn = saved.h;
});
const two = () => {
  const a = addStlFromBuffer(binaryStl(pyramid()), 'a.stl');
  const b = addStlFromBuffer(binaryStl(pyramid()), 'b.stl');
  return [a, b];
};

describe('cards: one open at a time', () => {
  it('two STLs are two cards; only the just-added one is open; opening the other closes the first and makes it active', () => {
    const [a, b] = two();
    expect(document.querySelectorAll('.stl-card')).toHaveLength(2);
    expect(card(a.id).classList.contains('stl-card-open')).toBe(false);
    expect(card(b.id).classList.contains('stl-card-open')).toBe(true);
    card(a.id).querySelector('[data-stl-pick]').click();
    expect(card(a.id).classList.contains('stl-card-open')).toBe(true);
    expect(card(b.id).classList.contains('stl-card-open')).toBe(false);
    expect(activeStlLayer().id).toBe(a.id);
    setStlField('scale', 2);
    expect(P.stlLayers.find((l) => l.id === a.id).scale).toBe(2);
    expect(P.stlLayers.find((l) => l.id === b.id).scale).not.toBe(2);
  });
  it('tapping the open card closes it (no card open)', () => {
    const [, b] = two();
    card(b.id).querySelector('[data-stl-pick]').click();
    expect(document.querySelectorAll('.stl-card-open')).toHaveLength(0);
  });
  it('a project with STLs but no tap yet shows every card closed', () => {
    const [a] = two();
    document.querySelector('.stl-card-open [data-stl-pick]').click(); // close
    syncStlPanel();
    expect(card(a.id).classList.contains('stl-card-open')).toBe(false);
  });
});

describe('every control exists once, inside the OPEN card', () => {
  it('each STL_CONTROLS / STL_ACTIONS element is in the document once and sits in the open card body', () => {
    const [a] = two();
    card(a.id).querySelector('[data-stl-pick]').click();
    const ids = [];
    for (const c of STL_CONTROLS) ids.push(...(c.kind === 'slider' ? [`stl_${c.id}Slider`, `stl_${c.id}`] : [`stl_${c.id}`]));
    ids.push(...STL_ACTIONS.map((x) => x.id), 'stlSnap', 'stlCentre', 'stlRotReset', 'stlDetail', 'stlDetailSlider', 'stlReimport', 'stlRemove', 'stlStock', 'stlSource', 'stlStored', 'stlHealth');
    for (const id of ids) {
      expect(document.querySelectorAll(`[id="${id}"]`), id).toHaveLength(1);
      expect(body(a.id).contains($(id)), `${id} in the open card`).toBe(true);
    }
    expect($('stlActive').closest('.stl-card')).toBe(card(a.id));
  });
  it('with no card open the settings are parked hidden outside every card', () => {
    const [, b] = two();
    card(b.id).querySelector('[data-stl-pick]').click();
    expect($('stlActive').hidden).toBe(true);
    expect($('stlActive').closest('.stl-card')).toBeNull();
    expect($('stl_scale')).toBeTruthy();
  });
});

describe('the settings fold in the declared groups', () => {
  it('the declared order is Place, Size, Rotate, Stamp, Detail; Place is open by default, the rest closed', () => {
    expect(STL_GROUPS.map((g) => g.id)).toEqual(['place', 'size', 'rotate', 'stamp', 'detail']);
    two();
    expect(group('place').classList.contains('collapsed')).toBe(false);
    for (const g of ['size', 'rotate', 'stamp', 'detail']) expect(group(g).classList.contains('collapsed'), g).toBe(true);
    expect(group('rotate').contains($('stlRotReset'))).toBe(true);
    expect(group('detail').contains($('stlDetailSlider'))).toBe(true);
    expect(group('size').contains($('stlStock'))).toBe(true);
  });
  it('opening Rotate survives syncStlPanel and a full renderStlPanel', () => {
    two();
    group('rotate').querySelector('.panel-header').click();
    expect(group('rotate').classList.contains('collapsed')).toBe(false);
    syncStlPanel();
    expect(group('rotate').classList.contains('collapsed')).toBe(false);
    renderStlPanel($('stlLayerBody')); bindStlPanel({});
    expect(group('rotate').classList.contains('collapsed')).toBe(false);
    group('place').querySelector('.panel-header').click(); // and closing Place sticks too
    syncStlPanel();
    expect(group('place').classList.contains('collapsed')).toBe(true);
  });
});

describe('row delete and warning', () => {
  it('the row trash removes that STL in ONE undo step and does not open it', () => {
    const [a, b] = two();
    scheduleUndoSnapshot.mockClear();
    card(a.id).querySelector('[data-stl-del]').click();
    expect(P.stlLayers.map((l) => l.id)).toEqual([b.id]);
    expect(scheduleUndoSnapshot).toHaveBeenCalledTimes(1);
    expect(card(b.id).classList.contains('stl-card-open')).toBe(true); // b was open before and stays so
  });
  it('deleting the OPEN STL leaves no card open', () => {
    const [, b] = two();
    card(b.id).querySelector('[data-stl-del]').click();
    expect(document.querySelectorAll('.stl-card-open')).toHaveLength(0);
  });
  it('the warning icon shows for the STL whose stock report is set, with the message as its title', () => {
    const [a, b] = two();
    expect(card(a.id).querySelector('[data-stl-warn]').hidden).toBe(true);
    setStlStockReport({ [a.id]: { count: 3, maxOver: 0.5, maxUnder: 0, carveZ: 1 } });
    const w = card(a.id).querySelector('[data-stl-warn]');
    expect(w.hidden).toBe(false);
    expect(w.title).toMatch(/rises 0\.50 in above the stock top/);
    expect(card(b.id).querySelector('[data-stl-warn]').hidden).toBe(true);
  });
});

describe('pickStlLayer (the 3D gizmo)', () => {
  it('opens that STL\'s card and scrolls it into view', () => {
    const [a, b] = two();
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy; // the card is rebuilt by the sync: spy on the prototype
    expect(card(a.id).classList.contains('stl-card-open')).toBe(false);
    expect(pickStlLayer(a.id)).toBe(true);
    expect(card(a.id).classList.contains('stl-card-open')).toBe(true);
    expect(card(b.id).classList.contains('stl-card-open')).toBe(false);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.contexts[0]).toBe(card(a.id));
    delete Element.prototype.scrollIntoView;
  });
});

/**
 * UX-UNDO — declared UNDO_SCOPE and the commit-time hook
 * (`scheduleUndoSnapshot`, core/history.js) that makes every sidebar
 * control undoable through the palette's GLOBAL undo, one step per
 * COMMITTED value (never per `input` tick), coalesced within a shared
 * 400ms window so a burst of rapid commits (five quick +/- stepper
 * clicks) still produces exactly one entry.
 *
 * ROADMAP ruling: "undo follows where the change was made" — sidebar
 * controls -> global undo; drawing content edited in the SVG editor
 * modal -> the editor's own stack (SE4c, unchanged). A control declared
 * 'none' in UNDO_SCOPE (a purely visual view toggle) never reaches
 * history at all; everything else defaults to 'global' with zero
 * per-control registration.
 *
 * Tests two layers: the pure `scheduleUndoSnapshot` mechanism directly
 * (fake timers, no DOM events needed), then the real DOM wiring it's
 * actually reached through — `bind()`/`syncPair()` (core/ui-utils.js)
 * for ordinary sidebar sliders, and `createDomBinders`'s
 * bindLayerOnlyNumber/Checkbox (main/stamp/_dom-binders.js) for
 * per-layer tooling fields that live on editor._layers instead of P.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  undoScopeOf, UNDO_SCOPE, scheduleUndoSnapshot, globalHistoryLog,
  isEditorOpen, setUndoRestoring,
} from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { bind, syncPair } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { createDomBinders } from '../bspline-frame-builder/b-spline-gen/html/main/stamp/_dom-binders.js';
import {
  setLayerVisible, setLayerCarve, setLayerShowColor,
} from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';

function freshInput(id, type = 'number', value = '0') {
  const el = document.createElement('input');
  el.id = id;
  el.type = type;
  el.value = value;
  document.body.appendChild(el);
  return el;
}

describe('UNDO_SCOPE (declared table)', () => {
  it('defaults an unlisted control to global — the common case needs no registration', () => {
    expect(undoScopeOf('someRandomSliderNeverListed')).toBe('global');
    expect(undoScopeOf('stampDepth')).toBe('global');
  });

  it('the declared visual-only exceptions are none', () => {
    expect(UNDO_SCOPE.showMesh).toBe('none');
    expect(UNDO_SCOPE.thickenWireframe).toBe('none');
    expect(UNDO_SCOPE.showLeaders).toBe('none');
  });
});

describe('scheduleUndoSnapshot: coalescing — one entry per committed value', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a single commit produces no entry immediately, then exactly one after the coalescing window', () => {
    scheduleUndoSnapshot('widthIn');
    expect(globalHistoryLog.length).toBe(0);
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });

  it('five rapid commits (e.g. five quick stepper clicks) coalesce into ONE entry', () => {
    for (let i = 0; i < 5; i++) {
      scheduleUndoSnapshot('stampDepth');
      vi.advanceTimersByTime(50); // well inside the 400ms window each time
    }
    expect(globalHistoryLog.length).toBe(0);
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });

  it('non-vacuous: two commits separated by MORE than the window produce two SEPARATE entries', () => {
    scheduleUndoSnapshot('carveZ');
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
    scheduleUndoSnapshot('carveZ');
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(2);
  });

  it('a none-scoped control never creates an entry, no matter how long you wait', () => {
    scheduleUndoSnapshot('showMesh');
    vi.advanceTimersByTime(5000);
    expect(globalHistoryLog.length).toBe(0);
  });
});

describe('scheduleUndoSnapshot: gated on isEditorOpen (belt-and-suspenders for "a drawing edit does not create a global entry")', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('while the SVG editor modal is open, a commit does not create an entry', () => {
    const modal = document.createElement('div');
    modal.id = 'svgEditorModal';
    modal.style.display = 'block';
    document.body.appendChild(modal);
    expect(isEditorOpen()).toBe(true);

    scheduleUndoSnapshot('widthIn');
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0);
  });
});

describe('bind() (core/ui-utils.js): "change" commits, "input" alone never does', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('dispatching only "input" (live drag/typing) never commits', () => {
    const el = freshInput('widthIn');
    bind('widthIn', 'number', () => {});
    el.value = '10';
    el.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0);
  });

  it('dispatching "change" (blur/Enter commit) creates exactly one entry', () => {
    const el = freshInput('widthIn');
    bind('widthIn', 'number', () => {});
    el.value = '10';
    el.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });

  it('a none-scoped control (showMesh) never commits via bind() either', () => {
    const el = freshInput('showMesh', 'checkbox');
    bind('showMesh', 'checkbox', () => {});
    el.checked = true;
    el.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0);
  });
});

describe('syncPair() (core/ui-utils.js): dragging the physical slider commits on release, not per tick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('slider "input" ticks (dragging) do not commit', () => {
    freshInput('carveZ', 'number', '1');
    const sld = freshInput('carveZSlider', 'range', '1');
    bind('carveZ', 'number', () => {});
    syncPair('carveZ', 'carveZSlider');

    sld.value = '2';
    sld.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0);
  });

  it('non-vacuous: slider "change" (release) forwards to the number input and commits exactly one entry', () => {
    freshInput('carveZ', 'number', '1');
    const sld = freshInput('carveZSlider', 'range', '1');
    bind('carveZ', 'number', () => {});
    syncPair('carveZ', 'carveZSlider');

    sld.value = '2';
    sld.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });
});

describe('createDomBinders (main/stamp/_dom-binders.js): per-layer tooling fields commit on change, not input', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
    document.body.innerHTML = '';
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('bindLayerOnlyNumber: "input" writes the layer field but does not commit; "change" commits exactly one entry', () => {
    const num = freshInput('stampDepth', 'number', '0.25');
    const layer = { depth: 0.25 };
    const binders = createDomBinders({
      activeLayer: () => layer, activeEditorLayer: () => null, requestRemask: () => {},
    });
    binders.bindLayerOnlyNumber('stampDepth', null, 'depth');

    num.value = '0.5';
    num.dispatchEvent(new Event('input'));
    expect(layer.depth).toBe(0.5); // the live write still happens
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0); // but no snapshot from input alone

    num.dispatchEvent(new Event('change'));
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });

  it('bindLayerOnlyCheckbox: "change" commits exactly one entry', () => {
    const cb = freshInput('layerCarve', 'checkbox');
    cb.checked = true;
    const layer = { carve: true };
    const binders = createDomBinders({
      activeLayer: () => layer, activeEditorLayer: () => null, requestRemask: () => {},
    });
    binders.bindLayerOnlyCheckbox('layerCarve', 'carve');

    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(layer.carve).toBe(false);
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });

  it('bindLayerOnlySegmented (SE12 T36): clicking a choice button commits exactly one entry, and only that button ends up .active', () => {
    const btnCenter = document.createElement('button');
    btnCenter.id = 'stampFusionGeometry-centerline';
    btnCenter.classList.add('active');
    const btnOutline = document.createElement('button');
    btnOutline.id = 'stampFusionGeometry-outline';
    document.body.append(btnCenter, btnOutline);

    const layer = { fusionGeometry: 'centerline' };
    const binders = createDomBinders({
      activeLayer: () => layer, activeEditorLayer: () => null, requestRemask: () => {},
    });
    binders.bindLayerOnlySegmented(
      { centerline: 'stampFusionGeometry-centerline', outline: 'stampFusionGeometry-outline' },
      'fusionGeometry',
    );

    btnOutline.click();
    expect(layer.fusionGeometry).toBe('outline');
    expect(btnOutline.classList.contains('active')).toBe(true);
    expect(btnCenter.classList.contains('active')).toBe(false);
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });

  it('bindLayerOnlySegmented: two rapid clicks (changed mind) still coalesce into ONE entry, same as the number/checkbox binders above', () => {
    const btnA = document.createElement('button');
    btnA.id = 'segA';
    const btnB = document.createElement('button');
    btnB.id = 'segB';
    document.body.append(btnA, btnB);
    const layer = { fusionGeometry: 'centerline' };
    const binders = createDomBinders({
      activeLayer: () => layer, activeEditorLayer: () => null, requestRemask: () => {},
    });
    binders.bindLayerOnlySegmented({ a: 'segA', b: 'segB' }, 'fusionGeometry');

    btnA.click();
    vi.advanceTimersByTime(50);
    btnB.click();
    expect(layer.fusionGeometry).toBe('b'); // last click wins
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });
});

/**
 * setUndoRestoring — the guard found via live Fusion verification:
 * applySnapshot's own restore loop writes every P key back through
 * syncUItoParam, which deliberately dispatches a real 'change' on
 * checkboxes so dependent panels re-sync (its own comment says why).
 * That's the SAME event bind() listens on to schedule an undo step, so
 * without this guard, clicking Undo would immediately schedule ANOTHER
 * snapshot as a side effect of the restore itself — confirmed live: the
 * pre-fix build logged `scheduleUndoSnapshot` firing for showMesh/
 * detailDensityRespectSymmetry/thickenEnabled etc. during every
 * unifiedUndo call, and one of them (thickenEnabled) went on to actually
 * push a stray snapshot.
 */
describe('setUndoRestoring: applySnapshot restoring itself does not schedule a NEW snapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    setUndoRestoring(false); // never leak into other test files
  });

  it('while restoring, a commit that would normally schedule a snapshot is suppressed', () => {
    setUndoRestoring(true);
    scheduleUndoSnapshot('carveZ');
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0);
  });

  it('non-vacuous: the SAME call, once restoring is cleared, schedules normally', () => {
    setUndoRestoring(true);
    scheduleUndoSnapshot('carveZ');
    vi.advanceTimersByTime(1000);
    expect(globalHistoryLog.length).toBe(0);

    setUndoRestoring(false);
    scheduleUndoSnapshot('carveZ');
    vi.advanceTimersByTime(400);
    expect(globalHistoryLog.length).toBe(1);
  });
});

/**
 * The layer row's 👁/3D/palette toggles (editor/layers.js — shared
 * between the sidebar and the SVG editor's own Layers panel) commit via
 * setLayerVisible/Carve/ShowColor directly, not through bind()/the
 * stamp-panel binders — found live in Fusion: clicking "3D" changed the
 * model but never touched undo history until this event was added.
 * These setters dispatch a plain DOM CustomEvent rather than importing
 * scheduleUndoSnapshot directly (core/history.js already imports
 * TOOLING_DEFAULTS FROM this file — importing back would be circular).
 */
describe('editor/layers.js: setLayerVisible/Carve/ShowColor dispatch layer-tooling-commit', () => {
  function mockEditor() {
    return { _layers: [{ id: 'L1', visible: true, carve: true, showColor: true }] };
  }

  it('setLayerCarve dispatches with detail.field === "carve"', () => {
    const editor = mockEditor();
    const seen = [];
    const handler = (e) => seen.push(e.detail.field);
    document.addEventListener('layer-tooling-commit', handler);
    try {
      setLayerCarve(editor, 'L1', false);
    } finally {
      document.removeEventListener('layer-tooling-commit', handler);
    }
    expect(seen).toEqual(['carve']);
    expect(editor._layers[0].carve).toBe(false);
  });

  it('setLayerVisible dispatches with detail.field === "visible"', () => {
    const editor = mockEditor();
    const seen = [];
    const handler = (e) => seen.push(e.detail.field);
    document.addEventListener('layer-tooling-commit', handler);
    try {
      setLayerVisible(editor, 'L1', false);
    } finally {
      document.removeEventListener('layer-tooling-commit', handler);
    }
    expect(seen).toEqual(['visible']);
  });

  it('setLayerShowColor dispatches with detail.field === "showColor"', () => {
    const editor = mockEditor();
    const seen = [];
    const handler = (e) => seen.push(e.detail.field);
    document.addEventListener('layer-tooling-commit', handler);
    try {
      setLayerShowColor(editor, 'L1', false);
    } finally {
      document.removeEventListener('layer-tooling-commit', handler);
    }
    expect(seen).toEqual(['showColor']);
  });

  it('integration: a listener that calls scheduleUndoSnapshot (as main/ui-bindings.js does) turns the event into exactly one history entry', () => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
    const handler = (e) => scheduleUndoSnapshot('layer:' + e.detail.field);
    document.addEventListener('layer-tooling-commit', handler);
    try {
      setLayerCarve(mockEditor(), 'L1', false);
      vi.advanceTimersByTime(400);
      expect(globalHistoryLog.length).toBe(1);
    } finally {
      document.removeEventListener('layer-tooling-commit', handler);
      vi.useRealTimers();
    }
  });

  it('non-vacuous: while the SVG editor modal is open, the SAME event never reaches global history (goes through the editor\'s own stack instead)', () => {
    vi.useFakeTimers();
    globalHistoryLog.length = 0;
    const modal = document.createElement('div');
    modal.id = 'svgEditorModal';
    modal.style.display = 'block';
    document.body.appendChild(modal);
    const handler = (e) => scheduleUndoSnapshot('layer:' + e.detail.field);
    document.addEventListener('layer-tooling-commit', handler);
    try {
      setLayerCarve(mockEditor(), 'L1', false);
      vi.advanceTimersByTime(1000);
      expect(globalHistoryLog.length).toBe(0);
    } finally {
      document.removeEventListener('layer-tooling-commit', handler);
      document.body.removeChild(modal);
      vi.useRealTimers();
    }
  });
});

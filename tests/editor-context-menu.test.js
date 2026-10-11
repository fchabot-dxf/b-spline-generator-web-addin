/**
 * H6 CONTEXT-MENU: editor-context-menu.js in isolation. The heavy modules
 * it delegates to (the actual cut/join/copy/paste/colour/layer commands)
 * are mocked to spies — this file asserts the REGISTRY's own filtering
 * rules and that each entry calls the RIGHT underlying command with the
 * RIGHT arguments, not that those commands themselves work (H5's own
 * tests, and this codebase's existing suite, already cover those).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted above every other statement in this file,
// so the spies they close over must be created via vi.hoisted (a plain
// `const x = vi.fn()` above the vi.mock calls would still run AFTER the
// hoisted factory, a TDZ error) — vitest's own documented pattern for
// exactly this "reference an outer spy from inside vi.mock" case.
const {
  cutAt, join, cutIntentMock, copySelection, pasteClipboard, selectAllVisible,
  openColorMosaic, applyLayerState, addLayer, pieceKindOf, applyColorOverride,
} = vi.hoisted(() => ({
  cutAt: vi.fn(() => ['a', 'b']),
  join: vi.fn(() => 'joined'),
  cutIntentMock: vi.fn(() => null),
  copySelection: vi.fn(),
  pasteClipboard: vi.fn(),
  selectAllVisible: vi.fn(),
  openColorMosaic: vi.fn(),
  applyLayerState: vi.fn(),
  addLayer: vi.fn(() => ({ id: '99', name: 'Layer 99' })),
  pieceKindOf: vi.fn(() => null),
  applyColorOverride: vi.fn(),
}));

vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-cut-tool.js', () => ({
  cutAt, join, cutIntent: (...args) => cutIntentMock(...args),
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js', () => ({
  copySelection, pasteClipboard, selectAllVisible,
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-color.js', () => ({ openColorMosaic }));
// brickElementNodes (item 22 slice 3): a node of no brick element is just itself -- these fakes are plain lines
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/layers.js', () => ({ applyLayerState, addLayer, syncLayerZOrder: () => {}, brickElementNodes: (editor, node) => (node ? [node] : []) }));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-piece-override.js', () => ({
  pieceKindOf: (...args) => pieceKindOf(...args), applyColorOverride,
}));
vi.mock('../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js', () => ({
  CONTOUR_SEG_INDEX_ATTR: 'data-contour-seg',
}));

const {
  CONTEXT_MENU_ITEMS, matchingItems, targetKindOf,
  armContextMenuHold, cancelContextMenuHoldIfMoved, cancelContextMenuHold,
  bindContextMenu,
} = await import('../bspline-frame-builder/b-spline-gen/html/editor/editor-context-menu.js');

function fakeEl({ type = 'line', kind = null, contour = false } = {}) {
  pieceKindOf.mockImplementation((el) => (el === wrapper ? kind : null));
  const node = { hasAttribute: (attr) => contour && attr === 'data-contour-seg', getAttribute: () => null };
  const wrapper = { type, node };
  return wrapper;
}

function makeEditor(pointerType = 'touch') {
  const layers = [{ id: '0', name: 'Layer 1' }, { id: '1', name: 'Layer 2' }];
  return {
    _pointerType: pointerType,
    _selectedElements: [],
    _clipboard: [],
    _layers: layers,
    _isDragging: true,
    _isDrawing: true,
    _latticeMove: { fake: true },
    _sketchLayer: { children: () => ({ toArray: () => [] }) },
    _select(el) { this._selectedElements = [el]; },
    _selectMany(els) { this._selectedElements = els.slice(); },
    setColor: vi.fn(),
    deleteSelected: vi.fn(),
    fitView: vi.fn(),
    pushState: vi.fn(),
    _notifyChange: vi.fn(),
    _getMousePoint: () => ({ x: 1, y: 1 }),
  };
}

function target(overrides = {}) {
  const editor = overrides.editor || makeEditor();
  return { editor, kind: 'empty', el: null, selection: [], point: { x: 0, y: 0 }, cutIntent: null, ...overrides };
}

beforeEach(() => { vi.useFakeTimers(); cutIntentMock.mockReturnValue(null); });
afterEach(() => {
  cancelContextMenuHold();
  document.querySelectorAll('.context-menu-popover').forEach((n) => n.remove());
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('targetKindOf', () => {
  it('reads a lattice kind via pieceKindOf', () => {
    const el = fakeEl({ kind: 'rails' });
    expect(targetKindOf(el)).toBe('rails');
  });
  it('reads contour via the segment-index attribute when pieceKindOf says no', () => {
    const el = fakeEl({ contour: true });
    expect(targetKindOf(el)).toBe('contour');
  });
  it('falls back to the plain svg.js el.type', () => {
    const el = fakeEl({ type: 'rect' });
    expect(targetKindOf(el)).toBe('rect');
  });
  it('is "empty" for no element', () => {
    expect(targetKindOf(null)).toBe('empty');
  });
});

describe('registry filtering — a lattice piece (rails)', () => {
  const t = () => target({ kind: 'rails', selection: [fakeEl({ kind: 'rails' })] });

  it('offers Colour, Duplicate, Select all rails, Delete', () => {
    const ids = matchingItems(t()).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['colour', 'duplicate', 'select-all-kind', 'delete']));
  });
  it('HIDES Move to layer — lattice-owned pieces live on their own kind-layer', () => {
    expect(matchingItems(t()).map((i) => i.id)).not.toContain('move-to-layer');
  });
  it('never offers the empty-canvas-only entries', () => {
    const ids = matchingItems(t()).map((i) => i.id);
    expect(ids).not.toEqual(expect.arrayContaining(['paste', 'select-all', 'fit-view']));
  });
});

describe('registry filtering — a plain line', () => {
  const t = () => target({ kind: 'line', selection: [fakeEl({ type: 'line' })] });

  it('offers Move to layer — a plain element, not lattice-owned', () => {
    expect(matchingItems(t()).map((i) => i.id)).toContain('move-to-layer');
  });
  it('does NOT offer Select all <kind> — that entry is lattice-kind only', () => {
    expect(matchingItems(t()).map((i) => i.id)).not.toContain('select-all-kind');
  });
});

describe('registry filtering — contour segment', () => {
  const t = () => target({ kind: 'contour', selection: [fakeEl({ contour: true })] });

  it('offers Colour, Duplicate, Delete', () => {
    const ids = matchingItems(t()).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['colour', 'duplicate', 'delete']));
  });
  it('HIDES Move to layer — contour is lattice-owned too', () => {
    expect(matchingItems(t()).map((i) => i.id)).not.toContain('move-to-layer');
  });
  it('never offers Cut/Join — those apply to lines only', () => {
    const ids = matchingItems(t()).map((i) => i.id);
    expect(ids).not.toEqual(expect.arrayContaining(['cut', 'join']));
  });
});

describe('registry filtering — empty canvas', () => {
  it('offers Select all and Fit view unconditionally', () => {
    const ids = matchingItems(target()).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['select-all', 'fit-view']));
  });
  it('offers Paste only when the clipboard has content', () => {
    const empty = target({ editor: makeEditor() });
    expect(matchingItems(empty).map((i) => i.id)).not.toContain('paste');
    const withClip = target({ editor: (() => { const e = makeEditor(); e._clipboard = [{}]; return e; })() });
    expect(matchingItems(withClip).map((i) => i.id)).toContain('paste');
  });
  it('offers none of the on-a-piece-only entries', () => {
    const ids = matchingItems(target()).map((i) => i.id);
    expect(ids).not.toEqual(expect.arrayContaining(['colour', 'cut', 'join', 'duplicate', 'delete', 'move-to-layer']));
  });
});

describe('registry filtering — Cut/Join gated on cutIntent, not just kind', () => {
  it('Cut appears only when cutIntent says action:"cut"', () => {
    const t1 = target({ kind: 'line', cutIntent: { action: 'cut', el: {}, at: { x: 0, y: 0 } } });
    expect(matchingItems(t1).map((i) => i.id)).toContain('cut');
    const t2 = target({ kind: 'line', cutIntent: null });
    expect(matchingItems(t2).map((i) => i.id)).not.toContain('cut');
  });
  it('Join appears only when cutIntent says action:"join"', () => {
    const t1 = target({ kind: 'line', cutIntent: { action: 'join', joint: ['a', 'b'] } });
    expect(matchingItems(t1).map((i) => i.id)).toContain('join');
    const t2 = target({ kind: 'line', cutIntent: { action: 'cut' } });
    expect(matchingItems(t2).map((i) => i.id)).not.toContain('join');
  });
});

describe('each action runs the EXISTING command, not a reimplementation', () => {
  it('Colour stamps overrides on lattice pieces then calls editor.setColor ONCE, last', () => {
    const railEl = fakeEl({ kind: 'rails' });
    pieceKindOf.mockImplementation((el) => (el === railEl ? 'rails' : null));
    const editor = makeEditor();
    const t = target({ editor, kind: 'rails', selection: [railEl] });
    const rowEl = document.createElement('button');
    openColorMosaic.mockImplementation((anchor, onPick) => onPick('#123456'));
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'colour').run(editor, t, rowEl);
    expect(applyColorOverride).toHaveBeenCalledWith(railEl, 'rails', '#123456');
    expect(editor.setColor).toHaveBeenCalledWith('#123456');
    expect(editor.setColor.mock.invocationCallOrder[0]).toBeGreaterThan(applyColorOverride.mock.invocationCallOrder[0]);
  });

  it('Cut here calls editor-cut-tool.js\'s own cutAt with the cutIntent\'s el/point', () => {
    const editor = makeEditor();
    const intent = { action: 'cut', el: 'THE_LINE', at: { x: 5, y: 5 } };
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'cut').run(editor, target({ editor, cutIntent: intent }));
    expect(cutAt).toHaveBeenCalledWith(editor, 'THE_LINE', { x: 5, y: 5 });
  });

  it('Join calls editor-cut-tool.js\'s own join with the cutIntent\'s joint', () => {
    const editor = makeEditor();
    const intent = { action: 'join', joint: ['p', 'q'] };
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'join').run(editor, target({ editor, cutIntent: intent }));
    expect(join).toHaveBeenCalledWith(editor, ['p', 'q']);
  });

  it('Duplicate composes copySelection + pasteClipboard, in that order', () => {
    const editor = makeEditor();
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'duplicate').run(editor, target({ editor }));
    expect(copySelection).toHaveBeenCalledWith(editor);
    expect(pasteClipboard).toHaveBeenCalledWith(editor);
    expect(pasteClipboard.mock.invocationCallOrder[0]).toBeGreaterThan(copySelection.mock.invocationCallOrder[0]);
  });

  it('Delete calls editor.deleteSelected (already multi-select safe)', () => {
    const editor = makeEditor();
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'delete').run(editor, target({ editor }));
    expect(editor.deleteSelected).toHaveBeenCalledTimes(1);
  });

  it('Select all <kind> filters the sketch layer by pieceKindOf and calls _selectMany', () => {
    const railA = fakeEl({ kind: 'rails' }); const railB = fakeEl({ kind: 'rails' }); const tie = fakeEl({ kind: 'ties' });
    pieceKindOf.mockImplementation((el) => (el === tie ? 'ties' : 'rails'));
    const editor = makeEditor();
    editor._sketchLayer = { children: () => ({ toArray: () => [railA, tie, railB] }) };
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'select-all-kind').run(editor, target({ editor, kind: 'rails' }));
    expect(editor._selectedElements).toEqual([railA, railB]);
  });

  it('Paste/Select all/Fit view call their own existing functions', () => {
    const editor = makeEditor();
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'paste').run(editor, target({ editor }));
    expect(pasteClipboard).toHaveBeenCalledWith(editor);
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'select-all').run(editor, target({ editor }));
    expect(selectAllVisible).toHaveBeenCalledWith(editor);
    CONTEXT_MENU_ITEMS.find((i) => i.id === 'fit-view').run(editor, target({ editor }));
    expect(editor.fitView).toHaveBeenCalledTimes(1);
  });

  it('Move to layer\'s submenu moves the selection and commits ONCE (one undo step)', () => {
    const el1 = fakeEl(); const editor = makeEditor();
    const t = target({ editor, kind: 'line', selection: [el1] });
    const subItems = CONTEXT_MENU_ITEMS.find((i) => i.id === 'move-to-layer').submenu(editor, t);
    expect(subItems.map((s) => s.label)).toEqual(['Layer 1', 'Layer 2', 'New layer…']);
    subItems[1].run(); // "Layer 2"
    expect(el1.node.getAttribute).toBeDefined(); // sanity: still a real wrapper
    expect(applyLayerState).toHaveBeenCalledWith(editor);
    expect(editor.pushState).toHaveBeenCalledTimes(1);
    expect(editor._notifyChange).toHaveBeenCalledWith('commit');
  });

  it('Move to layer\'s "New layer…" creates the layer AND moves the selection in ONE undo step', () => {
    const el1 = fakeEl(); const editor = makeEditor();
    const t = target({ editor, kind: 'line', selection: [el1] });
    const subItems = CONTEXT_MENU_ITEMS.find((i) => i.id === 'move-to-layer').submenu(editor, t);
    subItems[2].run(); // "New layer…"
    expect(addLayer).toHaveBeenCalledWith(editor, { skipUndo: true }); // the layer's OWN creation-undo is skipped
    expect(editor.pushState).toHaveBeenCalledTimes(1); // exactly one step for the whole action
  });
});

describe('the touch hold-to-menu gesture — mirrors H5\'s own arm/cancel shape', () => {
  it('fires after MULTISELECT_HOLD_MS and opens a menu in the DOM', () => {
    const editor = makeEditor('touch');
    editor._selectedElements = [fakeEl({ kind: 'rails' })];
    armContextMenuHold(editor, target({ editor, kind: 'rails' }), { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(450);
    expect(document.querySelector('.context-menu-popover')).not.toBeNull();
  });

  it('neutralizes drag/draw state so lifting the finger does nothing further underneath', () => {
    const editor = makeEditor('touch');
    armContextMenuHold(editor, target({ editor }), { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(450);
    expect(editor._isDragging).toBe(false);
    expect(editor._isDrawing).toBe(false);
    expect(editor._latticeMove).toBeNull();
  });

  it('is a no-op for mouse/pen — desktop uses right-click, not a hold', () => {
    const editor = makeEditor('mouse');
    armContextMenuHold(editor, target({ editor }), { clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.context-menu-popover')).toBeNull();
  });

  it('movement past the click threshold cancels the hold (a drag, not a menu)', () => {
    const editor = makeEditor('touch');
    armContextMenuHold(editor, target({ editor }), { clientX: 0, clientY: 0 });
    cancelContextMenuHoldIfMoved({ clientX: 50, clientY: 0 }); // 50px >> the 3px click threshold
    vi.advanceTimersByTime(450);
    expect(document.querySelector('.context-menu-popover')).toBeNull();
  });

  it('a release before the hold time cancels it (a quick tap, no menu)', () => {
    const editor = makeEditor('touch');
    armContextMenuHold(editor, target({ editor }), { clientX: 0, clientY: 0 });
    cancelContextMenuHold(); // pointerup, released early
    vi.advanceTimersByTime(450);
    expect(document.querySelector('.context-menu-popover')).toBeNull();
  });

});

describe('desktop right-click', () => {
  function fakeSvgNode() {
    const listeners = {};
    return {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      _fire(type, e) { listeners[type](e); },
    };
  }

  it('suppresses the native menu and opens the registry menu for the current selection', () => {
    const editor = makeEditor('mouse');
    const railEl = fakeEl({ kind: 'rails' });
    pieceKindOf.mockImplementation((el) => (el === railEl ? 'rails' : null));
    editor._selectedElements = [railEl];
    const svgNode = fakeSvgNode();
    bindContextMenu(editor, svgNode);
    let defaultPrevented = false;
    svgNode._fire('contextmenu', { clientX: 10, clientY: 10, preventDefault: () => { defaultPrevented = true; } });
    expect(defaultPrevented).toBe(true);
    expect(document.querySelector('.context-menu-popover')).not.toBeNull();
  });

  it('shows the empty-canvas menu when nothing is selected', () => {
    const editor = makeEditor('mouse');
    editor._selectedElements = [];
    const svgNode = fakeSvgNode();
    bindContextMenu(editor, svgNode);
    svgNode._fire('contextmenu', { clientX: 10, clientY: 10, preventDefault: () => {} });
    const labels = [...document.querySelectorAll('.context-menu-row-label')].map((n) => n.textContent);
    // Fred 2026-10-10: "Select all" is named by the open tab (the Artwork tab by default), + the current layer only
    expect(labels).toEqual(expect.arrayContaining(['Select all artwork', 'Select all in current layer', 'Fit view']));
  });
});

// Fred 2026-10-10 (Android Chrome, live: "long-press doesn't do anything, it just does a haptic pulse, no menu"): a touch
// long-press also fires the platform's own contextmenu event. The canvas's right-click listener answered it with a SECOND,
// unprotected menu over the hold's own; the touch's trailing compat mousedown then closed it -- nothing left on screen.
describe("a touch long-press: the hold's menu survives Android's own contextmenu event and the release", () => {
  const fakeSvgNode = () => { const listeners = {}; return { addEventListener: (type, fn) => { listeners[type] = fn; }, _fire(type, e) { listeners[type](e); } }; };
  const androidHold = (kind, el = null) => {
    const editor = makeEditor('touch');
    const svgNode = fakeSvgNode();
    bindContextMenu(editor, svgNode);
    armContextMenuHold(editor, target({ editor, kind, el }), { clientX: 40, clientY: 40 });
    vi.advanceTimersByTime(600); // a 600 ms still touch: the hold fires (the menu + its haptic)
    const first = document.querySelector('.context-menu-popover');
    svgNode._fire('contextmenu', { clientX: 40, clientY: 40, pointerType: 'touch', preventDefault: () => {} }); // Android
    cancelContextMenuHold(); // the finger lifts (pointerup)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); // the touch's compat mousedown
    return { first, now: document.querySelectorAll('.context-menu-popover') };
  };
  it('on EMPTY canvas: the same menu is still open after the release', () => {
    const { first, now } = androidHold('empty');
    expect(first).not.toBeNull();
    expect(now.length).toBe(1);
    expect(now[0]).toBe(first);
  });
  it('on a PIECE: the same', () => {
    const { first, now } = androidHold('line', { node: {} });
    expect(first).not.toBeNull();
    expect(now.length).toBe(1);
    expect(now[0]).toBe(first);
  });
  it('a mouse right-click still opens the menu (desktop unchanged)', () => {
    const editor = makeEditor('mouse');
    const svgNode = fakeSvgNode();
    bindContextMenu(editor, svgNode);
    svgNode._fire('contextmenu', { clientX: 10, clientY: 10, pointerType: 'mouse', preventDefault: () => {} });
    expect(document.querySelector('.context-menu-popover')).not.toBeNull();
  });
});

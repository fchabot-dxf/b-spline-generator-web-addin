/**
 * main/pull-changelist.js -- Pull from Fusion, step (b) (seat D 2026-10-16; advisor 45, Fred): applyChangeList, the
 * one write path the change-list dialog's Apply button calls into. Board rows go through applyParam (the width/
 * height side effects -- updateSpacingLabels, the stockSizeChanged event -- a bare P write would miss), layer rows
 * write onto that layer's own pattern config (so a later Regenerate doesn't revert the pulled width) AND re-paint
 * the already-drawn SVG in place (rewidthOwnedKindsAcrossLayers -- no reseed, matching Fred's "Pull seeds shapes,
 * never applies constraints"), frame rows merge onto a full copy of the current frame record (setFrameRecord's own
 * merge is shallow on .params, so a bare patch would silently drop every OTHER params.* field). All of it is ONE
 * global undo step (core/history.js recordStep, same "sidebar change becomes one step" convention frame-panel.js's
 * editFrameNow already uses) plus one editor-instance pushState/commit.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../bspline-frame-builder/b-spline-gen/html/main/param-manager.js', async (orig) => ({ ...(await orig()), applyParam: vi.fn() }));

import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { applyParam } from '../bspline-frame-builder/b-spline-gen/html/main/param-manager.js';
import { getFrameRecord, setFrameRecord } from '../bspline-frame-builder/b-spline-gen/html/core/frame-record.js';
import { globalHistoryLog, globalRedoLog, takeSnapshot, unifiedUndo } from '../bspline-frame-builder/b-spline-gen/html/core/history.js';
import { OWNERSHIP_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { LATTICE_ATTR, RAIL_ID_ATTR } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js';
import { applyChangeList } from '../bspline-frame-builder/b-spline-gen/html/main/pull-changelist.js';

function makeMockEditor() {
  const elements = [];
  function makeEl(attrs) {
    const store = { ...attrs };
    const el = {
      node: {
        getAttribute: (k) => (store[k] !== undefined ? store[k] : null),
        hasAttribute: (k) => store[k] !== undefined,
      },
      attr(k, ...rest) {
        if (rest.length === 0) return store[k];
        store[k] = rest[0];
        return el;
      },
    };
    return el;
  }
  return {
    elements,
    makeEl,
    _layers: [],
    _sketchLayer: { children: () => ({ toArray: () => [...elements] }) },
    _mW: 10, _mH: 10,
    pushState: vi.fn(),
    _notifyChange: vi.fn(),
  };
}

function makeChangeList({ editor }) {
  editor._layers.push({
    id: 'L1', name: 'Layer 1',
    pattern: { layers: { rails: 'R1', ties: 'T1', nodes: 'N1' }, widths: { rails: 0.25, ties: 0.25, nodeDiameter: 0.5 } },
  });
  const rail = editor.makeEl({ [LATTICE_ATTR]: 'rail', [OWNERSHIP_ATTR]: '1', 'data-layer': 'R1', 'stroke-width': 0.25 });
  const node = editor.makeEl({ [LATTICE_ATTR]: 'node', [OWNERSHIP_ATTR]: '1', 'data-layer': 'N1', r: 0.25 });
  editor.elements.push(rail, node);

  return {
    rail, node,
    changeList: {
      boardRows: [{ fusionParam: 'widthIn', scope: 'board', appPath: 'widthIn', label: 'Width', unit: 'in', from: 7, to: 10, changed: true }],
      layerGroups: [{
        layerId: 'L1', layerName: 'Layer 1',
        rows: [
          { fusionParam: 'rail_width', scope: 'layer', appPath: 'widths.rails', label: 'Rail width', unit: 'in', kind: 'rails', from: 0.25, to: 0.4, changed: true },
          { fusionParam: 'node_diameter', scope: 'layer', appPath: 'widths.nodeDiameter', label: 'Node diameter', unit: 'in', kind: 'nodes', from: 0.5, to: 0.6, changed: true },
        ],
      }],
      frameRows: [{ fusionParam: 'frame_thickness', scope: 'frame', appPath: 'params.frame_thickness', label: 'Frame thickness', unit: 'in', from: 0.75, to: 0.8, changed: true }],
      keptCount: 0, notMappedCount: 0, curveCount: 0,
    },
  };
}

let savedWidth;
beforeEach(() => {
  vi.clearAllMocks();
  savedWidth = P.widthIn;
  setFrameRecord({ templateId: 'template_1', params: { frame_thickness: 0.75, boundingboxoffset: 0.25 } });
  globalHistoryLog.length = 0; globalRedoLog.length = 0;
  takeSnapshot('Initial');
});
afterEach(() => { P.widthIn = savedWidth; });

describe('applyChangeList: board + layer + frame rows, one undo step', () => {
  it('board rows go through applyParam; layer rows write the pattern config AND re-paint the SVG; frame rows merge onto a full copy', () => {
    const editor = makeMockEditor();
    const { rail, node, changeList } = makeChangeList({ editor });

    applyChangeList(changeList, { editor });

    expect(applyParam).toHaveBeenCalledWith('widthIn', 10);

    expect(editor._layers[0].pattern.widths.rails).toBe(0.4);
    expect(editor._layers[0].pattern.widths.nodeDiameter).toBe(0.6);
    expect(rail.attr('stroke-width')).toBe(0.4);
    expect(node.attr('r')).toBe(0.3); // NODE-D: diameter 0.6 -> radius 0.3, same /2 as rewidthOwnedKind

    // frame_thickness changed; boundingboxoffset was never named in frameRows -- it must survive the merge
    expect(getFrameRecord().params.frame_thickness).toBe(0.8);
    expect(getFrameRecord().params.boundingboxoffset).toBe(0.25);

    expect(editor.pushState).toHaveBeenCalledOnce();
    expect(editor._notifyChange).toHaveBeenCalledWith('commit');
  });

  it('is exactly ONE global undo step, and Undo restores the frame transition', () => {
    const editor = makeMockEditor();
    const { changeList } = makeChangeList({ editor });
    P.seed = (P.seed || 0) + 1; // a change that took no snapshot of its own (core/history.js ensureUndoBaseline
    // only adds a "Before ..." baseline when P actually drifted since the last snapshot -- same precedent
    // tests/delete-frame.test.js's own "sidebar (global) Undo" test uses to exercise that baseline)

    applyChangeList(changeList, { editor });

    expect(globalHistoryLog.map((s) => s.label)).toEqual(['Initial', 'Before Pull from Fusion', 'Pull from Fusion']);
    const step = globalHistoryLog[globalHistoryLog.length - 1];
    expect(step.restore.frame.before.params.frame_thickness).toBe(0.75);
    expect(step.restore.frame.after.params.frame_thickness).toBe(0.8);

    const applied = [];
    unifiedUndo((snap, restore) => applied.push(restore && restore.frame.params.frame_thickness));
    expect(applied).toEqual([0.75]);
  });

  it('an empty change list is a no-op -- no undo push, no editor touch, applyParam never called', () => {
    const editor = makeMockEditor();
    const before = globalHistoryLog.length;

    applyChangeList({ boardRows: [], layerGroups: [], frameRows: [], keptCount: 0, notMappedCount: 0, curveCount: 0 }, { editor });

    expect(globalHistoryLog.length).toBe(before);
    expect(applyParam).not.toHaveBeenCalled();
    expect(editor.pushState).not.toHaveBeenCalled();
  });

  it('works with no editor at all when only board/frame rows are present (no layer rows, no SVG to re-paint)', () => {
    const changeList = {
      boardRows: [{ fusionParam: 'widthIn', scope: 'board', appPath: 'widthIn', label: 'Width', unit: 'in', from: 7, to: 10, changed: true }],
      layerGroups: [], frameRows: [], keptCount: 0, notMappedCount: 0, curveCount: 0,
    };
    P.seed = (P.seed || 0) + 1;

    expect(() => applyChangeList(changeList, {})).not.toThrow();
    expect(applyParam).toHaveBeenCalledWith('widthIn', 10);
    expect(globalHistoryLog.map((s) => s.label)).toEqual(['Initial', 'Before Pull from Fusion', 'Pull from Fusion']);
  });
});

// Rails custom-position + lock slice (seat D 2026-10-16; advisor 45, Fred's pre-decided design): applyChangeList's
// own rail-position write path -- a pulled line with a real railId (and a still-live rail for it) locks
// pattern.rails.custom at its new position; Apply never re-paints the rail's own SVG (this slice's own doc
// comment -- that happens on the NEXT Generate), so this is purely a DATA assertion.
describe('applyChangeList: pulled rail positions write pattern.rails.custom, locked', () => {
  const EMPTY_CL = { boardRows: [], layerGroups: [], frameRows: [], keptCount: 0, notMappedCount: 0, curveCount: 1 };

  function editorWithRail(railId, y = 4) {
    const editor = makeMockEditor();
    editor._layers.push({ id: 'L1', name: 'Layer 1', pattern: { spacing: 0.25, orientation: 'horizontal', widths: {} } });
    const rail = editor.makeEl({ [LATTICE_ATTR]: 'rail', [RAIL_ID_ATTR]: railId, 'data-layer': 'L1', x1: '0.5', y1: String(y), x2: '8', y2: String(y) });
    editor.elements.push(rail);
    return editor;
  }

  it('a matched pulled rail writes a NEW pattern.rails.custom entry, locked true', () => {
    const editor = editorWithRail('rail7', 6);
    const pulledCurves = [{ type: 'line', railId: 'rail7', isConstruction: false, x1: 0.5, y1: 6, x2: 8, y2: 6 }];

    applyChangeList(EMPTY_CL, { editor, pulledCurves });

    const pattern = editor._layers[0].pattern;
    expect(pattern.rails.custom).toHaveLength(1);
    expect(pattern.rails.custom[0].id).toBe('rail7');
    expect(pattern.rails.custom[0].locked).toBe(true);
    expect(editor.pushState).toHaveBeenCalledOnce();
    expect(editor._notifyChange).toHaveBeenCalledWith('commit');
  });

  it('a pull that re-locks an EXISTING, previously-unlocked entry (Pull always re-locks what it touches)', () => {
    const editor = editorWithRail('rail7', 6);
    editor._layers[0].pattern.rails = { custom: [{ id: 'rail7', at: 0.1, locked: false }] }; // the user had unlocked it
    const pulledCurves = [{ type: 'line', railId: 'rail7', isConstruction: false, x1: 0.5, y1: 6, x2: 8, y2: 6 }];

    applyChangeList(EMPTY_CL, { editor, pulledCurves });

    const custom = editor._layers[0].pattern.rails.custom;
    expect(custom).toHaveLength(1); // updated in place, not duplicated
    expect(custom[0].locked).toBe(true); // re-locked
    expect(custom[0].at).not.toBe(0.1); // and its position actually updated too
  });

  it('a curve with no railId, or one with no live rail left, is skipped -- no crash, no entry', () => {
    const editor = editorWithRail('rail7', 6);
    const pulledCurves = [
      { type: 'line', railId: null, isConstruction: false, x1: 0, y1: 0, x2: 1, y2: 0 },
      // a validly-SHAPED id (matchPulledRails' own RAIL_ID_RE would accept it) that just has no live rail left
      // -- the ONE case that isolates _findRailElementById's own guard from matchPulledRails' separate id-shape one
      { type: 'line', railId: 'rail99', isConstruction: false, x1: 0, y1: 1, x2: 1, y2: 1 },
    ];

    expect(() => applyChangeList(EMPTY_CL, { editor, pulledCurves })).not.toThrow();
    expect(editor._layers[0].pattern.rails?.custom ?? []).toEqual([]);
    expect(editor.pushState).not.toHaveBeenCalled(); // nothing actually matched -- no step at all
  });

  it('no pulledCurves at all (an ordinary param-only Apply): untouched, same as before this slice', () => {
    const editor = makeMockEditor();
    const { changeList } = makeChangeList({ editor });

    expect(() => applyChangeList(changeList, { editor })).not.toThrow();
  });
});

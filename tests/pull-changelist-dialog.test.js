/**
 * main/pull-changelist.js -- Pull from Fusion, step (b) (Fred-approved mockup shots/seatD/pull/01_desktop_
 * changelist.png): the change-list dialog's own DOM, built from core/pull-changelist.js's buildChangeList.
 * Nothing changes until Apply; Cancel (or an outside click) removes the dialog and writes nothing -- this file
 * only ever builds/removes DOM and fires callbacks, it owns no app state itself.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { showChangeListDialog, hasChanges } from '../bspline-frame-builder/b-spline-gen/html/main/pull-changelist.js';

beforeEach(() => { document.body.innerHTML = ''; });

const SOME_CHANGES = {
  boardRows: [{ fusionParam: 'widthIn', label: 'Width', from: 7, to: 8 }],
  layerGroups: [{ layerId: '3', layerName: 'Layer 1', rows: [{ fusionParam: 'node_diameter', label: 'Node diameter', from: 0.25, to: 0.3 }] }],
  frameRows: [{ fusionParam: 'frame_thickness', label: 'Frame thickness', from: 0.75, to: 0.8 }],
  keptCount: 2, notMappedCount: 1, curveCount: 4,
};
const NO_CHANGES = { boardRows: [], layerGroups: [], frameRows: [], keptCount: 0, notMappedCount: 0, curveCount: 0 };

describe('hasChanges: whether there is anything at all to show', () => {
  it('false for an empty list, true for any one non-empty field', () => {
    expect(hasChanges(NO_CHANGES)).toBe(false);
    expect(hasChanges({ ...NO_CHANGES, boardRows: [{}] })).toBe(true);
    expect(hasChanges({ ...NO_CHANGES, layerGroups: [{}] })).toBe(true);
    expect(hasChanges({ ...NO_CHANGES, frameRows: [{}] })).toBe(true);
    expect(hasChanges({ ...NO_CHANGES, curveCount: 1 })).toBe(true); // informational-only still counts as "something to say"
  });
});

describe('showChangeListDialog: the rows it renders', () => {
  it('a group per board/layer/frame, each row "label  from → to"', () => {
    showChangeListDialog(SOME_CHANGES);
    const body = document.querySelector('.pull-changelist-body');
    expect(body.textContent).toContain('Board');
    expect(body.textContent).toContain('Width');
    expect(body.textContent).toContain('7.00"');
    expect(body.textContent).toContain('8.00"');
    expect(body.textContent).toContain('Layer 1');
    expect(body.textContent).toContain('Node diameter');
    expect(body.textContent).toContain('Wood frame');
    expect(body.textContent).toContain('Frame thickness');
  });

  // live Fusion test (seat D 2026-10-16): a row with no prior app value (core/pull-changelist.js's own diffScope --
  // "the app has no value yet (undefined): counts as changed, the row still shows, from is undefined") used to
  // throw (v.toFixed on undefined) and silently swallow the WHOLE dialog, caught by onSketchPulled's own try/
  // catch -- not a hypothetical, reproduced live against a real captured Fusion pull result.
  it('a row with no prior app value (from undefined) renders "(none)", never throws', () => {
    const withUnsetFrom = { ...SOME_CHANGES, frameRows: [{ fusionParam: 'boundingboxoffset', label: 'Trim offset', from: undefined, to: 0.25 }] };
    expect(() => showChangeListDialog(withUnsetFrom)).not.toThrow();
    const body = document.querySelector('.pull-changelist-body');
    expect(body.textContent).toContain('(none)');
    expect(body.textContent).toContain('0.25"');
  });

  it('the informational rails note and the kept/not-mapped summary', () => {
    showChangeListDialog(SOME_CHANGES);
    const body = document.querySelector('.pull-changelist-body');
    expect(body.querySelector('.pull-changelist-note').textContent).toBe('4 rails moved in Fusion — not pulled yet.');
    expect(body.querySelector('.pull-changelist-summary').textContent).toBe('Kept in Fusion: 2 unchanged · Not mapped: 1 param');
  });

  it('no rails moved: no note at all (not "0 rails moved")', () => {
    showChangeListDialog({ ...SOME_CHANGES, curveCount: 0 });
    expect(document.querySelector('.pull-changelist-note')).toBeNull();
  });

  it('a lone layer group with no board/frame rows: only that group shows', () => {
    showChangeListDialog({ ...NO_CHANGES, layerGroups: SOME_CHANGES.layerGroups });
    const body = document.querySelector('.pull-changelist-body');
    expect(body.textContent).not.toContain('Board');
    expect(body.textContent).not.toContain('Wood frame');
    expect(body.textContent).toContain('Layer 1');
  });
});

describe('Cancel / Apply / outside click: nothing changes until Apply', () => {
  it('Cancel removes the dialog and calls onCancel, never onApply', () => {
    const onApply = vi.fn(), onCancel = vi.fn();
    showChangeListDialog(SOME_CHANGES, { onApply, onCancel });
    document.getElementById('pullChangeListOverlay').querySelector('.cad-btn-secondary').click();
    expect(document.getElementById('pullChangeListOverlay')).toBeNull();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('an outside click (on the overlay itself, not the window) also cancels', () => {
    const onCancel = vi.fn();
    showChangeListDialog(SOME_CHANGES, { onCancel });
    document.getElementById('pullChangeListOverlay').click();
    expect(document.getElementById('pullChangeListOverlay')).toBeNull();
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('a click INSIDE the window (not the overlay backdrop) never cancels', () => {
    const onCancel = vi.fn();
    showChangeListDialog(SOME_CHANGES, { onCancel });
    document.querySelector('.cad-modal-window').click();
    expect(document.getElementById('pullChangeListOverlay')).not.toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Apply removes the dialog and calls onApply with the SAME change list, never onCancel', () => {
    const onApply = vi.fn(), onCancel = vi.fn();
    showChangeListDialog(SOME_CHANGES, { onApply, onCancel });
    document.getElementById('pullChangeListOverlay').querySelector('.cad-btn-primary').click();
    expect(document.getElementById('pullChangeListOverlay')).toBeNull();
    expect(onApply).toHaveBeenCalledWith(SOME_CHANGES);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('onApply/onCancel are optional -- a bare dialog never throws on Cancel or Apply', () => {
    showChangeListDialog(SOME_CHANGES);
    expect(() => document.getElementById('pullChangeListOverlay').querySelector('.cad-btn-secondary').click()).not.toThrow();
    showChangeListDialog(SOME_CHANGES);
    expect(() => document.getElementById('pullChangeListOverlay').querySelector('.cad-btn-primary').click()).not.toThrow();
  });
});

/**
 * Job timeline step 3, slice 1, the 'layer' half (seat D, 2026-10-15): a locked lattice/vector/bricks step locks
 * its OWN editor layer (editor/layers.js jobLocked -- isEditableByLayer / isOnVisibleLayer), every other layer
 * stays editable. Rails and Nodes are two separate steps that SHARE one `layerId` (core/job-timeline.js
 * deriveJobSteps, the pattern's owner -- so clicking either opens the same Lattice tab); their own CONTENT lives
 * on SEPARATE sibling kind-layers once Generate has split them (editor-lattice-pattern.js _ensureKindLayers), so
 * main/job-timeline-lock.js's syncLayerLocks resolves each step's REAL target through the owner's own
 * pattern.layers map -- locking Rails must never also lock Nodes, and vice versa.
 */
import { describe, it, expect } from 'vitest';
import { syncLayerLocks } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-lock.js';
import { isEditableByLayer, isOnVisibleLayer, isJobLocked, setActiveLayer } from '../bspline-frame-builder/b-spline-gen/html/editor/layers.js';
import { freshPattern, _ensureKindLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { jobProjectOf, deriveJobSteps, defaultJobOrder } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';

function makeMockEditor() {
  return {
    _sketchLayer: { children() { const a = []; a.toArray = () => a; return a; }, node: {} },
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    pushState() {},
    _notifyChange() {},
  };
}
const nodeOn = (layerId) => ({ attr: (k) => (k === 'data-layer' ? layerId : null), node: {} });

describe('syncLayerLocks: Rails and Nodes resolve to their OWN real editor layer, not each other\'s', () => {
  it('pre-split (one layer holds everything): locking the lattice group locks that one layer for both sub-steps', () => {
    const editor = makeMockEditor();
    editor._layers[0].pattern = freshPattern(editor); // the Lattice panel's own lazy create, before any Generate
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    const head = order.length; // lock everything

    syncLayerLocks(steps, order, head, editor);
    expect(editor._layers[0].jobLocked).toBe(true);
  });

  it('post-split: locking ONLY Rails locks the real Rails layer, leaves the real Nodes layer editable', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']); // the first Generate's own split
    const railsId = pattern.layers.rails, nodesId = pattern.layers.nodes, tiesId = pattern.layers.ties;
    expect(railsId).not.toBe(nodesId); // sanity: genuinely separate real layers

    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    const head = order.indexOf('lattice:' + steps.find((s) => s.kind === 'latticeRails').id.split(':')[1] + ':rails') + 1;
    syncLayerLocks(steps, order, head, editor);

    expect(editor._layers.find((l) => l.id === railsId).jobLocked).toBe(true);
    expect(editor._layers.find((l) => l.id === nodesId).jobLocked).toBe(false);
    // ties has no job-timeline step of its own (core/job-timeline.js declares none), but latticeRails' own
    // locksAlso (Fred, via advisor 2026-10-16: "cut with the rails") locks it WITH rails
    expect(editor._layers.find((l) => l.id === tiesId).jobLocked).toBe(true);
  });

  it('contour (the OTHER locksAlso target) locks WITH Rails too, when it exists', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes', 'contour']);
    const contourId = pattern.layers.contour;
    expect(contourId).toBeTruthy(); // sanity: a real contour layer exists

    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    const head = order.indexOf('lattice:' + steps.find((s) => s.kind === 'latticeRails').id.split(':')[1] + ':rails') + 1;
    syncLayerLocks(steps, order, head, editor);

    expect(editor._layers.find((l) => l.id === contourId).jobLocked).toBe(true);
  });

  it('a contour that was never generated (not yet in pattern.layers) locks nothing -- no crash, nothing phantom', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']); // no 'contour' requested
    expect(pattern.layers.contour).toBeUndefined();

    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    const head = order.indexOf('lattice:' + steps.find((s) => s.kind === 'latticeRails').id.split(':')[1] + ':rails') + 1;
    expect(() => syncLayerLocks(steps, order, head, editor)).not.toThrow();
  });

  it('locksAlso only follows Rails -- locking ONLY Nodes (reordered before Rails) never locks ties', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    const nodesId = pattern.layers.nodes, tiesId = pattern.layers.ties;

    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const nodesStepId = steps.find((s) => s.kind === 'latticeNodes').id;
    const railsStepId = steps.find((s) => s.kind === 'latticeRails').id;
    // Rails normally precedes Nodes (defaultJobOrder) -- a custom order with Nodes FIRST is the only way to lock
    // Nodes without also locking Rails (locked = order.slice(0, head), a PREFIX)
    const order = [nodesStepId, railsStepId, ...defaultJobOrder(steps).filter((id) => id !== nodesStepId && id !== railsStepId)];
    syncLayerLocks(steps, order, 1, editor); // only the first entry (Nodes) is locked

    expect(editor._layers.find((l) => l.id === nodesId).jobLocked).toBe(true);
    expect(editor._layers.find((l) => l.id === tiesId).jobLocked).toBe(false);
  });

  it('both Rails and Nodes locked: both real layers locked', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    const railsId = pattern.layers.rails, nodesId = pattern.layers.nodes;

    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    syncLayerLocks(steps, order, order.length, editor); // lock everything

    expect(editor._layers.find((l) => l.id === railsId).jobLocked).toBe(true);
    expect(editor._layers.find((l) => l.id === nodesId).jobLocked).toBe(true);
  });

  it('moving the head back unlocks: jobLocked flips back to false', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    const railsId = pattern.layers.rails;
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);

    syncLayerLocks(steps, order, order.length, editor);
    expect(editor._layers.find((l) => l.id === railsId).jobLocked).toBe(true);
    syncLayerLocks(steps, order, 0, editor);
    expect(editor._layers.find((l) => l.id === railsId).jobLocked).toBe(false);
  });

  it('a vector layer\'s step.layerId already names the real layer directly -- no owner indirection needed', () => {
    const editor = makeMockEditor();
    editor._layers = [{ id: 'v1', name: 'Red petals', visible: true }];
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    syncLayerLocks(steps, order, order.length, editor);
    expect(editor._layers[0].jobLocked).toBe(true);
  });
});

describe('editor/layers.js: a jobLocked layer is not editable, same gate shape as the existing active-layer / visibility checks', () => {
  it('isEditableByLayer: false for a node on the active but jobLocked layer; true once unlocked', () => {
    const editor = { _layers: [{ id: '0', jobLocked: true }], _activeLayer: '0' };
    expect(isEditableByLayer(editor, nodeOn('0'))).toBe(false);
    editor._layers[0].jobLocked = false;
    expect(isEditableByLayer(editor, nodeOn('0'))).toBe(true);
  });

  it('isOnVisibleLayer: false for a node on a visible but jobLocked layer', () => {
    const editor = { _layers: [{ id: '0', visible: true, jobLocked: true }] };
    expect(isOnVisibleLayer(editor, nodeOn('0'))).toBe(false);
    editor._layers[0].jobLocked = false;
    expect(isOnVisibleLayer(editor, nodeOn('0'))).toBe(true);
  });

  it('isJobLocked: a plain declared read, missing/false reads as unlocked (same default shape as isCarved et al.)', () => {
    expect(isJobLocked(null)).toBe(false);
    expect(isJobLocked({})).toBe(false);
    expect(isJobLocked({ jobLocked: false })).toBe(false);
    expect(isJobLocked({ jobLocked: true })).toBe(true);
  });

  it('switching the ACTIVE layer to a jobLocked one is still allowed (Fred: "can be looked at, not changed") -- only edits are blocked', () => {
    const editor = { _layers: [{ id: '0' }, { id: '1', jobLocked: true }], _activeLayer: '0' };
    setActiveLayer(editor, '1');
    expect(editor._activeLayer).toBe('1');
    expect(isEditableByLayer(editor, nodeOn('1'))).toBe(false); // but its content still can't be edited
  });
});

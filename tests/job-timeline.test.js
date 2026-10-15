/**
 * The job timeline's data (core/job-timeline.js; Fred 2026-10-14, steps 1 + 2, no locking): the steps derived from the
 * project, Fred's default order, the saved order made safe on every load / layer change, the runs the strip draws and the
 * DETECTION-ONLY dependency marks.
 */
import { describe, it, expect } from 'vitest';
import { JOB_STEP_KINDS, JOB_DEFAULT_KIND_ORDER, jobProjectOf, deriveJobSteps, defaultJobOrder, normalizeJobTimeline, groupRuns, dependencyMarks, dependencyNote } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';

const PROJECT = {
  layers: [
    { id: 'L1', name: 'Red petals', kind: 'vector', stackIndex: 0 },
    { id: 'LA', name: 'A', kind: 'lattice', stackIndex: 1 },
    { id: 'L2', name: 'Green stems', kind: 'vector', stackIndex: 2 },
    { id: 'B', name: 'Bricks', kind: 'bricks', stackIndex: 3 },
  ],
  hasFrame: true,
};
const steps = deriveJobSteps(PROJECT);

describe('the steps and Fred\'s default order', () => {
  it('every kind is declared once, with its look, what it opens and its dependencies (data)', () => {
    for (const [id, k] of Object.entries(JOB_STEP_KINDS)) {
      expect(k.label, id).toBeTruthy(); expect(k.color, id).toMatch(/^#/); expect(k.opens, id).toBeTruthy(); expect(Array.isArray(k.dependsOn), id).toBe(true);
    }
    expect(JOB_STEP_KINDS.stock.fixed).toBe('first');
    expect(JOB_STEP_KINDS.latticeRails.group.by).toBe('layer');
    expect(JOB_STEP_KINDS.vector.group.by).toBe('kind');
    expect([...JOB_DEFAULT_KIND_ORDER].sort()).toEqual(Object.keys(JOB_STEP_KINDS).sort());
  });
  it('derived: the 6 sections, one group per lattice layer (rails, nodes), one step per vector layer, bricks, the frame', () => {
    expect(defaultJobOrder(steps)).toEqual(['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back',
      'lattice:LA:rails', 'lattice:LA:nodes', 'vector:L1', 'vector:L2', 'bricks', 'frame']);
    expect(steps.find((s) => s.id === 'lattice:LA:rails').group.label).toBe('Lattice A');
    expect(deriveJobSteps({ layers: [] }).map((s) => s.id)).not.toContain('frame'); // no template: no frame step
  });
});

describe('normalized on every load / layer change: a saved order can never error', () => {
  it('an old project (no timeline): the default order, the head at the start', () => {
    expect(normalizeJobTimeline(undefined, steps)).toEqual({ order: defaultJobOrder(steps), head: 0 });
  });
  it('a saved order naming a DELETED vector layer drops it; a NEW layer is appended at the end', () => {
    const saved = { order: ['stock', 'vector:GONE', 'seed', 'skeleton', 'filter', 'sculptTop', 'back', 'vector:L1', 'lattice:LA:rails', 'lattice:LA:nodes', 'bricks', 'frame'], head: 3 };
    const n = normalizeJobTimeline(saved, steps);
    expect(n.order).not.toContain('vector:GONE');
    expect(n.order.at(-1)).toBe('vector:L2'); // the layer the saved order did not know
    expect(n.order.length).toBe(steps.length);
  });
  it('duplicates go, Stock is moved back to step 1, the head is clamped', () => {
    const n = normalizeJobTimeline({ order: ['seed', 'stock', 'seed', 'filter'], head: 99 }, steps);
    expect(n.order[0]).toBe('stock');
    expect(n.order.filter((id) => id === 'seed').length).toBe(1);
    expect(n.head).toBe(steps.length);
    expect(normalizeJobTimeline({ order: [], head: -4 }, steps).head).toBe(0);
  });
});

describe('the strip\'s runs: free interleave, the group named on each run', () => {
  it('a lattice group split by a vector layer shows its label on both runs', () => {
    const order = ['stock', 'lattice:LA:rails', 'vector:L1', 'lattice:LA:nodes', 'vector:L2'];
    const runs = groupRuns(order, steps);
    expect(runs.map((r) => [r.group?.label || null, r.steps.map((s) => s.id)])).toEqual([
      [null, ['stock']], ['Lattice A', ['lattice:LA:rails']], ['Vector stamping', ['vector:L1']], ['Lattice A', ['lattice:LA:nodes']], ['Vector stamping', ['vector:L2']],
    ]);
  });
});

describe('dependency marks: DETECTION ONLY', () => {
  // the code's own reads (core/job-timeline.js, cited): Fred's default order cuts Skeleton before Filter (which sets its
  // frequency), Back before every stamp (it reads the stamped heights), Bricks before the frame (its contour, its edge)
  it('Fred\'s default order: the marks the code\'s reads give it, with Fred\'s sentence', () => {
    const marks = dependencyMarks(defaultJobOrder(steps), steps);
    // Fred 2026-10-14: the Back is snapshot-backed (snapshotOnLock) -- never marked, though it reads the stamps after it
    expect(marks).toEqual([
      { stepId: 'skeleton', before: ['filter'] },
      { stepId: 'bricks', before: ['frame'] },
    ]);
    expect(dependencyNote(marks[0], steps)).toBe('Skeleton is cut before Filter, but Filter changes the skeleton');
    expect(JOB_STEP_KINDS.back.snapshotOnLock).toBe(true);
  });
  it('an order that follows every read marks nothing', () => {
    const order = ['stock', 'seed', 'filter', 'skeleton', 'sculptTop', 'back', 'frame', 'vector:L1', 'lattice:LA:rails', 'lattice:LA:nodes', 'vector:L2', 'bricks'];
    expect(dependencyMarks(order, steps)).toEqual([]); // the Back first, as Fred cuts it: no mark
  });
  it('a conditional read counts only when it applies: an inset window, a lattice following the frame', () => {
    const plain = deriveJobSteps({ layers: [{ id: 'L1', name: 'Red', kind: 'vector', stackIndex: 0 }], hasFrame: true });
    const order = ['stock', 'seed', 'filter', 'skeleton', 'sculptTop', 'vector:L1', 'back', 'frame'];
    expect(dependencyMarks(order, plain).map((m) => m.stepId)).not.toContain('vector:L1');
    const inset = deriveJobSteps({ layers: [{ id: 'L1', name: 'Red', kind: 'vector', stackIndex: 0 }], hasFrame: true, insetWindow: true });
    expect(dependencyMarks(order, inset).find((m) => m.stepId === 'vector:L1').before).toEqual(['frame']);
  });
  it('lattice nodes before their OWN rails are marked; another layer\'s rails are not their dependency', () => {
    const two = deriveJobSteps({ layers: [{ id: 'LA', name: 'A', kind: 'lattice' }, { id: 'LB', name: 'B', kind: 'lattice' }] });
    const order = ['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back', 'lattice:LA:nodes', 'lattice:LA:rails', 'lattice:LB:rails', 'lattice:LB:nodes'];
    expect(dependencyMarks(order, two).filter((m) => m.stepId.startsWith('lattice:'))).toEqual([{ stepId: 'lattice:LA:nodes', before: ['lattice:LA:rails'] }]);
  });
});

describe('the project view: a saved layer roster -> the step layers', () => {
  it('a lattice is its owner layer; the sibling kind-layers its pattern names are not vector steps; bricks by their marks', () => {
    const roster = [
      { id: 1, name: 'Red petals' },
      { id: 2, name: 'Lattice A', pattern: { layers: { ties: '3', nodes: '4' } } },
      { id: 3, name: 'Ties' }, { id: 4, name: 'Nodes' },
      { id: 5, name: 'Bricks', brickKind: 'wall' }, { id: 6, name: 'Old bricks', holdsBricks: true },
    ];
    const v = jobProjectOf(roster, { templateId: 'template_1' });
    expect(v.layers.map(({ id, name, kind, stackIndex }) => ({ id, name, kind, stackIndex }))).toEqual([
      { id: '1', name: 'Red petals', kind: 'vector', stackIndex: 0 }, { id: '2', name: 'Lattice A', kind: 'lattice', stackIndex: 1 },
      { id: '5', name: 'Bricks', kind: 'bricks', stackIndex: 4 }, { id: '6', name: 'Old bricks', kind: 'bricks', stackIndex: 5 },
    ]);
    expect(v.hasFrame).toBe(true);
    expect(jobProjectOf(roster, { templateId: null }).hasFrame).toBe(false);
  });
});

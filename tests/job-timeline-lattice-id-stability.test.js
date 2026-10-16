/**
 * core/job-timeline.js step 2 nit (Fred's spec to seat D, turn 1): on a fresh board the editor's placeholder layer
 * (id '0') becomes the lattice's pattern owner the moment the Lattice/Shape-Lattice panel is first opened
 * (properties-shape-lattice.js's currentPattern, lazy freshPattern()). The FIRST Generate then moves that SAME
 * pattern object onto a brand-new Rails layer (editor-lattice-pattern.js _ensureKindLayers) and drops the empty
 * placeholder -- the owner layer's raw id shifts 0 -> the new layer's real id. deriveJobSteps used to key
 * lattice:<id>:rails/nodes off that raw id, so normalizeJobTimeline saw the old ids vanish and the new ones as
 * unknown, appending them at the end instead of keeping their saved position.
 *
 * Stabilized via jobProjectOf's jobId: pattern.jobKey (minted once by freshPattern, a field of its own -- NOT
 * pattern.id, which is already the Generate/Regenerate button's own "has run once" signal) moves WITH the pattern
 * object across the split, so the step ids never change. Falls back to the raw layer id for a legacy pattern with
 * no jobKey (a pre-fix save).
 */
import { describe, it, expect } from 'vitest';
import { jobProjectOf, deriveJobSteps, normalizeJobTimeline } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { freshPattern, _ensureKindLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';

// Same lightweight-but-real shape tests/editor-lattice-kind-layers.test.js's own makeMockEditor already establishes.
function makeMockEditor() {
  return {
    _sketchLayer: { children() { const a = []; a.toArray = () => a; return a; }, node: {} },
    _layers: [{ id: '0', name: 'Layer 1', visible: true }],
    _activeLayer: '0',
    pushState() {},
    _notifyChange() {},
  };
}

describe('lattice step ids survive the placeholder layer\'s id shift on first Generate', () => {
  it('the real sequence: freshPattern() on the placeholder, then _ensureKindLayers\' first split (0 -> a new Rails layer) -- the job step id is unchanged', () => {
    const editor = makeMockEditor();
    const placeholder = editor._layers[0];
    placeholder.pattern = freshPattern(editor); // the Lattice panel's own lazy create

    const before = deriveJobSteps(jobProjectOf(editor._layers, null));
    const beforeIds = before.filter((s) => s.kind === 'latticeRails' || s.kind === 'latticeNodes').map((s) => s.id);
    expect(beforeIds.length).toBe(2); // sanity: the placeholder already reads as a lattice layer, before Generate ever runs

    _ensureKindLayers(editor, placeholder.pattern, '0', ['rails', 'ties', 'nodes']); // the first Generate's own split
    expect(editor._layers.some((l) => l.id === '0')).toBe(false); // placeholder dropped (editor-lattice-kind-layers.test.js)

    const after = deriveJobSteps(jobProjectOf(editor._layers, null));
    const afterIds = after.filter((s) => s.kind === 'latticeRails' || s.kind === 'latticeNodes').map((s) => s.id);
    expect(afterIds).toEqual(beforeIds); // the SAME ids -- not read as new steps
  });

  it('normalizeJobTimeline keeps the saved order\'s position across the shift instead of dropping + appending at the end', () => {
    const editor = makeMockEditor();
    const placeholder = editor._layers[0];
    placeholder.pattern = freshPattern(editor);
    const stepsBefore = deriveJobSteps(jobProjectOf(editor._layers, null));
    const saved = normalizeJobTimeline(null, stepsBefore); // Fred's default order: the lattice group sits mid-order

    _ensureKindLayers(editor, placeholder.pattern, '0', ['rails', 'ties', 'nodes']);
    const stepsAfter = deriveJobSteps(jobProjectOf(editor._layers, null));
    const n = normalizeJobTimeline(saved, stepsAfter);
    expect(n.order).toEqual(saved.order); // nothing dropped, nothing appended -- the split is invisible to the saved order
  });

  it('a legacy pattern with no .jobKey (saved before this fix) falls back to the raw layer id -- unchanged behaviour', () => {
    const editor = makeMockEditor();
    editor._layers[0].pattern = { spacing: 0.25 }; // no .jobKey, like a pre-fix save
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    expect(steps.find((s) => s.kind === 'latticeRails').id).toBe('lattice:0:rails');
  });

  it('freshPattern never sets .id -- that field is the Generate/Regenerate button\'s own "has run once" signal (properties-lattice.js), not job-timeline\'s', () => {
    expect(freshPattern(makeMockEditor()).id).toBeUndefined();
  });
});

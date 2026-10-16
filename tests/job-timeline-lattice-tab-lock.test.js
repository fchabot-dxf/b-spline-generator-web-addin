/**
 * main/job-timeline-lock.js syncLatticeTabLock -- job-timeline step 3 slice 3 (Fred-approved mockup
 * shots/seatD/timeline/lock_mock_3_lattice_readonly_editor.png): the editor's OWN Lattice tab panel
 * (#editorLatticePanelBody) goes inert + its own banner naming the layer and which of its kinds are cut, separate
 * from the sidebar banners (syncJobLocks) and from the geometry-edit lock (syncLayerLocks, slice 1).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { syncLatticeTabLock } from '../bspline-frame-builder/b-spline-gen/html/main/job-timeline-lock.js';
import { freshPattern, _ensureKindLayers } from '../bspline-frame-builder/b-spline-gen/html/editor/editor-lattice-pattern.js';
import { jobProjectOf, deriveJobSteps, defaultJobOrder } from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const BODY = HTML.slice(HTML.indexOf('<body'), HTML.indexOf('</body>') + 7).replace(/<script[\s\S]*?<\/script>/g, '');

function makeMockEditor() {
  return {
    _sketchLayer: { children() { const a = []; a.toArray = () => a; return a; }, node: {} },
    _layers: [{ id: '0', name: 'Lattice Layer 1', visible: true }],
    _activeLayer: '0',
    pushState() {},
    _notifyChange() {},
  };
}

beforeEach(() => {
  document.body.innerHTML = BODY.replace(/^<body[^>]*>/, '').replace(/<\/body>$/, '');
});

function panelRoot() { return document.getElementById('editorLatticePanelBody'); }
function banner() { return panelRoot().previousElementSibling; }

describe('no active lattice pattern: nothing to lock', () => {
  it('a non-lattice active layer: the panel stays editable, no banner', () => {
    const editor = makeMockEditor(); // no .pattern on the active layer
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const order = defaultJobOrder(steps);
    syncLatticeTabLock(steps, order, order.length, editor, () => {}, document);
    expect(panelRoot().classList.contains('job-readonly')).toBe(false);
    expect(banner()?.classList.contains('job-lock-banner')).not.toBe(true);
  });

  it('no editor at all: a no-op, never throws', () => {
    expect(() => syncLatticeTabLock([], [], 0, null, () => {}, document)).not.toThrow();
  });
});

describe('a lattice pattern, Rails locked', () => {
  function lockedFixture() {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    // _ensureKindLayers REPLACES layer '0' with fresh kind-named layers (owner -> the real Rails layer, named
    // "Rails" by default) -- Fred renaming it (editor/layers.js's own rename affordance) is the mockup's own
    // "Lattice Layer 1" example; a fresh unrenamed board would read "Rails is cut" under its own name "Rails".
    const owner = editor._layers.find((l) => String(l.id) === String(pattern.layers.rails));
    owner.name = 'Lattice Layer 1';
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const railsStepId = steps.find((s) => s.kind === 'latticeRails').id;
    const order = defaultJobOrder(steps);
    const head = order.indexOf(railsStepId) + 1; // locks Rails (and ties, via locksAlso), not Nodes
    return { editor, steps, order, head, railsStepId };
  }

  it('the panel goes read-only, a real input inside it is disabled', () => {
    const { editor, steps, order, head } = lockedFixture();
    syncLatticeTabLock(steps, order, head, editor, () => {}, document);
    expect(panelRoot().classList.contains('job-readonly')).toBe(true);
    const widthInput = document.getElementById('latticeSizeWidth');
    expect(widthInput.disabled).toBe(true);
  });

  it('the banner names the layer and the single locked kind ("is cut", singular)', () => {
    const { editor, steps, order, head } = lockedFixture();
    syncLatticeTabLock(steps, order, head, editor, () => {}, document);
    const b = banner();
    expect(b.classList.contains('job-lock-banner')).toBe(true);
    expect(b.textContent).toContain('Lattice Layer 1');
    expect(b.textContent).toContain('Rails is cut');
    expect(b.textContent).toContain('Read-only: the lattice and its layer can be looked at, not changed. Every other layer is still editable.');
  });

  it('an un-renamed board (a fresh Generate -- _ensureKindLayers names the owner "Rails" by default) reads under that real name', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']); // owner.name stays its default, "Rails"
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const railsStepId = steps.find((s) => s.kind === 'latticeRails').id;
    const order = defaultJobOrder(steps);
    syncLatticeTabLock(steps, order, order.indexOf(railsStepId) + 1, editor, () => {}, document);
    expect(banner().textContent).toContain('Rails · Rails is cut'); // the layer's own real name, not a special-cased label
  });

  it('the CTA moves the head to Rails\' own step', () => {
    const { editor, steps, order, head, railsStepId } = lockedFixture();
    const moved = [];
    syncLatticeTabLock(steps, order, head, editor, (id) => moved.push(id), document);
    banner().querySelector('.job-lock-cta').click();
    expect(moved).toEqual([railsStepId]);
  });

  it('the ACTIVE layer is the Nodes kind-layer (not the owner) -- still resolves to the same owner\'s lock', () => {
    const { editor, steps, order, head } = lockedFixture();
    editor._activeLayer = String(editor._layers[0].pattern.layers.nodes); // a click on a node activates its own layer
    syncLatticeTabLock(steps, order, head, editor, () => {}, document);
    expect(panelRoot().classList.contains('job-readonly')).toBe(true);
    expect(banner().textContent).toContain('Rails is cut');
  });

  it('moving the head back unlocks: the banner is removed, the panel editable again', () => {
    const { editor, steps, order, head } = lockedFixture();
    syncLatticeTabLock(steps, order, head, editor, () => {}, document);
    expect(panelRoot().classList.contains('job-readonly')).toBe(true);
    syncLatticeTabLock(steps, order, 0, editor, () => {}, document);
    expect(panelRoot().classList.contains('job-readonly')).toBe(false);
    expect(banner()?.classList.contains('job-lock-banner')).not.toBe(true);
    expect(document.getElementById('latticeSizeWidth').disabled).toBe(false);
  });
});

describe('a lattice pattern, both Rails and Nodes locked', () => {
  it('the banner joins both kinds ("Rails and Nodes are cut", plural), the CTA targets the EARLIER one (Rails)', () => {
    const editor = makeMockEditor();
    const pattern = freshPattern(editor);
    editor._layers[0].pattern = pattern;
    _ensureKindLayers(editor, pattern, '0', ['rails', 'ties', 'nodes']);
    const steps = deriveJobSteps(jobProjectOf(editor._layers, null));
    const railsStepId = steps.find((s) => s.kind === 'latticeRails').id;
    const order = defaultJobOrder(steps);
    syncLatticeTabLock(steps, order, order.length, editor, () => {}, document); // lock everything

    const b = banner();
    expect(b.textContent).toContain('Rails and Nodes are cut');
    const moved = [];
    b.querySelector('.job-lock-cta').onclick = null; // overwritten below via a fresh call that captures moved
    syncLatticeTabLock(steps, order, order.length, editor, (id) => moved.push(id), document);
    banner().querySelector('.job-lock-cta').click();
    expect(moved).toEqual([railsStepId]);
  });
});

/**
 * STL stamps in the job timeline: ONE 'stl' step (like 'bricks'), declared in JOB_STEP_KINDS, derived from P.stlLayers,
 * cut after the editor layers and bricks, read by the Back. A board with no STL derives exactly the steps it had before.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  JOB_STEP_KINDS, JOB_DEFAULT_KIND_ORDER, jobProjectOf, deriveJobSteps, defaultJobOrder, normalizeJobTimeline, dependencyMarks,
} from '../bspline-frame-builder/b-spline-gen/html/core/job-timeline.js';
import { SECTION_THEMES } from '../bspline-frame-builder/b-spline-gen/html/main/section-themes.js';
import { SIDEBAR_TABS, branchSections } from '../bspline-frame-builder/b-spline-gen/html/main/sidebar-tabs.js';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { encodeLayersAttr } from '../bspline-frame-builder/b-spline-gen/html/editor/layers-attr.js';
import { setSectionReadOnly } from '../bspline-frame-builder/b-spline-gen/html/core/ui-utils.js';
import { P } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { renderStlPanel, syncStlPanel, _resetStlPanelForTests } from '../bspline-frame-builder/b-spline-gen/html/main/stl-panel.js';

const HTML = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
const roster = [{ id: 'a', name: 'Red petals' }, { id: 'b', name: 'Brick', brickKind: 'x' }];
const stl = [{ id: 's1', name: 'Dragon' }];
const svgWith = (r) => `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${encodeLayersAttr(r)}"></svg>`;
const OLD_ORDER = ['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back', 'vector:a', 'bricks', 'frame'];

describe('the stl step is derived from the STL list', () => {
  it('a board with an STL gets one stl step, placed like bricks', () => {
    const steps = deriveJobSteps(jobProjectOf(roster, { templateId: 't' }, stl));
    expect(steps.filter((s) => s.kind === 'stl')).toEqual([{ id: 'stl', kind: 'stl', label: 'Mesh stamps', flags: [] }]);
    expect(steps.map((s) => s.id).slice(-3)).toEqual(['bricks', 'stl', 'frame']);
  });
  it('a disabled record still counts; two records are still one step', () => {
    expect(jobProjectOf([], null, [{ id: 'x', enabled: false }]).hasStl).toBe(true);
    const steps = deriveJobSteps(jobProjectOf([], null, [{ id: 'x' }, { id: 'y' }]));
    expect(steps.filter((s) => s.kind === 'stl').length).toBe(1);
  });
  it('no STL (absent, null, empty): exactly the steps and order of a board before STL existed', () => {
    const base = deriveJobSteps(jobProjectOf(roster, { templateId: 't' }));
    for (const none of [undefined, null, []]) {
      const steps = deriveJobSteps(jobProjectOf(roster, { templateId: 't' }, none));
      expect(steps).toEqual(base);
      expect(defaultJobOrder(steps)).toEqual(defaultJobOrder(base));
    }
    expect(defaultJobOrder(base)).toEqual(OLD_ORDER);
    expect(base.some((s) => s.kind === 'stl')).toBe(false);
  });
});

describe('the declaration', () => {
  it('the default order puts stl after bricks and before frame', () => {
    const i = JOB_DEFAULT_KIND_ORDER.indexOf('stl');
    expect(i).toBeGreaterThan(-1);
    expect(JOB_DEFAULT_KIND_ORDER[i - 1]).toBe('bricks');
    expect(JOB_DEFAULT_KIND_ORDER[i + 1]).toBe('frame');
    const steps = deriveJobSteps(jobProjectOf(roster, { templateId: 't' }, stl));
    expect(defaultJobOrder(steps)).toEqual([...OLD_ORDER.slice(0, -1), 'stl', 'frame']);
  });
  it('own icon, a real section theme, a declared sidebar panel', () => {
    const k = JOB_STEP_KINDS.stl;
    expect(k).toBeTruthy();
    const others = Object.entries(JOB_STEP_KINDS).filter(([id]) => id !== 'stl').map(([, v]) => v.icon);
    expect(others).not.toContain(k.icon);
    expect(Object.keys(SECTION_THEMES)).toContain(k.section);
    const all = SIDEBAR_TABS.flatMap((t) => branchSections(t));
    expect(all).toContain(k.opens.sidebar);
    expect(k.readOnly).toBe('section');
    expect(k.cuts).toBe('top');
  });
  it('detection: cutting stl before a vector layer marks it; the Back depends on stl', () => {
    const steps = deriveJobSteps(jobProjectOf(roster, null, stl));
    const order = ['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'stl', 'vector:a', 'bricks', 'back'];
    expect(dependencyMarks(order, steps).find((m) => m.stepId === 'stl')).toEqual({ stepId: 'stl', before: ['vector:a', 'bricks'] });
    expect(JOB_STEP_KINDS.back.dependsOn).toContain('stl');
  });
});

describe('a saved timeline and the migration', () => {
  it('a saved order without stl, now that the board has an STL: stl lands at the END', () => {
    const steps = deriveJobSteps(jobProjectOf(roster, { templateId: 't' }, stl));
    const saved = { order: OLD_ORDER, head: 2 };
    const out = normalizeJobTimeline(saved, steps);
    expect(out.order).toEqual([...OLD_ORDER, 'stl']);
    expect(out.head).toBe(2);
  });
  it('migration: an old board without stlLayers gets the timeline it always got', () => {
    const p = { editorSvg: svgWith(roster), frame: { templateId: 't' } };
    expect(MIGRATIONS.some((m) => m.id === 'job-timeline')).toBe(true);
    runMigrations(p);
    expect(p.jobTimeline).toEqual({ order: OLD_ORDER, head: 0 });
  });
  it('migration: an unsaved-timeline board WITH stlLayers has stl in its order', () => {
    const p = { editorSvg: svgWith(roster), frame: { templateId: 't' }, stlLayers: stl };
    runMigrations(p);
    expect(p.jobTimeline.order).toEqual([...OLD_ORDER.slice(0, -1), 'stl', 'frame']);
  });
});

describe('the lock hook', () => {
  const tag = (HTML.match(/<div[^>]*id="stlLayerBody"[^>]*>/) || [''])[0];
  beforeEach(() => { document.body.innerHTML = `${tag}</div>`; _resetStlPanelForTests(); delete P.stlLayers; });
  it('the real palette carries data-job-lock="stl" on #stlLayerBody', () => {
    expect(tag).toContain('data-job-lock="stl"');
  });
  it('locking the section disables the panel controls', () => {
    renderStlPanel(document.getElementById('stlLayerBody'));
    setSectionReadOnly('stl', true);
    const inputs = [...document.querySelectorAll('#stlLayerBody input, #stlLayerBody button')];
    expect(inputs.length).toBeGreaterThan(5);
    expect(inputs.every((el) => el.disabled)).toBe(true);
    setSectionReadOnly('stl', false);
    expect(inputs.some((el) => el.disabled)).toBe(false);
  });
});

/**
 * The job timeline in the PROJECT (Fred 2026-10-14): P.jobTimeline = { order, head }, saved with the project (persistableP
 * keeps every P key). A board saved before it gets Fred's default order of ITS steps, head at the start
 * (main/app-init.js MIGRATIONS 'job-timeline'); a saved timeline is never rewritten by the migration.
 */
import { describe, it, expect } from 'vitest';
import { MIGRATIONS, runMigrations } from '../bspline-frame-builder/b-spline-gen/html/main/app-init.js';
import { DEFAULT, persistableP } from '../bspline-frame-builder/b-spline-gen/html/core/state.js';
import { encodeLayersAttr } from '../bspline-frame-builder/b-spline-gen/html/editor/layers-attr.js';

const svgWith = (roster) => `<svg xmlns="http://www.w3.org/2000/svg" data-editor-layers="${encodeLayersAttr(roster)}"></svg>`;

describe('P.jobTimeline', () => {
  it('declared (null = not decided yet) and saved with the project', () => {
    expect(DEFAULT.jobTimeline).toBeNull();
    expect('jobTimeline' in persistableP({ ...DEFAULT, jobTimeline: { order: ['stock'], head: 0 } })).toBe(true);
    expect(MIGRATIONS.some((m) => m.id === 'job-timeline')).toBe(true);
  });
  it('an old project: its own steps in Fred\'s default order, the head at the start', () => {
    const p = {
      editorSvg: svgWith([{ id: 'a', name: 'Red petals' }, { id: 'b', name: 'Lattice A', pattern: { layers: { nodes: 'c' } } }, { id: 'c', name: 'Nodes' }]),
      frame: { templateId: 'template_1' },
    };
    runMigrations(p);
    expect(p.jobTimeline).toEqual({
      order: ['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back', 'lattice:b:rails', 'lattice:b:nodes', 'vector:a', 'frame'],
      head: 0,
    });
  });
  it('a board with no editor document and no frame: the sections only', () => {
    const p = { editorSvg: null, frame: { templateId: null } };
    runMigrations(p);
    expect(p.jobTimeline.order).toEqual(['stock', 'seed', 'skeleton', 'filter', 'sculptTop', 'back']);
  });
  it('a saved timeline is left as it is', () => {
    const saved = { order: ['stock', 'filter', 'seed'], head: 2 };
    const p = { editorSvg: null, frame: null, jobTimeline: saved };
    runMigrations(p);
    expect(p.jobTimeline).toBe(saved);
  });
});

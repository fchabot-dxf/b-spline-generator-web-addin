/**
 * main/brick-control-requires.js is pure data the control-matrix test (Node) imports: no imports of its
 * own, every rule names real control ids and a supported `satisfied` form.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { BRICK_CONTROL_REQUIRES, requirementMet } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';

describe('BRICK_CONTROL_REQUIRES', () => {
  it('has no imports (Node-importable)', () => {
    const src = readFileSync('bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js', 'utf8');
    expect(src).not.toMatch(/^\s*import\s/m);
  });
  it('every id is a real palette control, every satisfied form is supported', () => {
    const html = readFileSync('bspline-frame-builder/b-spline-gen/html/bspline_gen_palette.html', 'utf8');
    for (const r of BRICK_CONTROL_REQUIRES) {
      // a static palette id, or one main/brick-panel.js renders from a declared list (`prefix_${...}`)
      const panel = readFileSync('bspline-frame-builder/b-spline-gen/html/main/brick-panel.js', 'utf8');
      // ...or a sidebar quick-settings button: quickButtonId = `brickQuick_${row.id}_${choice.id}` (BRICK_QUICK_SETTINGS)
      const quick = (id) => /^brickQuick_[a-z]+_/.test(id) && panel.includes(`id: '${id.split('_')[1]}'`) && panel.includes('`brickQuick_${row.id}_${choice.id}`');
      const exists = (id) => html.includes(`id="${id}"`) || panel.includes(`\`${id.slice(0, id.lastIndexOf('_') + 1)}\${`) || quick(id);
      for (const id of [...r.controls, ...(r.within || []), r.requires.control].filter(Boolean)) expect(exists(id), id).toBe(true);
      if (r.requires.engineOption || r.requires.fact) continue; // an engine option / a board fact, not a control state
      expect(Object.keys(r.requires.satisfied).some((k) => ['gt', 'active', 'checked'].includes(k))).toBe(true);
      expect(r.why).toBeTruthy();
    }
  });
  it('requirementMet reads each form', () => {
    expect(requirementMet({ satisfied: { gt: 0 } }, { value: '0' })).toBe(false);
    expect(requirementMet({ satisfied: { gt: 0 } }, { value: '0.2' })).toBe(true);
    expect(requirementMet({ satisfied: { active: true } }, { classList: { contains: () => false } })).toBe(false);
    expect(requirementMet({ satisfied: { checked: true } }, { checked: true })).toBe(true);
    expect(requirementMet({ satisfied: { gt: 0 } }, null)).toBe(true);
  });
});

describe('turn 199: engineOption requirements', () => {
  // T86 item 17 shipped: `largeStones` is now really in ENGINE_OPTIONS, so the rule's own
  // requirement is met against the REAL array -- the control appears by itself, exactly what the
  // engine.js ENGINE_OPTIONS header comment (turn 199) declared this mechanism for.
  it('met now that the engine genuinely lists largeStones (T86 item 17)', async () => {
    const { ENGINE_OPTIONS } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js');
    const rule = BRICK_CONTROL_REQUIRES.find((r) => r.controls.includes('brickLargeStonesRow'));
    expect(rule.hides).toBe(true);
    expect(ENGINE_OPTIONS).toContain('largeStones');
    expect(requirementMet(rule.requires, null, { engineOptions: ENGINE_OPTIONS })).toBe(true);
    expect(requirementMet(rule.requires, null, { engineOptions: ENGINE_OPTIONS.filter((o) => o !== 'largeStones') })).toBe(false);
  });
});

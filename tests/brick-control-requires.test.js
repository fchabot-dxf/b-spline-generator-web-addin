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
      for (const id of [...r.controls, r.requires.control].filter(Boolean)) expect(html).toContain(`id="${id}"`);
      if (r.requires.engineOption) continue; // an engine option, not a control state
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
  it('met only when the engine lists the option; Large stones is NOT in the engine yet', async () => {
    const { ENGINE_OPTIONS } = await import('../bspline-frame-builder/b-spline-gen/html/core/bricks/index.js');
    const rule = BRICK_CONTROL_REQUIRES.find((r) => r.controls.includes('brickLargeStonesRow'));
    expect(rule.hides).toBe(true);
    expect(requirementMet(rule.requires, null, { engineOptions: ENGINE_OPTIONS })).toBe(false);
    expect(requirementMet(rule.requires, null, { engineOptions: [...ENGINE_OPTIONS, 'largeStones'] })).toBe(true);
  });
});

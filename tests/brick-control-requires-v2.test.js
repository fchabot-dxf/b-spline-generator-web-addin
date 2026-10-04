/**
 * Audit v2 (AUDIT-BRICK-TAB-v2.md): N3 -- with White Rocks (fieldstone layout) the course bonds and the
 * per-band patterns do nothing, so they are greyed / hidden through the declared requires; N5 -- the
 * sidebar BRICK controls need laid Wall/Frame bricks (a board FACT), greyed with a visible reason.
 */
import { describe, it, expect } from 'vitest';
import { BRICK_CONTROL_REQUIRES, requirementMet } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';
import { BRICK_PATTERNS } from '../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';

const ruleFor = (id) => BRICK_CONTROL_REQUIRES.find((r) => r.controls.includes(id));

describe('N3: White Rocks greys exactly the course bonds', () => {
  const courseKinds = Object.entries(BRICK_PATTERNS).filter(([, d]) => d.kind === 'course' || d.kind === 'course-alternating').map(([id]) => id);
  it('every course / course-alternating pattern (and only those) is greyed under White Rocks, in the editor AND the quick row', () => {
    const rule = ruleFor('brickPattern_stretcher');
    expect(rule.requires).toEqual({ control: 'brickSetWhite', satisfied: { active: false } });
    const greyed = rule.controls.filter((id) => id.startsWith('brickPattern_')).map((id) => id.replace('brickPattern_', '')).sort();
    expect(greyed).toEqual([...courseKinds].sort());
    for (const id of courseKinds) expect(rule.controls).toContain(`brickQuick_pattern_${id}`);
    for (const id of ['herringbone', 'basketweave', 'fieldstone', 'none']) expect(rule.controls).not.toContain(`brickPattern_${id}`);
  });
  it('the band-pattern list is HIDDEN under White Rocks', () => {
    const rule = ruleFor('brickFrameBandPatternList');
    expect(rule.hides).toBe(true);
    expect(rule.requires.control).toBe('brickSetWhite');
  });
});

describe('N5: the sidebar BRICK controls need laid bricks (a board fact)', () => {
  it('a fact requirement is met unless the fact is false; a missing fact (e.g. the Node matrix) counts as met', () => {
    const rule = ruleFor('brickBtnReliefCarved');
    expect(rule.requires).toEqual({ fact: 'bricksLaid' });
    expect(rule.within).toEqual(['brickQuickSettings', 'brickSurfaceStyleToggle']);
    expect(requirementMet(rule.requires, null, { facts: { bricksLaid: false } })).toBe(false);
    expect(requirementMet(rule.requires, null, { facts: { bricksLaid: true } })).toBe(true);
    expect(requirementMet(rule.requires, null, {})).toBe(true);
  });
});

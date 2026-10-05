/**
 * Audit v2 (AUDIT-BRICK-TAB-v2.md): N3 -- with White Rocks (fieldstone layout) the course bonds and the
 * per-band patterns do nothing, so they are greyed / hidden through the declared requires; N5 -- the
 * sidebar BRICK controls need laid Wall/Frame bricks (a board FACT), greyed with a visible reason.
 */
import { describe, it, expect } from 'vitest';
import { BRICK_CONTROL_REQUIRES, requirementMet } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';

const ruleFor = (id) => BRICK_CONTROL_REQUIRES.find((r) => r.controls.includes(id));

// N3's White Rocks rules were retired by F35 item 23 (White Rocks left the Set row; the Fieldstone pattern implies it).
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

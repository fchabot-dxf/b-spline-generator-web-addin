/**
 * Audit v2 (AUDIT-BRICK-TAB-v2.md): N3 -- with White Rocks (fieldstone layout) the course bonds and the
 * per-band patterns do nothing, so they are greyed / hidden through the declared requires; N5 -- the
 * sidebar BRICK controls need laid Wall/Frame bricks (a board FACT), greyed with a visible reason.
 */
import { describe, it, expect } from 'vitest';
import { BRICK_CONTROL_REQUIRES, requirementMet } from '../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js';
import { boardHasBricks } from '../bspline-frame-builder/b-spline-gen/html/main/brick-panel.js';

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

// advisor (seat E, brush grout): the fact counts ANY brick element -- a stroke-only board's quick rows (its grout
// colour) are live, not greyed
describe('the bricksLaid fact: any brick element', () => {
  const board = (html) => { const node = document.createElement('div'); node.innerHTML = html; return { _sketchLayer: { node } }; };
  const svgNs = (tag, attrs) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}></${tag}>`;
  it('an empty board (and no saved drawing): false -- the rows stay greyed', () => {
    expect(boardHasBricks(board(''), undefined)).toBe(false);
    expect(boardHasBricks(null, '<svg><rect data-layer="0"/></svg>')).toBe(false);
  });
  it('a Brush stroke alone (its spine, or its pieces), a Wall, or a saved drawing holding any of them: true', () => {
    expect(boardHasBricks(board(svgNs('line', { 'data-brick': 'brush-spine', 'data-brick-element': 's1' })), undefined)).toBe(true);
    expect(boardHasBricks(board(svgNs('polygon', { 'data-brick': 'brush', 'data-brick-gen': '1' })), undefined)).toBe(true);
    expect(boardHasBricks(board(svgNs('polygon', { 'data-brick': 'wall', 'data-brick-gen': '1' })), undefined)).toBe(true);
    expect(boardHasBricks(null, '<svg><line data-brick="brush-spine"/></svg>')).toBe(true);
    expect(boardHasBricks(null, '<svg><polygon data-brick="frame"/></svg>')).toBe(true);
  });
  it('the reason no longer says Wall or Frame only', () => {
    expect(BRICK_CONTROL_REQUIRES.find((r) => r.requires.fact === 'bricksLaid').why).toMatch(/Brush stroke/);
  });
});

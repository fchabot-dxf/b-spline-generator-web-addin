/**
 * main/brick-control-requires.js -- which Brick controls only work while ANOTHER control is in some
 * state (audit, agreed with 88 for tools/brick-matrix). Pure data, no imports: main/brick-panel.js greys
 * each id in `controls` out (disabled, title = why) while `requires` is unmet, and the control-matrix
 * test (Node, no DOM) reads the SAME declaration instead of keeping its own copy.
 * `satisfied` forms: { gt: n } on a number input's value, { active: bool } on a button's .active class,
 * { checked: bool } on a checkbox.
 */
export const BRICK_CONTROL_REQUIRES = [
  { controls: ['brickClumping', 'brickClumpingSlider'], requires: { control: 'brickSuppression', satisfied: { gt: 0 } },
    why: 'Clumping only shapes which bricks Suppression removes -- no effect at Suppression 0' },
  { controls: ['brickGroutDepth'], requires: { control: 'brickBtnGroutRecessed', satisfied: { active: true } },
    why: 'Grout depth is the recess depth -- no effect while the grout is Flush' },
];

/** Is `requires` met, given the DOM node of its control? (null control = met: never grey on a missing node) */
export function requirementMet(requires, controlEl) {
  if (!controlEl) return true;
  const s = requires.satisfied || {};
  if ('gt' in s) return Number(controlEl.value) > s.gt;
  if ('active' in s) return controlEl.classList.contains('active') === s.active;
  if ('checked' in s) return !!controlEl.checked === s.checked;
  return true;
}

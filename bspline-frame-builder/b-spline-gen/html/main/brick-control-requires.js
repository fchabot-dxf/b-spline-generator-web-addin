/**
 * main/brick-control-requires.js -- which Brick controls only work while ANOTHER control is in some
 * state (audit, agreed with 88 for tools/brick-matrix). Pure data, no imports: main/brick-panel.js greys
 * each id in `controls` out (disabled, title = why) while `requires` is unmet, and the control-matrix
 * test (Node, no DOM) reads the SAME declaration instead of keeping its own copy.
 * `satisfied` forms: { gt: n } on a number input's value, { active: bool } on a button's .active class,
 * { checked: bool } on a checkbox. `requires: { engineOption: name }` (turn 199) = the brick engine
 * honours that generateBricks option (core/bricks/engine.js ENGINE_OPTIONS, passed in as
 * ctx.engineOptions); `hides: true` = hidden, not greyed, while unmet (a control that would do nothing).
 * `requires: { fact: name }` (audit v2 N5) = a fact about the board the panel supplies as ctx.facts[name]
 * (a missing fact counts as met, like a missing control). `within: [containerId]` greys every button /
 * input INSIDE those containers too (their buttons are rendered from data, ids not listed here).
 * A control under several rules is greyed while ANY of them is unmet.
 */
/** A frame lay with no contour to follow (the frame's outline can't carry bands): the toast's words, and the
 *  sidebar Frame bands row's reason while it is greyed (item 63). No template is the board rectangle (item 66). */
export const FRAME_NEEDS_A_FRAME = "This frame's outline can't carry brick bands -- pick another frame template.";

/** Item 74b (Fred: grey + explain): a corner choice that would re-lay the identical frame -- no square corner on this
 *  outline is long enough for its cut at this brick size (measured: T18 at 1.25 in, Butt / Block / Lapped). Live again
 *  when the size allows; the mitre is never greyed. The fact is the engine's (frameCornerEffect), not a clamp. */
export const CORNER_NOT_LONG_ENOUGH = 'No square corner here is long enough at this brick size';
export const cornerFact = (style) => `cornerTakes_${style}`;

// Audit v2 N5: the main sidebar's BRICK controls (quick settings + 3D) -- they act on laid Wall/Frame bricks
const SIDEBAR_BRICK_CONTROLS = ['brickBtnReliefRaised', 'brickBtnReliefCarved', 'brickBtnTopOrganic', 'brickBtnTopFlat',
  'brickSurfaceWear', 'brickSurfaceWearSlider', 'brickReliefHeight', 'brickReliefHeightSlider', 'brickGroutDepth',
  'brickBtnGroutRecessed', 'brickBtnGroutFlush'];

export const BRICK_CONTROL_REQUIRES = [
  { controls: ['brickClumping', 'brickClumpingSlider'], requires: { control: 'brickSuppression', satisfied: { gt: 0 } },
    why: 'Clumping only shapes which bricks Suppression removes -- no effect at Suppression 0' },
  { controls: ['brickGroutDepth'], requires: { control: 'brickBtnGroutRecessed', satisfied: { active: true } },
    why: 'Grout depth is the recess depth -- no effect while the grout is Flush' },
  { controls: ['brickLargeStonesRow'], requires: { engineOption: 'largeStones' }, hides: true,
    why: 'Large stones needs the fieldstone engine option (seat B, T86 item 17) -- hidden until the engine reads it' },
  { controls: ['brickRusticRow_wall', 'brickRusticRow_brush'], requires: { engineOption: 'rustic' }, hides: true,
    why: 'Rustic coursing is laid by the engine (seat B, T86 item 22) -- hidden until it reads it' },
  { controls: ['brickSubTool_wall_area', 'brickWallAreaRow'], requires: { engineOption: 'wallRegion' }, hides: true,
    why: 'Painting wall areas needs the engine\'s strokes-to-region op (seat B, T86 item 18) -- hidden until it exists' },
  { controls: ['brickWallRotationRow'], requires: { engineOption: 'rotationDeg' }, hides: true,
    why: 'Pattern rotation is laid by the engine (seat B, T86 item 29) -- hidden until it reads rotationDeg' },
  { controls: ['brickFrameBandsNoteRow'], requires: { engineOption: 'bandFit' }, hides: true,
    why: 'The band-fit note comes from the engine\'s fit rule (seat B, T86 item 28) -- hidden until it exists' },
  { controls: ['brickRaisedMode_grout'], requires: { engineOption: 'groutCut' }, hides: true,
    why: 'Grout mode cuts joints with the engine\'s bricksGroutCut (seat B, T86 item 10) -- hidden until it exists' },
  { controls: SIDEBAR_BRICK_CONTROLS, within: ['brickQuickSettings', 'brickSurfaceStyleToggle'], requires: { fact: 'bricksLaid' },
    why: 'No bricks on this board yet -- lay a Wall, a Frame or a Brush stroke in the editor\'s Brick tab first' },
  // F35 item 63: the sidebar's Frame bands pick lays the frame along its contour -- none for an outline that can't carry one
  { controls: [], within: ['brickQuickRow_frameBands'], requires: { fact: 'frameContour' }, why: FRAME_NEEDS_A_FRAME },
  // item 74b: one rule per cutting corner style (core/bricks CORNER_CUT_STYLES)
  ...['butt', 'block', 'lapped'].map((style) => ({ controls: [`brickFrameCorner_${style}`], requires: { fact: cornerFact(style) }, why: CORNER_NOT_LONG_ENOUGH })),
];

/** Is `requires` met, given the DOM node of its control? (null control = met: never grey on a missing node) */
export function requirementMet(requires, controlEl, ctx = {}) {
  if (requires.engineOption) return (ctx.engineOptions || []).includes(requires.engineOption);
  if (requires.fact) return !ctx.facts || ctx.facts[requires.fact] !== false;
  if (!controlEl) return true;
  const s = requires.satisfied || {};
  if ('gt' in s) return Number(controlEl.value) > s.gt;
  if ('active' in s) return controlEl.classList.contains('active') === s.active;
  if ('checked' in s) return !!controlEl.checked === s.checked;
  return true;
}

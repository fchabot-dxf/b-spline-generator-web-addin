// The Brick tab's controls, declared once: what each one is EXPECTED to do, end to end.
// tools/brick-matrix/run.mjs drives every entry in the real app (headless Chrome) and checks it.
//
// Fred (2026-10-04): "the brick tab is not really working, none of the params do anything" -- the
// advisor: "make the web matrix a permanent automated test ... so the merge gate runs it".
//
// kind:
//   'editor'    a Brick-tab (editor) control: change -> pending dot? -> Generate -> canvas changed? ->
//               Apply -> 3D (heightmap) changed?
//   'editor3d'  an editor control that is 3D-only ('surface' commit): change -> Apply -> 3D changed?
//   'brush'     a Brush setting (frozen into each stroke at draw time): the SAME stroke drawn before and
//               after the change must differ
//   'sidebar'   a main-sidebar Brick control ('auto' commit): change -> canvas? -> 3D? (no Generate)
//   'stripe'    a Stripe-panel brick-style pick: a fresh brush stroke is striped (count 4), then the pick
//               must re-style the striped runs at once (canvas), never pending
// introducedBy: the commit that added the control -- on a build without it the row is SKIPPED, not failed.
// tool:   the Brick tool that must be active for an 'editor'/'editor3d' row (its settings section shows)
// do:     { click: id } | { set: id, value, event }   (event: 'input' | 'change')
// expect: { pending, canvas, threeD }: true / false = must / must not change; null = not checked.
// requires: { control, satisfied, why } -- the setting only has an effect while ANOTHER control is in a
//   given state (satisfied: { gt: n } on a number input's value, or { active: true } on a button). While it
//   is NOT satisfied the control must be greyed out (disabled, tooltip = why) and the row checks exactly that;
//   while it is, the row runs normally. (satisfied: { checked: true } for a checkbox; an unmet control may
//   be hidden instead of greyed out.) (Advisor, 2026-10-04: "a disabled-by-design control isn't a FAIL".)
//   A control the user can change is expected to do something visible -- a row that changes nothing
//   (e.g. Clumping while Suppression is 0) FAILS on purpose: it is a control that "does nothing".
const E = (pending, canvas, threeD) => ({ pending, canvas, threeD });
const LAYOUT = E(true, true, true);      // a 2D layout setting: pending, re-laid on Generate, new relief
const SURFACE = E(false, null, true);    // a 3D-only setting: never pending, new relief
const AUTO = E(false, true, true);       // a sidebar quick setting: re-lays at once
const click = (id) => ({ click: id });
const NEEDS_SUPPRESSION = { control: 'brickSuppression', satisfied: { gt: 0 }, why: 'Clumping only shapes which bricks Suppression removes -- it has no effect at Suppression 0' };
const NEEDS_THREE_STYLES = { control: 'stripeThree', satisfied: { checked: true }, why: 'Style C only exists when the stripe uses three styles' };
const STRIPE = E(false, true, null);
const NEEDS_RECESSED = { control: 'brickBtnGroutRecessed', satisfied: { active: true }, why: 'Grout depth is the recess depth -- it has no effect while the grout is Flush' };
const set = (id, value, event = 'change') => ({ set: id, value, event });

export const BRICK_CONTROLS = [
  // ---- editor, Wall tool
  { name: 'Set: White Rocks', kind: 'editor', tool: 'wall', do: click('brickSetWhite'), expect: LAYOUT },
  { name: 'Set: Red Brick', kind: 'editor', tool: 'wall', do: click('brickSetRed'), expect: LAYOUT },
  { name: 'Wall pattern: Herringbone', kind: 'editor', tool: 'wall', do: click('brickPattern_herringbone'), expect: LAYOUT },
  { name: 'Wall pattern: Basketweave', kind: 'editor', tool: 'wall', do: click('brickPattern_basketweave'), expect: LAYOUT },
  { name: 'Wall pattern: Fieldstone', kind: 'editor', tool: 'wall', do: click('brickPattern_fieldstone'), expect: LAYOUT },
  // shown only for a fieldstone wall (White Rocks or the Fieldstone pattern) -- hence right after the row above
  { name: 'Large stones 0.6 (Fieldstone)', kind: 'editor', tool: 'wall', do: set('brickLargeStones', 0.6), expect: LAYOUT, introducedBy: '88c7616' },
  { name: 'Wall pattern: None', kind: 'editor', tool: 'wall', do: click('brickPattern_none'), expect: LAYOUT },
  { name: 'Wall pattern: Stretcher', kind: 'editor', tool: 'wall', do: click('brickPattern_stretcher'), expect: LAYOUT },
  { name: 'Wall Level +1/8', kind: 'editor3d', tool: 'wall', do: set('brickLevel_wall', 0.125), expect: SURFACE },
  { name: 'Wall Level 0', kind: 'editor3d', tool: 'wall', do: set('brickLevel_wall', 0), expect: SURFACE },
  { name: 'Brick size preset 1-1/2', kind: 'editor', tool: 'wall', do: click('brickSizePreset_half1'), expect: LAYOUT },
  { name: 'Brick size stepper 1.0', kind: 'editor', tool: 'wall', do: set('brickSize', 1), expect: LAYOUT },
  { name: 'Brick size slider (log 500)', kind: 'editor', tool: 'wall', do: set('brickSizeSlider', 500), expect: LAYOUT },
  { name: 'Brick size preset 3/4', kind: 'editor', tool: 'wall', do: click('brickSizePreset_quarter3'), expect: LAYOUT },
  { name: 'Grout width 0.08', kind: 'editor', tool: 'wall', do: set('brickGroutWidth', 0.08, 'input'), expect: LAYOUT },
  { name: 'Suppression 0.5', kind: 'editor', tool: 'wall', do: set('brickSuppression', 0.5), expect: LAYOUT },
  { name: 'Clumping 0.9 (Suppression 0.5)', kind: 'editor', tool: 'wall', do: set('brickClumping', 0.9), expect: LAYOUT, requires: NEEDS_SUPPRESSION },
  { name: 'Suppression 0', kind: 'editor', tool: 'wall', do: set('brickSuppression', 0), expect: LAYOUT },
  { name: 'Clumping 0.1 (Suppression 0)', kind: 'editor', tool: 'wall', do: set('brickClumping', 0.1), expect: LAYOUT, requires: NEEDS_SUPPRESSION },
  { name: 'Seed 77', kind: 'editor', tool: 'wall', do: set('brickSeed', 77, 'input'), expect: LAYOUT },
  { name: 'Random seed', kind: 'editor', tool: 'wall', do: click('brickBtnRandomSeed'), expect: LAYOUT },
  // ---- editor, Frame tool
  { name: 'Frame preset: 3-band', kind: 'editor', tool: 'frame', do: click('brickFramePreset_three_band'), expect: LAYOUT },
  { name: 'Band 1 pattern: Header', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_header'), expect: LAYOUT },
  { name: 'Frame offset distance 0.25', kind: 'editor', tool: 'frame', do: set('brickFrameOffsetDistance', 0.25), expect: LAYOUT },
  { name: 'Frame offset off', kind: 'editor', tool: 'frame', do: click('brickFrameOffsetOn'), expect: LAYOUT },
  { name: 'Frame offset on', kind: 'editor', tool: 'frame', do: click('brickFrameOffsetOn'), expect: LAYOUT },
  { name: 'Frame Level -1/8', kind: 'editor3d', tool: 'frame', do: set('brickLevel_frame', -0.125), expect: SURFACE },
  { name: 'Frame Level 0', kind: 'editor3d', tool: 'frame', do: set('brickLevel_frame', 0), expect: SURFACE },
  { name: 'Frame preset: None', kind: 'editor', tool: 'frame', do: click('brickFramePreset_none'), expect: LAYOUT },
  { name: 'Frame preset: Soldier', kind: 'editor', tool: 'frame', do: click('brickFramePreset_single_soldier'), expect: LAYOUT },
  // ---- Brush settings (new strokes)
  { name: 'Brush profile: Continuous', kind: 'brush', do: click('brickBtnProfileContinuous'), expect: E(false, true, null) },
  { name: 'Brush orientation: Soldier', kind: 'brush', do: click('brickBtnOrientationSoldier'), expect: E(false, true, null) },
  { name: 'Brush profile: Stripped', kind: 'brush', do: click('brickBtnProfileStripped'), expect: E(false, true, null) },
  { name: 'Brush preset: 2-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_2_running'), expect: E(false, true, null) },
  { name: 'Brush preset: 1-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_1'), expect: E(false, true, null) },
  // ---- Stripe panel brick-style picks (seat 37, fb-app 702876d)
  { name: 'Stripe A: White continuous', kind: 'stripe', do: click('stripeBrickStyle_A_white_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe B: Red continuous', kind: 'stripe', do: click('stripeBrickStyle_B_red_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe C: White bricks', kind: 'stripe', do: click('stripeBrickStyle_C_white_bricks'), expect: STRIPE, introducedBy: '702876d', requires: NEEDS_THREE_STYLES },
  // ---- main sidebar
  { name: 'Quick set: White Rocks', kind: 'sidebar', do: click('brickQuick_set_3'), expect: AUTO },
  { name: 'Quick set: Red Brick', kind: 'sidebar', do: click('brickQuick_set_1'), expect: AUTO },
  { name: 'Quick size: 1-1/2', kind: 'sidebar', do: click('brickQuick_size_half1'), expect: AUTO },
  { name: 'Quick size: 3/4', kind: 'sidebar', do: click('brickQuick_size_quarter3'), expect: AUTO },
  { name: 'Quick pattern: Herringbone', kind: 'sidebar', do: click('brickQuick_pattern_herringbone'), expect: AUTO },
  { name: 'Quick frame bands: 3-band', kind: 'sidebar', do: click('brickQuick_frameBands_three_band'), expect: AUTO },
  { name: 'Relief: Carved', kind: 'sidebar', do: click('brickBtnReliefCarved'), expect: SURFACE },
  { name: 'Relief: Raised', kind: 'sidebar', do: click('brickBtnReliefRaised'), expect: SURFACE },
  { name: 'Brick top: Flat', kind: 'sidebar', do: click('brickBtnTopFlat'), expect: SURFACE },
  { name: 'Brick top: Organic', kind: 'sidebar', do: click('brickBtnTopOrganic'), expect: SURFACE },
  { name: 'Surface: Weathered', kind: 'sidebar', do: click('brickSurfaceStyle_weathered'), expect: SURFACE },
  { name: 'Wear 0.9 (Weathered)', kind: 'sidebar', do: set('brickSurfaceWear', 0.9), expect: SURFACE },
  { name: 'Surface: Clean', kind: 'sidebar', do: click('brickSurfaceStyle_clean'), expect: SURFACE },
  { name: 'Max Height 0.2', kind: 'sidebar', do: set('brickReliefHeight', 0.2), expect: SURFACE },
  { name: 'Grout: Recessed', kind: 'sidebar', do: click('brickBtnGroutRecessed'), expect: SURFACE },
  { name: 'Grout depth 0.1 (Recessed)', kind: 'sidebar', do: set('brickGroutDepth', 0.1), expect: SURFACE, requires: NEEDS_RECESSED },
  { name: 'Grout: Flush', kind: 'sidebar', do: click('brickBtnGroutFlush'), expect: SURFACE },
  { name: 'Grout depth 0.05 (Flush)', kind: 'sidebar', do: set('brickGroutDepth', 0.05), expect: SURFACE, requires: NEEDS_RECESSED },
  { name: 'Hide filter texture', kind: 'sidebar', do: click('isolateSkeleton'), expect: SURFACE },
];

// The APP's own declaration wins when it exists (seat 37: main/brick-control-requires.js, a pure data
// module the Brick panel greys controls out from): each of its entries' `controls` gets that `requires`,
// so the matrix checks the app against the app's rule instead of a second copy that could drift. Until
// that module lands, the NEEDS_* copies above stand in.
let appRequires = null;
try {
  ({ BRICK_CONTROL_REQUIRES: appRequires } = await import('../../bspline-frame-builder/b-spline-gen/html/main/brick-control-requires.js'));
} catch { /* not in this build yet */ }
if (Array.isArray(appRequires)) {
  for (const row of BRICK_CONTROLS) {
    const target = row.do.click || row.do.set;
    const decl = appRequires.find((d) => (d.controls || []).includes(target));
    if (decl) row.requires = { control: decl.requires.control, satisfied: decl.requires.satisfied, why: decl.why };
  }
}
export const REQUIRES_SOURCE = Array.isArray(appRequires) ? 'app (main/brick-control-requires.js)' : 'matrix fallback (controls.mjs NEEDS_*)';

// ---- persistence (audit v2 N1/N2, advisor 2026-10-04): the matrix missed the bug Fred hit. A non-default
// board is laid through the UI and applied; then after a RELOAD, and again after a project SAVE AS -> LOAD
// (the real Project Manager modal, its cloud API answered by an in-page stand-in so nothing leaves the
// machine), every control must SHOW the board's value and the canvas must show its bricks PAINTED (each
// brick's fill resolves to a <pattern> that exists).
//   setup:  UI actions, in order ({ tool } picks a Brick tool; { apply: true } presses Apply)
//   panel:  { name, active: id } -- that button is the highlighted choice; { name, value: [id, n] } -- that
//           field reads n
//   bricks: { name, kind } -- the canvas holds bricks of that kind and every one of them is painted
export const PERSIST_BOARD = {
  setup: [
    { tool: 'wall' }, click('brickSetWhite'), click('brickPattern_herringbone'), click('brickSizePreset_half1'),
    set('brickLevel_wall', 0.0625), click('brickGenerate'),
    { tool: 'frame' }, click('brickFramePreset_three_band'), click('brickGenerate'),
    { tool: 'brush' }, { stroke: [[0.3, 0.45], [0.7, 0.45]] },
    { apply: true },
    { sidebar: true }, click('brickSurfaceStyle_weathered'), set('brickReliefHeight', 0.2),
  ],
  panel: [
    { name: 'Set: White Rocks', active: 'brickSetWhite' },
    { name: 'Wall pattern: Herringbone', active: 'brickPattern_herringbone' },
    { name: 'Brick size 1.5', value: ['brickSize', 1.5] },
    { name: 'Wall Level 1/16', value: ['brickLevel_wall', 0.0625] },
    { name: 'Frame preset: 3-band', active: 'brickFramePreset_three_band' },
    { name: 'Surface: Weathered', active: 'brickSurfaceStyle_weathered' },
    { name: 'Max Height 0.2', value: ['brickReliefHeight', 0.2] },
    { name: 'Quick set: White Rocks', active: 'brickQuick_set_3' },
    { name: 'Quick pattern: Herringbone', active: 'brickQuick_pattern_herringbone' },
  ],
  bricks: [
    { name: 'Wall bricks painted', kind: 'wall' },
    { name: 'Frame bricks painted', kind: 'frame' },
    { name: 'Brush bricks painted', kind: 'brush' },
  ],
};

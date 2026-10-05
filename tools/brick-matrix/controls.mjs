// The Brick tab's controls, declared once: what each one is EXPECTED to do, end to end.
// tools/brick-matrix/run.mjs drives every entry in the real app (headless Chrome) and checks it.
//
// Fred (2026-10-04): "the brick tab is not really working, none of the params do anything" -- the
// advisor: "make the web matrix a permanent automated test ... so the merge gate runs it".
//
// kind:
//   'editor'    a Brick-tab (editor) control. F35 item 27 (Fred: the editor re-lays AT ONCE, like the sidebar;
//               seat 37, fb-app 9eb45d2): change -> canvas changed at once (read right after the change, NO
//               Generate click, so a setting that waits for Generate fails) -> Apply -> 3D changed? Nothing is
//               ever pending any more.
//   'relay'     Generate itself ("re-lay now"): the canvas is disturbed by hand, Generate must restore exactly
//               the layout the current settings produce
//   'editor3d'  an editor control that is 3D-only ('surface' commit): change -> Apply -> 3D changed?
//   'brush'     a Brush setting (frozen into each stroke at draw time): the SAME stroke drawn before and
//               after the change must differ
//   'sidebar'   a main-sidebar Brick control ('auto' commit): change -> canvas? -> 3D? (no Generate)
//   'stripe'    a Stripe-panel brick-style pick: a fresh brush stroke is striped (count 4), then the pick
//               must re-style the striped runs at once (canvas), never pending
//   'opens'     a main-sidebar button that opens the editor: expect { tab } = the editor tab it must open on
//               (seat 37, turn 207); the row closes the editor again (Apply), or with `closeWith` (a control that
//               must close it, e.g. the [2D|3D] pill's 3D)
// introducedBy: the commit that added the control -- on a build without it the row is SKIPPED, not failed.
// tool:   the Brick tool that must be active for an 'editor'/'editor3d' row (its settings section shows)
// do:     { click: id } | { set: id, value, event }   (event: 'input' | 'change')
// expect: { pending, canvas, threeD }: true / false = must / must not change; null = not checked.
//   commit: 'at once' -- the canvas is read straight after the change (no Generate click).
//   reads: { <input id>: <number> } -- after the change that field reads that value (seat 37 fb-app 1404b72: the
//     Grout width shows the selected element's joint, its set's declared grout.widthIn unless changed)
//   sets: { <brick kind>: <set id> } -- after the change every brick of that kind carries that data-brick-set
//     (item 23, seat 37 fb-app 40c4bdf: the set is per element; a Fieldstone wall or band lays the rock set).
// group: run the row in another group than its tool's own (it needs that group's state).
// requires: { control, satisfied, why } -- the setting only has an effect while ANOTHER control is in a
//   given state (satisfied: { gt: n } on a number input's value, or { active: true } on a button). While it
//   is NOT satisfied the control must be greyed out (disabled, tooltip = why) and the row checks exactly that;
//   while it is, the row runs normally. (satisfied: { checked: true } for a checkbox; an unmet control may
//   be hidden instead of greyed out.) (Advisor, 2026-10-04: "a disabled-by-design control isn't a FAIL".)
//   A control the user can change is expected to do something visible -- a row that changes nothing
//   (e.g. Clumping while Suppression is 0) FAILS on purpose: it is a control that "does nothing".
import { BRICK_SETS as BRICK_SETS_DECL } from '../../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
const E = (pending, canvas, threeD) => ({ pending, canvas, threeD });
// the sets' own declared values (the app reads them; so does the matrix -- never a copied number)
const RED_SET = BRICK_SETS_DECL.find((s) => s.layout === 'bond');
const ROCK_SET = BRICK_SETS_DECL.find((s) => s.layout === 'fieldstone');
const AT_ONCE = { commit: 'at once' };
const LAYOUT = { ...E(false, true, true), ...AT_ONCE };       // a 2D layout setting: re-laid at once, new relief (F35 item 27)
const LEVEL = { ...E(false, null, true), ...AT_ONCE };        // a brick level: at once, relief only
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
  // (item 23: the Set row lists the brick sets only -- today just Red Brick -- so it has no row to change;
  // rocks come from the Fieldstone pattern, checked by `sets` below)
  { name: 'Wall pattern: Herringbone', kind: 'editor', tool: 'wall', do: click('brickPattern_herringbone'), expect: LAYOUT },
  { name: 'Wall pattern: Basketweave', kind: 'editor', tool: 'wall', do: click('brickPattern_basketweave'), expect: LAYOUT },
  // T86 item 13 (37, fb-app f85c8d1): Fred's sheet patterns, layouts/sheet-patterns.js
  ...[['stacked_horizontal', 'Stacked horizontal'], ['chevron', 'Chevron'], ['stacked_variation', 'Stacked variation'],
    ['basketweave_variation', 'Basketweave variation'], ['basketweave_stacked', 'Basketweave + stacked']]
    .map(([id, name]) => ({ name: `Wall pattern: ${name}`, kind: 'editor', tool: 'wall', do: click(`brickPattern_${id}`), expect: LAYOUT, introducedBy: 'f85c8d1' })),
  // T86 item 14 (37, fb-app 59550fe): the tiles (Fred's sheet 3); octagon + square last, its ratio chips right after
  ...[['square_grid', 'Square grid'], ['square_diamond', 'Square + diamond'], ['hexagon', 'Hexagon'], ['lozenge', 'Lozenge'],
    ['framed_square', 'Framed square'], ['octagon_square', 'Octagon + square']]
    .map(([id, name]) => ({ name: `Wall pattern: ${name}`, kind: 'editor', tool: 'wall', do: click(`brickPattern_${id}`), expect: LAYOUT, introducedBy: '59550fe' })),
  { name: 'Octagon + square: ratio S', kind: 'editor', tool: 'wall', do: click('brickPatternParam_ratio_0'), expect: LAYOUT, introducedBy: '59550fe' },
  { name: 'Octagon + square: ratio L', kind: 'editor', tool: 'wall', do: click('brickPatternParam_ratio_2'), expect: LAYOUT, introducedBy: '59550fe' },
  { name: 'Wall pattern: Fieldstone', kind: 'editor', tool: 'wall', do: click('brickPattern_fieldstone'), expect: { ...LAYOUT, sets: { wall: 3 }, reads: { brickGroutWidth: ROCK_SET.grout.widthIn } } },
  // per-element joint: the Frame tool shows the frame's own (Red Brick) joint while the wall is rock
  { name: 'Frame tool shows its own joint', kind: 'editor', tool: 'wall', do: click('brickTool_frame'), expect: { ...E(false, false, false), commit: 'at once', reads: { brickGroutWidth: RED_SET.grout.widthIn } }, introducedBy: '1404b72' },
  { name: 'Back to the Wall tool', kind: 'editor', tool: 'wall', do: click('brickTool_wall'), expect: { ...E(false, false, false), commit: 'at once', reads: { brickGroutWidth: ROCK_SET.grout.widthIn } }, introducedBy: '1404b72' },
  // shown only for a fieldstone wall (White Rocks or the Fieldstone pattern) -- hence right after the row above
  { name: 'Large stones 0.6 (Fieldstone)', kind: 'editor', tool: 'wall', do: set('brickLargeStones', 0.6), expect: LAYOUT, introducedBy: '88c7616' },
  // T86 item 25 + 37's a30a605: Coursed rubble picks Set 5 (Grey stone) the way Fieldstone picks Set 3 (after the
  // fieldstone rows: rows run in sequence, and Large stones needs the Fieldstone wall)
  { name: 'Wall pattern: Coursed rubble', kind: 'editor', tool: 'wall', do: click('brickPattern_coursed_rubble'), expect: { ...LAYOUT, sets: { wall: 5 } }, introducedBy: 'a30a605' },
  { name: 'Wall pattern: None', kind: 'editor', tool: 'wall', do: click('brickPattern_none'), expect: LAYOUT },
  { name: 'Wall pattern: Stretcher', kind: 'editor', tool: 'wall', do: click('brickPattern_stretcher'), expect: LAYOUT },
  // T86 item 29 + F35 item 13 (37, fb-app 8d8d3f1): the wall rotation chips; 45 then back to 0 -- `backTo`: this row's
  // canvas and 3D must equal the named row's BEFORE-state (the same lay as before the turn)
  { name: 'Wall rotation 45', kind: 'editor', tool: 'wall', do: click('brickWallRotation_45'), expect: LAYOUT, introducedBy: '8d8d3f1' },
  { name: 'Wall rotation 0 (back)', kind: 'editor', tool: 'wall', do: click('brickWallRotation_0'), expect: { ...LAYOUT, backTo: 'Wall rotation 45' }, introducedBy: '8d8d3f1' },
  // Level (audit v2 N6; item 27): an editor Level change re-lays at once like every editor setting (LEVEL
  // profile: no pending dot, relief changes); the 2D canvas is not checked (a level is height only)
  { name: 'Wall Level +1/8', kind: 'editor', tool: 'wall', do: set('brickLevel_wall', 0.125), expect: LEVEL, introducedBy: '90a1483' },
  { name: 'Wall Level 0', kind: 'editor', tool: 'wall', do: set('brickLevel_wall', 0), expect: LEVEL, introducedBy: '90a1483' },
  // F35 item 15 (seat 37): raised accents on the Wall -- 3D-only (never pending); the 2D shows an outline only
  { name: 'Raised accents: Course bands', kind: 'editor3d', tool: 'wall', do: click('brickAccent_courseBand'), expect: SURFACE, introducedBy: '82f3755' },
  { name: 'Accent level -1/16', kind: 'editor3d', tool: 'wall', do: set('brickAccentLevel', -0.0625), expect: SURFACE, introducedBy: '82f3755' },
  { name: 'Raised accents: None', kind: 'editor3d', tool: 'wall', do: click('brickAccent_none'), expect: SURFACE, introducedBy: '82f3755' },
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
  { name: 'Generate re-lays now (wall)', kind: 'relay', tool: 'wall', do: click('brickGenerate'), expect: { restores: true }, introducedBy: '9eb45d2' },
  // ---- editor, Frame tool
  // item 28: a 3-band stack is reduced to what fits the board; at the 1 in default it keeps only its outer band on
  // T1 7x9 (= the Soldier the frame already has, nothing to see), at 3/4 in it keeps two
  { name: 'Brick size 3/4 (frame group: 3-band fits T1 7x9 from here)', kind: 'editor', tool: 'wall', group: 'frame', do: click('brickSizePreset_quarter3'), expect: LAYOUT },
  { name: 'Frame preset: 3-band', kind: 'editor', tool: 'frame', do: click('brickFramePreset_three_band'), expect: LAYOUT },
  { name: 'Band 1 pattern: Header', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_header'), expect: LAYOUT },
  // item 23: a Fieldstone band makes the whole frame rock (every band); then the per-element rule -- the Frame
  // tool's Set changes the frame only, a rock wall stays rock
  { name: 'Band 1 pattern: Fieldstone', kind: 'editor', tool: 'frame', do: click('brickFrameBandPattern_0_fieldstone'), expect: { ...LAYOUT, sets: { frame: 3 } }, introducedBy: '40c4bdf' },
  { name: 'Wall pattern: Fieldstone (frame group)', kind: 'editor', tool: 'wall', group: 'frame', do: click('brickPattern_fieldstone'), expect: { ...LAYOUT, sets: { wall: 3 } }, introducedBy: '40c4bdf' },
  { name: 'Frame Set: Red Brick, the rock wall stays', kind: 'editor', tool: 'frame', do: click('brickSet_1'), expect: { ...LAYOUT, sets: { frame: 1, wall: 3 } }, introducedBy: '40c4bdf' },
  { name: 'Frame offset distance 0.25', kind: 'editor', tool: 'frame', do: set('brickFrameOffsetDistance', 0.25), expect: LAYOUT },
  { name: 'Frame offset off', kind: 'editor', tool: 'frame', do: click('brickFrameOffsetOn'), expect: LAYOUT },
  { name: 'Frame offset on', kind: 'editor', tool: 'frame', do: click('brickFrameOffsetOn'), expect: LAYOUT },
  { name: 'Frame Level -1/8', kind: 'editor', tool: 'frame', do: set('brickLevel_frame', -0.125), expect: LEVEL, introducedBy: '90a1483' },
  { name: 'Frame Level 0', kind: 'editor', tool: 'frame', do: set('brickLevel_frame', 0), expect: LEVEL, introducedBy: '90a1483' },
  { name: 'Frame preset: None', kind: 'editor', tool: 'frame', do: click('brickFramePreset_none'), expect: LAYOUT },
  { name: 'Frame preset: Soldier', kind: 'editor', tool: 'frame', do: click('brickFramePreset_single_soldier'), expect: LAYOUT },
  // ---- Brush settings (new strokes)
  { name: 'Brush profile: Continuous', kind: 'brush', do: click('brickBtnProfileContinuous'), expect: E(false, true, null) },
  { name: 'Brush orientation: Soldier', kind: 'brush', do: click('brickBtnOrientationSoldier'), expect: E(false, true, null) },
  { name: 'Brush profile: Stripped', kind: 'brush', do: click('brickBtnProfileStripped'), expect: E(false, true, null) },
  { name: 'Brush preset: 2-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_2_running'), expect: E(false, true, null) },
  { name: 'Brush preset: 1-wide', kind: 'brush', do: click('brickBrushPreset_stretcher_1'), expect: E(false, true, null) },
  // F35 item 16 (seat 37): the Raised brush -- its Level lifts each new stroke's bricks (data-brick-height-offset);
  // its Grout mode waits for the engine's groutCut (main/brick-control-requires.js hides it until then)
  { name: 'Raised brush level 1/8', kind: 'brush', tool: 'raisedBrush', do: set('brickRaisedLevel', 0.125, 'input'), expect: E(false, true, null), introducedBy: '0f45668' },
  { name: 'Raised brush mode: Grout', kind: 'brush', tool: 'raisedBrush', do: click('brickRaisedMode_grout'), expect: E(false, true, null), introducedBy: '0f45668' },
  // ---- Stripe panel brick-style picks (seat 37, fb-app 702876d)
  { name: 'Stripe A: White continuous', kind: 'stripe', do: click('stripeBrickStyle_A_white_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe B: Red continuous', kind: 'stripe', do: click('stripeBrickStyle_B_red_continuous'), expect: STRIPE, introducedBy: '702876d' },
  { name: 'Stripe C: White bricks', kind: 'stripe', do: click('stripeBrickStyle_C_white_bricks'), expect: STRIPE, introducedBy: '702876d', requires: NEEDS_THREE_STYLES },
  // ---- main sidebar
  // (item 23: the quick Set row lists the brick sets only -- one choice today, nothing to change)
  { name: 'Quick size: 1-1/2', kind: 'sidebar', do: click('brickQuick_size_half1'), expect: AUTO },
  { name: 'Quick size: 3/4', kind: 'sidebar', do: click('brickQuick_size_quarter3'), expect: AUTO },
  { name: 'Quick pattern: Herringbone', kind: 'sidebar', do: click('brickQuick_pattern_herringbone'), expect: AUTO },
  { name: 'Quick frame bands: 3-band', kind: 'sidebar', do: click('brickQuick_frameBands_three_band'), expect: AUTO },
  { name: 'Relief: Carved', kind: 'sidebar', do: click('brickBtnReliefCarved'), expect: SURFACE },
  { name: 'Relief: Raised', kind: 'sidebar', do: click('brickBtnReliefRaised'), expect: SURFACE },
  // turn 207: a new board starts Flat + Recessed (core/state.js), so each pair first moves AWAY from the default
  { name: 'Brick top: Organic', kind: 'sidebar', do: click('brickBtnTopOrganic'), expect: SURFACE },
  { name: 'Brick top: Flat', kind: 'sidebar', do: click('brickBtnTopFlat'), expect: SURFACE },
  { name: 'Surface: Weathered', kind: 'sidebar', do: click('brickSurfaceStyle_weathered'), expect: SURFACE },
  { name: 'Wear 0.9 (Weathered)', kind: 'sidebar', do: set('brickSurfaceWear', 0.9), expect: SURFACE },
  { name: 'Surface: Clean', kind: 'sidebar', do: click('brickSurfaceStyle_clean'), expect: SURFACE },
  { name: 'Max Height 0.2', kind: 'sidebar', do: set('brickReliefHeight', 0.2), expect: SURFACE },
  { name: 'Grout: Flush', kind: 'sidebar', do: click('brickBtnGroutFlush'), expect: SURFACE },
  { name: 'Grout depth 0.05 (Flush)', kind: 'sidebar', do: set('brickGroutDepth', 0.05), expect: SURFACE, requires: NEEDS_RECESSED },
  { name: 'Grout: Recessed', kind: 'sidebar', do: click('brickBtnGroutRecessed'), expect: SURFACE },
  { name: 'Grout depth 0.1 (Recessed)', kind: 'sidebar', do: set('brickGroutDepth', 0.1), expect: SURFACE, requires: NEEDS_RECESSED },
  { name: 'Hide filter texture', kind: 'sidebar', do: click('isolateSkeleton'), expect: SURFACE },
  // turn 207 (Fred): the BRICK section's "Brick editor" button opens the editor on the Brick tab
  { name: 'Brick editor button', kind: 'opens', do: click('btnEditBricks'), expect: { tab: 'brick' }, introducedBy: '979ada1' },
  // F35 item 25: the viewport's [2D] opens the editor on the last-used tab (Brick: the row above left it there),
  // the editor's [3D] closes it again (Apply, or just close when nothing changed)
  { name: 'Viewport 2D / 3D pill', kind: 'opens', do: click('viewMode_2d'), expect: { tab: 'brick' }, closeWith: 'viewMode_3d_editor', introducedBy: '3447e95' },
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
    // a board-fact rule (requires.fact, e.g. 'bricksLaid') names no control to copy: the page judges it
    // (run.mjs appRule -> the app's requirementMet) and the matrix always runs on a laid board
    if (decl && decl.requires.control) row.requires = { control: decl.requires.control, satisfied: decl.requires.satisfied, why: decl.why };
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
// T86 item 14 (37, fb-app 59550fe): a pattern's parameter chip is saved with the board (P.brickSettings.patternParams)
export const PATTERN_PARAM_PERSIST = { pattern: 'brickPattern_octagon_square', chip: 'brickPatternParam_ratio_2', introducedBy: '59550fe' };

export const PERSIST_BOARD = {
  setup: [
    { tool: 'wall' }, click('brickPattern_fieldstone'), click('brickSizePreset_quarter3'),
    set('brickLevel_wall', 0.0625), click('brickGenerate'),
    { tool: 'frame' }, click('brickFramePreset_three_band'), click('brickGenerate'),
    { tool: 'brush' }, { stroke: [[0.3, 0.45], [0.7, 0.45]] },
    { apply: true },
    { sidebar: true }, click('brickSurfaceStyle_weathered'), set('brickReliefHeight', 0.2),
  ],
  panel: [
    { name: 'Wall pattern: Fieldstone', active: 'brickPattern_fieldstone' },
    { name: 'Brick size 0.75', value: ['brickSize', 0.75] },
    { name: 'Wall Level 1/16', value: ['brickLevel_wall', 0.0625] },
    { name: 'Frame preset: 3-band', active: 'brickFramePreset_three_band' },
    { name: 'Surface: Weathered', active: 'brickSurfaceStyle_weathered' },
    { name: 'Max Height 0.2', value: ['brickReliefHeight', 0.2] },
    { name: 'Quick pattern: Fieldstone', active: 'brickQuick_pattern_fieldstone' },
  ],
  bricks: [
    { name: 'Wall bricks painted', kind: 'wall' },
    { name: 'Frame bricks painted', kind: 'frame' },
    { name: 'Brush bricks painted', kind: 'brush' },
  ],
};

// ---- layout (Fred, live: "Wall is missing the generate button"): in the drawer layout (phone, or a Fusion
// palette docked narrower than editor/breakpoints.js MOBILE_MAX_PX) the drawer opens at PEEK height; the
// tool's Generate must still show IN FULL there. One row per viewport x tool.
export const PEEK_LAYOUT = {
  viewports: [
    { name: 'phone 390x844', width: 390, height: 844, mobile: true },
    { name: 'palette 700x850', width: 700, height: 850, mobile: false },
    { name: 'palette 880x850', width: 880, height: 850, mobile: false },
  ],
  tools: ['wall', 'frame'],
  element: 'brickGenerate',
};

// ---- Clear menu (F35 item 28; seat 37 fb-app 678c746). The editor header's Clear opens a menu: All / Frame /
// Artwork / Photo / Bricks. Answers declared by the advisor (2026-10-04): Clear Frame removes the frame SHAPE only
// (template -> Rectangle) and the frame/wall bricks re-lay on the rectangle at once; Clear Bricks removes every
// brick element and nulls the laid key; Clear All resets everything incl. the template and the photo; ONE undo
// restores everything a Clear removed. Each row seeds a board holding all four kinds, uses the option from the
// tab that owns its kind, then checks: every `clears` kind is empty, every `changes` kind is still present (it
// may differ), every other kind is byte-identical; then one Ctrl+Z must bring every kind back.
//   kinds:   how each kind is fingerprinted in the page -- see run.mjs CLEAR_PROBE (frame: P.frame; artwork: the
//            sketch children on non-Bricks layers; photo: P.photoImageDataUrl / photoEdits / photoPatternId;
//            bricks: [data-brick-gen="1"] + the wall/frame records <g data-brick-record> (item 22, seat 37
//            fb-app 8fe50e2: the old shared layer key brickLaidKey is retired; records are hidden <g>s, never art)
export const CLEAR_MENU = {
  button: 'editorClear',
  confirmOk: '.pm-prompt-ok',
  seed: { photoFile: 'b-spline-gen/html/assets/logo-64.png', stroke: [[0.35, 0.4], [0.5, 0.55], [0.65, 0.4]] },
  options: [
    { name: 'Clear All', item: 'editorClear_all', tab: 'editorTabArtwork', confirm: 'ok', clears: ['frame', 'artwork', 'photo', 'bricks'], changes: [] },
    { name: 'Clear All, then Keep', item: 'editorClear_all', tab: 'editorTabArtwork', confirm: 'keep', clears: [], changes: [], undo: false },
    { name: 'Clear Frame', item: 'editorClear_frame', tab: 'editorTabFrame', clears: ['frame'], changes: ['bricks'] },
    { name: 'Clear Artwork', item: 'editorClear_artwork', tab: 'editorTabArtwork', clears: ['artwork'], changes: [] },
    { name: 'Clear Photo', item: 'editorClear_photo', tab: 'editorTabPhoto', clears: ['photo'], changes: [] },
    { name: 'Clear Bricks', item: 'editorClear_bricks', tab: 'editorTabBrick', clears: ['bricks'], changes: [] },
  ],
  introducedBy: '678c746',
};

// ---- lay warnings (seat 37, audit B1, fb-app dd5a59c): bands that cover the whole board leave no room for the
// wall -- the app says so, and the wall comes back when the bands fit again (before the fix it never did).
export const LAY_WARNING = {
  template: 'template_9',
  // item 28: a stack too deep for the board is reduced first, so "no room for the wall" is now a board too narrow
  // for even ONE band: T9 7x9 at 1-1/2 in (measured: no wall; at 3/4 in a 146-brick wall)
  tooManySize: 'brickSizePreset_half1',
  fitsSize: 'brickSizePreset_quarter3',
  tooMany: 'brickQuick_frameBands_three_band',
  fits: 'brickQuick_frameBands_single_soldier',
  notes: { sidebar: 'brickLayWarnings', editor: 'brickEditorLayWarnings' },
  text: 'no room for the wall', // a stable part of "The frame bands cover the whole board -- no room for the wall: ..."
  introducedBy: 'dd5a59c',
};

// ---- bands reduced to fit (T86 item 28 engine `bandsReduced`; F35 item 35 note, seat 37 fb-app 21a1ffd): on T1 7x9
// at the 1.25 in default, 3-band keeps 1 band -- the wall stays, the note says so, the dropped bands' rows are disabled.
export const BANDS_NOTE = {
  template: 'template_1', tooDeep: 'brickFramePreset_three_band', fits: 'brickFramePreset_single_soldier',
  note: 'brickFrameBandsNote', text: 'Bands reduced to fit the board: 1 of 3 laid.', dropped: '[data-band-dropped="1"]',
  emptyWarning: 'brickEditorLayWarnings', introducedBy: '21a1ffd',
};

// ---- Select (item 22 slice 1, seat 37 fb-app 2482482): picking a Wall/Frame element in the Brick tab.
export const SELECT_ELEMENT = {
  wallTool: 'brickTool_wall',
  selectMode: 'brickElementSelect',
  wallSelect: 'brickSubTool_wall_select', wallArea: 'brickSubTool_wall_area', // area is hidden until 'wallRegion'
  frameTool: 'brickTool_frame',
  frameLabel: { id: 'brickElementLabel_frame', text: 'Editing: this Frame' },
  introducedBy: '2482482',
};

// ---- migration (item 22, seat 37 fb-app 8fe50e2): a board saved BEFORE item 22 (a Bricks layer with the shared
// brickLaidKey, no records) restores migrated in place. fixtures/pre-item22-board.splineGenLastSession.json is seat 37's
// raw localStorage['splineGenLastSession'] saved at b75e836~1 (T1 7x9, Wall + Frame, Red Brick, Applied): 99 wall +
// 106 frame bricks, no records.
// ---- group setup pins (advisor, 2026-10-05): what a group's rows depend on is declared, never the new-board default.
// The frame group's rows were measured at 1 in; the default moving to 1.25 in (37, 124b799) made T1 7x9 three soldier
// bands fill the board (B1's empty wall) and failed "Frame Set: Red Brick, the rock wall stays" -- a default leaking
// into a fixture, the same class as MIGRATION's neutral set. Applied when the group runs on its own (--parallel = the
// gate); an all-groups run shares one baseline with the wall group's own size rows, so it is left as is.
export const GROUP_SETUP = {
  frame: [{ set: 'brickSize', value: 1, event: 'change', why: 'the frame rows were measured at 1 in' }],
  // T86 item 28: frame-ui accents band 1 of three_band after its rock-frame row, so three ROCK rings (0.75 + 0.6 +
  // 0.75 in, declared widths that no brick size changes). On a 7x9 the fit rule keeps one ring at a 1/3 share; on a
  // 9x12 two fit under 1/3 and 1/2 alike (T1's narrowest gap 4.96 in). runFrameUi's own reload keeps the board.
  'frame-ui': [
    { set: 'widthIn', value: 9, event: 'change', why: 'band 1 of three rock rings exists on a 9x12 board' },
    { set: 'heightIn', value: 12, event: 'change', why: 'band 1 of three rock rings exists on a 9x12 board' },
  ],
};

// ---- bricks on layers (F35 item 22 slice 3, seat 37 fb-app bb9e664): Wall / Frame / Brush land on the ACTIVE layer
// beside art (a fresh board gets no Bricks layer); a brick element moves with "Move to layer"; a layer's carve covers
// its bricks; Clear Bricks / Clear Artwork split by node, not by layer. 37's seven rows (run.mjs runBrickLayers).
export const BRICK_LAYERS = {
  addLayer: 'editorAddLayer', wallTool: 'brickTool_wall', selectTool: 'toolSelect',
  menuMove: 'Move to layer', menuNewLayer: 'New layer…', // the context menu's own labels (editor-context-menu.js)
  carveButton: '.layer-carve', framePreset: 'brickFramePreset_none', // a frame change that always leaves a wall
  artworkTab: 'editorTabArtwork',
  clears: CLEAR_MENU.options.filter((o) => o.item === 'editorClear_bricks' || o.item === 'editorClear_artwork'),
  stroke: [[0.3, 0.5], [0.5, 0.56], [0.7, 0.5]],
  introducedBy: 'bb9e664',
};

// ---- wall areas (F35 item 22 slice 2, seat 37 fb-app 58be3ed, on T86 18b/18c): the Area brush paints walls of whole
// bricks, newest first. 37's measured scenario on T1 7x9 (wall + Soldier frame); points in board inches.
export const WALL_AREAS = {
  template: 'template_1', areaTool: 'brickSubTool_wall_area', selectTool: 'brickSubTool_wall_select', clearAreas: 'brickWallAreasClear',
  wallLabel: { id: 'brickElementLabel_wall', text: 'Editing: this Wall' },
  strokes: [
    { pattern: 'brickPattern_stretcher', width: 'brickWallAreaWidth_2', points: [[2.2, 2.4], [4.6, 5.0]] },
    { pattern: 'brickPattern_herringbone', width: 'brickWallAreaWidth_2', points: [[4.8, 2.4], [2.2, 5.2]] },
    { pattern: 'brickPattern_stack', width: 'brickWallAreaWidth_1', points: [[3.5, 6.4], [3.5, 8.9]] },
  ],
  introducedBy: '58be3ed',
};

export const MIGRATION = {
  fixture: 'fixtures/pre-item22-board.splineGenLastSession.json', sessionKey: 'splineGenLastSession', wall: 99, frame: 106,
  setGroutWidthIn: RED_SET.grout.widthIn, // the fixture's wall/frame are Red Brick: groutByElement null = this
  // settings fields added since the fixture was saved, at the value that lays exactly as before. The migrated key
  // carries them, the old one did not. A value is: 'empty' (an empty list), an object/array (that exact value), or a
  // plain value every leaf must equal. Advisor: a commit adding a persisted brick field adds its neutral here too.
  neutralNewFields: {
    groutByElement: null, rusticByElement: 0, // per-element grout / rustic (37: 1404b72 / item 29)
    userPatterns: 'empty', // the pattern builder (b91d0f6)
    frameBandAccents: 'empty', brushAccent: { preset: 'none', levelIn: 0.0625, clicks: [] }, // per-element accents (ed618f3)
    frameCorner: null, // the Frame's corner pick (f0e3728): null = the preset's own
    patternParams: {}, // a pattern's declared params, per pattern (37: F35 item 14); {} = every pattern's defaults
    wallRotationDeg: 0, // the Wall pattern's rotation (37: F35 item 13); 0 = as laid
    wallAreaWidthIn: 1, // the Area brush's width (37: F35 item 22 slice 2); strokes only, never a lay
  },
  introducedBy: 'b75e836',
};

// ---- the password to save (item 34, seat 37 fb-app 68feae7): every cloud WRITE carries `Authorization: Bearer <pw>`;
// the worker answers 401 to a wrong one. The matrix's cloud stand-in (run.mjs CLOUD_STAND_IN) mirrors that contract
// with this declared test password -- never a real one.
export const EDIT_PASSWORD_TEST = {
  password: 'brick-matrix-test-password', storageKey: 'bspline.editPassword',
  askTitle: 'Password to save', retryTitle: 'Wrong password -- try again',
  statusSaved: 'Saved on this device.', statusUnsetStarts: 'Not set',
  introducedBy: '68feae7',
};

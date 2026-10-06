// The Brick tab's controls, declared once: what each one is EXPECTED to do, end to end.
// tools/brick-matrix/run.mjs drives every entry in the real app (headless Chrome) and checks it. One module per group
// (groups/<group>.mjs: its rows, constants, runner), indexed by groups/index.mjs; this file holds the row helpers.
//
// Fred (2026-10-04): "the brick tab is not really working, none of the params do anything" -- the
// advisor: "make the web matrix a permanent automated test ... so the merge gate runs it".
//
// kind:
//   'editor'    a Brick-tab (editor) control. F35 item 27 (Fred: the editor re-lays AT ONCE, like the sidebar;
//               seat 37, fb-app 9eb45d2): change -> canvas changed at once (read right after the change, NO
//               Generate click, so a setting that waits for Generate fails) -> Apply -> 3D changed? Nothing is
//               ever pending any more.
//   'relay'     Generate itself ("re-lay now"; item 39: with a new seed, expect.newSeed): the canvas is disturbed by hand, Generate must restore exactly
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
// group: the row lives in another group's file than its tool's own (it needs that group's state); it must name the
//   file it is in (groups/index.mjs checks).
// requires: { control, satisfied, why } -- the setting only has an effect while ANOTHER control is in a
//   given state (satisfied: { gt: n } on a number input's value, or { active: true } on a button). While it
//   is NOT satisfied the control must be greyed out (disabled, tooltip = why) and the row checks exactly that;
//   while it is, the row runs normally. (satisfied: { checked: true } for a checkbox; an unmet control may
//   be hidden instead of greyed out.) (Advisor, 2026-10-04: "a disabled-by-design control isn't a FAIL".)
//   A control the user can change is expected to do something visible -- a row that changes nothing
//   (e.g. Clumping while Suppression is 0) FAILS on purpose: it is a control that "does nothing".
import { BRICK_SETS as BRICK_SETS_DECL } from '../../../bspline-frame-builder/b-spline-gen/html/core/bricks/library.js';
export const E = (pending, canvas, threeD) => ({ pending, canvas, threeD });
// the sets' own declared values (the app reads them; so does the matrix -- never a copied number)
export const RED_SET = BRICK_SETS_DECL.find((s) => s.layout === 'bond');
export const ROCK_SET = BRICK_SETS_DECL.find((s) => s.layout === 'fieldstone');
export const AT_ONCE = { commit: 'at once' };
export const LAYOUT = { ...E(false, true, true), ...AT_ONCE };       // a 2D layout setting: re-laid at once, new relief (F35 item 27)
export const LEVEL = { ...E(false, null, true), ...AT_ONCE };        // a brick level: at once, relief only
export const SURFACE = E(false, null, true);    // a 3D-only setting: never pending, new relief
export const AUTO = E(false, true, true);       // a sidebar quick setting: re-lays at once
export const click = (id) => ({ click: id });
export const NEEDS_SUPPRESSION = { control: 'brickSuppression', satisfied: { gt: 0 }, why: 'Clumping only shapes which bricks Suppression removes -- it has no effect at Suppression 0' };
export const NEEDS_THREE_STYLES = { control: 'stripeThree', satisfied: { checked: true }, why: 'Style C only exists when the stripe uses three styles' };
export const STRIPE = E(false, true, null);
export const NEEDS_RECESSED = { control: 'brickBtnGroutRecessed', satisfied: { active: true }, why: 'Grout depth is the recess depth -- it has no effect while the grout is Flush' };
export const set = (id, value, event = 'change') => ({ set: id, value, event });

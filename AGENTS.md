# Rules for coding agents working in this repo

Read this before changing anything. It applies to every agent (Claude seats, Antigravity/Gemini, any other).

## 1. Never push to `main`

`main` auto-deploys the live website (bspline-generator.pages.dev) and the Cloudflare worker. Work on a branch,
push the branch, and hand it to the advisor, who runs the merge gate (full vitest + pytest + the brick-matrix
browser checks) and merges. When you hand it over, name the tier: `tier: groups <matrix groups your change
touches>` or `tier: full`.

## 2. Declare, don't hand-roll

Behaviour lives in declared data tables, read by one mechanism each. Extend the table; don't add a second
mechanism next to it. Existing ones to reuse:

- pickers: `main/icon-select.js` (`mountIconSelect`, `mountIconGrid`, `PICKER_TILE`). Never hand-build a popover.
- frame presets / bands / motifs: `core/bricks/library.js` (`FRAME_PRESETS`, `withBestSize`, `withArch`,
  `BAND_MOTIFS`, `RELIEF_LEVELS`).
- sidebar: `main/sidebar-tabs.js` `SIDEBAR_TABS` + `SECTION_THEMES`. A new sidebar panel MUST be declared there.
- labels: `core/frame-labels.js`. Loading stages: `withLoadingStage` / `PARAM_STAGES`.

## 3. Saved boards must not change

A saved project must lay, carve and look exactly as before. Any change to a default or to how a preset lays
ships with a declared entry in `MIGRATIONS` and a hash pin test. Never rewrite a loaded board's settings in an
event handler.

## 4. Tests

A new test must FAIL on the code before your change (real assertions on real app shapes, not tautologies or
restated tables). Run the touched test files and the full `npx vitest run` before handing over.

## 5. Owner decisions already made (don't reverse them silently)

- Wood-frame "families" SUGGEST presets (fitting ones first / marked); they never hide a preset.
- Never resize the user's board without an explicit value or the user's yes.
- Phone first: 390 px wide, touch targets >= 28 px on a coarse pointer, and a loading card before any long work.

Ask the owner before adding any clamp, guard or validation rule.

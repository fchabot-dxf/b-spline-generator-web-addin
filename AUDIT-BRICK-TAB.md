# Brick tab audit (2026-10-04)

Read-only audit of the editor's Brick tab at origin/main `e6085b8`. Seat 88, for the advisor and Fred.
Nothing was fixed. Every finding was driven in the real app (headless Chrome, real CDP mouse and key
events, default 7x9 board with Template 1). Screenshots are in `~/.bspline-status/shots/seat88/audit_*`.

**Summary:** 4 broken, 11 confusing, 7 cosmetic. Three of the four broken items share one root cause:
brick SETTINGS live outside the editor's undo/commit model, while the brick GEOMETRY lives inside it.

## Already planned (not reported as bugs)

These came up during the walk but are queued work, so they are not findings:

- **Sidebar split (F35 item 18.3):** the main sidebar has no brick controls today. "Hide filter texture"
  is a global terrain-filter setting that lives in the Brick editor tab.
- **Flat/Organic brick tops (18.1) and Weathered (18.2).**
- **Wall/Frame as tools (item 16):** Wall and Frame are one board-wide layout today. The panel is not
  contextual to a selected element, and a drawn brush stroke's settings can't be edited.
- **Icon grids and thumbnails (item 13 + template icon rule):** pattern and preset pickers are text
  buttons today.
- **More patterns and tiles (13/14/15), adaptive mesh (17), real photo surface (5), crumble frame (9),
  send bricks (11/12).**

## Broken

### B1. Cancel then Discard reverts the bricks but not the brick settings
- **Repro:** Brick tab, Wall, Apply. Reopen, Wall pattern Basketweave, Generate. Cancel, Discard.
  Reopen the editor, Brick tab, click Wall.
- **Expected:** the discarded change is gone, both on the canvas and in the panel.
- **Actual:** the canvas correctly shows the old stretcher wall. The panel still highlights Basketweave,
  and Generate shows no pending dot. Clicking Wall to see its settings immediately re-lays the
  discarded basketweave.
- **Suspect:** every brick setting is saved to the session the moment it changes
  (`main/brick-panel.js:63` notifyChange calls saveLastSession). Cancel only discards the editor's
  undo stack (`editor/tools/action-tools.js:91`). Nothing snapshots or restores `P.brickSettings`.
- **Shots:** `audit_s3_01_cancel_modal`, `audit_s3_02_reopen_after_discard`, `audit_s3_03_wall_after_discard`.

### B2. Undo and redo after Generate leave the panel and the pending state wrong
- **Repro:** Wall (stretcher), pattern Herringbone, Generate, Ctrl+Z.
- **Expected:** either the settings follow the undo back to Stretcher, or Generate shows pending
  because the canvas and settings now differ.
- **Actual:** the canvas returns to stretcher. The panel still highlights Herringbone, and Generate
  shows no pending dot. The next Generate silently re-applies herringbone. Redo is the mirror case.
- **Suspect:** the "last laid" record is module memory (`main/brick-panel.js:354` _drawnLayoutKey),
  set by Generate and tool clicks (`:374`). Undo restores the DOM but never this record or the settings.
- **Shot:** `audit_s6_02_after_undo_bricks_invisible` (despite the name, bricks render fine: stretcher
  canvas, Herringbone highlighted, no dot). A first run showed a blank canvas right after Ctrl+Z, but
  it did not reproduce, and the DOM was sound (171 bricks, fill pattern present).

### B3. After reload or reopen, unapplied settings show no pending state
- **Repro:** Wall, Herringbone, Generate, Apply. Reopen, pick Stack (pending dot shows), Apply without
  Generate. Reload the page, reopen the editor, Brick tab, click Wall.
- **Expected:** a pending dot, since the panel says Stack and the canvas shows Herringbone.
- **Actual:** no pending dot. The panel says Stack over a herringbone canvas. Clicking Wall re-lays
  Stack at once, with no Generate press.
- **Suspect:** same root as B2. `_drawnLayoutKey` starts as null after a reload, so nothing is ever
  pending (`main/brick-panel.js:356`). The settings that produced the bricks on the canvas are not
  recorded with them.
- **Shot:** `audit_s2_09_after_reload`.
- **Root cause for B1, B2 and B3:** declare the layout the bricks were laid with ON the Bricks layer
  (persisted in the editor SVG and the undo snapshot), and derive pending, and possibly the panel,
  from it. Today it is inferred from memory, which dies on undo, Cancel and reload.

### B4. Grout Depth does nothing
- **Repro:** Wall tool, Grout Depth 0.05 to 0.2. A pending dot appears. Generate.
- **Expected:** deeper joints in the 3D relief.
- **Actual:** the brick markup and the Bricks layer are byte-identical before and after. No code
  reads `grout.depthIn` from the settings. The only consumers are the declared library defaults.
- **Suspect:** `main/brick-panel.js:444` binds the field. Nothing in `editor/editor-brick-tool.js`,
  `editor/editor-brick-height-mask.js` or `core/bricks/` reads it.
- **Shot:** `audit_s7_B4a_depth_pending`.

## Confusing

### C1. Picking Wall also lays the frame bands, and picking Frame also lays the wall
- **Repro:** fresh board, Brick tab, click Wall: 171 wall + 124 frame bricks appear. The same happens
  with Frame.
- **Also:** Wall's hint says "Fills the whole board with bricks", but the wall is clipped to the frame
  interior whenever a frame exists.
- **Suspect:** one runBricks call draws both kinds (`editor/editor-brick-tool.js:321`, `:339`). The hint
  is at `main/brick-panel.js:46`. Item 16 will restructure this; the hint text is wrong today.
- **Shot:** `audit_s1_02_wall_selected`.

### C2. Clicking a tool icon re-lays at once, which is the only way to reach that tool's settings
- **Repro:** after B1 or B3, click Wall to look at the wall settings.
- **Actual:** the layout re-lays immediately with whatever settings are stored, including discarded or
  unapplied ones. The advisor confirmed tool-click-lays as intended, but combined with B1/B3 it
  resurrects changes the user threw away.
- **Suspect:** `main/brick-panel.js:657` selectTool.
- **Shot:** `audit_s3_03_wall_after_discard`.

### C3. With no tool picked, Generate and the pending dot are hidden
- **Repro:** Wall, change a pattern (pending), press Esc.
- **Actual:** the Layers panel replaces the Brick panel, so Generate and the pending dot disappear. The
  pending change is still there and invisible.
- **Suspect:** `main/brick-panel.js:479` syncEmptySelectionPanel.
- **Shot:** `audit_s1_03_after_esc`.

### C4. Red Brick's grout width differs between first use and re-picking it
- **Repro:** fresh session (grout 0.06 in). Click White Rocks, then Red Brick: grout becomes 0.034 in.
  Generate.
- **Actual:** the layout changes from 171 + 124 to 193 + 136 bricks, though the user is "back on Red".
  The default grout profile is also 'flush' while every set declares 'recessed'.
- **Suspect:** `core/state.js:93` (0.06, flush) vs `core/bricks/library.js:129` (Set 1: 0.034, recessed).
  selectSet copies the set's width (`main/brick-panel.js:81`).
- **Shots:** `audit_s7_C4a_red_initial_grout`, `audit_s7_C4b_red_repicked_grout`.

### C5. Recessed marks pending, but changes nothing
- **Repro:** Grout Recessed, Generate.
- **Actual:** byte-identical bricks. Its tooltip says "not yet visually implemented", but it still
  sets the pending dot and invites a Generate.
- **Suspect:** `main/brick-panel.js:163`. `grout.profile` is never read
  (`editor/editor-brick-tool.js:38` documents the gap).
- **Shot:** `audit_s7_C5_recessed_pending`.

### C6. The Brick tab's Stripe opens Artwork's colour stripe panel
- **Repro:** Brick tab, Stripe tool.
- **Actual:** a middle column opens with Count/Length, Even/Dash, colour swatches A/B/C, and text about
  rails, contour segments and lattices. None of it maps to bricks: runs alternate Red/Stripped and
  White/Continuous by position. The panel also squeezes the canvas.
- **Suspect:** `editor/editor-ui.js:295` shows `#editorStripePanel` by mode. The gap is documented at
  `editor/editor-brick-tool.js:621`, yet F35 item 4(a), brick-style thumbnails, is ticked done.
- **Shot:** `audit_s1_11_stripe_tap`.

### C7. Generate silently re-enables carving on the Bricks layer
- **Repro:** no tool, Layers panel, Bricks row, click "Carved into the relief" to switch carving off.
  Wall, Generate.
- **Actual:** carving is back on. The Bricks row also exposes depth and colour controls that the
  Brick panel owns and overwrites on every Generate.
- **Suspect:** `editor/editor-brick-tool.js:117-126` applyBrickLayerTooling forces carve, depth and
  profile on every run.
- **Shots:** `audit_s7_C7a_carve_off_in_layers`, `audit_s7_C7b_carve_back_on_after_generate`.

### C8. Generating on a hidden Bricks layer gives no feedback
- **Repro:** Layers panel, hide Bricks. Wall, change pattern, Generate.
- **Actual:** the bricks re-lay on the hidden layer, so nothing visible happens.
- **Shot:** `audit_s3_04_generate_hidden_layer`.

### C9. Generate is shown for Brush, Scissors and Stripe, where it never applies
- **Repro:** Brush, draw a stroke, switch to Continuous, Generate.
- **Actual:** nothing changes and there's no feedback. Brush settings only affect new strokes, by
  design, but the big pinned Generate suggests otherwise.
- **Shot:** `audit_s7_C9_generate_with_brush`.

### C10. Brush strokes overlap the wall with no clipping
- **Repro:** Wall laid, then Brush strokes across it.
- **Actual:** brush bricks sit on top of wall bricks, brick over brick. Item 16 declares "later wall
  wins" for walls, but brush-vs-wall isn't covered. This needs Fred's call.
- **Shot:** `audit_s1_08_two_strokes`.

### C11. Mobile: at the drawer's peek height, the pending state is invisible
- **Repro:** 390x844, Brick tab, Wall, change pattern.
- **Actual:** the drawer shows only "BRICK" and the top 10 px of Generate. Tapping the BRICK drawer tab
  doesn't open it; dragging the handle does. Once open, Generate stays pinned and shows the dot
  (`audit_s5m_02_drawer_pending`, `audit_s5m_03_drawer_scrolled`).
- **Shot:** `audit_s4m_04_wall`.

## Cosmetic

- **K1. Narrow number boxes truncate their values.** Max Height shows 0.125 as "0.12"; the box is 38 px
  wide, on desktop and mobile. Grout Width shows Red Brick's 0.034 as "0.03".
  `bspline_gen_palette.html:3189`. Shots `audit_s7_K1_max_height_truncated`, `audit_s7_C4b_red_repicked_grout`.
- **K2. Frame preset None leaves an empty "Band patterns" heading.** `bspline_gen_palette.html:3137`.
  Shot `audit_s1_05_frame_none_generated`.
- **K3. The tool hint sits directly under the Set picker.** "Fills the whole board with bricks." reads
  as describing Red Brick / White Rocks. `bspline_gen_palette.html:3095`. Shot `audit_s1_02_wall_selected`.
- **K4. Stale code comments mislead the next seat.** The slider header still describes live-preview
  plus regenerate-on-release (`main/brick-panel.js:282`). `core/state.js:88` says a set switch resets
  brick length, while selectSet's own comment says it deliberately doesn't.
- **K5. Clear uses the browser's native "Clear all?" confirm, Cancel uses the in-app dialog.**
  `editor/tools/action-tools.js:34`.
- **K6. Scissors and Stripe taps on wall or frame bricks do nothing, silently.** The hints do say
  "Tap a brush stroke".
- **K7. The Bricks layer row reads "Bricks · Flat .13"".** "Flat" is the layer profile, and it will
  collide with the planned Flat/Organic brick-top setting.

## Walked and fine

- Esc from every tool returns to Select and swaps to the Layers panel.
- Tab round trips (Artwork, Frame, Photo) keep the brick tool; Shape Lattice no longer leaks (e6085b8).
- Pending marks and clears correctly for every control, including setting a value back.
- Frame and Wall None presets, size presets, Life 8in, White Rocks, Carved (layer depth −0.125),
  suppression and seed all re-lay correctly on Generate.
- Scissors on a brush stroke splits the spine; pieces regenerate separately once moved, as the hint says.
- Clear empties the canvas. Deleting the Bricks layer and pressing Generate recreates it.
- Apply then reopen keeps the bricks. No page errors or console warnings in any run.

## Not verified

- The Frame tool on a board with no usable frame logs a console warning and gives no UI feedback
  (`main/brick-panel.js:683`). I didn't find a default board without a frame to drive it live.
- 3D/height effects: checked through the Bricks layer and settings that feed the height mask, not by
  measuring the 3D mesh.
- "Frame offset from frame": the Brick Frame bands are always at distance 0 from the frame contour
  (`main/brick-panel.js` resolveFrameGeom). No control exists, so there was nothing to walk.

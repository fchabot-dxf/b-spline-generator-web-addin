# NEXT — SE6: snap-to-grid with a faint, customisable grid in the SVG editor (Fred's ask 2026-09-18)

**Ball: worker (seat A) · epoch 1 · SE6.** Files: NEW `bspline-frame-builder/b-spline-gen/html/editor/editor-grid.js`,
`editor/init.js`, `editor/editor.js`, `editor/editor-interaction.js`, `editor/editor-ui.js` (or `editor-controls.js`,
wherever toolbar groups are wired), `bspline_gen_palette.html` (one new toolbar group), `tests/editor-grid.test.js`
(+ WORK-LOG). One commit by path, predicted **7–8 files**. Seat B idle; nothing else in flight.

## Ground truth
- Snap had a stub (hidden toggle, `_isSnapping`, `_snapSize=2.0`) that nothing could turn on; SE1 removed it and left
  `_snap(pt)` as an identity pass-through (`editor.js:231`) with its two live callers `handleStart` / `handleMove`
  (`editor-interaction.js:249,259`). There is no grid drawn anywhere; the dotted area around the board is the
  container background. The view record + `applyView` (SE2) and `vector-effect` make a zoom-stable grid cheap.
- Layers: `init.js:14-19` creates `bgLayer / sketchLayer / handleLayer / highlightLayer`; `sync3DBackground`
  (`editor-io.js:589-603`) rebuilds `_bgLayer` (image + red border) on every board change. Serialization reads
  `_sketchLayer` only, so a grid layer can never leak into the saved SVG — assert that in WORK-LOG after reading
  `serializeEditor`.
- Existing per-viewer preference pattern: `localStorage` in `editor-ui.js:39-49` (expand callout).

## Build — declare the grid once, derive everything from it
1. **`editor/editor-grid.js` (leaf, no svg.js in the pure parts):**
   - `export const GRID_DEFAULTS = { visible: false, snap: false, spacing: 0.25 }` (inches; the board is in inches).
   - `export const GRID_SPACINGS = [0.0625, 0.125, 0.25, 0.5, 1]` — the customisable choices (the select derives
     its options from this list; no hand-written `<option>`s).
   - `export function snapToGrid(pt, grid, bypass = false)` → `pt` unchanged when `!grid.snap || bypass`, else each
     coordinate rounded to the nearest multiple of `grid.spacing`. Pure.
   - `export function applyGrid(editor)` → clears `editor._gridLayer` and, when `visible`, draws vertical + horizontal
     lines across the board (0..mW, 0..mH, step `spacing`) with `stroke:#000; stroke-width:1; vector-effect:
     non-scaling-stroke; opacity:.10`; every whole-inch line at `opacity:.22` (major/minor from ONE loop, the
     modulo decides). The lines are `pointer-events:none`.
   - `export function loadGridPrefs()` / `saveGridPrefs(grid)` — localStorage key `bsg.editorGrid`, try/catch, merge
     over `GRID_DEFAULTS` so a stale key never yields a half-shaped object.
2. **`init.js`:** add `gridLayer = draw.group().id('grid-layer')` created AFTER bg and BEFORE sketch; return it;
   `editor._gridLayer` set in `initEditor`. `sync3DBackground` must not clear it (it clears `_bgLayer` only — verify).
3. **`editor.js`:** `this._grid = loadGridPrefs()`; `_snap(pt, bypass)` → `snapToGrid(pt, this._grid, bypass)`;
   `setModelMetrics` calls `applyGrid(this)` after the fit (board size changed → redraw); `setGrid(patch)` merges,
   saves prefs, applies, and returns the new grid (one setter for the toolbar).
4. **`editor-interaction.js`:** the two `_snap` callers pass `e.altKey` as the bypass (hold Alt to draw off-grid);
   `handleMove` must not snap while panning (pan branch returns before it — verify order). Snap applies to every mode
   that goes through those two callers (pen anchors, line, rect, circle, select-drag) — say in WORK-LOG which modes
   read the pointer elsewhere (node tool / transform handles use `_getMousePoint` directly at :84/:222 — leave those
   unsnapped this turn, note it).
5. **Toolbar group** in the modal (`bspline_gen_palette.html`, after `#editorStrokeGroup` :1255): `#editorGridGroup`
   with a "GRID" label like the others, two segmented toggles reusing T4's declared `.editor-fillmode-btn` class
   (`#editorGridShow` "SHOW", `#editorGridSnap` "SNAP"; `.active` reflects state) and `<select id="editorGridSpacing">`
   populated from `GRID_SPACINGS` at bind time (labels like `1/4"`; declare the label format in one helper).
   Wire clicks in the same module that wires the stroke group; each handler = `editor.setGrid({...})` + toggle
   `.active`. Add `data-key="g"` to `#editorGridShow` so the SE1 lookup gives `G` = toggle grid for free; `title="Show
   grid (G)"`.
6. Zoom: the grid is drawn in model units, so `applyView` leaves it consistent; `non-scaling-stroke` keeps it 1 px.
   Confirm the modal's editor `<svg>` is not styled with `shape-rendering` that blurs 1 px lines; if lines look
   soft, add `shape-rendering: crispEdges` to the grid lines only.

## Verify
- `tests/editor-grid.test.js`: `snapToGrid` off → identity; on → nearest multiple for both axes (incl. a negative
  coordinate); bypass → identity; `loadGridPrefs` merges a partial stored object over `GRID_DEFAULTS` (mock
  localStorage or inject a storage object — export the pure merge if that is simpler).
- `npx vitest run` → 64 + new, green; `node --check` touched modules + extracted palette scripts.
- Greps: `_snapSize|_isSnapping` → 0; `GRID_SPACINGS` → definition + the select population; `grid-layer` → 1;
  `data-key=` → 10.
- Live (advisor): grid visible at 1/4", major lines at inches, stays 1 px at 8x zoom; pen anchors land on
  intersections with SNAP on; Alt draws off-grid; prefs survive a reopen; saved SVG has no grid lines.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE6: declared grid (GRID_DEFAULTS/GRID_SPACINGS), snapToGrid + Alt bypass, grid layer, toolbar group, prefs — <sha>, N files, vitest N"`
and stop.

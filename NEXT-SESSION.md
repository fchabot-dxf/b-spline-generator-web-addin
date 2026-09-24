# NEXT — SE7a: Lattice tool — rails and ties on the grid; dots are the Circle tool's job (AMENDED 2026-09-23)

**Ball: worker (seat A) · epoch 1 · SE7a.** Files: NEW `bspline-frame-builder/b-spline-gen/html/editor/editor-lattice.js`
(pure lattice math + the emit helpers), `editor/editor-interaction.js` (one new mode handler), `editor/tools/mode-tools.js`,
`bspline_gen_palette.html` (one rail button + one toolbar toggle), `tests/editor-lattice.test.js` (+ WORK-LOG). One commit
by path, predicted **6–7 files**. NOTE: a `.claude/settings.json` permission allowlist now exists in this checkout (git-
ignored) — if your window was open before today, restart it once so prompts stop.

## What Fred wants (photo: a relief with red horizontal rails, yellow vertical ties spanning 1–3 rows, dark nodes at tie
ends and crossings). Everything the tool emits must stay EDITABLE with the existing tools, and carve like anything else.
**Fred's ruling (amend):** the lattice tool does NOT place nodes by click — "isn't Circle enough?" Manual dots are the
Circle tool's job. The lattice tool = rails + ties + auto-nodes. A bare click in lattice mode does nothing.

## Ground truth
- Grid (SE6): `editor._grid = {visible, snap, spacing}` (inches), `snapToGrid`, `applyGrid`, `GRID_SPACINGS`
  (`editor/editor-grid.js`). `_snap(pt, bypass)` is applied in `handleStart`/`handleMove` (`editor-interaction.js:249,259`).
- Drawing modes are a handler table `modeHandlers` (`editor-interaction.js:592-598`) built by `makeDrawingHandler(modeId)`
  (`:410`) — read it for how a shape is created, gets `data-layer`, stroke width/color (`editor._strokeWidth/_strokeColor`,
  `editor.js:74-79`), `pushState()` and `_onChange()`. Circle drawing at `:683/:708`.
- Node tool / transform handles read the pointer through `_getMousePoint` directly (`:84` is the wheel — leave it;
  `:222` is `handleDblClick`; the node-drag path lives in `editor-transform-handles.js` / the node handler) — those do
  NOT snap yet (SE6 follow-up a).

## Build — declare the lattice, emit plain elements
1. **`editor/editor-lattice.js` (leaf):**
   - `export const LATTICE_DEFAULTS = { autoNodes: true, nodeRadiusFactor: 0.2 }` (node radius = factor × spacing);
     `export const LATTICE_ATTR = 'data-lattice'` with values `'rail' | 'tie' | 'node'`.
   - `toLattice(pt, spacing)` → `{i, j}` integer lattice coords (round); `fromLattice({i,j}, spacing)` → `{x,y}`.
   - `classifyDrag(a, b)` (both lattice coords) → `'node'` when equal, `'rail'` when |di| ≥ |dj|, else `'tie'`;
     `constrain(a, b)` → the end point projected onto the dominant axis (so a rail is exactly horizontal, a tie
     exactly vertical). Pure, tested.
   - `latticeCrossings(seg, segs)` → lattice points where an axis-aligned segment crosses others of the OTHER kind
     (rail × tie only), plus its own two endpoints. Pure, tested.
   - `emitSegment(editor, kind, a, b)` → `<line>` with `data-lattice=kind`, current stroke width/color, `data-layer` via
     the same path makeDrawingHandler uses; `emitNode(editor, p)` → `<circle>` (filled, `data-lattice="node"`,
     r = `nodeRadiusFactor × spacing`) unless a node already sits at that lattice point (dedupe by lattice coords —
     `findNodeAt(editor, p)`); `removeNode(editor, p)`.
2. **Mode `lattice`** in the handler table: `start` snaps to the lattice ALWAYS (independent of the SNAP toggle —
   the lattice tool is the grid; use `toLattice/fromLattice` directly, not `_snap`), remembers `a`; `update` draws a
   preview line from `a` to `constrain(a, cursor)` (reuse the drawing-preview element the other modes use);
   `end`: `classifyDrag` → `'node'` (no movement) → do NOTHING (no element, no pushState); rail/tie: `emitSegment`,
   then if `editor._lattice.autoNodes` → `emitNode` at each of `latticeCrossings(newSeg, existing lattice segments)`.
   Drop `removeNode` from the leaf (Delete/Eraser already remove circles); keep `findNodeAt` for the dedupe.
   ONE `pushState()` + ONE `_onChange()` per gesture (not per emitted element) — check how makeDrawingHandler batches.
   `editor._lattice = { ...LATTICE_DEFAULTS }` in the constructor. If the grid is not visible when the tool is
   picked, turn it on (`setGrid({visible:true})`) — the lattice is meaningless invisible.
3. **UI:** rail button after Circle: `<button id="toolLattice" class="tool-btn" title="Lattice (K) — drag along a row =
   rail, along a column = tie, click = node" data-key="k">` (icon: a small ⌗). Toolbar: an `AUTO NODES` toggle button
   in the GRID group (same `.editor-fillmode-btn` class, `.active` = on) that flips `editor._lattice.autoNodes`; show
   it only in lattice mode via `updateToolbarVisibility` like the Font group.
4. **Circle tool = the node tool (amend):** in circle mode with SNAP on, snap the CENTER only — the drag point that
   sets the radius must use the UNSNAPPED pointer (otherwise the smallest circle is one grid cell). And a click with
   no drag (start == end within `_getDynamicTolerance(3)`) emits a default dot through the SAME `emitNode` the
   lattice auto-nodes use (r = `nodeRadiusFactor × spacing` when the grid is on, else `0.09`" — declare
   `DEFAULT_NODE_RADIUS_IN` next to `LATTICE_DEFAULTS`). One emitter, two callers, identical elements.
6. **Snap is a per-tool DECLARATION (amend 2, Fred: "snap could apply to tools that make sense").** Today `_snap`
   is applied blindly in handleStart/handleMove for every mode, which quantises the pen's freehand stroke and the
   eraser — wrong. Replace with one table in `editor/editor-grid.js`:
   `export const SNAP_POLICY = { select:'point', node:'point', draw:'anchors', line:'point', rect:'point',
   circle:'center', text:'point', erase:'none', expand:'none', lattice:'always' }` and one derivation
   `export function snapFor(pt, grid, mode, phase, bypass)` where `phase` is `'start'|'move'` and
   `'anchors'` = snap on start (pen anchor clicks) but never during a freehand drag (`_anchorFreehand`), `'center'` =
   snap on start only, `'always'` = snap even when `grid.snap` is off and ignore Alt, `'none'` = identity. `_snap`
   becomes `_snap(pt, bypass, phase)` reading `this._currentMode`; handleStart passes `'start'`, handleMove `'move'`.
   Items 4 and 5 are then just the `circle` and `node` rows — no special-casing in the handlers. Toolbar: dim the
   SNAP button (`.disabled` class, `pointer-events:none`, opacity .4) when the current mode's policy is `'none'` or
   `'always'`, via `updateToolbarVisibility`, so the user sees where snap applies. Tests: `snapFor` — erase never
   snaps; circle snaps start not move; draw snaps start, not a freehand move; lattice snaps with `grid.snap=false`
   and with bypass=true; line honours Alt bypass. (Add to `tests/editor-grid.test.js` or the new lattice test.)
5. **Node-tool snap (SE6 follow-up a) = the `node:'point'` row of item 6:** route the node-drag pointer read through `editor._snap(pt, e.altKey)` so
   node edits honour SNAP like everything else. Transform handles stay as they are (scaling on-grid is a different
   feature; say so in WORK-LOG).

## Verify
- `tests/editor-lattice.test.js`: `toLattice/fromLattice` round-trip; `classifyDrag` (node / rail / tie, incl. a
  diagonal drag resolving to the dominant axis); `constrain` keeps the dominant coordinate and snaps the other;
  `latticeCrossings` for a tie crossing two rails → 2 crossings + 2 endpoints, no duplicates. ≥ 6 tests.
- `npx vitest run` → 79 + new, green; `node --check` touched modules + extracted palette scripts.
- Greps: `data-key=` → 11; `data-lattice` → only in editor-lattice.js + the handler; `modeHandlers` has `lattice:`.
- Serialization: lattice elements are plain `<line>/<circle>` with an extra data attribute — confirm `serializeEditor`
  keeps data-* (it keeps `data-layer`) and that `getLayerSvg` still rasterizes them (a `<circle>` with fill → a dot).
- Live (advisor): draw two rails, three ties, watch auto nodes appear at ends and crossings; Circle tool + SNAP: a
  click drops a default dot on a lattice point, a drag makes a circle centred on one with a free radius; select +
  move a tie with SNAP on → lands on lattice points; Apply → three kinds carve.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7a: lattice mode (rail/tie), auto-nodes, Circle-as-node-tool, node-tool snap — <sha>, N files, vitest N"`
and stop.

# Open bugs

_Last updated: 2026-05-20_

Context sheet for a fresh debugging session — pick up cold, do not assume the
prior fixes worked. All current entries surfaced during the SVG-editor layers
refactor.

**Index**
- B1. Ctrl+Z erases multiple strokes at a time
- B2. Elements vanish on editor reopen
- B3. Expand tool doesn't work on lines (and possibly other tools)

---

## Bug B1 — Ctrl+Z erases multiple strokes at a time

### Symptom
In the SVG editor, pressing Ctrl+Z (or clicking the sidebar undo button)
removes more than one stroke per press. The user expects each completed pen
stroke / line / shape to be its own undo step.

### Where the code lives
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor.js`
  - `pushState()` — snapshot {svg, layers, activeLayer}
  - `undo()` / `redo()` — pop/push between stacks
  - `_restoreState(state)` — rehydrate sketch + layer roster + active
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-interaction.js`
  - `finishDrawing` ~line 356 — should call `editor.pushState()` once per stroke
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-io.js`
  - `open()` — initial baseline snapshot is now pushed after load

### What was already tried
1. **Rebuilt `pushState` to snapshot {svg, layers, activeLayer}** so the layer
   roster restores too. Per-stroke granularity should be unchanged — each
   `finishDrawing` still fires exactly one pushState. Fix verified syntactically;
   user still sees grouping in Fusion.
2. **Baseline snapshot on `open()`** so the very first user action is reversible
   (the previous code only pushed AFTER user actions, leaving the first stroke
   permanently anchored to the loaded state).
3. **Added `_undoLog` instrumentation** to `pushState` / `undo` / `redo` /
   `_restoreState`, dual-piped to console + `fusLog` (Fusion log file). The
   `caller=` field uses a stack-trace shim (`_shortCaller`) to identify who
   pushed.

### What we DON'T know yet (need to verify from log)
- Whether each stroke produces **exactly one** `[UNDO] pushState  caller=finishDrawing`
  line, or **multiple** (spurious extra pushes from setStrokeColor / something
  in the _onChange chain / etc.).
- Whether each Ctrl+Z press produces **exactly one** `[UNDO] undo  popped`
  followed by `[UNDO] restoreState done` with `children` decremented by 1.

### Diagnostic plan
1. Deploy current code (instrumentation is in `editor.js` and writes to
   `b_spline_gen_log.txt` via `fusLog` regardless of `window.__editorDebug`).
2. In the editor, draw 4 discrete strokes (pen up between each).
3. Press Ctrl+Z four times, slowly.
4. Grep `[UNDO]` from `b_spline_gen_log.txt`. Look at the `caller=` field
   between strokes and the `children=` delta on each undo.

### Files/lines
- `editor.js` ~line 165 — `pushState`
- `editor.js` ~line 195 — `undo` / `redo` / `_restoreState`
- `editor.js` ~line 70 — `_shortCaller` helper
- `editor.js` ~line 28 — `_undoLog` helper

---

## Bug B2 — Layer elements vanish on editor reopen

### Symptom
After drawing elements in the SVG editor, clicking Apply Stencils, and
reopening the editor, the elements that were on layers are no longer visible.
The layers panel may also be empty or incorrect.

### Where the code lives
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-io.js`
  - `save(editor, dpi)` — serializes `_sketchLayer.node.innerHTML`
  - `saveForRasterization(editor, dpi)` — same plus embedded @font-face
  - `open(editor, svgString, w, h)` — parses, injects into `_sketchLayer`,
    calls `_reconcileLayersFromSvg`, sets active layer, pushes baseline
  - `_reconcileLayersFromSvg(editor)` — rebuilds `editor._layers` from
    `data-layer` attrs found on loaded children; orphans (no `data-layer`)
    are stamped onto the first layer
- File: `bspline-frame-builder/b-spline-gen/html/core/svg-utils.js`
  - `stripSvgjsAttributes(svgText)` — only strips `svgjs:*` attrs (verified;
    `data-layer` survives the save→load round trip)
- File: `bspline-frame-builder/b-spline-gen/html/editor/layers.js`
  - `applyLayerState(editor)` — toggles `inactive-layer` (no CSS, just marker)
    and `layer-hidden` (CSS `display:none`) per child based on the layer
    roster's `visible` flag
- File: `bspline-frame-builder/styles/editor.css`
  - `#editorSVGContainer .layer-hidden { display: none; }` (line ~582)
  - `.inactive-layer` — NO styling defined (just a logical marker)

### Hypotheses to verify
- **Saved SVG actually contains the data-layer attrs?** `save()` reads
  `_sketchLayer.node.innerHTML` which should include all attributes. Need to
  dump `P.stampLayers[idx].svg` after Apply to confirm. Possibly the
  `stripSvgjsAttributes` regex over-matches (it only matches `\s+svgjs:*` so
  this is unlikely but worth verifying).
- **`_reconcileLayersFromSvg` finds zero children?** If `_sketchLayer.svg(html)`
  doesn't repopulate `.children()` properly, reconcile early-returns and
  `_layers` stays empty. Elements would still be in the DOM but the layers
  panel would be empty.
- **applyLayerState adds `layer-hidden` incorrectly?** After reconcile,
  every layer is `visible: true`, so `!isVisible` should be false and the
  class should be removed. Unless `toggleClass(name, false)` isn't actually
  removing in this svg.js version.
- **Class `layer-hidden` was serialized into the saved SVG** (because
  applyLayerState had added it during a prior visibility toggle), and even
  though applyLayerState now wants to remove it, removal doesn't reach all
  elements (perhaps `.children()` doesn't include nested elements).
- **The reopen path loads from `currentLayer.svg` which is null** (a save
  was never reached, or it's a different stamp layer index than expected).

### Diagnostic plan
Already wired (current code, ready to deploy):
- `[EDITOR-IO] open() called  svgLen=...` at entry
- `[EDITOR-IO] reconcile: childCount=N`
- `[EDITOR-IO]   child[i] tag=path data-layer="0" class="..."` for first 5 children
- `[EDITOR-IO] reconcile: M orphan(s) -> anchored to layer X`
- `[EDITOR-IO] reconcile done: layers=0,1,2  anchor=0  nextId=3`

Repro: Apply Stencils, close, reopen. Grep `[EDITOR-IO]` in
`b_spline_gen_log.txt`. Confirm svgLen > 0 (save round-trip worked),
childCount > 0 (DOM rehydrated), and at least one data-layer attr survived.

### Files/lines
- `editor-io.js` ~line 12 — `_ioLog` helper
- `editor-io.js` ~line 18 — `_reconcileLayersFromSvg` (with logs)
- `editor-io.js` ~line 200 — `open()` with entry log
- `layers.js` ~line 160 — `applyLayerState`

---

## Bug B3 — Expand tool doesn't work on lines (and possibly other tools)

### Symptom
The "Expand" tool in the SVG editor (the toolbar button + expand pipeline that
turns drawn primitives into thickened stencil geometry) does not work on
`<line>` elements. The user suspects it may also be broken on other element
types beyond freehand paths.

### Where the code lives
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-expand-shape.js`
  - Generic shape expansion (rect, circle, polygon, etc.)
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-expand-text.js`
  - Text-specific expansion via opentype.js
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-expand-trace.js`
  - Trace expansion (freehand strokes → outlined regions)
- File: `bspline-frame-builder/b-spline-gen/html/editor/editor-expand.js`
  - Likely the entry dispatcher (selects which expand variant runs based on
    element type) — verify this is where the type switch lives

### Hypotheses to verify
- **No `'line'` branch in the expand dispatcher** — the dispatcher likely
  handles `'path'`, `'text'`, etc. but skips `'line'` (the type returned by
  svg.js for `<line>` elements). The fix is either (a) add a line branch
  that converts the line into a 2-segment outline before running the trace
  pipeline, or (b) auto-convert line to path inside the dispatcher.
- **Layer-refactor side effect** — the recent `data-layer` enforcement
  expects every element to have a valid `data-layer` attr that matches a
  layer in `_layers`. If lines were drawn before that change and don't have
  the attr, the expand pipeline might bail early. Already mitigated by
  `_reconcileLayersFromSvg` on load + `ensureActiveLayer` on create — but
  verify that lines drawn through `createDrawingShape(editor, 'line', pt)`
  actually inherit a valid id. (Looked at line 290-293, the line creation
  does set `.attr('data-layer', layer)` where `layer = ensureActiveLayer`, so
  this should be fine in v1+ saves; pre-fix saves may have empty layer attrs.)
- **Expand commit silently no-ops on lines** — the `if (commit && editor.pushState)`
  guard at the end of each expand fires regardless, but the geometry
  transformation might leave the element unchanged for type=line.

### Diagnostic plan
1. Add an `_expandLog` helper at the entry of each expand variant that prints
   `[EXPAND] file=expand-shape  type=<el.type>  data-layer="<el.attr('data-layer')>"`.
2. Repro: draw one line, select it, click Expand. Check which expand variant
   logged. If none did, the dispatcher isn't routing line elements at all.

### Files/lines
- `editor-expand-shape.js` line 37 — type check `el.attr('data-layer')`
- `editor-expand-shape.js` line 49 — commit pushState
- `editor-expand-text.js` line 98, 136
- `editor-expand-trace.js` line 116, 131
- `editor-expand.js` — dispatcher (line numbers TBD)

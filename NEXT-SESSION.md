# NEXT — SE2: SVG editor zoom / pan / fit — the one usability change that matters at the docked 460 px

**Ball: worker (seat A) · epoch 1 · SE2.** Scope: `bspline-frame-builder/b-spline-gen/html/` only —
`editor/editor.js`, `editor/editor-interaction.js`, `bspline_gen_palette.html` (+ a new `editor/editor-view.js` if
you want the view math in its own leaf; recommended, it is unit-testable without svg.js). One commit by path,
predicted **3–4 files**. SE1 (235b8f0) landed and is merged; lane-b's tests are in main (vitest 36, pytest 118).

## Ground truth (advisor, from the code)
- The editor root is `window.SVG().addTo('#editorSVGContainer').size('100%','100%')` (`editor/init.js:14`); the board
  is shown by `setModelMetrics(w,h)` → `this._draw.viewbox(0, 0, w, h)` (`editor.js:352-358`), inches as user units.
  There is **no zoom and no pan** anywhere (`grep 'wheel'` under `editor/` → 0).
- Everything downstream is already viewbox-relative, which is why this is contained: pointer → model goes through
  `editor._draw.point(clientX, clientY)` (`editor-io.js:600`), click slop through `getDynamicTolerance(editor, px)`
  = `px * viewbox.width / #editorSVGContainer.clientWidth` (`editor-hit.js:14`), and the transform handles size
  themselves "in model units, scales with the viewbox" (`editor-transform-handles.js:60-102`). So a smaller viewbox
  = bigger drawing, same on-screen tolerances and handle sizes, for free.
- Pointer entry: `handleStart` (`editor-interaction.js:176`) on `mousedown` of the svg node; `handleMove`; the mode
  handler table `getModeHandler(mode)`.

## Build — DECLARE the view, derive the viewbox
- **One view record on the editor:** `this._view = { zoom: 1, cx: w/2, cy: h/2 }` (zoom 1 = whole board; cx/cy =
  model-space center). **One derivation:** `viewboxFor(view, mW, mH)` → `{x: cx - mW/(2z), y: cy - mH/(2z),
  w: mW/z, h: mH/z}` — a pure function (put it in `editor/editor-view.js`, export it), and one `applyView(editor)`
  that calls `editor._draw.viewbox(...)` from it. `setModelMetrics` resets the view to fit and applies. No other
  code touches `viewbox()` directly.
- **Wheel = zoom about the cursor.** `on(svgNode, 'wheel', …, { passive: false })`: factor `Math.exp(-e.deltaY * 0.0015)`,
  clamp zoom to **[1, 16]** (declare `ZOOM_MIN/ZOOM_MAX` in editor-view.js). Zoom about the cursor: convert the
  pointer to model space BEFORE the change (`_getMousePoint`), update zoom, then shift cx/cy so that model point
  stays under the cursor. `preventDefault()` so the modal body does not scroll.
- **Pan = middle-button drag OR Space + left drag.** In `handleStart`, BEFORE the mode handler: if `e.button === 1`
  or `editor._spaceHeld`, start a pan (remember the client position + view center) and return; move/up complete it
  (`cx -= dxClient * viewbox.w / clientWidth`, same for y). Space: track `_spaceHeld` with keydown/keyup on
  `window` — inside `_handleEditorKeydown` (it already gates on `_isEditorActive` + `_isTypingTarget`); add the
  matching keyup with the same gate; `preventDefault` on Space so the page does not scroll. Cursor: `grab`/`grabbing`
  on the container while Space is held / panning (one CSS class toggle, rules in the modal's style block).
- **Fit** = view reset to `{1, w/2, h/2}`. Add a tool button after the Eraser: `<button id="toolFit" class="tool-btn"
  title="Fit (0)" data-key="0">` with a simple icon (four corner brackets). Bind it in `action-tools.js`
  (`editor.fitView()`). The `data-key` costs nothing extra — SE1's lookup already dispatches it.
- Reopen: `open()` goes through `setModelMetrics` → fit; check it does, and that Apply/Cancel/reopen never leaves a
  stale zoom. Zoom does NOT touch the saved SVG (serialization reads the sketch layer, not the viewbox) — assert that
  in your reading of `editor-io.js` and say so in WORK-LOG.

## Verify
- New `tests/editor-view.test.js` (vitest): `viewboxFor` at zoom 1 = `{0,0,w,h}`; zoom 2 centered = the middle
  quarter; the zoom-about-cursor step keeps the cursor's model point fixed (compute before/after through
  `viewboxFor` + a screen→model map at the test's own clientWidth). Pure math, no svg.js — 3–4 tests.
- `node --check` every touched module + the extracted palette scripts; `npx vitest run` → 36 + new, all green.
- Greps: `viewbox(` under `editor/` → only in `applyView` (+ the unrelated `bakeSvgForCarving` root in editor-io.js);
  `toolFit` → 1 html + 1 binding; `data-key=` → 9.
- `git show --stat HEAD` within the predicted count. Live proof (wheel, Space-drag, middle-drag, Fit, tolerances at
  8x) is the ADVISOR's once Fusion is back; the site build is also a live surface (bspline-generator.pages.dev).

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE2: declared view + wheel zoom + Space/middle pan + Fit — <sha>, N files, vitest N"`
and stop.

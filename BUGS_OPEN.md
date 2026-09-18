# Open bugs

_Last updated: 2026-09-18 (T3 reconciliation, lane-b)_

Context sheet for a fresh debugging session — pick up cold, do not assume the
prior fixes worked. All current entries surfaced during the SVG-editor layers
refactor.

**Index**
- B1. Ctrl+Z erases multiple strokes at a time
- B2. Elements vanish on editor reopen
- B3. Expand tool doesn't work on lines (and possibly other tools)

## T3/T9 reconciliation summary (2026-09-18) — every entry verified against current code

| ID | Status | sha / test |
|----|--------|------------|
| B1 | CLOSED | pre-existing fix (no single sha); re-verified T2 2026-07-11 + lane-b A5b 2026-09-17 |
| B2 | CLOSED (via B6) | `957df31`, guarded by `tests/b6-hidden-layer-save.test.js` |
| B3 | STALE | investigated premise never held; runtime output-correctness still unconfirmed |
| B4 | CLOSED | `6d982ab` (no guard) |
| B5 | CLOSED | `0607eaf` (no guard) |
| B6 | CLOSED | `957df31`, guarded by `tests/b6-hidden-layer-save.test.js` |
| B7 | CLOSED | `c60628b` (no guard) |
| B8 | STALE | `59615fe` de-forked; Fred ruled 2026-09-18 stamp-editor standalone out of scope |
| B9 | CLOSED | `48cee2b` (no guard) |
| B10 | CLOSED | `f0d47ed` (no guard) |
| B11 | CLOSED | `48cee2b` (no guard) — one named P1 exception remains, documented in `ROADMAP.md` |
| B12 | CLOSED | `f46561a`, guarded by `tests/stamp-mask-clear.test.js` |
| B13 | CLOSED | `aeb9a53` + `629102d` (guarded by `tests/export-flow.test.js`); `stampSvgText` removed |
| B14 | CLOSED | `13a2480` (no guard — DOM-bound) |
| B15 | CLOSED | `fa9972a` (no guard — DOM-bound); advisor live-verified 2026-09-18 |

Per-entry detail (evidence, reasoning) is inline as a status line under each heading below. Original
entry text is preserved unchanged beneath each status line — this is a reconciliation, not a rewrite.

---

## Bug B1 — Ctrl+Z erases multiple strokes at a time

> **STATUS (T3, 2026-09-18): CLOSED — pre-existing fix, no single attributable sha.** The historic
> cause (svg.js's `toggleClass(name, force)` ignoring the `force` arg) was already fixed via explicit
> `addClass`/`removeClass` in `editor/layers.js` by the time this bug was first investigated (T2,
> 2026-07-11) — the fix predates organized bug tracking, so there is no clean single commit to cite.
> Verified TWICE against current code: T2's full `pushState` call-site trace (2026-07-11, one site:
> `finishDrawing`), and lane-b's own re-trace in A5b (2026-09-17) after the mechanism grew to 20
> `pushState()` call sites across the editor — the 4 in `editor-interaction.js` (the file this bug
> concerns) map to 4 distinct, non-overlapping gestures; none double-fire for one stroke. **No
> regression test exists.** A guard would assert: draw one stroke via `finishDrawing`, confirm exactly
> one `pushState()` call. Runtime confirmation in the actual Fusion CEF host was never performed by a
> human (T2's own caveat, still true).

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

> **STATUS (T3, 2026-09-18): CLOSED, via B6's fix.** T2 (2026-07-11) already resolved every original
> hypothesis for VISIBLE layers (the save/reopen round-trip is clean) and identified the one concrete,
> reproducible disappearance mechanism as B6 (`_visibleContent` dropping hidden-layer geometry at
> save). B6 is now fixed (`957df31`, `serializeEditor` keeps all layers regardless of visibility) and
> guarded by `tests/b6-hidden-layer-save.test.js` (lane-b T1, 2026-09-17). Since B2's only confirmed
> mechanism was B6, B2 closes with it — there is no other identified cause left open.

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

> **STATUS (T3, 2026-09-18): STALE — the investigated premise never held.** `OPEN_SHAPES = ['path',
> 'polyline', 'line']` in `editor/editor-expand-shape.js:42` already includes `'line'` — confirmed
> unchanged in TWO independent reads (T2, 2026-07-11, then `:41`; lane-b A5b, 2026-09-17, now `:42`,
> same content, one-line shift). The "no line branch in the dispatcher" hypothesis this bug was filed
> against is false and was already known false at investigation time. **Separate, still-unresolved
> question, not the same claim as "still buggy":** whether Expand's OUTPUT is geometrically correct
> for a `<line>` in the real Fusion CEF host has never been confirmed by a human — this needs a runtime
> check, not a code fix, and nothing in this reconciliation resolves that half.

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

---
---

# T2 — Bug & principle scout (2026-07-11)

Read-only sweep against `ARCHITECTURE.md`'s two seams + the ROADMAP principles.
Paths relative to `bspline-frame-builder/`. Verdicts on B1–B3 are appended (the
original entries above are unchanged). New findings B4–B11 ranked most-severe
first. Every claim was verified against source (not just the survey agents).

Principle key: **P1** one-frontend/host-logic-only-in-bridge · **P2** clean
hot-reload lifecycle · **P3** isolated sub-modules · **P4** declare-over-hand-roll.

## Verdicts on the 3 existing bugs

| Bug | Verdict (2026-07-11) | Evidence |
|-----|----------------------|----------|
| **B1** Ctrl+Z multi-erase | **likely-FIXED** (confirm at runtime) | Exactly one `pushState` per stroke — all callers of `pushState` traced; `finishDrawing` (`b-spline-gen/html/editor/editor-interaction.js:639`) is the sole per-stroke push and its side-effects (`_select`, `applyLayerState`) don't push. One pop per `undo()` (`editor/editor.js:266-276`). The historic cause is documented AND resolved in code: svg.js `toggleClass(name,force)` ignored the force arg, so a second `applyLayerState` flipped `layer-hidden`/`inactive-layer` back OFF on restored children — replaced with explicit `addClass`/`removeClass` at `editor/layers.js:272-275` (comment at `:264-271` names B1). Runtime confirm still wise: the original symptom was a visual hide, not a stack miscount. |
| **B2** elements vanish on reopen | **original hypotheses RESOLVED; a distinct data-loss path is OPEN** → net **CAN'T-TELL-without-runtime** | `data-layer` survives the round trip (`core/svg-utils.js:15-17` strips only `svgjs:*`); `_reconcileLayersFromSvg` (`editor/editor-io.js:336-400`) rebuilds `_layers`; `applyLayerState` correctly `removeClass('layer-hidden')`s visible layers (`layers.js:275`). So the round trip is clean **for visible layers**. The one real disappearance mechanism is **B6 below** (`_visibleContent` drops hidden-layer geometry at save) — reproducible only if a layer was hidden at save time. Who calls `open()` with which serialized string is outside the named files and not chased. |
| **B3** Expand broken on `<line>` | **likely-FIXED at dispatch** / CAN'T-TELL for output correctness | The "no `line` branch" hypothesis is false: `OPEN_SHAPES = ['path','polyline','line']` (`editor/editor-expand-shape.js:41`), accepted at `:55`, routed to `expandGeometric(... isClosed=false)` at `:73`. Dispatcher `expandCurrent` (`editor/editor-expand.js:18-51`) is fall-through text→shape→trace, and `line` is handled by `expandShape`. Whether output is *correct* for a `<line>` depends on `getTotalLength`/`getPointAtLength` on `SVGLineElement` in the Fusion CEF host and the trace fallback not dropping thin strokes (`editor-expand-trace.js:9-11`) — runtime-only. |

## New findings

### B4 — `import_svg_sketches` is a DEAD SEND  ·  runtime-bug  ·  confidence HIGH

> **STATUS (T3, 2026-09-18): CLOSED `6d982ab` (no guard).** The dead `#editorSendToFusion` button and
> its handler were removed entirely (RB4, 2026-07-11) — "Human doesn't use it" per the commit message —
> rather than wiring a Python receiver. `grep -rn "import_svg_sketches"` across the whole repo → 0 hits.
> No regression test (a deleted-button assertion needs a DOM harness for the palette HTML, which
> doesn't exist).

- **Where:** send `b-spline-gen/html/main/app-init.js:187`
  (`adsk.fusionSendData('import_svg_sketches', payload)`); no matching receiver.
- **Symptom:** the SVG editor's "Send to Fusion" button (BUG-23,
  `editorSendToFusion`) collects visible layers into a payload and sends action
  `import_svg_sketches`, but `b-spline-gen.py`'s `PaletteHTMLEventHandler.notify`
  (dispatch at `b-spline-gen/b-spline-gen.py:666-872`) has **no branch** for it
  (handled actions: `log`, `preview_mesh`, `preview`, `generate_start/chunk/finish`,
  `check_import_status`, `ping`, `get_design_params`, `reset_ui`, `generate`, `ok`,
  `cancel`). Repo-wide grep for `import_svg_sketches` returns only the send-site +
  an **aspirational comment** (`app-init.js:132` "Python add-in side will handle
  the 'import_svg_sketches' channel"). The button fires into a void **and logs a
  misleading success** (`app-init.js:188` "sent N sketch(es)"). Fusion-mode only
  (button `display:none` in web), so no web regression — but a user-facing feature
  that silently does nothing.

### B5 — fusion-inspector leaks an app-level selection subscription across Stop→Start  ·  P2-violation  ·  confidence HIGH

> **STATUS (T3, 2026-09-18): CLOSED `0607eaf` (no guard).** IN1 (2026-09-17): `run()` now self-heals
> (removes any handler left over from an unclean prior stop before adding the new one — confirmed at
> `frame-inspector/fusion-inspector.py:406,410`) and `stop()` removes the current handler (`:455`).
> Mirrors template-maker.py's already-correct pattern for the same event. No Python lifecycle test
> exists anywhere in the repo (reconciled repeatedly across A1/A5a/A6/T1) — no guard.

- **Where:** `frame-inspector/fusion-inspector.py:660-662` (run) vs `:668-704` (stop).
- **Symptom:** `run()` does `ui.activeSelectionChanged.add(sel_handler)`; `stop()`
  deletes the palette, panel control, and command definition but issues **no**
  `ui.activeSelectionChanged.remove(...)` and never clears `_handlers`. Fusion keeps
  the old subscription after each hot-reload, so after N Stop→Start cycles N
  `_SelectionChangedHandler`s fire per selection change (duplicated
  `_push_selection_to_palette` work, growing each reload). Breaks P2 ("sub-modules
  fully release in stop()"). Contrast the correct pattern: template-maker detaches
  sel+doc handlers in stop() (`template-maker/template-maker.py:797-812`),
  stamp-editor via `_disable_live_face_count` (`stamp-editor/stamp-editor.py:264`,
  invoked at `:1373`). Fix: mirror those — `remove(sel_handler)` + `_handlers.clear()`.

### B6 — Destructive save drops hidden-layer geometry  ·  runtime-bug / data-loss  ·  confidence MED-HIGH

> **STATUS (T3, 2026-09-18): CLOSED `957df31`, guarded by `tests/b6-hidden-layer-save.test.js`.**
> `_visibleContent` (the function this entry cites) no longer exists anywhere in the codebase — replaced
> by `serializeEditor` (`editor/editor-io.js:23-40`), whose own docstring names this bug by number:
> "Dropping their geometry here loses it permanently on save/reopen... (B6)." Traced every caller:
> `save()` and `saveForRasterization()` both keep all layers regardless of visibility; `getLayerSvg()`
> (the ONE place that still filters by visibility) is for the live stamp preview, a deliberately
> different concern the same docstring distinguishes. Verified independently in lane-b's A5b audit
> (2026-09-17) before the regression test was written (T1, same day).

- **Where:** `b-spline-gen/html/editor/editor-io.js:27-49` (`_visibleContent`), drop at `:44-47`.
- **Symptom:** before serializing on save, `_visibleContent` **removes** every child
  whose `data-layer` is a hidden layer (`ch.remove()`). The docstring (`:21-26`)
  frames this as intentional so hidden layers don't reach the Fusion **stamp**
  geometry — but it also governs the persisted `save()` output, so hiding a layer
  then saving **permanently deletes** that layer's geometry from the drawing;
  toggling it visible after reopen restores nothing (the roster still lists the now-
  empty layer via `data-editor-layers`). This is the concrete, reproducible
  mechanism behind B2 when a layer is hidden at save. Design tension: view-toggle vs
  stamp-exclude vs persistence are conflated onto one `visible` flag.

### B7 — `selection_items` not force-wiped → stale hot-reload  ·  P2-violation  ·  confidence HIGH (severity MED)

> **STATUS (T3, 2026-09-18): CLOSED `c60628b` (no guard).** Already marked resolved inline below
> (E7a, 2026-09-17) — `payload_builder.py` + `selection_items.py` were confirmed dead (zero callers)
> and deleted outright rather than added to the force-wipe list. No guard: the class of bug (stale
> module caching across Stop→Start) no longer applies since the module doesn't exist to go stale.

- **Where:** parent `bspline-frame-builder.py:243-250` (`_shared_project_names`) omits
  `selection_items`; import chain `frame-inspector/fusion-inspector.py:23` →
  `frame-inspector/payload_builder.py:7` (`from selection_items import …`).
- **Symptom:** `_bootstrap()` wipes `payload_builder` (in the list) so it re-execs
  fresh on Stop→Start, but `selection_items` stays cached in `sys.modules`, so the
  fresh `payload_builder` re-binds the **stale** `selection_items`. Edits to
  `frame-inspector/selection_items.py` don't take effect without a full Fusion
  restart — violates P2's "code edits take effect on Stop→Start." **Low blast
  radius:** `selection_items.py` exists only in frame-inspector (verified — one
  copy), so it's a stale-reload, not a cross-sub wrong-copy bind. Fix: add
  `'selection_items'` to `_shared_project_names`. (The two genuinely-colliding
  shared names, `entity_helpers`/`expression_coords`, ARE both wiped — no cross-sub
  hole found.)
  **RESOLVED 2026-09-17 (E7a): module was dead — deleted, not wiped.**

### B8 — Entire editor tree duplicated into stamp-editor  ·  P1-violation  ·  confidence HIGH (severity MED)

> **STATUS (T3, 2026-09-18): STALE.** `59615fe` (C1/F7, 2026-07-11) de-forked stamp-editor's copy —
> the generated `editor/`, `core/stamp/`, and 4 core deps are untracked + gitignored + regenerated by
> `sync_stamp_bundle.py`, not a committed duplicate; confirmed independently via `git ls-files` in
> lane-b's A4 audit (2026-09-17), which found zero of the 54 generated files tracked. Separately, Fred
> ruled 2026-09-18 that the standalone `stamp-editor` add-in itself is out of scope going forward —
> this entry's underlying premise (a forked editor tree needing eventual de-dup) no longer applies
> either way.

- **Where:** `b-spline-gen/html/editor/` (33 `.js`) copied verbatim to
  `stamp-editor/html/editor/` (33 `.js`); `editor-expand.js` is byte-identical today.
- **Symptom:** P1 says shared logic "must not be forked or copy-pasted per host."
  A whole forked editor means every B1–B3/B6-class fix must be applied twice or the
  copies drift; a fix to one silently misses the other. (The *systematic* duplication
  audit — this + the per-palette `expression_coords`/`entity_helpers` copies +
  source-vs-`dist/` drift — is T3 scope; logged here as the P1 breach it is.)

### B9 — Host calls bypass the fusion-bridge seam  ·  P1-violation  ·  confidence HIGH (severity LOW-MED)

> **STATUS (T3, 2026-09-18): CLOSED `48cee2b` (no guard).** BG2 (2026-09-17) routes `get_design_params`
> through `core/fusion-bridge.js` (confirmed at `:20-21`); `main.js` no longer calls `adsk.*` directly.
> (The `import_svg_sketches` half of this entry closed separately via B4's deletion.) `grep -rln
> "adsk\." core/*.js main/*.js` outside `fusion-bridge.js` now returns only `core/fusion-log.js` — see
> B11. No JS test framework covers this surface — no guard.

- **Where:** `b-spline-gen/html/main/main.js:136` (`get_design_params`) and
  `main/app-init.js:187` (`import_svg_sketches`) call `adsk.fusionSendData(...)`
  **directly** instead of through `core/fusion-bridge.js`.
- **Symptom:** the invariant "host-specific behaviour lives ONLY in
  `fusion-bridge.js`" is already breached. Both call-sites are `try/catch`-wrapped
  and only reached in Fusion-mode context, so there's **no live web-host crash
  today** — the risk is seam erosion: new bridge actions accrete outside the one
  guarded module, and a future refactor that removes the surrounding guard would
  throw `ReferenceError: adsk` in the web host. Fix: add `getDesignParams()` /
  `sendSvgSketches()` senders to `fusion-bridge.js` (and B4 needs a Python receiver
  regardless). (`app-init.js:187` is also the B4 dead-send site.)

### B10 — CAM-builder stop() unregisters 1 of its 3 CustomEvents  ·  P2-violation  ·  confidence MED (severity LOW)

> **STATUS (T3, 2026-09-18): CLOSED `f0d47ed` (no guard).** HY3 (2026-09-17) made `stop()` unregister
> all three events symmetrically — confirmed at `cam-builder.py:2185,2189,2193` (`REFRESH_EVENT_ID`,
> `TPGEN_EVENT_ID`, `AXISPICK_EVENT_ID`, in the merged CAM1 file). Re-verified against the CURRENT
> merged cam-builder.py (post-CAM1 Builder+Studio consolidation), not just the state this entry was
> originally written against. No Python lifecycle test exists anywhere in the repo — no guard.

- **Where:** `CAM-builder/cam-builder.py` registers `REFRESH`/`TPGEN`/`AXISPICK`
  CustomEvents in run() (`:2009/2022/2034`); stop() unregisters only `REFRESH`
  (`:2252`) then clears handler refs (`:2257`).
- **Symptom:** `TPGEN_EVENT_ID` + `AXISPICK_EVENT_ID` stay registered with Fusion
  after stop() while their Python handlers are dropped. **Masked** on the normal
  path because the next `run()` calls `stop()` then `_register_refresh_event()`,
  which re-unregisters all three before re-adding — so residual risk is only a
  stop() not followed by a run() (a stray TPGEN/AXISPICK fire hitting a cleared
  handler). Tighten stop() to unregister all three for symmetry.

### B11 — `fusLog` log-bridge re-inlined in 3 places  ·  P4-violation  ·  confidence HIGH (severity LOW)

> **STATUS (T3, 2026-09-18): CLOSED `48cee2b` (no guard) — with one documented, intentional exception.**
> BG2 (2026-09-17) extracted the log tunnel into a leaf module, `core/fusion-log.js`, breaking the
> circular-import block this entry's own text names as the root cause; `coords.js`/`state.js` no longer
> re-inline it. `grep -rln "adsk\." core/*.js main/*.js` outside `fusion-bridge.js` now returns only
> `core/fusion-log.js` (the declared leaf module — by design, since it's the log tunnel itself) and the
> palette HTML's inline `window.fusionJavaScriptHandler` (a SEPARATE, NAMED P1 exception — Fusion's
> palette API requires that global to exist synchronously, before any ES module can load; now
> documented as such in `ROADMAP.md:292`). No JS test framework covers this surface — no guard.

- **Where:** canonical `core/fusion-bridge.js:14`; re-inlined at `core/coords.js:9-20`
  (`COORD_SYSTEM.log`) and `core/state.js:264-266`.
- **Symptom:** the "tunnel a log line to the Fusion log via
  `adsk.fusionSendData('log', …)`" concept is hand-rolled three times instead of
  declared once. **Root cause is layering, not carelessness:** `fusion-bridge.js`
  imports from both `state.js` and `coords.js` (`fusion-bridge.js:6-7`), so those
  two leaf modules can't import `fusLog` back without a circular import. Proper
  declare-over-hand-roll fix: extract the log tunnel into a tiny leaf module
  (`core/fus-log.js`) that all three import. Minor behaviour drift between copies
  (canonical `String(msg)`; coords passes `msg` raw; state double-`JSON.stringify`s).
  No runtime bug.

### B12 — SVG editor Cancel does not revert; Apply of an emptied canvas keeps the stale mask  ·  runtime-bug  ·  confidence HIGH

> **STATUS (T9, 2026-09-18): CLOSED `f46561a`, guarded by `tests/stamp-mask-clear.test.js`.** SE3a
> (seat A) — advisor live-verified 2026-09-18 08:45: Cancel reverts; Clear → Apply clears the carve.
> Confirmed the commit and the test file both exist before recording this status.

> **STATUS (T4, 2026-09-18, historical): OPEN.** Found live by the advisor 2026-09-18; recorded here by
> lane-b per the dispatch. Fix queued as SE3a on main (seat A), not this lane's. Verified all three proof
> lines directly before recording:

- **Where (Cancel path):** `main/app-init.js:114-127`. On Cancel, restores the LEGACY per-stamp-layer
  fields (`P.stampLayers[idx].svg`/`.mask`/`enabled`) from `SvgEditorSnapshot` — not `P.editorSvg` (the
  "Step 3 unification" full editor document the comment at `:134-137` names). The snapshot itself is
  captured wrong in the first place — see the next line.
- **Where (snapshot capture):** `main/stamp/svg-source.js:91-97`. `SvgEditorSnapshot.svg =
  currentLayer.svg` where `currentLayer = ctx.activeLayer()` — but in the unified editor model,
  `ctx.activeLayer()` returns an EDITOR layer, which has no `.svg` field (that's a legacy-stamp-layer
  field). So `SvgEditorSnapshot.svg` is `undefined` at capture time, confirmed by the file's OWN comment
  two lines below (`:100-102`, "ctx.activeLayer() returns an EDITOR layer with no `.svg`... the old code
  passed undefined and reopened blank (RO1)") — the same class of bug already named once (RO1) for the
  reopen path, now recurring for the Cancel-snapshot path.
- **Where (Apply of an emptied canvas):** `main/stamp-mask-manager.js:40-78`. `updateStampMasks`
  builds a `work` list from layers that currently have SVG content (`:52-54`, `if (!svg) return`); if
  the user deletes everything on a layer and Applies, that layer contributes nothing to `work`. If NO
  layer has content, `work.length === 0` and the function returns early at `:78` — **the layer's stale
  `mask` (from before the canvas was emptied) is never nulled**, so old stamp geometry keeps rendering
  for a canvas the user just cleared.
- **Symptom:** open the SVG editor on a layer with content, Cancel — the pre-edit drawing does not come
  back (the snapshot it would restore from was `undefined` to begin with). Separately: empty a layer's
  canvas and click Apply — the old stamp geometry persists instead of clearing.

### B13 — Global undo/redo nulls `P.stampLayers[0].svg`; Export/Send-to-Fusion silently drop the drawing after any undo  ·  runtime-bug / data-loss  ·  confidence HIGH

> **STATUS (T11, 2026-09-18): CLOSED `aeb9a53` + `629102d` (guarded by `tests/export-flow.test.js`).**
> `aeb9a53` (SE4a) moved export-flow + compositor onto the editor content store; `629102d` (SE4c)
> finished the cleanup and removed `stampSvgText` outright — confirmed via `grep -rn "stampSvgText"
> bspline-frame-builder/b-spline-gen/html/` returning zero hits, so the null-write mechanism below no
> longer exists, not just no longer triggered. Advisor's ruling (recorded in ROADMAP): global undo now
> covers the heightfield only, not stamp content — the design choice that makes this whole causal chain
> moot rather than merely closing the two spots it was visible.
>
> **STATUS (T9, 2026-09-18): OPEN.** From `SE4-MIRROR-RETIREMENT-DESIGN.md` findings #1+#2. Fix in
> flight as SE4a (seat A). Verified all three proof lines directly before recording:

- **Where (the null gets created):** `core/history.js:25`. `takeSnapshot(label = "Action", stampSvgText
  = null)` — `stampSvgText` defaults to `null`. Grepped every call site (`main/app-init.js:67`,
  `core/sculpt-interaction.js:104,146`) — none ever pass a second argument, so `stampSvgText` is `null`
  on EVERY snapshot, unconditionally, not just some.
- **Where (the null gets written through):** `main/snapshot-manager.js:41`. `if (snap.stampSvgText !==
  undefined && P.stampLayers && P.stampLayers[0]) { P.stampLayers[0].svg = snap.stampSvgText; }` — the
  guard tests `!== undefined`, but the value is `null`, and `null !== undefined` is `true` in JS — so
  this branch runs and sets `P.stampLayers[0].svg = null` on every single undo/redo restore, wiping the
  legacy mirror field regardless of what the editor actually has.
- **Where (the wipe becomes visible):** `main/export-flow.js:40-44`. `isCarvingLayer`/`hasShippableSvg`
  (and the `activeStampLayers`/`exportableStampLayers` they gate) all read `l.svg` on the raw
  `P.stampLayers` entry — no fallback to the unified editor model (`P.editorSvg`/`editor._layers`). Once
  `:41` above nulls `P.stampLayers[0].svg`, these all evaluate false for that layer.
- **Symptom:** draw a stamp, do ANY undo-worthy action elsewhere (even unrelated to the stamp), then
  Export STEP or Send-to-Fusion — the stamp layer is silently excluded, with no error, because the
  legacy mirror field the export path reads was nulled by the most recent snapshot restore.

### B14 — Ghost selection overlay survives `_sketchLayer.clear()` (highlight + handle layers)  ·  runtime-bug  ·  confidence HIGH

> **STATUS (T9, 2026-09-18): CLOSED `13a2480` (no guard — DOM-bound).** Found + fixed same-day, this
> lane, turn T8. Bonus found during the fix: `_deselect()` also never cleared `_selectionHighlights`
> (the plural array for a multi-element selection) for ANY of its 13 pre-existing callers, not just the
> 2 new content-wipe sites — fixed once, in the one shared function, rather than patched per call site.

- **Where:** `editor/tools/action-tools.js:18-24` (Clear handler) and `editor/editor-io.js:464+`
  (`open()`) both call `editor._sketchLayer.clear()` without deselecting — `_selectedElements` keeps
  pointing at the now-removed nodes, and `_highlightLayer`/`_handleLayer` (separate SVG groups
  `_sketchLayer.clear()` never touches) keep drawing their stale halo/handles.
- **Symptom:** draw a stroke, Clear → Apply (or Cancel), or reopen the editor on an emptied layer — the
  old stroke's translucent yellow highlight band and transform handles remain visible on an otherwise
  empty canvas, before any further interaction.
- **Fix:** completed `editor.js`'s `_deselect()` to clear `_selectionHighlights` (plural) alongside the
  handle layer and the legacy singular `_selectionHighlight` it already cleared; called the now-complete
  `_deselect()` directly from both content-wipe sites (chose reuse over declaring a separate
  `resetContentState()` wrapper — `_deselect()` already covered everything needed).

### B15 — Two buttons named "Clear" with different effects (sidebar mirror-only vs. editor real-content)  ·  P4-violation / UX confusion  ·  confidence HIGH

> **STATUS (T11, 2026-09-18): CLOSED `fa9972a` (no guard — DOM-bound).** SE4b dropped the legacy
> `P.stampLayers[idx].svg`/`.mask` mirror-write branch and the content it duplicated; advisor
> live-verified 2026-09-18 09:55: the sidebar Clear button now removes both the carve and the drawing,
> so the two "Clear" buttons agree.
>
> **STATUS (T9, 2026-09-18): OPEN.** From the SE4 design doc §3 finding #3. Scheduled for SE4 slice (b).
> Verified both proof lines directly before recording:

- **Where (sidebar):** `main/stamp/svg-source.js:72-81`. `btnStampClear` (id, per
  `bspline_gen_palette.html:637`) nulls `P.stampLayers[idx].svg`/`.mask`, sets `enabled = false` — the
  LEGACY mirror fields only. Does not touch the actual editor document (`_sketchLayer`/`editor._layers`).
- **Where (editor modal):** `editor/tools/action-tools.js:18-24`. `editorClear` (id, per
  `bspline_gen_palette.html:1247`) calls `editor._sketchLayer.clear()` — the REAL content wipe (and, as
  of B14's fix, now correctly deselects too).
- **Symptom:** both buttons are labeled "Clear" and both live in stamp-related UI, but clicking the
  sidebar one does NOT clear what's drawn in the editor (only the legacy mirror snapshot of it) — a user
  reasonably expects "Clear" to mean the same thing in both places.

## Minor / lower-confidence (noted, not promoted)

- **Ctrl+Z has no `e.repeat` guard** — `main/global-events.js:36` fires `undo()` on
  every keydown, so holding the combo auto-repeats undos. Minor UX; adjacent to B1.
- **Expand-commit stores invalid XML** — `editor/editor-expand-commit.js:116-118`
  writes raw `<…>` markup into `data-original-svg`; only kept working by an external
  `sanitizeSvgForRaster` in `core/stamp/render-svg.js`. Fragile cross-module
  contract (two files must stay in lockstep), not a confirmed live bug.
- **Font `<defs>` phantom child (conditional)** — if `open()` is fed a
  rasterization/text-copy serialization, its injected `<defs><style>` block isn't
  stripped (`editor-io.js:437` removes only `.editor-metadata`) and
  `_reconcileLayersFromSvg` stamps a `data-layer` on it (`:386-389`), tracking a
  non-visual node as a layer element. Only triggers on that reopen source. LOW.

## Parked for T3 (out of T2 scope, per NEXT-SESSION)

Systematic code-duplication audit (B8 + per-palette shared-module copies +
source-vs-`dist/` drift), cloud identity drift (`preset-worker` three names),
`step-editor-worker` unprovisioned KV, `step-editor-pages` README-only,
README doc-drift, test coverage, dead code.

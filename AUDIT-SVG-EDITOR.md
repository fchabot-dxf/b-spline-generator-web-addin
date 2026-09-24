# AUDIT-SVG-EDITOR.md — full read-only audit of the vector editor (T12)

**Scope:** `bspline-frame-builder/b-spline-gen/html/editor/**` (36 files, 6,933 lines), `#svgEditorModal` in
`bspline_gen_palette.html`, `styles/editor.css`, and the host glue (`main/app-init.js`, `main/stamp/svg-source.js`,
`main/stamp-mask-manager.js`, `main/export-flow.js`, `core/engine/rebuild.js`, `core/stamp/*`).
**Method:** 6 parallel sub-audits (one per dimension group, general-purpose agents, read-only, no repo edits), each
required to cite verbatim `file:line` evidence or label a claim `HYPOTHESIS, unverified`. This worker then
spot-checked 6 of the highest-severity citations directly (Read/grep against current lane-b HEAD) before compiling
— all 6 matched exactly. One root-cause correction was made during compilation (SA-LAYER-1, below) after finding a
design comment the sub-audit had not read. All line numbers are current lane-b HEAD as of commit `f7d9cd6`; the
files under seat A's concurrent edit (`editor-interaction.js`, `editor-grid.js`, `editor.js`) were read, never
touched.

**ID scheme:** dimension-prefixed (`SA-COORD-`, `SA-UNDO-`, `SA-LAYER-`, `SA-ROUNDTRIP-`, `SA-DECL-`, `SA-DEAD-`,
`SA-TEXT-`, `SA-MOBILE-`) rather than a flat `SA1…SA47` — with 47 findings across 8 dimensions, a flat sequence
would be harder to navigate than the dispatch's own illustrative "SA1…" implied; each id is still unique.

**Correction to the dispatch's own premise:** the dispatch's model example, `SNAP_POLICY` ("a per-tool declared
table that replaced a blanket hand-rolled snap call"), **does not exist as shipped code** — `grep -rn
"SNAP_POLICY"` from repo root returns 0 hits in `.js`. It appears only in `ROADMAP.md` prose as a still-queued
SE7s name. Today's snap mechanism is one blanket function, `snapToGrid()` (`editor-grid.js:24`), one call site
(`editor.js:238`). The declarations used as models below instead are real, shipped ones: `GRID_DEFAULTS`
(`editor-grid.js:14`), `MODE_HINTS` (`editor-ui.js:12-22`), `modeHandlers` (`editor-interaction.js:587-596`), the
`dbg()`/`isDebugEnabled()` category gate (`core/debug.js`).

---

## Ranked findings

| id | sev | conf | claim | file:line |
|---|---|---|---|---|
| SA-ROUNDTRIP-1 | HIGH | HIGH | every circle/ellipse's arc params get corrupted (garbage radii/flags) by the carve-bake path — fires on every export, invisible in editor/preview | `editor-transform-handles.js:357-369` |
| SA-ROUNDTRIP-2 | HIGH | HIGH | rotated/non-uniformly-scaled `<text>` silently carves upright, wrong size (cos(θ) size error) | `editor-io.js:194-202` |
| SA-LAYER-1 | HIGH | HIGH (see correction below) | export path's tooling read from `P.stampLayers[idx]` breaks for a 4th+ layer, for content drawn directly (not Browse-imported), and after reorder/delete — silent no-carve | `main/export-flow.js:34-39,56-70` |
| SA-COORD-1 | HIGH | HIGH | `dragNode` writes world-space pointer straight into local attrs for line/polyline/path — no inverse transform | `editor-interaction.js:610-633` |
| SA-COORD-2 | HIGH | HIGH | corrects SE7n: `dragNode` has **no branch at all** for rect/circle/ellipse today — silent no-op, not a wrong-space write | `editor-interaction.js:610-633` |
| SA-COORD-3 | HIGH | HIGH | `getNearbyElement` hit-tests against stale pre-transform local bbox — clicking a moved element can miss it entirely | `editor-hit.js:58-80` |
| SA-TEXT-1 | HIGH | HIGH | Cancel button skips text-session teardown — leaks a `document`-level mousedown listener that steals focus app-wide after closing the editor | `editor/tools/action-tools.js:54-56`, `editor-text-session.js:283-346` |
| SA-MOBILE-13 | HIGH | HIGH | global `touch-action:none` (site-wide) blocks native pinch-zoom, contradicting its own adjacent WCAG 1.4.4 comment; combined with SE7m, zoom is unreachable by any means on touch | `styles/base.css:36-45` |
| SA-MOBILE-14 | HIGH | HIGH | no way to pan the canvas via touch at all (pan is middle-click / Space+left-drag only) | `editor-interaction.js:237` |
| SA-MOBILE-3 | HIGH | HIGH (formula) / MED (px estimate) | transform handles sized from viewBox model-space fraction, not screen px — hit target shrinks ~2× on a phone vs desktop | `editor-transform-handles.js:59-65,85,107` |
| SA-MOBILE-8 | HIGH | HIGH | per-layer delete button is `:hover`-only visible, zero touch fallback — layers are undeletable on a phone | `styles/editor.css:583-598` |
| SA-UNDO-1 | HIGH | HIGH | `_onChange()` (full remask/rasterize/localStorage pipeline) fires on every raw `mousemove` during node-drag, element-move, and transform-handle drag — no throttle | `editor-interaction.js:610-646`, `editor-transform-handles.js:224` |
| SA-UNDO-2 | HIGH | HIGH | `setStrokeWidth()` calls neither `pushState()` nor `_onChange()` — stroke-width edits are permanently un-undoable and never reach the carve preview until an unrelated edit | `editor.js:187-193` |
| SA-COORD-4 | MED-HIGH | HIGH (traced) | `expandTrace`'s canvg viewBox is framed from local (pre-transform) bbox while content renders transformed — Expand can silently fail ("no pixels") on any moved element | `editor-expand-trace.js:33-50` |
| SA-LAYER-2 | MED | HIGH | `updateP`'s editor-layer mirror write is gated behind the same stale 3-entry `P.stampLayers` check — per-layer depth/profile sliders are a no-op placebo past layer 3 | `core/state.js:356-369` |
| SA-TEXT-2 | MED-HIGH | HIGH | `<defs class="rasterization-fonts">` font-face block accumulates one extra nested copy per editor open/edit/close cycle — unbounded storage growth | `editor-io.js:294-332,465-592,518-519` |
| SA-MOBILE-1 | MED | HIGH | element/curve select hit radius = 10px screen (fingertip-marginal) | `editor-hit.js:15-26`, `editor-interaction.js:223,340,361,...` |
| SA-MOBILE-2 | MED | HIGH | node-drag grab radius = 15px screen | `editor-interaction.js:606` |
| SA-MOBILE-4 | MED | HIGH | sidebar tool buttons render at 38px (two conflicting mobile breakpoints), still under 44px guidance, 6px gap | `editor.css:333-338` vs `:436-445` |
| SA-MOBILE-6 | MED | MED (CSS read; not rendered) | layers panel likely mis-sized/floating at 390px column layout; the file's own comment promises a collapse-toggle that was never built | `editor.css:164-166,613-617` |
| SA-MOBILE-9 | MED | HIGH | full tool instructions live only in hover-tooltip `title` attrs, unreliable on touch | `bspline_gen_palette.html:1341` |
| SA-MOBILE-10 | MED | HIGH | Esc-cancel-pen-path has no on-screen button; only escape is an undocumented switch-tool side effect | `editor-interaction.js:570`, `editor-ui.js:96`, `editor.js:369` |
| SA-MOBILE-11 | MED | HIGH | copy/paste/select-all are keyboard-only, no on-screen equivalents | `editor-interaction.js:141-173` |
| SA-DECL-1 | MED | HIGH | `createDrawingShape`/`updateDrawingShape` hand-roll if/else per tool right beside the declared `modeHandlers` table in the same file | `editor-interaction.js:651-712` |
| SA-DECL-2 | MED | HIGH | toolbar-group visibility is a scattered hand-written boolean per group, no per-mode table | `editor-ui.js:133-173` |
| SA-DECL-3 | MED | HIGH | hit-tolerance px values are anonymous numeric literals at each of ~13 call sites, no named table | `editor-interaction.js` (13 sites), `editor-ui.js:216`, `editor-expand-trace.js:94` |
| SA-DECL-4 | MED | HIGH | element-kind capability rules (fillable, node/handle-editable) repeated as `.type===` branches across 3 files instead of one table | `properties-shape.js:75`, `editor-interaction.js:664-689,610-633`, `editor-hit.js:28-55` |
| SA-DEAD-1 | MED | HIGH | 8 sites hand-roll `window.__editorDebug === 'X'` instead of the already-declared `dbg()`/`isDebugEnabled()` gate; none of their 8 categories are in that gate's own doc-comment | `editor-eraser.js:45`, `editor-expand-union.js:26`, `editor-expand-shape.js:46`, `editor-expand.js:12`, `editor-expand-commit.js:37`, `expand.js:5`, `editor-io.js:18` |
| SA-DEAD-2 | MED | HIGH | `updateNodeCountUI` — fully built, wired onto the instance, **zero call sites** ever invoke it | `editor-ui.js:175-192`, `editor.js:365`, `bspline_gen_palette.html:1482` |
| SA-DEAD-3 | MED | HIGH | 3 doorless ids (`editorExpandSmooth`/`-Minus`/`-Plus`) — Smoothness control fully wired in JS, no UI markup exists to reach it | `properties-expand.js:9,13,31-32` |
| SA-DEAD-4 | MED | HIGH | `editorSelectPanel` doorless id — a second, later reference to an id a documented prior cleanup already removed from markup | `editor-ui.js:153-159` |
| SA-LAYER-3 | LOW | HIGH | `isFilletActive()` also reads stale `P.stampLayers` — affects only remask-debounce timing, not correctness | `main/stamp/_shared.js:44-48` |
| SA-UNDO-3 | LOW | MED | `setStrokeColor()` calls `pushState()` but never `_onChange()` — live preview shows stale color until an unrelated edit | `editor.js:177-186` |
| SA-MOBILE-5 | LOW | MED | dead CSS: a 700px `.editor-sidebar` width rule is permanently unreachable under two later `!important` 720px rules | `editor.css:155-197,267-344` vs `:346-446` |
| SA-MOBILE-12 | LOW-MED | HIGH | Shift-modifier precision aids (uniform-scale lock, 15° rotate snap) have no touch equivalent | `editor-transform-handles.js:186-189,208-209` |
| SA-MOBILE-15 | LOW (forward-looking) | MED | canvas `touchmove` never calls `preventDefault()` — masked today by SA-MOBILE-13, will resurface if that's fixed carelessly | `editor-interaction.js` (no citation — absence) |
| SA-TEXT-3 | MED | HIGH (path) / MED (frequency) | `_reconcileLayersFromSvg`'s orphan-adoption can stamp `data-layer` onto the injected font `<defs>` block on a corrupted-metadata reopen | `editor-io.js:423-431,449-452` |
| SA-TEXT-4 | MED | HIGH | Expand is a one-way trip — no UI restores editable `<text>`, and `open()` wipes the undo stack every reopen, cutting off the only alternative | `editor-expand-commit.js:107-121`, `editor-expand-trace.js:46,120`, `editor-io.js:479-485` |
| SA-TEXT-6 | LOW-MED | HIGH (dup) / contingent | 3 independently hand-typed font whitelists despite `editor-fonts.js`'s explicit "single source of truth" claim — a future font addition would silently carve as Arial | `editor-fonts.js:29-48` vs `core/stamp/render-svg.js:12-24` vs `bspline_gen_palette.html:1306-1310` |
| SA-DEAD-5 | LOW | HIGH | `editorSidebarToggle` — triple-dead (no button, no CSS, superseded by SE7m's responsive layout) | `editor-controls.js:13-18` |
| SA-DEAD-6 | LOW | HIGH | `editorLayerSelect` "compatibility shim" doc-comments name callers that no longer exist in-repo | `bspline_gen_palette.html:1484-1487`, `layers.js:489-491` |
| SA-DEAD-7 | LOW | HIGH | `setMode()` — 3 "special case" branches are fully redundant with the generic toggle one line above | `editor-ui.js:105-110` |
| SA-DEAD-8 | LOW | HIGH | empty-body `if` block — computes a real condition, does nothing | `editor-ui.js:161-166` |
| SA-TEXT-5 | LOW-MED | HIGH | stale doc-comment still asserts (as present-tense fact) a raw-markup XML-injection risk that EDM2's base64 encoding already fixed | `editor-expand-commit.js:24-31` vs `:117-121` |
| SA-TEXT-7 | LOW | HIGH | `TEXT-DBG` debug category defaults ON in production, inverted from its own "off by default" doc comment — console spam on every text-tool keystroke | `core/debug.js:7` vs `:19` |

**Not filed as findings — verified clean/non-applicable (recorded so nobody re-investigates):**
- SA-ROUNDTRIP-3 — `data-original-svg` raw-markup risk: **fixed** (base64 via `encodeSnapshot`, EDM2, tested in `tests/editor-serialization.test.js:94-111`). Only the doc-comment is stale (→ SA-TEXT-5, same underlying file).
- SA-ROUNDTRIP-4 — hidden layers: correctly excluded from mask generation, export, and rasterization at every stage; correctly restored on reopen. No defect.
- SA-ROUNDTRIP-5 — "expanded text session state lost on reopen": no such UI feature exists to lose state from (Expand is one-way — see SA-TEXT-4 instead, a different framing of the same absence).
- SA-MOBILE-7 — properties bar at 390px: correctly degrades to a scrollable, touch-friendly strip. No defect.
- Line/rect/path/polyline/untransformed-text/expanded-text/hidden-layer round-trips (line, rect, polyline, path, plain text, expanded text) — all traced stage-by-stage (show → save → carve) and found consistent. Only circle/ellipse (SA-ROUNDTRIP-1) and rotated/scaled text (SA-ROUNDTRIP-2) diverge.
- Text-session interruption handling (tool-switch, Escape, empty-commit, double-session-start, window resize) — all correctly clean. Only the editor-level **Cancel button** skips teardown (SA-TEXT-1).
- `dbg()` sweep — 32 gated call sites across 8 files, no orphaned instrumentation (separate from the 8 *hand-rolled bypasses* in SA-DEAD-1).
- Exported-function-used-only-locally sweep — 0 of 116 exported editor functions are single-file-only. Nothing to flag.
- `properties-panels.js` — an already self-documented, intentional empty stub from a prior cleanup. Not a live doorless panel.
- Cursor-per-mode — already declared via CSS classes (`.mode-select`/`.mode-node`/`.pan-ready`/`.panning`); coverage is incomplete (erase/text get no dedicated cursor) but that's a gap in an existing correct declaration, not a hand-roll violation.
- `bakeMatrixIntoElement`'s unscaled stroke-width copy on the rect/circle/ellipse→path promotion (`editor-transform-handles.js:325-328`) — may already match wherever SE7s lands on "never scale stroke on bake"; flagged for cross-check, not filed as a fresh defect.

---

## Coordinate spaces

**The declared boundary that exists today:** `editor-coords.js` declares a one-way LOCAL→WORLD boundary —
`transformPoint(m, pt)`, `worldPoint(el, pt)`, `worldBbox(el)`, `localAnchor(el)`. **There is no inverse
(`worldToLocal`) anywhere in the tree** (`grep -r "worldToLocal|localPoint|toLocal|fromWorld"` → 0 hits). Screen→world
for pointer events is centralized correctly (`getPointerPos`, `editor-io.js:609-619`, used consistently everywhere).

Of ~16 coordinate-conversion call sites swept, **~13 correctly route through the declared boundary or hand-roll
the identical correct math; 3 are flatly broken** — all 3 are *write*-direction sites (pointer → local attribute),
because no inverse has ever been declared for that direction:

**SA-COORD-1 (HIGH/HIGH, extends SE7n).** `dragNode`'s `line`/`polyline`/`polygon`/`path` branches
(`editor-interaction.js:610-633`) write the world-space `pt` from `handleMove` directly into local attrs — no
inverse-matrix step. `getNodes` (`editor-hit.js:55`) correctly bakes `el.matrix()` for *display*
(`worldPoint(el, pt)`), so handles render in the right place but dragging one writes wrong. **Failure:** drag a
line 3" right (sets `transform="translate(3,0)"`), then Node-drag an endpoint — it jumps an extra +3" past the
cursor and every further drag compounds the error.

**SA-COORD-2 (HIGH/HIGH, corrects SE7n).** SE7n's write-up says rect/circle/ellipse get a *wrong-space write*.
At current HEAD, `dragNode`'s if/else chain has **no branch at all** for those three types — the function falls
through to `_updateHandles()`/`_updateSelectionHighlight()`/`_onChange()` with **zero attribute writes**. The
symptom is "the handle doesn't move at all" (worse for user trust than "moves to the wrong place"), and the
index-skew SE7n describes between `getNodes` and `dragNode` does not currently reproduce for these types — it's a
coverage gap, not an indexing bug, for rect/circle/ellipse specifically. (`getNodes` itself, `editor-hit.js:46-54`,
already has correct rect/circle/ellipse branches — that half of SE7n's description is also stale.)

**SA-COORD-3 (HIGH/HIGH, new — SE7-new: pointer hit-testing).** `getNearbyElement`
(`editor-hit.js:58-80`) hit-tests the world-space pointer against `el.bbox()` — explicitly documented in this same
codebase (`editor-coords.js:10`) as "local bbox, IGNORES transform." Every other bbox-vs-pointer site in the file
(`updateHandles`, `editor-interaction.js:767`; the marquee, `editor-marquee.js:89`) correctly uses `worldBbox(el)`
instead — `getNearbyElement` is the one exception. **Failure:** drag a rect 2" down-right in Select mode (sets a
`transform`, doesn't touch x/y/width/height), deselect, then click where it now visually sits → **nothing selects**
(click point is outside the stale local bbox); clicking the *empty* spot where it used to be *does* select it.
Blast radius: backs click-to-select and hover-highlight for Select, Node, and Text modes, plus double-click-to-edit.

**SA-COORD-4 (MED-HIGH/HIGH traced, new — SE7-new: expand-trace framing).** `expandTrace`
(`editor-expand-trace.js:33-50`) frames its canvg render viewBox from `el.bbox()` (local) while wrapping the
rendered content in `<g transform="${transformAttr}">` (preserving the real transform) — so a moved/rotated
element renders outside the viewBox it's framed against, and `extractLoops` maps pixels back through the same
mismatched local bbox. **Failure:** drag a trace-fallback shape 5" away, run Expand → `"No filled pixels
detected in trace"`, silently, for an element plainly visible on screen.

**SA-COORD-5 (MED/MED, extends SE7s — second call site).** The same `bakeMatrixIntoElement` used by interactive
Flatten (SE7s's "stroke visually scales, Flatten silently reverts it") is *also* the function every carve/export
bake goes through (`editor-io.js:179-192,158-175`), and `carveMatrix()` is never identity (`{a:dpi,...,d:dpi}`).
No `stroke-width` compensation exists in either path — confirmed by grep (0 hits for `stroke-width` in
`editor-io.js`) — even though the codebase already knows how to compensate a scale-dependent attribute on bake
(`_carveTextAnchor` rescales `font-size` by `Math.abs(m.a)`, `editor-io.js:200-201`). Geometry gets no equivalent
treatment. Confidence MED only because whether Fusion actually consumes exported `stroke-width` as a kerf/carve
width is outside this file set — not independently confirmed here.

**How wide:** this is not a case of the boundary never being adopted — the *read* direction (baking `el.matrix()`
for rendering/hit-highlighting) is well-established and used correctly almost everywhere. The gap is specifically
the *write* direction, because no inverse was ever declared. **Proposed declaration:** add `worldToLocal(el, pt)`
to `editor-coords.js` (mirror `worldPoint`'s shape, `el.matrix().inverse()`), and route `dragNode`'s existing
branches plus new rect/circle/ellipse branches through it, and swap `getNearbyElement`'s `el.bbox()` for
`worldBbox(el)`. `editor-coords.js`'s own docstring records this exact bug class has been hit and fixed 4 times
before — all 4 on the read side; the write side has never had that hardening pass. Given the pattern tool's
lattice nodes will exercise dragging heavily, this is worth fixing before that lands, not after a 5th
rediscovery.

---

## Per-gesture undo + change fan-out

**Mechanism:** `pushState()` (`editor.js:261-279`) snapshots undo state only — it does not call `_onChange`.
`_onChange` (wired in `main/app-init.js:169-229`) does, in order: `saveForRasterization()` (full document
re-serialize + enumerate every `<text>`'s font), `P.editorSvg = svg`, `saveLastSession()` (synchronous
`JSON.stringify` + `localStorage.setItem` + a Fusion debug log write), then `refreshAllStampMasks()` — which
**immediately** (not debounced) re-rasterizes every visible content-bearing layer via `updateStampMasks()`, and
only *after* that schedules the (debounced) terrain rebuild. The debounce protects only the final mesh rebuild —
the serialize/localStorage/per-layer-rasterize cost runs in full on every firing.

**SA-UNDO-1 (HIGH/HIGH, new — SE7-new: drag-continuation fan-out).** 3 of the 4 drag-continuation paths call the
real `editor._onChange()` unconditionally on every raw `mousemove`/`pointermove` (plain `window` listener, no
throttle/rAF anywhere in the chain): `dragNode` (`editor-interaction.js:633`), `translateSelection`
(`:646`), `applyTransformDrag` (`editor-transform-handles.js:224`). `pushState()` is correctly gated to fire once,
at `mouseup`, by `_dragMoved` (`editor-interaction.js:318`) — the bug is purely in the `_onChange` fan-out
bypassing that gate. **Contrast (verified correct):** freehand/line/rect/circle drawing, marquee-select, eraser
preview, text sessions, layer CRUD, and Expand all fire `pushState`/`_onChange` exactly once per gesture. **Failure:**
a half-second 50px node-drag or shape-move fires the full remask/rasterize/localStorage pipeline once per native
mousemove event (commonly 15-40+), multiplied by every visible layer — real, measurable jank that gets worse as
the pattern tool adds more layers, i.e. exactly the direction this app is headed. **Proposed fix:** stop calling
the real `_onChange()` from the 3 move-handlers; declare a coalesced `_onDragPreview()` (rAF- or ~100ms-throttled)
for the cheap DOM-only visual feedback they already do separately, and fire the real `_onChange()` exactly once
from `handleEnd`'s existing `if (editor._dragMoved) editor.pushState();` block, alongside `pushState()`.

**SA-UNDO-2 (HIGH/HIGH, new — SE7-new: style-setter gaps).** `setStrokeWidth()` (`editor.js:187-193`) calls
neither `pushState()` nor `_onChange()` (contrast the setter immediately above it, `setStrokeColor`, which at
least calls `pushState`). Confirmed the only callers are the sidebar's `-`/`+`/input stroke-width controls
(`properties-shape.js:10-20`) — no other path. **Failure:** select a shape, change Stroke Width 1.0→3.0. The
on-screen stroke visibly thickens. Ctrl+Z does nothing — not merely batched into the next undo entry, permanently
absent from the stack. The carve preview / exported width also never updates until an unrelated edit happens to
fire `_onChange()`. Since stroke width determines carved line thickness in this app, this is a real WYSIWYG break.

**SA-UNDO-3 (LOW/MED).** `setStrokeColor()` (`editor.js:177-186`) calls `pushState()` but never `_onChange()` —
smaller version of the same gap; undo itself works, only the live preview lags until an unrelated edit.
**Proposed fix (both):** don't patch in isolation — declare one shared `_commitStyleChange()` every style/geometry
setter routes through (pairing `pushState()`+`_onChange()` together, the way `setFontFamily`/`setFontSize`,
`editor-text-style.js:20-59`, already get right), and point both setters at it.

---

## Layers vs. the `P.stampLayers` tooling mirror

**Correction made during compilation:** the sub-audit that found this framed it as "the SE4 mirror-retirement
work missed the export path." **That's not accurate** — `export-flow.js:34-39` carries an explicit, current
comment: *"Tooling (depth/enabled) stays on P.stampLayers[idx] per the dispatch — that part isn't a mirror, it's
the one place tooling lives."* This was a **deliberate SE4a design decision**, verified by reading the comment
directly, not an oversight. The concrete consequences below are still real bugs — they're consequences of that
deliberate choice interacting with `P.stampLayers`'s static 3-entry shape and lack of any resync, not of a rewrite
that was left half-finished. This distinction matters for how it gets fixed: extending/fixing `P.stampLayers`
itself (its cap, its sync) is a different, smaller change than "finish a rewrite that already has a target
pattern to copy" — it needs its own design decision, not a mechanical follow-through of SE4a.

**SA-LAYER-1 (HIGH/HIGH, new — SE7-new: stamp tooling beyond 3 layers).** `_stampExportCandidates()`
(`main/export-flow.js:56-70`) reads `enabled`/`depth`/`profile` **only** from `P.stampLayers?.[idx]`, gating both
`activeStampLayers()` (drives wizard option availability) and `exportableStampLayers()` (the actual export
payload, `export-flow.js:187`). Three independent ways this silently drops a layer from the physical export while
the live 3D preview (which reads `editor._layers` directly, unaffected) shows it fine:
1. **4th+ layer, always** — `P.stampLayers` has exactly 3 static entries (`core/state.js:110-117`); index 3+ is
   `undefined` → `tooling = {}` → `enabled: undefined` → excluded regardless of visibility/content.
2. **Layers 1/2 drawn directly (not Browse-imported), always** — `.enabled` is written only by
   `setStampLayerEnabled()`, whose only live callers are Browse-import success (`svg-source.js:69`) and Clear
   (`:109`); the editor's own visibility toggle (`editor/layers.js`) mutates `editor._layers[i].visible`, never
   `P.stampLayers[i].enabled`. `DEFAULT.stampLayers[1]/[2].enabled` both default `false` and nothing flips them for
   vector-tool-drawn content.
3. **After reorder or a middle-layer delete** — `editor/layers.js`'s `reorderLayer`/`removeLayer` mutate
   `editor._layers` (splice/reinsert) but never touch `P.stampLayers`, so post-op `P.stampLayers[idx]` describes a
   different original layer than whatever now sits at `editor._layers[idx]`.
**Failure scenario:** add a "Layer 2," draw a carve pattern directly with the pen/rect/circle tools, leave it
visible, export STEP / Send-to-Fusion. Live preview shows the carve. The exported part has none of it. For a CNC
picture-frame tool, this is about the most consequential class of silent-wrong-output this audit found.

**SA-LAYER-2 (MED/HIGH, same slice).** `updateP()`'s editor-layer mirror write for the tooling sliders (Depth,
Profile, V-bit Angle, Blur, Smoothing, Suppression, Edge Fillet Radius/Power) is nested *inside* the same
`P.stampLayers[P.activeLayerIdx]` existence check (`core/state.js:356-369`) — so past layer 3 the write into
`editor._layers[idx]` never happens either, not even as a side effect. **Contrast (correct):** the transform
fields (tx/ty/rotation/scale/mirror) use `bindLayerOnlyNumber`/`bindLayerOnlyCheckbox`
(`main/stamp/_dom-binders.js:52-104`), which write `editor._layers[idx]` unconditionally, no gate — these work at
any layer count. **Failure:** activate layer 4, drag its Depth slider — the slider's own value updates, but
`editor._layers[3].depth` never changes, so the carve depth the rebuild actually reads is frozen. The slider is a
placebo past 3 layers.

**SA-LAYER-3 (LOW/HIGH, same slice).** `isFilletActive()` (`main/stamp/_shared.js:44-48`) also reads the stale
3-entry `P.stampLayers`, but only picks immediate-vs-debounced remask timing — the actual rebuild always reads
live `editor._layers`, so the worst case is an extra ~180ms lag, not wrong output.

**Proposed fix (all three, one declaration):** a single `stampToolingForLayer(editor, idx)` sourced entirely from
`editor._layers[idx]` (`{enabled: layer.visible !== false, depth: layer.depth, profile: layer.profile}` — every
field `editor._layers` already carries via `TOOLING_DEFAULTS`), replacing every `P.stampLayers?.[idx]` read in
`export-flow.js`, `updateP`, and `isFilletActive`. This is the same pattern `core/engine/rebuild.js`'s
`_collectStampPasses` already uses correctly — a one-function fix, not three call-site patches. **This reverses
SE4a's "tooling stays on P.stampLayers" decision** rather than extending it, so flag for Fred/advisor sign-off
before implementing, not a unilateral worker call.

---

## Save → reopen → carve round trip

Element-kind coverage (show → save/reopen → carve), traced stage-by-stage: **line, rect, path, polyline, plain
text, expanded text, hidden-layer elements — all consistent at every stage.** Two kinds diverge, both silently:

**SA-ROUNDTRIP-1 (HIGH/HIGH).** `_bakeMatrixIntoPath` (`editor-transform-handles.js:357-369`) pairs every
remaining numeric slot in an SVG path segment as an (x,y) point — correct for M/L/C/S/Q/T, **wrong for `A`
(arc)**, whose 7 params are `rx ry x-rotation large-arc-flag sweep-flag x y` (verified against svg.js 3.2.0's own
`PathArray.js` source). Circles/ellipses get converted to two-half-arc `d` strings by `_primitiveToPathData`
(`:397-413`) before baking, and `bakeMatrixIntoElement` is called on **every** circle/ellipse on **every**
export (`carveMatrix()` is never identity), plus on any circle/ellipse the user Flattens interactively.
**Reproduced with a scratch script (functions copied verbatim):** a 1"-radius circle at (5,3) on a 10×8"/96dpi
board bakes to `d="M -96 -96 A -384 -288 -480 -288 -480 192 3 A -384 -288 -480 -288 -480 0 3 Z"` — flag fields of
`-288`/`-480` are not valid SVG grammar (must be a bare `0`/`1`), so a strict parser must stop mid-path per SVG's
own error-recovery rule; the rest of the shape is silently dropped, not just distorted. The live carve-preview
heightfield is unaffected (it goes through a completely different string-level `<g transform>` path, `core/stamp
/transform.js`, not per-element matrix baking) — which is exactly why this is invisible until the physical part.
**Proposed fix:** give `_bakeMatrixIntoPath` (and the structurally identical loop in `editor-expand-text.js:99-111`
— safe today only because opentype glyphs never emit `A`, same landmine for any future arc source) a declared
per-command coordinate-pair table (`{M:[[1,2]], C:[[1,2],[3,4],[5,6]], A:[[6,7]], ...}`) plus separate scale-only
handling for `A`'s rx/ry and its rotation field, instead of the blind "every remaining pair is a point"
assumption.

**SA-ROUNDTRIP-2 (HIGH/HIGH).** `_carveTextAnchor` (`editor-io.js:194-202`) unconditionally clears the carved
`<text>`'s `transform` and scales `font-size` by `Math.abs(m.a))` alone — correct only with no rotation/skew and
uniform scale. Text CAN be rotated in normal use (select mode selects `<text>` like any other element; transform
handles apply generically, no text exclusion). **Reproduced with a scratch script** (real matrix composition +
the function's literal formula): a 0.5"-font text rotated 45° carves perfectly upright at `font-size=33.94`
instead of `48` — the ratio is exactly `cos(45°)=0.7071`, and the rotation is discarded outright, no error. The
file's own doc-comment at `:154-156` frames this as a stale "Y-flip" concern (that flip was removed per an
earlier note at `:57`) — the actual drop is unconditional for *any* rotation/skew, so the comment is stale
relative to current `carveMatrix`. **Proposed fix:** the code already half-declares the real constraint ("expand
text to paths before carving") but never enforces it — add an export-time check that blocks (or auto-expands)
any `<text>` layer whose combined matrix carries non-trivial rotation/skew/non-uniform scale, rather than
silently dropping it in `_carveTextAnchor`.

---

## Tools vs. declarations

**SA-DECL-1 (MED/HIGH).** `editor-interaction.js`'s own header documents the intended pattern — dispatch via the
declared `modeHandlers` table, "adding a tool is one entry... plus, if it's a drawing tool, one entry in
`createDrawingShape`/`updateDrawingShape`." Only the first half is actually declared (`modeHandlers`,
`:587-596`); `createDrawingShape`/`updateDrawingShape` (`:651-712`) are hand-rolled `if (modeId===...)` chains.
Adding an ellipse tool (in this audit's own dimension list, not currently a toolbar button) means touching 3
separate places instead of one. **Proposed:** fold shape construction into `modeHandlers`-keyed entries (or a
parallel `SHAPE_FACTORY` table with matching keys) so one row covers a whole tool.

**SA-DECL-2 (MED/HIGH).** `updateToolbarVisibility` (`editor-ui.js:133-173`) hand-writes a separate boolean
expression per toolbar group per mode — no single place says "which groups does mode X show." **Proposed:** a
`TOOLBAR_GROUPS_VISIBLE_IN` table, modeled on this same file's own `MODE_HINTS` (`:12-22`).

**SA-DECL-3 (MED/HIGH).** The purpose-specific px values riding on top of the well-declared
`getDynamicTolerance()` conversion (paste-offset 8, hover-hit 10 ×7 sites, freehand-threshold 3, curve-fit 2 ×2,
node-grab 15, node-handle-radius 5, selection-pad 5, expand-trace-hit 1.0) are anonymous numeric literals at each
call site across `editor-interaction.js`, `editor-ui.js:216`, `editor-expand-trace.js:94`. This is exactly the
groundwork SE7m's own (not-yet-built) `INPUT_PROFILE` mobile-tolerance table needs underneath it — a
purpose-keyed `PX_TOLERANCE` table should land before or alongside `INPUT_PROFILE`, not after, so the mobile
multiplier has named purposes to multiply instead of a second layer of anonymous numbers.

**SA-DECL-4 (MED/HIGH).** Element-kind capability rules (fillable vs. stroke-only, which node/handle-edit mode
applies) are repeated `.type===` branches in 3 files (`properties-shape.js:75`, `editor-interaction.js:664-689`,
`editor-hit.js:28-55`/`editor-interaction.js:610-633`) instead of one table — and this is the same missing
declaration that caused SE7n's rect/circle/ellipse gap (SA-COORD-2): nobody has one place that says, per kind,
what a tool may do to it. SE7s's own ROADMAP note already sketches a `HANDLE_EDIT = {line:'endpoints',
circle:'radius', ...}` table for a different axis of the same question — **recommend merging into one
`ELEMENT_KIND_RULES` table** (fillable + handleEdit + nodeEdit columns) rather than three separate ones landing
independently across SE7n/SE7s/SE8.

---

## Dead / doorless / half-built

**SA-DEAD-1 (MED/HIGH).** `core/debug.js` already declares a shared, documented category gate
(`dbg()`/`isDebugEnabled()`, doc-comment lists 5 categories) — correctly used by `editor.js`'s `_undoLog` and
`editor-interaction.js`'s `_strokeLog`. 8 other sites (7 in-scope + 1 in `core/stamp/index.js`, out of scope but
corroborating) bypass it with a hand-rolled, strictly weaker `===`-only duplicate — `editor-eraser.js:45`,
`editor-expand-union.js:26`, `editor-expand-shape.js:46`, `editor-expand.js:12`, `editor-expand-commit.js:37`,
`expand.js:5`, `editor-io.js:18`. None of their 8 categories appear in the doc-comment's list. **Proposed:**
replace each with `dbg('X', ...)`/`isDebugEnabled('X')`, update the doc-comment's category list to the real set.

**SA-DEAD-2 (MED/HIGH).** `updateNodeCountUI` (`editor-ui.js:175-192`) is fully built and wired (`editor._updateNodeCountUI`, `editor.js:365`; a hidden div, `bspline_gen_palette.html:1482`) but `grep -rn
"_updateNodeCountUI("` returns exactly 1 hit — the wiring line itself. Zero callers. **Options (not a unilateral
call):** delete the whole chain as a clean, self-contained removal, or wire it into `dragNode`/`handleMove` if
live node-coordinate feedback during drag is actually wanted — the plumbing is ~90% there.

**SA-DEAD-3 (MED/HIGH).** 3 ids (`editorExpandSmooth`/`-Minus`/`-Plus`) are looked up and wired in
`properties-expand.js:9,13,31-32`, but `grep -n "editorExpandSmooth" bspline_gen_palette.html` → 0 hits — no such
control exists in markup (only the Detail stepper does). Not fully dead: `_expandSimplify` is hardcoded to 15 at
construction (`editor.js:84`) and still works, the user just has no way to change it. **Options:** build the
missing Smoothness stepper (mirror the existing Detail stepper markup) to make the JS reachable, or delete the
dead lookups if 15 is fine forever.

**SA-DEAD-4 (MED/HIGH).** `editorSelectPanel` (`editor-ui.js:153-159`) has 0 hits in the palette HTML. Notably,
`properties-panels.js`'s own header comment documents that this exact id was one of four **deliberately** dropped
from markup during a prior "mobile-UI orphan cleanup" — this later, independent reference in
`updateToolbarVisibility` (unrelated to the old tabbed-panel system that stub describes) was missed by that
cleanup. **Proposed removal chain:** delete lines 153-159; nothing downstream reads the `selectPanel` variable.

**SA-DEAD-5 (LOW/HIGH).** `editorSidebarToggle` (`editor-controls.js:13-18`) — no button in markup, no CSS rule
for `.editor-sidebar.collapsed` anywhere, superseded by SE7m's `@media` responsive layout
(`editor.css:312-331`). Clean removal, safe to fold into SE7m cleanup.

**SA-DEAD-6 (LOW/HIGH).** `editorLayerSelect`'s "compatibility shim" doc-comments (`bspline_gen_palette.html
:1484-1487`, `layers.js:489-491`) name `editor-text-session.js`/`editor-io.js` as still-reading callers —
`grep` finds 0 hits in either file. All 6 remaining in-repo references are inside `layers.js` itself (writer)
or comments. Can't rule out an external (Fusion-side/devtools) consumer, so **not** recommended for removal —
only the stale comments should be corrected.

**SA-DEAD-7 (LOW/HIGH) + SA-DEAD-8 (LOW/HIGH).** `setMode()`'s 3 "special case" `if` blocks
(`editor-ui.js:105-110`) are fully redundant with the generic `.toggle('active', ...)` one line above — provably
by inspection, no input can ever make them differ. A separate empty-body `if` (`:161-166`) computes a real
condition (symbol-keyboard auto-hide) and does nothing with it — its own comment says the real logic lives in
"tool click listeners," but neither `tools/mode-tools.js` nor `tools/action-tools.js` touches that panel at all.
Both are trivial, zero-behavior-change removals in the same function — bundle together.

---

## Text + Expand pipeline

**SA-TEXT-1 (HIGH/HIGH, new).** The editor modal's Cancel button (`tools/action-tools.js:54-56`,
`bind('editorCancel', () => { if (editor._onCommit) editor._onCommit(null); })`) skips `_commitText()` entirely —
contrast Apply immediately above it, which calls it first. `_teardownTextListeners`
(`editor-text-session.js:330-346`, clears the cursor-blink interval and removes the `document`-level `mousedown`
refocus handler) is only ever called from `commitText`/`cancelText`, never from this path. **Failure:** start
editing text, click Cancel (not Escape, not Apply). The modal closes; `editor._editingTextEl` stays truthy
forever, so `_attachRefocusHandler`'s `document` mousedown listener (`:283-315`) keeps firing on *every click
anywhere else in the app* — silently stealing focus back to the offscreen hidden input — until the user reopens
the editor and starts another text edit (which self-heals only as a side effect of the stale-element guard).
**Proposed fix:** declare text-session teardown as something the editor-close contract always runs — call
`editor._commitText()` (or a new `_endTextSession()` that tears down unconditionally, committing only if content
exists) before dispatching to Apply/Cancel, mirroring how `setMode()` already unconditionally commits on tool
switch.

**SA-TEXT-2 (MED-HIGH/HIGH, new) + SA-TEXT-3 (MED/HIGH, new).** `saveForRasterization()`
(`editor-io.js:294-332`) embeds a fresh `<defs class="rasterization-fonts">` block into the persisted document
every call; `open()` (`:465-592`) injects the **entire** saved document — including any previously-embedded defs
block — as live sketch-layer children, and strips only `.editor-metadata` (`:518-519`), never
`.rasterization-fonts`. Each open→edit→close cycle nests one more copy, growing the persisted payload (and
`localStorage`) unboundedly. Separately, if `data-editor-layers` is ever missing/corrupt, the reconcile fallback
(`_reconcileLayersFromSvg`, `:423-431,449-452`) treats any child lacking `data-layer` as an orphan and stamps a
layer id onto it — including that same undecorated defs block. **Proposed fix:** add `.rasterization-fonts` to
the same strip step as `.editor-metadata` on reopen, and exclude `defs`/`style`/`title`/`desc` node types from
the orphan walk (`_carveChildren` in `bakeSvgForCarving` already has this skip-list, `editor-io.js:182` —
declare it once, reuse in both places).

**SA-TEXT-4 (MED/HIGH, new).** Expand is a one-way trip: `data-original-text-svg`/`data-original-svg`
(`editor-expand-commit.js:107-121`) survive save/reopen and are read back exactly once — by `expand-trace.js:46`,
to re-run Expand at different detail settings, **not** to restore an editable `<text>`. No code path anywhere
decodes them back into a live text node (grepped every read site repo-wide). The only alternative, Ctrl+Z, is cut
off because `open()` unconditionally wipes `_undoStack`/`_redoStack` on every call (`:479-485`) — so the escape
hatch survives only until the editor is closed and reopened once. **Proposed:** if round-trip-to-text is wanted,
declare a real "Edit source text" action (decode `data-original-text-svg`, swap it back into the sketch layer);
if intentionally one-way, correct the comment that currently oversells recoverability.

**SA-TEXT-5 (LOW-MED/HIGH).** `editor-expand-commit.js:24-31`'s doc-comment still states, present-tense, that
`data-original-svg` "contains raw SVG markup... the resulting saved SVG is INVALID XML" — describing pre-EDM2
behavior. The function itself (`:117-121`) has base64-encoded new snapshots via `encodeSnapshot` for a while now,
and `tests/editor-serialization.test.js:94-111` (EDM2) proves the fix holds. Docs-only fix: update to past tense.

**SA-TEXT-6 (LOW-MED/HIGH-for-duplication).** `editor-fonts.js`'s header explicitly claims `FONT_MAP` is "the
single source of truth," true for the opentype path, the on-screen keyboard, and the runtime self-test — but
**not** for `core/stamp/render-svg.js:12-24`'s `KNOWN_FONTS` (a separately hand-typed rasterizer whitelist) or
`bspline_gen_palette.html:1306-1310`'s font `<select>` (a third, currently-smaller hand-typed list). They happen
to agree today (diffed). **Latent risk:** a future font added to `FONT_MAP` per its own "one-line change" promise
would silently rasterize/carve as Arial-substituted if the dev doesn't separately know to touch `render-svg.js`.
**Proposed:** derive `KNOWN_FONTS` from `Object.keys(FONT_MAP)` instead of retyping it.

**SA-TEXT-7 (LOW/HIGH).** `core/debug.js:7`'s doc says "off by default"; `:19` sets `let _flag = 'TEXT-DBG'` as
the actual baseline, and nothing at boot ever resets it. All 20 `dbg('TEXT-DBG', ...)` calls in
`editor-text-session.js` (confirmed exact count via grep — genuinely well-targeted instrumentation around the
file's documented fragile mobile-focus dance, not leftover noise) fire live in production on every keystroke/
click near the text tool. **Proposed:** default `_flag` to `false`, matching the documented contract.

---

## Mobile readiness (beyond SE7m)

**Re-verified SE7m at current HEAD despite seat A's concurrent edits:** `editor-interaction.js:233`
(`if (e.type==='touchstart' && e.touches.length>1) return;`) unchanged — confirmed still current.

**Zoom and pan are both fully unreachable on touch — the two most severe findings in this dimension:**
- **SA-MOBILE-13 (HIGH/HIGH, new).** `html, body { touch-action: none; }` is set **globally**
  (`styles/base.css:36-45`). Per the CSS Touch Action spec, a descendant cannot re-enable a gesture an ancestor
  disabled — this one rule kills native pinch-zoom for the **entire page**, not just the 3D viewport. It directly
  contradicts the page's own adjacent comment (`bspline_gen_palette.html:6-9`): *"the rest of the page must
  remain pinch-zoomable"* (a stated WCAG 1.4.4 requirement) — the rule as written opts out the whole page, not
  just the 3D canvas the comment says should. Combined with SE7m's multi-touch drop, there is currently **no way
  to zoom the editor canvas on a touchscreen at all** — neither the browser's native gesture (blocked site-wide)
  nor the app's own (mouse-wheel only, no touch path). **Proposed:** scope `touch-action: none` down to just the
  3D canvas per the comment's own stated intent, restoring page-level pinch-zoom as the fallback everywhere else.
- **SA-MOBILE-14 (HIGH/HIGH, new).** No touch pan path either — pan is gated on middle-click or
  Space+left-drag (`editor-interaction.js:237`), and there's no dedicated on-screen pan tool among the 13 sidebar
  buttons. Combined with the above, a phone user cannot navigate the canvas beyond the initial fitted view.
- **SA-MOBILE-15 (LOW forward-looking).** Canvas `touchmove` never calls `preventDefault()` — harmless only
  because SA-MOBILE-13's blanket rule already suppresses it; fixing 13 without also scoping this correctly would
  re-introduce native-page-scroll-fights-drawing underneath the canvas. Carries this as a fix dependency.

**Hit targets:** select/hover hit radius 10px screen (SA-MOBILE-1), node-grab 15px (SA-MOBILE-2) — both
marginal for a fingertip but at least screen-px-based. **Transform handles are the one exception** (SA-MOBILE-3,
HIGH/HIGH-formula): sized from a *model-space viewBox fraction* (`editor-transform-handles.js:59-65`,
`sz = Math.max(viewMin*0.012, 0.05)`), not corrected for container size the way `getDynamicTolerance` is —
estimated to shrink roughly 2× on a ~350px phone container vs. an ~800px desktop one at the same zoom. Toolbar
buttons land at 38px under two conflicting mobile breakpoints (SA-MOBILE-4), still under the ~44px guideline.

**Hover-only, no fallback:** the per-layer delete (trash) button is `visibility:hidden` until `:hover`
(SA-MOBILE-8, HIGH/HIGH) — confirmed zero JS mouseenter/touch equivalent anywhere in the tree — **layers are
undeletable on a phone.** Tool instructions live only in hover `title` tooltips (SA-MOBILE-9, partially
mitigated by an existing `#editorStatusHint` bar that doesn't cover the keyboard-specific parts).

**Keyboard-only, no on-screen equivalent:** copy/paste/select-all (SA-MOBILE-11), Shift-modifier precision aids
(SA-MOBILE-12, lower severity — nice-to-have, not core). Pen-path Escape-cancel has no dedicated button
(SA-MOBILE-10) but switching tools silently cancels it as an undocumented side effect — not a hard dead-end, just
undiscoverable.

**Layout at 390px:** properties bar correctly degrades to a scrollable strip (verified clean, not filed).
Layers panel likely floats mis-sized in the column layout — its own code comment already promises a
collapse-behind-a-toggle that was never built (SA-MOBILE-6). One dead CSS rule found in the responsive cascade
(SA-MOBILE-5, low — a trap for future edits, not a live bug).

---

## Proposed order of new/extended slices

Ordered by the audit's own severity rubric — **silent wrong physical output first**, then interaction-breaking
bugs, then perf/undo, then lifecycle bugs, then the already-planned mobile work (this audit adds detail/priority
within it), then hygiene last:

1. **SE7u (new) — carve-bake correctness: arc + rotated-text corruption.** SA-ROUNDTRIP-1, SA-ROUNDTRIP-2. Both
   are the audit's own definition of a HIGH finding (looks right in editor and preview, carves wrong, no error).
   Cheap, well-scoped fix (a declared per-command coordinate table + an export-time transform check).
2. **SE7w (new, needs Fred/advisor sign-off — reverses an SE4a decision) — stamp tooling beyond 3 layers.**
   SA-LAYER-1/2/3. Also silent-wrong-output-on-export, for a very plausible user action (4th layer, or drawing
   directly instead of Browse-importing). Flagged for a design decision, not a unilateral worker fix, because it
   changes where tooling data lives.
3. **SE7-new (new) — pointer/hit-test correctness: `worldToLocal` + `getNearbyElement`.** SA-COORD-1, SA-COORD-2
   (corrects SE7n), SA-COORD-3. Declare the missing inverse helper once, fix 3 call sites through it. Not
   carve-silent, but breaks basic click-to-select/drag on any moved element — high user-visible disruption.
4. **SE7v (new) — undo/change-fan-out coalescing.** SA-UNDO-1 (perf: full remask per mousemove), SA-UNDO-2/3
   (stroke-width/color undo gaps). One shared committed-write pattern fixes both classes.
5. **SE7x (new) — text-session + Expand lifecycle.** SA-TEXT-1 (listener leak — the highest-severity item in this
   cluster), SA-TEXT-2/3 (defs accumulation + mis-reconcile), SA-TEXT-4 (Expand one-way trip), plus the LOW
   doc/hygiene items (SA-TEXT-5/6/7) as cheap same-file riders.
6. **SE7t (new) — expand-trace coordinate framing.** SA-COORD-4. Narrower blast radius (trace-fallback strategy
   only), can trail the higher-priority coordinate work.
7. **SE7m (extend, already planned) — mobile.** This audit's contribution: prioritize SA-MOBILE-13+14 (zoom AND
   pan both fully unreachable — the two most severe items) and SA-MOBILE-8 (undeletable layers) ahead of the
   hit-target/layout polish items (1,2,3,4,6,9,10,11,12); land SA-DECL-3's `PX_TOLERANCE` naming first so
   SE7m's own `INPUT_PROFILE` table has named purposes to multiply.
8. **SE8 (new) — tool/UI declarations + dead-code sweep.** SA-DECL-1/2/3 (fold SA-DECL-4 into whichever of
   SE7n/SE7s lands the merged `ELEMENT_KIND_RULES`/`HANDLE_EDIT` table instead), SA-DEAD-1 (debug-gate
   consolidation), and the pure-removal batch SA-DEAD-5/7/8 (zero behavior change, no design decision needed).
   SA-DEAD-2/3/4 need a product decision first (revive vs. delete each half-built UI) — bundle those three
   together as one small decision point rather than resolving piecemeal.

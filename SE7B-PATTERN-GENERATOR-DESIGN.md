# SE7b — the Lattice PATTERN generator (declared pattern → Generate → ordinary editable geometry)

Design only. No product code changed in this turn. File:line references are against lane-b HEAD (post
`898ee73` merge — SE8a/SE5a/SE5b in main, SE7n `5cea9dd` in main). Read at current HEAD; nothing under
`editor/` was edited.

## What this closes (Fred's ask, ROADMAP "SE7 — Lattice")

Option B (the interactive Lattice tool — drag a row for a rail, a column for a tie, click for a node,
auto-nodes at ends/crossings) is SE7a, already live. Option C is this: **a declared pattern that
Generates the SAME kind of ordinary rails/ties/nodes in one shot** — reproducible from a seed like the
terrain, editable afterwards with every existing tool (Select, Node, transform handles, Delete), and
must work at 390px (SE7m adds touch input; this design must not assume hover to be usable, per the
dispatch).

## Ground truth — what SE7a/SE6 already declared, and what this design reuses wholesale

Read `editor/editor-lattice.js` (147 lines), `editor/editor-grid.js` (183 lines), `editor/layers.js`'s
layer-CRUD functions, and `core/noise.js`/`core/terrain.js` for the seed mechanism, before designing
anything new. Three things are already exactly the primitives this feature needs — SE7b's job is
composition, not new geometry/DOM machinery:

1. **Emission is already declared and DOM-correct.** `emitSegment(editor, kind, a, b)`
   (`editor-lattice.js:119-126`) and `emitNode(editor, p)` (`:132-147`) already do the real work: pull
   `data-layer` from `ensureActiveLayer(editor)`, stamp `data-lattice="rail"|"tie"|"node"`
   (`LATTICE_ATTR`, `:21`), apply stroke/fill from the editor's current style state. A manually-drawn
   lattice element (SE7a) and a Generated one are the SAME element shape — this is what "editable
   afterwards with every tool" means concretely: there is no separate generated-element type to teach
   the rest of the editor about.
2. **Lattice math is already pure and tested.** `toLattice`/`fromLattice`/`classifyDrag`/`constrain`/
   `latticeCrossings` (`:28-87`) have no DOM dependency. `latticeCrossings(seg, segs)` in particular —
   rail×tie crossing points, deduped by `{i,j}` — is EXACTLY the primitive Generate needs for
   `nodes.crossings`; no new crossing math to write.
3. **Layer creation/tooling is already declared.** `addLayer(editor, opts)` (`editor/layers.js:115-138`)
   takes `{id, name, visible, ...toolingOverrides}`, fills the rest from `TOOLING_DEFAULTS`
   (`layers.js:37-52`), and — critically for undo (§4) — accepts `{skipUndo: true}`. `setActiveLayer`
   (`:230-248`) does **not** push undo. This means Generate can create/select all 3 layers and emit every
   element without touching the undo stack at all, then push exactly once at the end — the same shape
   `action-tools.js`'s `editorClear` handler already uses (`_sketchLayer` mutations, then one
   `pushState()` + one `_onChange()`).
4. **Gesture-completion already has ONE hook point.** `handleEnd` (`editor-interaction.js:307-334`) is
   where node-drag, transform-drag, and select-translate all converge before `if (editor._dragMoved)
   editor.pushState();` (`:330`) — the ownership-detach hook in §2 lives here, not scattered across the
   3 move-handlers.
5. **The seed mechanism already exists, and reusing it needs one small extension, not a new RNG.**
   `core/noise.js`'s `PerlinNoise` class (exported, `new PerlinNoise(seed)`) is what `core/terrain.js`
   seeds the coarse/warp/fine fields with (`terrain.js:37-39`). But Perlin noise is the wrong shape for
   Generate's actual decisions ("does column i get a tie, yes/no" — an independent per-column draw, not
   a spatially-correlated field; thresholded Perlin would visibly clump neighboring columns together).
   The closer match is `terrain.js`'s own **`lcgPoints(seed, count)`** (`terrain.js:309-318`) — a plain
   seeded LCG producing independent `{u,v}` draws in `[0,1)`, already used for the same "arbitrary-
   looking but reproducible discrete placement" job (seed-panel point scattering, `terrain.js:192`,
   `lcgPoints(seed ^ 0xdeadbeef, count)`). **It is not exported.** Slice 1 exports it (one line) rather
   than SE7b hand-rolling a second copy — this is the literal "find the RNG and reuse it, do not add a
   second one" instruction. **Named, not fixed, in this design:** `lcgPoints` and `noise.js`'s
   `buildPerm` (`noise.js:7-20`) already independently hand-roll the identical Numerical-Recipes LCG step
   (`Math.imul(s, 1664525) + 1013904223`) — a real, pre-existing "declare once" gap this design does NOT
   fix (out of scope for a lattice feature), flagged here so it's on record rather than silently noticed
   and dropped.

---

## 1. The pattern as data

```js
PATTERN = {
  id: 'lattice-1',            // stable across Regenerate; see §2 for why this exists
  spacing: 0.25,               // reuses GRID_SPACINGS' vocabulary (editor-grid.js:18) — the panel's
                                // spacing control should BE a GRID_SPACINGS dropdown, not a second list
  extent: { mode: 'board' } | { mode: 'rect', iMin, jMin, iMax, jMax },  // lattice coords (see below)
  rails:  { every: 2, offset: 0 },                 // row j included when (j - offset) % every === 0
  ties:   { density: 0.4, spanMin: 1, spanMax: 3, columns: null },  // columns: explicit i[] overrides density
  nodes:  { ends: true, crossings: true },
  layers: { rails: null, ties: null, nodes: null },  // editor layer ids; null = "create on first Generate"
  seed:   42,
}
```

**Where it lives — document-level, mirroring `data-editor-layers`, not a per-layer field.** A pattern
spans 3 layers by construction (it isn't a property of any one of them), so it gets its own root
attribute, `data-lattice-pattern="<json>"`, written and read at the exact 3 call sites
`_serializeLayersAttr`/`data-editor-layers` already use: `save()` (`editor-io.js:205-220`),
`saveForRasterization()` (`:316-354`), `saveWithTextCopies()` (`:356-392`) on the write side, `open()`
(`:487+`, alongside the existing `data-editor-layers` read at `:555-563`) on the read side. Declare a
sibling `_serializeLatticePatternAttr(editor)` next to `_serializeLayersAttr` (`:68-90`) rather than
inlining JSON.stringify at 3 call sites — same reason `_serializeLayersAttr` itself is a named function
and not copy-pasted 3 times. **This is one JSON blob, not three** — exactly the SE4/SE5 lesson applied
going forward instead of retroactively: one document-level fact, one attribute, read/written through one
named function, at the same call sites its sibling already established as correct.

**`extent`:** `{mode:'board'}` derives `{iMin:0, jMin:0, iMax:toLattice({x:editor._mW,y:editor._mH},
spacing).i, iMax:...}` from the board dims already on `editor` (`editor.js`'s `_mW`/`_mH`, inches, same
units `toLattice`/`fromLattice` already assume per their own doc comments). `{mode:'rect', ...}` is for a
future "pattern only in this region" — not needed for slice 1, declared now so the shape doesn't need a
breaking change later (a cheap, near-free declaration per this project's own stated principle — the cost
of NOT declaring it is a shape migration later, the cost of declaring it now is 4 extra fields nothing
reads yet).

**`layers`:** ids, not tooling — tooling lives on the editor layer itself (SE5, `TOOLING_DEFAULTS`), not
duplicated into `PATTERN`. First Generate creates 3 layers named "Rails"/"Ties"/"Nodes" via `addLayer`
with tooling overrides matching "the color mapping of the piece" (ROADMAP:519 — Fred's own framing: rails/
ties/nodes ARE the tooling-per-layer color mapping) — e.g. distinct `depth`/`profile` per layer,
exact values are a live-tuning question for whoever builds slice 2, not fixed here. Subsequent Generates
reuse the same 3 ids from `PATTERN.layers` (created once, referenced by id thereafter) — this is also
why `layers` holds ids and not a boolean "has layers been created": an id survives a rename, a boolean
doesn't tell you WHICH layer.

---

## 2. One-way generation + ownership

**Ownership marking:** every element Generate creates gets `data-lattice-gen="<PATTERN.id>"` alongside
its existing `data-lattice="rail"|"tie"|"node"` (`LATTICE_ATTR`) — a sibling attribute on the same
element, not a new element wrapper or a parallel list. `PATTERN.id` (not a bare boolean) is what makes
Regenerate's query exact — `[data-lattice-gen="lattice-1"]` — rather than "every lattice element,"
which would also catch hand-drawn SE7a rails/ties that were never Generated at all and must never be
touched by Regenerate.

**Regenerate's algorithm:**
1. Query `editor._sketchLayer`'s children for `[data-lattice-gen="${PATTERN.id}"]` — the full owned set.
2. Remove them all (plain DOM removal, like `editorClear`'s per-layer removal in `svg-source.js`'s Clear
   handler — no `pushState`/`_onChange` per removal, batched into the one Generate-level push per §4).
3. Recompute the pattern from current `PATTERN` fields (§1's algorithm, below) and emit fresh elements,
   tagged with the SAME `PATTERN.id` (it didn't change — the user edited spacing/density/etc., not
   started a new pattern).
4. Elements that were never owned (hand-drawn SE7a content, or elements that WERE owned but got detached
   — next paragraph) are never queried, never touched. This is the whole "one-way, never touches
   hand-edited ones" guarantee, and it's structural (a CSS-attribute-selector query), not a diffing
   algorithm — no second store to keep in sync (the SE4 lesson, applied to a brand-new feature instead of
   retrofitted onto one).

**What an edit does to ownership — the fork the dispatch asks me to resolve, resolved:** ANY interactive
edit to a generated element strips `data-lattice-gen` from it. Concretely: hook `handleEnd`
(`editor-interaction.js:307-334`), right before the existing `if (editor._dragMoved) editor.pushState();`
at `:330` — if the drag just completed touched an element (or elements, for a multi-select transform)
carrying `data-lattice-gen`, remove that attribute from each before the push, so the detach lands in the
SAME undo snapshot as the edit that caused it (one undo step reverts both the move AND re-establishes
ownership — no split-brain state where undo puts the element back but leaves it detached, or vice versa).
Node-drag, translate, and transform-handle drags all converge at this one point already (`wasNodeDrag`/
`wasTransform` checks at `:320-321`), so this is one hook, not three. Deletion (eraser stroke, Delete key,
sidebar/modal Clear) needs no special handling — the element stops existing, and a later Regenerate
recreates a fresh one at that lattice cell if the current pattern still calls for it there.
**Reasoning for "detach on ANY touch," not "detach only on a content-changing edit":** matches the
standard generative-fill mental model (symbol instances in vector tools "eject" on first edit); it's also
the simplest rule to implement correctly at one hook point, versus trying to distinguish "just reselected
it" from "actually moved it" (`_dragMoved`, already checked at `:330`, already gates on real movement —
a click-without-drag does NOT strip ownership, since `_dragMoved` stays false and the hook only fires
inside that same `if`).

**Known rough edge, named rather than silently accepted:** if a user detaches a tie at column 5 (moves
it), then Regenerates with `ties.columns` still including column 5, a fresh tie is generated at column 5
too — the detached one and the new one now coexist, visually overlapping at their original position. Not
fixed in slice 1 (it needs Regenerate to check "is this lattice cell already occupied by a DETACHED
element" before placing new content there, an extra query per candidate cell). Flagged as a slice-3-or-
later refinement, not silently designed away.

**Generate creates and owns; Regenerate only replaces what it owns.** First Generate (no existing
`data-lattice-pattern`) creates the 3 layers (§3) and PATTERN.id fresh. Every subsequent invocation of
the panel's Generate button (until "New Pattern," if that ever exists — not in scope) is a Regenerate
against the SAME id.

---

## 3. Layers

First Generate: `addLayer(editor, {name:'Rails', ...toolingOverrides, skipUndo:true})` ×3 (Rails/Ties/
Nodes), store the 3 returned `.id`s into `PATTERN.layers`. If `editor._layers` already has layers with
those exact ids (a Regenerate after a reload, or after the user manually created same-named layers —
edge case, resolved by ID not name), reuse them rather than creating duplicates — check
`editor._layers.some(l => l.id === PATTERN.layers.rails)` before calling `addLayer`.

**Interaction with SE5 (tooling on the editor layer):** no interaction needed beyond "use the existing
mechanism" — `addLayer`'s tooling-override params ARE SE5's single store; Generate doesn't invent a
second tooling path, it just calls the one that already exists with 3 different default sets (rail/tie/
node depth+profile, matching the piece's red/yellow/dark color-to-tooling mapping Fred described).

**Interaction with the user's EXISTING layers:** Generate's 3 layers are ordinary editor layers — they
show in the layers panel, can be renamed/reordered/hidden/deleted like any other. Deleting one of them
(via the layers panel's own remove) does NOT special-case anything — `removeLayer` (`layers.js:140-163`)
already removes that layer's elements, and if the user then Regenerates, `PATTERN.layers.rails` (say)
now points at a dead id; `addLayer` recreates it fresh (per the reuse-check above finding no match) —
this is not a new failure mode, it degrades to "first Generate" behavior automatically.

---

## 4. Undo

Generate/Regenerate is **exactly one step on the editor's undo stack** — the same "editor's own stack,
not the global one" scope SE4c/SE5's final ruling already established for drawing content (ROADMAP:589,
"drawing content edited in the editor modal → the editor's own stack"). Mechanism: every internal
operation (layer creation via `addLayer{skipUndo:true}`, `setActiveLayer` switches, element removal,
`emitSegment`/`emitNode` calls) is undo-silent by construction (per the Ground Truth section — none of
these push on their own except `addLayer` without `skipUndo`, which Generate never calls). One explicit
`editor.pushState(); editor._onChange();` at the very end of the whole Generate/Regenerate function —
the exact `editorClear` shape (`action-tools.js`'s Clear handler: mutate, then one push, one onChange).

---

## 5. Panel UI (390px first)

No hover-dependent affordance (matches T16's `(hover: none)`/`(pointer: coarse)` precedent set for the
rest of the editor this same lane). Every control is a real tap target, not a hover-reveal.

```
┌─────────────────────────────────┐  390px width
│ Lattice Pattern           [ ⓧ ] │  header + close
├─────────────────────────────────┤
│ Spacing    [ 0.25" ▾ ]          │  <- GRID_SPACINGS dropdown, reused
│                                  │
│ Rails      every [2 ▾] row(s)   │
│            offset [0 ▾]         │
│                                  │
│ Ties       density [====----]   │  <- range input, 0..1, live % label
│            span [1] to [3] rows │
│            columns  ( ) auto    │  radio: auto (density) vs hand-pick
│                      ( ) pick…  │  "pick…" opens a lattice-column tap
│                                  │  mode (SE7m territory — touch-first,
│                                  │  no hover needed either way)
│                                  │
│ Nodes      [x] at tie ends      │  checkboxes — real tap targets, no
│            [x] at crossings     │  hover-reveal
│                                  │
│ Seed       [ 42 ] [ ⟳ ]         │  number input + reroll button
│                                  │  (regenerates ties.columns' random
│                                  │  choice when columns=auto; rails are
│                                  │  deterministic from every/offset,
│                                  │  not seed-dependent, so reroll only
│                                  │  visibly changes ties unless spans
│                                  │  also draw from the seed — they do)
│                                  │
│ [   Generate / Regenerate    ]  │  <- full-width, single primary action;
│                                  │     label reads "Regenerate" once
│                                  │     PATTERN.id already exists
│ [   Detach all            ]     │  <- secondary; strips data-lattice-gen
│                                  │     from every owned element WITHOUT
│                                  │     deleting them (the inverse of the
│                                  │     handleEnd hook in §2 — bulk detach,
│                                  │     no drag needed) so the user can
│                                  │     "keep this as a starting point,
│                                  │     stop tracking it as generated"
└─────────────────────────────────┘
```

**No live preview-before-commit.** Recommendation: skip it for slice 1. Reasoning: Generate is already
one undo step and non-destructive to hand-edited content by construction (§2) — the cost of "just
Generate, then Ctrl+Z if wrong" is one keystroke, same cost a live-preview toggle would have to beat, and
a live preview means rendering the pattern algorithm on every slider tick (density, spacing, span) without
committing — real added complexity (a shadow/ghost render path) for a feature whose actual commit cost is
already near-zero. Named as a real UX tradeoff, not asserted as obviously right — if Fred's actual usage
shows "I keep Generate → doesn't look right → Ctrl+Z → tweak → Generate again" as a slow loop in practice,
a preview is the fix, but that's a decision to make from live use (matching how SE7s/SE7m's own scope
changes in ROADMAP came from Fred using the tool, not from this design guessing ahead of usage).

**"Detach all"** is the panel's one gesture-free ownership operation — useful specifically because §2's
per-drag detach hook requires an actual drag; a user who wants to "accept this pattern as a starting point
and never have Regenerate touch it again" without individually nudging every element needs a bulk action.

---

## 6. Slices

### Slice 1 — the pure pattern algorithm + RNG export, no editor/DOM code
- Export `lcgPoints` from `core/terrain.js` (one line: add `export` to its declaration at `:309`) — the
  RNG reuse the dispatch asked for, not a new one.
- New pure module `editor/editor-lattice-pattern.js` (mirrors `editor-lattice.js`'s own pure/DOM split,
  `editor-lattice.js:8-13`'s own stated convention): `computePattern(PATTERN, opts)` →
  `{ segments: [{kind, a, b}], nodePoints: [{i,j}] }`, built entirely from `toLattice`/`fromLattice`/
  `classifyDrag`/`constrain`/`latticeCrossings` (imported from `editor-lattice.js`, not reimplemented) and
  `lcgPoints` (imported from `core/terrain.js`). No svg.js, no DOM, no `editor` object — takes plain data,
  returns plain data, exactly like `toLattice`/`constrain` already do.
- Predicted files: `core/terrain.js`, `editor/editor-lattice-pattern.js` (new), `tests/
  editor-lattice-pattern.test.js` (new) — 3 files.
- Verify: determinism (same `PATTERN` object, including seed → byte-identical `segments`/`nodePoints`
  arrays across two calls); `rails.every=2` on a 10-row extent produces exactly 5 rail segments, each
  spanning the full `iMin..iMax`; `ties.columns` explicit list bypasses `lcgPoints` entirely (no seed
  dependency when hand-picked); a fixed seed + `ties.density=1.0` produces ties on every column
  (density=1 shouldn't need the RNG to matter — boundary case worth its own test); crossings computed via
  `latticeCrossings` match a hand-computed small example (3 rails × 2 ties → up to 6 crossing points,
  fewer if some don't overlap in span).

### Slice 2 — layer creation + DOM emission + document-level persistence
- `editor/editor-lattice-pattern.js` gains `generatePattern(editor, PATTERN)` (or a sibling
  DOM-touching function, per the file's own pure/impure split) — calls `computePattern`, then
  `addLayer`/`setActiveLayer`/`emitSegment`/`emitNode` per §2/§3's algorithm, tags `data-lattice-gen`,
  ends with one `pushState()`/`_onChange()` (§4).
- `editor/editor-io.js`: `_serializeLatticePatternAttr` (mirrors `_serializeLayersAttr`), wired at the
  same 3 save call sites + the 1 open call site (§1).
- Predicted files: `editor/editor-lattice-pattern.js`, `editor/editor-io.js`, `tests/
  editor-lattice-pattern-emit.test.js` (new, DOM-level) — 3 files (mock `editor._sketchLayer`/`_layers`
  the same way `tests/se5a-tooling-single-store.test.js`/`tests/export-flow.test.js` already do — an
  established pattern in this test suite, not a new mocking style).
- Verify: Generate on a fresh editor creates exactly 3 layers named Rails/Ties/Nodes with the right
  tooling defaults; every emitted element carries both `data-lattice` and `data-lattice-gen`; Regenerate
  on an unchanged `PATTERN` produces byte-identical `data-layer`/geometry to the first Generate (proves
  the replace-in-place path doesn't silently drift); save → reopen round-trips `data-lattice-pattern` and
  a subsequent Regenerate still finds/replaces the right elements (ownership survives serialize/parse,
  not just an in-memory session); Regenerate after a hand-edit (simulate the `handleEnd` detach — strip
  `data-lattice-gen` from one owned element directly in the test, matching what §2's hook would do) leaves
  that one element completely untouched (same node reference, same attributes) while replacing the rest.

### Slice 3 — ownership-detach hook + panel UI
- `editor/editor-interaction.js`: the `handleEnd` hook (§2) — strip `data-lattice-gen` from the drag
  target(s) before `pushState()`.
- New "Detach all" action, wired the same way `editorClear` is (`tools/action-tools.js`).
- Panel markup + wiring in `bspline_gen_palette.html`/a new `main/stamp/lattice-pattern.js` (matching this
  codebase's existing per-panel-module convention, `main/stamp/layer.js`/`depth.js`/etc.) + `styles/
  editor.css` (390px-first, no hover-only controls, per §5).
- Predicted files: `editor-interaction.js`, `bspline_gen_palette.html`, `main/stamp/lattice-pattern.js`
  (new), `styles/editor.css`, `tests/editor-interaction-lattice-detach.test.js` (new) — 5 files.
- Verify: dragging a generated tie via Select strips its `data-lattice-gen` in the same `pushState()` as
  the move (one undo step reverts both); a click-without-drag on a generated element does NOT strip
  ownership (`_dragMoved` stays false); "Detach all" strips every owned element's tag without deleting or
  moving anything; live proof (390px capture, Generate/Regenerate/Detach all reachable and legible without
  a mouse hover) is the advisor's, per this lane's established pattern for CSS/UX verification.

---

## Open questions for Fred/advisor before slice 2 starts

1. **Tie placement anchoring.** "Yellow vertical ties of 1–3 rows" (ROADMAP:517) reads as ties bridging
   BETWEEN rail rows, not floating mid-span — should a tie's span be anchored to start/end AT a rail row
   (so it visually connects two rails), or purely random within the column's full row range? This design
   assumed the former (ties anchored to rail rows) is closer to the photo's described look, but it's a
   real visual-judgment call, not something derivable from the code alone — flagging rather than
   guessing silently, per this lane's own established discipline for genuine design forks.
2. **Rail/tie/node tooling defaults** (exact depth/profile per layer) — not fixed in this design; a
   live-tuning question for whoever implements slice 2, same as SE5's tooling defaults were tuned in
   practice, not pre-specified in that design doc either.
3. **The "already generated, but detach-overlap" rough edge** named in §2 — confirm slice 1-3 scope is
   right to defer it, or pull the "skip occupied detached cells" check into slice 2/3 if Fred considers it
   a first-cut requirement rather than a refinement.

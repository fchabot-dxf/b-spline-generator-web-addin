# SE13 — Boundary mode for the Lattice (fill any closed shape, ending rules not trimming)

Design only. No product code changed this turn. File:line references are against lane-b HEAD (post
`6f3d4ee`, T45 + circle-export add-on merged). Nothing under `editor/`/`main/` was edited.

## What this closes (Fred's ask)

A screenshot of Fred's own `svgcreator.pages.dev` "Mondrian" effect: a closed boundary filled with a grid
of lines, cut into colored runs, with dots at junctions. His own framing, verbatim: "Make a new tool like
lattice that can create this kind of shape system — make a plan." Then, correcting scope: **"not sure you
should reuse the STYLE, the LOGIC is good."** Then the one hard constraint this whole design turns on:
**"Don't trim, add ending logic — if it's simpler than trimming."**

Not a new tool: a **Boundary: Board | Shape** mode of the existing Lattice panel. Everything already built
carries over — Add Rail/Tie/Node, drag-stretch/drag-move, Widths, Colors, per-layer `pattern`, Generate =
new seed, ownership + Detach all, undo, save/load.

## Ground truth — what SE7a/SE7b/SE7i already declared, reused wholesale

Two research passes this turn, not assumed from memory: one over the CURRENT Lattice implementation
(`editor/editor-lattice-pattern.js`, `editor/editor-lattice.js`, `editor/properties-lattice.js`,
`editor/editor-interaction.js`, `editor/editor-io.js`), one over the reference site's own deployed source
(`reference/svgcreator-deployed/`, untracked, cited by path/line, never copied).

**1. `PATTERN` is per-layer, already richer than SE7b's own original doc.**
`PATTERN_DEFAULTS` (`editor-lattice-pattern.js:63-116`):
```js
{
  spacing: 0.25, orientation: 'horizontal', margin: 1,
  rails: { every: 2, offset: 0 },
  ties: { density: 0.4, spanMin: 1, spanMax: 3, columns: null, anchor: 'free', railSnapRows: 1 },
  nodes: { ends: true, crossings: true, railEnds: false },
  colors: { rails: '#c62828', ties: '#f9c80e', nodes: '#1a237e' },
  widths: { rails: 0.07, ties: 0.055, nodeRadius: 0.075 },
  seed: 42,
}
```
plus `id` (assigned on first Generate, drives the Generate/Regenerate label) and `extent`
(`{mode:'board'}` default, or `{mode:'rect', iMin,jMin,iMax,jMax}`). Lives at `layer.pattern`, one field in
`_PERSISTED_LAYER_FIELDS` (`editor-io.js:81-93`) — plain `JSON.stringify`, no special-casing, already
round-trips through save/load and undo (`editor.js`'s `pushState()` deep-clones `.pattern` specifically so
a snapshot doesn't alias the live object `generatePattern` mutates in place).

**2. `computePattern(PATTERN, {extent, occupied})`** (`editor-lattice-pattern.js:253-372`) is pure — no DOM,
no `editor` object, plain data in, `{segments:[{kind,a:{i,j},b:{i,j}}], nodePoints:[{i,j}]}` out, all in
integer lattice coords. `_resolveExtent` (`:393-407`) is the DOM-touching half that turns `extent.mode`
into a concrete `{iMin,jMin,iMax,jMax}` box. **This is the natural extension point** — a third
`extent.mode:'boundary'` — but see §2 below: extending it is NOT just "add a case to `_resolveExtent`". The
rail/tie generation loop itself currently assumes a rail/tie spans the FULL box edge-to-edge once gated
on/off (`_railRows`, full `iMin..iMax` span); a boundary can enter/exit a scanline more than once, so the
loop needs to accept **multiple inside-sub-spans per row/column**, not just a wider or narrower box.

**3. Ownership is simpler than SE7b's own original design proposed — and this answers one of the
dispatch's own open questions for free.** `OWNERSHIP_ATTR = 'data-lattice-gen'` (`:41`) tags every
generator-emitted element with `PATTERN.id`. (Re)Generate removes every element on the active layer
carrying that tag, regardless of its current geometry, then emits fresh — replace, not diff. **A hand-drag
(stretch or move) does NOT strip ownership** (confirmed by reading `_finishLatticeMove`, not assumed from
SE7b's own aspirational doc, which proposed an auto-detach-on-touch hook that was never shipped) — a
manually stretched owned piece keeps its tag and gets swept away on the next Generate, UNLESS the user
first runs the existing **Detach all** (`detachAllOwned`, `:650-658`), which strips the tag from every
owned element on the layer without touching geometry.

**4. Reference site findings — logic, not style.** `reference/svgcreator-deployed/effects/mondrian.js`:
- **`getIntersections`** (`:94-152`) is the standard half-open `[lo, hi)` scanline-fill rule, applied
  per-primitive: the endpoint with the SMALLER scan-axis coordinate is included, the LARGER is excluded —
  for a line, a plain interval compare; for an arc (not monotonic in x/y), the same rule applied by
  proximity-testing the crossing against the arc's own two endpoints. This is the reusable property: as
  long as every primitive kind agrees on "which of my two ends is the excluded one," a vertex shared by two
  adjacent primitives is counted exactly once, never zero or two times, regardless of what kind either
  primitive is.
- **`renderGrid`** (`:154-282`) is a 3-level cutting hierarchy: boundary-crossing **spans** → cut at every
  **grid stop** the span crosses → each stop-to-stop run further chopped into fixed-length color **parts**.
  This maps directly onto this app's own existing rail/tie-per-cell concept (spans→stops IS "which cells
  does this row/column actually touch"); the parts level is new — see §4.
- **Stored rolls, confirmed exactly the mechanism the dispatch described**: every generated piece persists
  its RAW `[0,1)` dice rolls (not a derived boolean) as `data-omit`/`data-loose`/`data-cr`/`data-ci`
  attributes at creation time (`:211`). `patch()` (`:351-458`) re-applies a changed slider by reading those
  stored rolls back and recomputing against the NEW threshold — `random()` is never called again. **A real
  bug found in their own implementation, and a deliberate improvement this design makes rather than
  copies**: joints do NOT get this treatment (`:417-440` calls `random()` fresh every `patch()`), so
  touching joint frequency/shape reshuffles every joint's inclusion and color while grid-line sliders don't
  reshuffle anything. §4 below persists rolls for EVERY randomized attribute uniformly — joints included —
  closing exactly this gap rather than reproducing it.
- **Shape→primitives is NOT something the reference solves for arbitrary input.** Its own "boundary" is
  always ONE synthetic loop the tool builds itself from keypoints + circular bulge arcs
  (`pathloop.js`/`utils.js:110-314`) — never an ingested SVG rect/circle/ellipse/polygon/path. There is no
  curve-flattening step anywhere in their pipeline because their own source geometry is already only
  L/A. **This means §3 below (arbitrary-shape → L/A/numeric-C primitives) has no reference to lean on and
  is this design's own original piece** — built by reusing THIS session's own T39-T45 path-normalization
  machinery (`_parseD`, `_lineIntersect`, `_lineCircleIntersect`, `arcCenterParam`), not the reference's.
- **Exact circular fillets exist in their code** (`solveLineArcFillet`/`solveArcArcFillet`/`intersectRays`,
  `utils.js:358-431`, true Apollonius tangency solves, not a radius approximation) — noted as a candidate
  if Fred ever wants filleted-corner joints instead of plain node circles, but NOT part of this design:
  Fred's own "ending rules, not trimming" steer favors the simpler node-circle approach §5/§6 already use.
  Named so it isn't silently unavailable if wanted later, not built now.

---

## 1. The boundary as data

```js
PATTERN.boundary = {
  shapeId: 'b-3f9a',       // links to the boundary element, see below — NOT the shape's geometry copied in
  endRule: 'inset',        // 'on-boundary' | 'inset' (default) | 'joint' | 'loose' — see §5
  runs: {
    stepLen: 0.5,           // color-part length within one grid-cell run; null = one part per cell (today's
                             // per-cell-single-color behavior — see the runs/parts open question, below)
    omitPct: 0,              // 0..1, chance a run/part is hidden (kept in DOM, display:none — patchable)
    loosePct: 0,              // 0..1, chance the RUN's own final part additionally stops one stop early
    palette: ['#c62828'],    // >=1 color; 1 entry = today's uniform-color behavior, exactly backward compat
  },
  joints: { freq: 1, shape: 'circle', size: null },  // size: null = Widths › Node size (today's field)
  border: { enabled: false, width: null, color: null },  // null = reuse the boundary shape's own stroke
}
```
Sits alongside the existing `rails`/`ties`/`nodes`/`colors`/`widths`/`seed` fields on the SAME `layer.pattern`
object — not a parallel structure. `extent.mode` gains `'boundary'` (a 4th value next to `'board'`/`'rect'`);
when `extent.mode === 'boundary'`, `PATTERN.boundary` is read, otherwise it's inert and can stay on the
object untouched (switching Board↔Shape in the panel toggles `extent.mode`, doesn't discard the other
mode's own settings — flipping back and forth doesn't lose either configuration).

**The link — a new element-identity attribute, since none exists today.** Researched directly: no element
in this editor currently carries a stable per-element id (`data-layer` is layer MEMBERSHIP, not identity).
"Linked by id, not copied; editing it refills with the same seed" needs one. New attribute,
`data-boundary-ref="<id>"`, stamped onto the PICKED shape element the first time it's chosen as a
boundary (a short generated id, same shape `PATTERN.id` itself already uses — `` `b-${Date.now().toString(36)}` ``).
`PATTERN.boundary.shapeId` stores that same value. Picking a DIFFERENT shape later stamps a new id onto
the new element and updates `shapeId`; the old element's own `data-boundary-ref` is left in place (inert —
nothing reads an orphaned one) rather than swept, matching this codebase's own "don't retroactively clean
up unrelated content" convention. If the picked element is deleted, `_resolveExtent`'s `'boundary'` branch
finds no match (query `_sketchLayer` for `[data-boundary-ref="${shapeId}"]`, empty result) and falls back
to `{mode:'board'}` for that Generate — same graceful "can't find it, don't crash" shape §2's cutting
engine also uses for a degenerate boundary.

---

## 2. The cutting engine (pure, no DOM)

`insideSpans(scanLine, boundaryPrimitives)`: line × closed-boundary → sorted list of `[lo, hi]` intervals
along the scan line that are INSIDE the shape. New module, `editor/editor-lattice-boundary.js`, pure —
same "no svg.js, no DOM, plain data" contract `editor-lattice-pattern.js`'s own `computePattern` already
sets.

**Exact, closed-form, for L and circular A** (the common case — reuses existing primitives, not
re-derived): a candidate scan line (a rail = horizontal at fixed y, a tie = vertical at fixed x) against
each boundary primitive:
- primitive is `L`: `_lineIntersect` (editor-expand-path.js, already exported internally — export it, one
  word) against the scan line's own infinite-line form; exact.
- primitive is a circular `A`: `_lineCircleIntersect` (same file) for the intersection with the arc's
  FULL circle, then keep only candidates whose angle (via `arcCenterParam`, path-layout.js, already
  exported) falls within the arc's own actual sweep — exact.
- primitive is elliptical `A` or `C` (Q already elevated to C by `_parseD`): **no closed form** — a line ×
  cubic is a cubic polynomial along the scan axis (line × ellipse is a quadratic, solvable directly, but
  general elliptical-arc-with-rotation is treated the same numeric way for one code path instead of two).
  Newton's method from evenly-spaced seed points along `t∈[0,1]`, refined to `1e-6`, deduped by proximity —
  the dispatch's own stated tolerance, matching this session's own biarc-fit tolerance convention
  (`editor-expand-biarc.js`) rather than inventing a new one.

**Half-open rule** (reference's own finding, §Ground-truth — generalized here to a case they never had:
numeric segments). Every primitive, exact or numeric, reports which of its own two ends is the "low"
(scan-axis-included) end; a numeric segment's own root list is classified the SAME way relative to the
segment's own two endpoints (not the segment's arbitrary internal parameter order) before merging into the
whole-boundary crossing list. This is what makes a vertex where an exact `L` meets a numeric `C` count
correctly without special-casing that specific pairing.

**Holes, via even-odd — a genuine extension, not present in the reference at all** (confirmed: grepped
their whole codebase for "hole", zero matches). `_parseD` already walks every subpath in a multi-subpath
`d` string (T39's own tokenizer). Collect crossings from EVERY subpath's own primitives into ONE sorted
list per scan line, then pair consecutively (1st↔2nd, 3rd↔4th, ...) — standard even-odd parity. This
needs no subpath-identity bookkeeping (no "which one is the outer boundary, which is the hole" tagging) —
exactly SVG's own even-odd fill semantics, and exactly why sorting-then-pairing is the right primitive
instead of a nonzero-winding approach that WOULD need per-subpath direction.

**Tangency**: a scan line that just TOUCHES the boundary (grazes a local extremum without truly crossing)
produces two coincident or near-coincident crossings at the SAME point — under the half-open rule these
pair into a zero-length span and are naturally dropped (a span the emission step below already skips, no
special tangency detection needed).

**Degenerate/empty boundary** (self-intersecting shape, a boundary with zero enclosed area, a boundary
that doesn't actually close): `insideSpans` returns `[]` — `computePattern`'s `'boundary'` branch then
behaves exactly like an empty extent (no rails/ties/nodes emitted, same as today's `'rect'` mode with an
inverted/zero-size rectangle) — declined gracefully, not thrown.

---

## 3. Shape → primitives (the piece with no reference to lean on)

One function per source kind, all converging on the SAME `{type:'L'|'A', ...}` primitive list §2 consumes
— reusing this session's own T39-T45 machinery, not new geometry math:

| shape kind | primitives | exactness |
|---|---|---|
| `rect` | 4 `L` | exact |
| `circle` | the circle itself, tested as ONE primitive (no need to split into 2 semicircle `A`s the way an OUTLINE ring does — §2's line-circle test works directly against a full circle) | exact |
| `ellipse` (axis-aligned, no rotation on this element) | the ellipse itself, one closed-form quadratic line×ellipse test (simpler than `ellipseOutlinePathD`'s own OFFSET problem, which has no closed form — intersecting the raw ellipse does) | exact |
| `polygon`/`path` with only `L`/`A` (round-joined outlines, hand-drawn straight/arc paths) | `_parseD`'s own normalized segment list, walked directly | exact |
| `path` with real `C`/`Q` content, or a rotated ellipse | same `_parseD` walk, `C`/rotated-`A` primitives flagged for §2's numeric branch | numeric, ≤1e-6 |
| `text` | `localGlyphPathD` (editor-expand-text.js, already built for T40 part 2's outline preview) → `_parseD` walk, same as any other path | exact (glyph curves are cubic → numeric per-primitive, same as above) |

**Text is naturally multi-region, and that's fine, not a special case.** A word like "AB" is two disjoint
closed loops. `insideSpans` doesn't care whether the boundary primitives form one connected loop or several
— it just needs the full primitive list per scan line — so each letter independently fills with its own
grid, which is the visually obvious and almost certainly desired behavior, not something requiring extra
design.

---

## 4. Spans → stops → runs (the 3-level cut, stored rolls)

For each rail row / tie column that the boundary's own bounding box touches (a cheap pre-filter — compute
`insideSpans` only for rows/columns whose lattice cell range overlaps the boundary's axis-aligned bbox, not
every row in the whole board):

1. **Spans** = `insideSpans(row, boundaryPrimitives)` — §2.
2. **Stops** = each span cut at every grid-cell boundary it crosses (mirrors the reference's own
   `renderGrid` stops array exactly, reusing lattice-coordinate math already in `editor-lattice.js`'s
   `toLattice`/`fromLattice` rather than re-deriving grid-cell boundaries). Each stop-to-stop piece is one
   **run** — the same granularity a rail/tie segment already has in Board mode today (one segment per
   lattice cell); Boundary mode's only new thing here is a run's own two ends may ALSO be a raw boundary
   crossing (the span's own start/end) instead of always a grid line.
3. **Parts** (optional, `runs.stepLen`): each run further chopped into `ceil(runLength / stepLen)` equal
   pieces for color variation, same as the reference's `drawSegmentedLine`. `stepLen: null` (the default)
   skips this level entirely — one part per run, i.e. today's Board-mode behavior of "one rail segment, one
   color" exactly, so Boundary mode with default settings looks like today's Lattice, just shaped to the
   boundary instead of the board rectangle.

**Stored rolls, persisted per PIECE, uniformly — closing the reference's own joint gap (§Ground-truth).**
Every emitted part/run/joint gets its own `{omitRoll, looseRoll, colorRoll}` (and a joint's own
`{includeRoll, colorRoll}`) computed ONCE at generation time from `lcgPoints` (the seeded RNG SE7b already
declared reusable, `core/terrain.js`), stored as `data-omit`/`data-loose`/`data-cr` attributes on the
emitted `<line>`/`<circle>` element itself — literally the reference's own attribute names and convention,
credited as logic worth copying (Fred's own instruction), applied here to EVERY randomized draw, joints
included. Changing `runs.omitPct`/`runs.loosePct`/a palette weight afterward is then a **pure attribute-
threshold re-check** (`hidden = omitRoll < omitPct`), no re-Generate, no reshuffling relative to other
pieces — same guarantee the reference's own `patch()` gives for grid lines, now given to joints too. This
needs a lightweight `patchBoundaryPattern(editor, layer)` sibling to `generatePattern` for the slider-drag
case specifically (re-read stored rolls, toggle `display:none`/color, no DOM removal+recreation) — see
Slice 3.

---

## 5. Ending rules instead of trimming (Fred's own explicit ask)

A run's TWO free ends: either landed on a GRID stop (unchanged — same round/butt/square cap the piece kind
already uses today, `SUPPORTED_LINE_CAPS`, editor-expand-analytic.js) or landed on a BOUNDARY crossing
(§2's own span endpoint) — only the boundary-crossing ends need a rule. One declared table, not per-case
logic:

| rule | at a boundary end | why not trimming |
|---|---|---|
| `on-boundary` | centerline stops exactly at the crossing point; the piece's OWN cap style (round/square) may visually overhang past the boundary line itself, same as any capped stroke | zero extra geometry — the crossing point computed in §2 IS the final endpoint, no further math |
| `inset` (**default**) | endpoint pulled back along the run's own direction by `strokeWidth/2` from the raw crossing, so the STROKE'S EDGE (not just centerline) touches the boundary from inside, never crosses it | one subtraction along an already-known direction vector — not a clip, not a boolean op |
| `joint` | same as `on-boundary`, PLUS a node (circle) emitted at the crossing point via the EXISTING `emitNode` | reuses existing node emission verbatim; the node visually absorbs the cap overhang the same way an internal rail×tie crossing node already does today |
| `loose` | the run's OWN final stop is chosen as the PREVIOUS grid stop inside the span, not the true boundary crossing — i.e. the cut hierarchy (§4) simply stops one stop early for that run | purely a CHOICE OF WHICH STOP TO CUT AT, already a value §4 computes — no new geometry, no per-endpoint math at all; genuinely simpler than trimming, per Fred's own stated bar |

**"No geometric trimming unless you find a case the rules can't handle — then say which and why," per the
dispatch's own instruction: one real case named.** A run whose ENTIRE length is shorter than one grid cell
(the boundary clips a corner so tightly that a span's own two ends are both boundary crossings, no grid
stop between them) has no "previous stop" for `loose` to fall back to. Resolution: `loose` degrades to
`inset` for that one run specifically (still zero new geometry — reuses the rule immediately above it in
the table) rather than either omitting the run entirely or inventing a synthetic stop. Named here so it's a
decided fallback, not a silent gap.

---

## 6. Joints = existing nodes

`PATTERN.boundary.joints` reuses `emitNode` (`editor-lattice.js`) exactly as internal rail×tie crossings
already do — `freq` (0..1, a stored per-candidate-joint roll, §4) gates inclusion, `shape` ('circle' —
'square' is a new node shape, a small addition to `emitNode`'s own rendering, same underlying emission
call), `size: null` inherits `Widths › Node size` (today's existing `widths.nodeRadius` field) — no new
size concept unless Fred wants joints sized independently of internal-crossing nodes, named as an open
question below rather than assumed.

---

## 7. Optional Border piece

`PATTERN.boundary.border`: when enabled, ONE additional element tracing the boundary shape's own primitive
list at its own width/color (default: inherits the boundary element's own current stroke/width, `null`
meaning "don't override"). Not cut into runs — a single continuous stroke (or, if the boundary itself is a
CLOSED path already, literally the SAME `d`/shape geometry, just re-stroked at the pattern's own width) —
this is the ONE piece in the whole design that's just "draw the boundary shape a second time, styled,"
needing no cutting-engine involvement, sharing `data-lattice-gen`/`OWNERSHIP_ATTR` like every other
generated piece so it sweeps and regenerates identically.

---

## 8. Carve/export exactness — no new export code

Boundary-mode pieces are the SAME `<line>`/`<circle>` element kinds Board-mode Lattice already emits —
`emitSegment`/`emitNode` are reused verbatim (§Ground-truth), not new element types. This means T39-T45's
own `OUTLINE_KINDS` table (editor-outline-preview.js) and the Fusion export swap (`getLayerSvg({geometry:
'fusion'})`, editor-io.js) already handle every piece this design produces with ZERO new code: a rail/tie
run outlines via `lineOutlinePathD`/`pathOutlinePathD` exactly like a hand-drawn line; a joint or the
zero-length-line degenerate case exports as a native `<circle>` exactly like T45's own add-on already
guarantees (measured live in Fusion this same session: 8 nodes → 8 true SketchCircles). The Border piece,
if it traces a boundary that's itself a `path`/`polygon`, outlines through the general `pathOutlinePathD`
engine the same way any user-drawn path already does. **This is the strongest argument for "everything
already built carries over" being literally true, not just a convenient framing**: the carve/export
pipeline needed no design work this turn because it was already generic over element KIND, never over
"was this element hand-drawn or generated."

---

## 9. Link refresh — commit-only, same hook this session already established

`refreshOutlinePreview`/`refreshDrape` both refresh on COMMIT only (never a 'live' drag frame) via the
existing `runChangePipeline`/`_notifyChange('commit')` hook (SE12, this session's own earlier work). A
Boundary-mode layer's refill on "the linked shape changed" reuses the SAME hook: on every commit, if any
layer's `pattern.extent.mode === 'boundary'`, compare the linked element's current serialized geometry
(cheap: its own `d`/`cx,cy,r`/`points` attribute string) against a hash stored on the pattern from the last
refill; changed → re-run Generate for that layer with the SAME seed (a refill, not a reroll — matches
"editing it refills with the same seed," Fred's own words) and the SAME stored rolls where the affected
runs/joints didn't move (best-effort: rolls keyed by lattice cell `{i,j}`, so a cell whose crossing geometry
is unaffected by a LOCAL boundary edit keeps its stored roll; a cell whose spans genuinely changed gets a
fresh roll — no attempt at pixel-level diffing beyond that). No new refresh-trigger system — one more
consumer of the hook that already exists.

---

## 10. Move/stretch interaction — the dispatch's own open question, answered from the CORRECTED ground truth

Two different things can be "stretched," and the existing (not aspirational) ownership model in
§Ground-truth #3 already answers both without a new rule:

- **A generated rail/tie/joint itself is dragged/stretched.** Ownership is NOT stripped on drag (confirmed
  by reading the shipped code, not SE7b's own original proposal). The piece keeps its geometry — including
  now extending past the boundary if the user stretched it that way — until the NEXT Generate/refill, which
  sweeps every owned piece and re-emits fresh (so a boundary-violating stretch is temporary unless the user
  runs Detach all first, exactly matching today's Board-mode behavior for a rail dragged off the visible
  board). **No new rule needed**: this is the existing mechanism, unchanged.
- **The LINKED BOUNDARY SHAPE itself is dragged/resized.** §9's commit-only hook means a live drag shows
  the OLD fill until the gesture completes (the same lag `refreshOutlinePreview`/the drape already have,
  and already accepted product behavior) — pieces may visibly sit outside the NEW boundary for the
  duration of one drag, self-correcting on commit. Named explicitly as the answer, not left implicit,
  since it's a real, visible (if brief) inconsistency a live-preview mode could remove later if Fred finds
  the lag bothers him in practice — same "decide from usage, not preemptively" stance SE7b's own "no live
  preview" call already took for a different control.

---

## 11. Undo

One `pushState()` per Generate/Regenerate/refill, exactly SE7b's own established shape (§Ground-truth) —
a boundary refill triggered by §9's commit hook is itself one more discrete editor action, gets its own
undo step like any other commit-triggered mutation, not folded into the shape-edit's own undo step (so
"undo the shape move" and "undo the resulting refill" are two separate, individually reversible steps —
consistent with how every other commit-pipeline consumer in this app already behaves, not a new policy).

## 12. Save/load

`layer.pattern.boundary` is one more field inside the SAME already-generic `layer.pattern` object —
`_PERSISTED_LAYER_FIELDS`'s existing `'pattern'` entry (plain `JSON.stringify`, editor-io.js:92) needs NO
change at all. The linked shape's own `data-boundary-ref` attribute is an ordinary element attribute,
already covered by the existing sketch-layer serialization — no new save-path code. On open(), if
`shapeId` doesn't resolve to any element carrying that `data-boundary-ref` (a save from before this
feature, or the referenced element was itself not exported/deleted before save), `_resolveExtent` falls
back to `{mode:'board'}` for that one layer, same graceful degradation §1 already specifies.

---

## 13. Panel UI mock (390px-first, matching SE7b's own established style)

```
┌─────────────────────────────────┐
│ Lattice Pattern           [ ⓧ ] │
├─────────────────────────────────┤
│ Boundary   ( ) Board  (•) Shape │  <- new: extent.mode toggle
│            [ Pick shape... ]    │  <- click, then click a closed
│            Linked: ellipse #3   │     shape on canvas (or Esc to
│                                  │     cancel) — shown only when
│                                  │     Shape is selected
│                                  │
│ (…Spacing / Rails / Ties / Nodes│  <- UNCHANGED from today
│    / Colors / Widths / Seed…)   │
│                                  │
│ Ending      [ Inset        ▾ ]  │  <- new: on-boundary/inset/
│                                  │     joint/loose, shown only
│                                  │     when Shape is selected
│                                  │
│ Runs        step [0.3"] (blank  │  <- new: stepLen, omit%, loose%
│             = whole cell)        │
│             omit   [====----]   │
│             loose  [==--------] │
│             palette [■][■][+]   │  <- color swatches, + adds one
│                                  │
│ Border      [ ] draw boundary   │  <- new checkbox
│             width [ auto ] color│     (fields shown only if
│                       [ auto ]  │      checked)
│                                  │
│ [   Generate / Regenerate    ]  │  <- UNCHANGED
│ [   Detach all            ]     │  <- UNCHANGED
└─────────────────────────────────┘
```
"Pick shape..." reuses whatever selection-affordance pattern the editor already has for "click an element
on canvas" (the same gesture Select mode already provides) rather than inventing a new picking UI —
implementation detail for whoever builds Slice 3, not fixed here.

---

## 14. Slices (each independently browser-provable, matching SE7b's own 3-slice shape)

### Slice 1 — the cutting engine, pure, no editor/DOM
- Export `_lineIntersect`/`_lineCircleIntersect`/`arcCenterParam` where not already exported
  (editor-expand-path.js/path-layout.js — one-word `export` additions, no logic change).
- New `editor/editor-lattice-boundary.js`: `shapeToPrimitives(el)` (§3), `insideSpans(scanLine,
  primitives)` (§2), pure, no DOM beyond reading the source element's own attrs (same `_outlineAdapter`-
  style plain-object contract T45's own export code already established for a non-live element).
- Predicted files: `editor-expand-path.js`, `path-layout.js`, `editor-lattice-boundary.js` (new),
  `tests/editor-lattice-boundary.test.js` (new) — 4 files.
- Verify: a rail through a known rect boundary returns the exact expected span; a rail through a circle
  returns the exact chord span (closed-form check against the circle's own equation); a donut path (two
  concentric circle subpaths) correctly produces an OUTER-minus-INNER pair of spans (proves even-odd);
  a scan line exactly tangent to a boundary vertex returns zero spans there (half-open, non-vacuous —
  mutation-test by disabling the half-open exclusion and confirming a spurious span appears); a numeric
  line×cubic case matches a dense-sample independent oracle within 1e-6 (same cross-check discipline this
  session's own path-offsetting tests already use).

### Slice 2 — computePattern's boundary mode + spans/stops/runs + stored rolls
- `editor-lattice-pattern.js`: `_resolveExtent`'s `'boundary'` branch (calls Slice 1); the rail/tie
  generation loop restructured to accept multiple inside-sub-spans per row/column (§Ground-truth #2's own
  named complication) instead of one full-width span; §4's stops/parts cutting; per-piece roll generation
  via `lcgPoints`.
- Predicted files: `editor-lattice-pattern.js`, `tests/editor-lattice-pattern-boundary.test.js` (new) — 2
  files.
- Verify: a rectangular "boundary" (mode:'boundary' with a rect shape) produces byte-identical
  segments/nodePoints to `mode:'rect'` with the same bounds (proves the new path reduces correctly to the
  old one on the simplest case); a circular boundary's own rail rows correctly shorten near the top/bottom
  (chord length < board width); determinism (same PATTERN+seed → identical rolls across two calls); a
  stored roll re-threshold (simulate `patchBoundaryPattern`) matches a hand-computed expected hidden-set
  without calling the RNG again (proves the patch path is genuinely roll-based, not a re-generate in
  disguise — mutation-test by forcing a second RNG call and confirming the test would have caught a
  reshuffle).

### Slice 3 — emission, ending rules, ownership, panel UI, commit-hook refresh
- `editor-lattice-pattern.js`/`editor-lattice.js`: §5's ending-rule dispatch at emission time
  (`emitSegment`/`emitNode` calls, inset math, the loose-degrades-to-inset fallback); §7's Border piece.
- `editor-io.js` or wherever the commit pipeline's own hook list lives: §9's boundary-refill consumer.
- New `data-boundary-ref` stamping on shape-pick.
- Panel markup + a new `main/stamp/lattice-boundary.js` (matching the existing per-panel-module
  convention) + `styles/editor.css`.
- Predicted files: `editor-lattice-pattern.js`, `editor-lattice.js`, the commit-pipeline file, `editor-io.js`
  (shape-pick stamping), `bspline_gen_palette.html`, `main/stamp/lattice-boundary.js` (new), `styles/
  editor.css`, `tests/editor-lattice-boundary-emit.test.js` (new) — 8 files.
- Verify: a live CDP run — draw a star-shaped path, pick it as boundary, Generate, screenshot (rails/ties
  visibly clipped to the star's own outline, not the board rectangle); each ending rule produces its own
  visibly distinct result on the same boundary (on-boundary overhang visible, inset flush, joint dotted,
  loose visibly short of the edge) — same "screenshot each combination, view every one" discipline this
  session's own T44 cap/join work already used; drag the linked shape, confirm the fill refits only on
  commit (not mid-drag); Fusion-outline-export a boundary-filled layer, confirm zero new decline kinds
  (§8's own "no new export code" claim, proven live not just argued); save → reopen round-trips the whole
  boundary config and the link survives.

---

## Fred's answers (2026-09-25: "agree with your bracket propositions")
1. Runs: plain per-kind colors first; runs later, only if wanted (slot stays declared: boundary.runs = null).
2. Stretch/boundary-move: no new rule — pieces stay until next Generate/refill; boundary refits on release.
3. Joint size = the one Node size.
4. Curved/freehand boundaries: supported (numeric path kept).
5. Border piece defaults to the boundary shape's own stroke width + color.

## Open questions for Fred (answered above)

1. **Runs/parts for v1, or defer?** `runs.stepLen`/`omitPct`/`loosePct`/`palette` (§4) is the most
   reference-visual-specific piece (color speckling) and the LARGEST slice-3 surface. Given "not sure you
   should reuse the STYLE" — is per-part color variation actually wanted in v1, or does v1 stop at "same
   uniform per-kind color Board mode already has, just shaped to a boundary" (i.e. Slice 2 without the
   `parts` sub-cut, `stepLen` always null)? Keeps the first shippable slice smaller either way; flagging
   because it's a real scope call, not derivable from "make a plan" alone.
2. **Move/stretch answer (§10)** — confirm the "no new rule, existing ownership/commit-hook mechanics
   already cover both cases" reasoning is the right call, not a gap being waved past.
3. **Joint size independent of internal-crossing node size?** (§6) — defaulting to "same field" unless told
   otherwise.
4. **Rotated ellipse / raw elliptical-arc boundaries**: numeric (§2/§3), meaningfully slower than the exact
   cases and the one boundary kind most likely to need real tolerance-tuning in practice. Worth a v1
   decline (fall back to the shape's own bounding rect) instead of the numeric path, deferred to when a
   real use case asks for it? Named because "numeric, ≤1e-6" was written into the dispatch as a target, not
   confirmed as actually needed for v1's real shapes.
5. **Border piece color/width defaults** (§7) — "inherits the boundary shape's own current stroke" was
   this design's own guess at least-surprise; confirm or override.

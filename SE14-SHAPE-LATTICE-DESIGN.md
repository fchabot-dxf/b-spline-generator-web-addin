# SE14 — Shape Lattice tool: a generated/picked silhouette, per-segment styling, split from the box Lattice

Design only. No product code changed this turn. File:line references are against lane-b HEAD (post `c6ecda7`,
T51 merged, MOB3 drawer merged). Nothing under `editor/`/`main/` was edited.

## What this closes (Fred's ask)

"The shape lattice and lattice box are different" → **two tools sharing one engine**. The box `#` Lattice goes
back to simple (the SE13 Boundary row moves OUT of it); a new Shape Lattice tool gets its own rail icon + drawer
tab/desktop panel with a SHAPE section (generate a silhouette, or pick any closed shape — the SE13 link,
unchanged) + the same Fill settings (spacing, rails, ties, nodes, colors, widths, ending rule, border) + Generate.
"Shape tool just has more settings for shape refinement, perhaps per shape segment toggle for curve, straight or
kinked line" → per-segment style (straight | curve | kink), picked from a list or by tapping the segment on
canvas, mirrored pairs change together, corner rounding radius. Output stays exact (L + circular A) → an ordinary
node-editable path, exact carve/Outline export/Fusion.

---

## Ground truth — reference findings, both what's reusable and what isn't

Three sources read this turn, not assumed from the dispatch's own summary: `reference/svgcreator-deployed/`'s
`pathloop.js` (273 lines, full read), `utils.js`'s `resolveGenerator`/`decomposeSegment`/fillet solvers (full
read), `main.js`'s proportions-overlay UI (lines 174-260) and debug-label code (lines 895-963, partial); and the
EXTERNAL `C:/Users/danse/APPS/SVG creator/src/envelope.js` (150 lines, full read, NOT part of this repo, never
committed).

**1. `pathloop.js`'s own `PathGenerator.generate(ctx)` is the live, deployed hourglass/bust generator — reused
as the primary model, not the envelope system (see #4 below).** Shape: a flat BASE (bottom), tapering through a
SHOULDER zone up to a NECK (narrowest), widening again through a HEAD zone to a HEAD ARC (top), mirrored
left↔right about a vertical centerline `cx`. Dimensions (`fullW`, `fullH`) and per-zone WIDTHS (shoulder/neck/
head) are each independently randomized within a declared min/max range (`getWidth(part, minR, maxR)`, e.g.
`wNeck = fullW * mix(0.10, 0.28, random())`) — OR pinned to an explicit 0-100 slider value when the caller
supplies one (`pathParams.widths.shoulder` etc.), the exact "seed vs. explicit control" duality this design
needs. Y-positions for neck/head come from `proportions = {neck: 35, chin: 72}` (0=bottom base, 100=top), each a
% of `fullH` — clamped so `neck < chin - 5` (a hard-coded minimum 5% separation, worth keeping as a declared
constant, not a magic number, in the port).

**2. `symmetryRelax` (0-1, default 0) is the reference's own answer to "mirrored pairs change together" —
reused directly, not reinvented.** At `relax=0` the right-side keypoints are EXACT mirrors of the left (`neckRight
= cx + (cx - neckLeft.x)`, etc.); `relax` blends toward an independently-randomized right side. This is exactly
the declared knob Fred's own "mirrored pairs" ask needs, just inverted in framing (his ask is the `relax=0`
floor — SE14 can default it there and expose it as an optional advanced control, not build a second mechanism).

**3. `decomposeSegment(p1, p2, bulge, side, cx)` is the exact, reusable bulge→primitive formula — the ONE
piece of math this design ports as-is (translated to this session's own primitive shape, not copied verbatim).**
A `bulge` (signed float, `|bulge|<0.999`) of ~0 gives a straight `L`; otherwise the closed-form CAD "bulge
factor" radius `R = |chord/2 · (1 + b²) / (2b)|` gives an EXACT circular arc through the two endpoints, with
`sweep` derived from comparing the bulge's own sign against which side of the chord is "outward" (away from
`cx`). This is EXACTLY this session's own `A`-primitive shape (`arcCenterParam`'s own inverse, `path-layout.js`)
— cross-checked against it before committing to porting it (§3 below shows the arithmetic both ways agree).

**4. The external `envelope.js` is a DIFFERENT, older, more general model — read, understood, and DELIBERATELY
NOT adopted wholesale, but its own "waist" terminology is what SE14 borrows.** It computes a CONTINUOUS
per-pixel width multiplier from a distance-from-waist curve (`smooth`/`linear`/`sharp`/`staircase`/`double`/
`bell`), zone-gated (full/halves/quadrants) — a fundamentally different shape (procedural multiplier field, no
discrete keypoints at all) that doesn't map onto "toggle THIS segment's own style," Fred's own explicit ask.
Not ported. What IS borrowed: envelope.js's own `waistPos`/`waistW` naming for "a narrowing at some Y with some
minimum width" — since the dispatch's own "neck / chin / **waist**" proportions are THREE zones, but
`pathloop.js`'s own `proportions` only has TWO (`neck`, `chin`) — SE14 needs a genuinely NEW third zone. §7
below adds it as a WAIST pinch between the base and the neck (a torso taper below the shoulders), built as one
more `getWidth`-style zone in `pathloop.js`'s own keypoint model — an original synthesis of the two references'
own vocabulary, not a port of either one's full mechanism.

**5. A real, disclosed finding: the reference's own PER-SEGMENT NAMED STYLE system (`PathGenerator.ALL_STYLES`
— `straight/arc/arc-deep/arc-flat/arc-in/arc-in-deep/ellipse-out/ellipse-in/sharp/step-out/step-in/notch/
s-bend`) is DECLARED but NOT actually wired into the live generator.** Grepped the whole reference for where
`leftStyles`/`rightStyles`/`headStyle` are ever ASSIGNED (not just read) — zero matches. `main.js`'s own
debug-label code reads `gen.leftStyles`/`gen.headStyle` and falls back to `'?'`/`'arc'` when absent, which is
ALWAYS, in this deployed build — `pathloop.js`'s own `generate()` return value never sets them. **This means
Fred's own "per-segment toggle for curve, straight or kinked line" has no working reference implementation to
port** — it's this design's own original piece, informed by `ALL_STYLES`' own DECLARED vocabulary (a useful
naming reference, not dead weight — reused as the STYLE TABLE's own candidate name list, §4) and the ONE proven
mechanism that IS wired (`decomposeSegment`'s own bulge formula), not silently presented as "the reference
already does this." Named explicitly, the same discipline SE13's own design doc used for its own shape-to-
primitives gap.

**6. Exact fillet-solving exists and is genuinely reusable geometry, not a port of style.**
`solveLineArcFillet`/`solveArcArcFillet`/`intersectRays` (`utils.js:358-431`) solve the TRUE tangent-circle
fillet (Apollonius circles for line-arc/arc-arc, exact ray intersection for line-line) for "round this corner by
radius R" — a DIFFERENT operation from this session's own T44 join-building (`_buildJoin`, which rounds/miters
where two OFFSET curves meet during stroke-to-outline expansion, not where the ORIGINAL centerline path turns).
Genuinely new capability this codebase doesn't have yet — §5 below proposes porting the LOGIC (exact tangent-
circle solve) expressed via this session's own `_lineIntersect`/`_lineCircleIntersect` primitives where they
already cover it (line-line, line-arc), with one new small arc-arc Apollonius solver for the case neither
existing primitive reaches.

---

## §1 The two-tool split — what moves where, and migration

**Box `#` Lattice** (existing `editor-lattice-pattern.js`/`properties-lattice.js`/`#editorLatticePanel`,
`TOOL_PANELS.lattice`): reverts to `extent.mode` ∈ `{'board','rect'}` only. The Boundary/Ending/Border panel
sections (T49/T50/T51) move OUT of `#editorLatticePanel` into the new tool's own panel. The box tool's own
Generate, from this point on, ALWAYS resolves `extent.mode` to `'board'` — it never reads or writes
`PATTERN.extent.mode==='boundary'` again, and never touches `PATTERN.boundary` at all.

**Shape Lattice** (new `editor-shape-lattice.js`? or a `properties-shape-lattice.js` sibling wired the same way
`properties-lattice.js` is — naming TBD at implementation, not fixed here): `extent.mode` is ALWAYS
`'boundary'` — there is no Board option on this tool at all, since shape-filling is its entire purpose. Shares
`computePattern`/`_resolveExtent`/`generatePattern`/`shapeToInnerBoundaryPrimitives`/`insideSpans`/the ending-
rule table/the Border piece — ZERO new fill-engine code, exactly "two tools sharing one engine." A layer's
`.pattern` object gains no new top-level shape (same `PATTERN_DEFAULTS` structure T49 already declared); which
TOOL last wrote it is not tracked or needed — `computePattern` itself has never cared which UI surface called
it.

**A genuine, disclosed design decision on migration** (not explicitly specified by the dispatch, so named
here rather than silently assumed): an EXISTING layer saved with `extent.mode==='boundary'` from the OLD
(pre-split) box Lattice tool is left EXACTLY as-is on disk/on canvas — nothing auto-migrates, nothing breaks on
load (`computePattern` doesn't care which tool wrote its input). The only real question is **what the box
Lattice's OWN next Generate does to it**, since that panel no longer offers a Board/Shape toggle at all. Proposed
rule: the box tool's Generate ALWAYS force-writes `extent.mode: 'board'` before running (a one-line change,
`PATTERN.extent = { mode: 'board' }` unconditionally, dropping any stale `'boundary'` value) — the EXISTING
boundary-shaped geometry on canvas stays untouched until that Generate is actually pressed, at which point it's
replaced with a board-filled pattern, same as pressing Generate always replaces the layer's own owned content
today. `PATTERN.boundary` itself (shapeId, endRule, border, ...) is left in the saved pattern object, inert,
matching this codebase's own "don't retroactively clean up unrelated content" convention (SE13 §1) — if the
user later opens the SAME layer in the NEW Shape Lattice tool and picks/generates a shape, that field gets
overwritten fresh, not read from the stale value. Flagged as **open question 1** for Fred to confirm or
override — a real scope call, not derivable from "split the tools" alone.

---

## §2 The silhouette data model

```js
PATTERN.shape = {
  source: 'generated',        // 'generated' | 'picked' — which one is currently authoritative
  // 'picked': PATTERN.boundary.shapeId already IS the link (SE13, unchanged) — nothing else needed here.
  // 'generated': the silhouette below is regenerated from these params on every edit; its OWN OUTPUT
  //              element is what PATTERN.boundary.shapeId links to (§6).
  seed: 42,
  proportions: { waist: 18, neck: 42, chin: 74 },  // % from bottom (0=base, 100=top); waist < neck < chin, each >=5% apart
  widths: { shoulder: null, waist: null, neck: null, head: null },  // 0-100 slider value, or null = random from seed
  symmetryRelax: 0,           // 0 = perfect mirror (Fred's own default expectation) .. 1 = independent right side
  keypointCounts: { base: 2, shoulder: 1, waist: 1, neck: 1, head: 1 },  // per-zone keypoint density (pathloop.js's own dial)
  // The declared per-segment table — one entry per segment in generation
  // order (left side, bottom-to-top; head; right side, top-to-bottom;
  // base) — see §4 for `style`/`bulge`/`dir` and §5 for `cornerRadius`.
  segments: [
    { style: 'curve', bulge: 0.18, dir: 'out', cornerRadius: 0 },
    // ... one per segment, length = leftSegCount + 1(head) + rightSegCount + 1(base)
  ],
}
```

Sits on `layer.pattern` alongside the EXISTING `rails`/`ties`/`nodes`/`colors`/`widths`/`seed`/`boundary` fields
(SE13's own established shape) — a new top-level key, `shape`, not a parallel structure. `PATTERN.boundary`
itself is UNCHANGED (SE13's own `{shapeId, endRule, runs, joints, border, edge}|` — §6 below is exactly how
`PATTERN.shape`'s own generated output becomes `PATTERN.boundary.shapeId`'s target).

**Why `segments` is declared as ONE FLAT ARRAY, not nested per-zone**: `pathloop.js`'s own `resolveGenerator`
already assembles left-segments + head + right-segments + base into ONE ordered list before decomposing (`utils.
js:117-136`) — mirroring that exact ordering here means the array index IS the segment identity for picking
(§4) with no separate zone/index pair to track, and "regenerate the path" is a straight `map` over this array,
not a per-zone dispatch.

---

## §3 The generator — seed → proportions → segments → exact primitives

Pure function, `editor-shape-lattice-generator.js`? (naming TBD) — same "no DOM, no editor object" contract
`computePattern`/`shapeToPrimitives` already set. Four stages, mirroring `pathloop.js`'s own shape (ported,
not copied verbatim — this session's own primitive/RNG conventions throughout):

1. **Dimensions + widths**: `fullW`/`fullH` from `innerW`/`innerH` (the board, or a caller-given bbox — TBD at
   implementation which) via `lcgPoints` (this session's own seeded RNG, `core/terrain.js` — NOT `Math.random`,
   matching every other seeded-generation feature in this codebase, e.g. Lattice's own ties). Per-zone width
   (shoulder/waist/neck/head) from `PATTERN.shape.widths[zone]` when set, else randomized within a declared
   min/max range table (ported from `pathloop.js`'s own `getWidth` call sites, §7 for the waist zone's own
   range).
2. **Keypoints**: base corners → (waist zone, new) → neck → (head zone) → head-arc apex is NOT a keypoint here
   (unlike `pathloop.js`'s own debug-only "head arc" concept) — the head zone's own TOP keypoints on each side
   connect via ONE segment (a straight chord, or "curve"/"kink" per §4, exactly like every other segment — no
   special-cased head geometry, a genuine simplification over the reference's own separate `headStyle`/
   `headParam` machinery, justified because it was never actually wired there either, per Ground-truth #5).
   `symmetryRelax` blends the right side toward independence exactly as `pathloop.js`'s own formula does.
3. **Segments → primitives**: `PATTERN.shape.segments[i]` → `{type:'L'}` (straight) or `{type:'A', ...}` via
   the SAME bulge formula (Ground-truth #3), one primitive per segment, assembled in the declared order (§2).
4. **Fillets** (only where `segments[i].cornerRadius > 0`): §5's own solver, applied between adjacent
   primitives at their shared vertex — replaces that vertex with a short tangent arc, shortening both adjacent
   primitives to their own new tangent points (same shape `_buildJoin`'s own trim-to-intersection already has,
   generalized to a FIXED radius instead of a miter-limit-driven one).

Output: a flat `{type:'L'|'A', ...}` primitive list, EXACTLY `shapeToPrimitives`'s own return shape (SE13 §2) —
serialized to one `d` string (`M ... L/A ... Z`) for emission as an ordinary `<path>` (§6), and ALSO usable
directly as `insideSpans`' own input without a round-trip through `_parseD` (a `path` element's own `d` would
just re-derive the identical primitives anyway — an optimization worth naming, not required for v1 correctness).

---

## §4 Per-segment style — the table, picking, mirroring

**The style table — v1 builds a DECLARED SUBSET of `ALL_STYLES`' own vocabulary, not all 13.** Fred's own ask
is explicitly three: straight | curve | kink. Mapped onto the ONE proven mechanism (`decomposeSegment`'s own
bulge):

| style | bulge | meaning |
|---|---|---|
| `straight` | `0` | `L`, no arc (`decomposeSegment`'s own `\|bulge\|<0.001` branch) |
| `curve` | a signed float, `dir:'out'`→positive, `dir:'in'`→negative | a true circular arc bulging away from (`out`) or into (`in`) the shape's own centerline — Fred's own "bulge in↔out" |
| `kink` | n/a — a SHARP vertex, not an arc | two `L` segments meeting at a NEW point offset perpendicular from the chord's own midpoint by a declared distance (same `dir:'out'`/`'in'` sign) — this is genuinely NOT `ALL_STYLES`' own `'sharp'` (that name is reserved, unwired, in the reference); v1's `kink` is its own small, exact construction: `apex = midpoint + normal * kinkDepth * (halfChord)`, two `L`s from p1→apex→p2 |

`ALL_STYLES`' own remaining 10 names (`arc-deep`/`arc-flat`/`ellipse-*`/`step-*`/`notch`/`s-bend`) are NOT
built this slice — named as a DECLARED, not-yet-wired extension point (`style` is a string field, adding a new
value later is additive, no schema change) rather than silently unavailable. Flagged as **open question 2**:
worth any of them in v1, or genuinely deferred?

**Picking a segment** — TWO entry points into the SAME selection state (`PATTERN.shape.segments[i]`'s own
index, held as simple UI state, not persisted):
- **A list** in the panel (one row per segment, matching the design doc's own §2 flat-array ordering) —
  straightforward, no new mechanism, same "declared table drives the control" shape every other panel list in
  this codebase already uses.
- **Tapping the segment on canvas** — reuses the SAME hit-test primitive T49's own shape-pick already
  established (`editor._getNearbyElement`, checked before the mode dispatch in `handleStart` — T49's own
  `editor._boundaryPickCallback` pattern, generalized: while the Shape Lattice tool is active and a generated
  silhouette is linked, a tap hit-tests against THAT PATH'S OWN SEGMENTS specifically (nearest-point-on-
  primitive, not nearest-element) rather than picking a whole element — a genuinely new hit-test refinement
  (element-level picking already exists; sub-element/segment-level does not), scoped to this one tool.

**Mirrored pairs**: at `symmetryRelax: 0` (default), editing a LEFT segment's own style/bulge/cornerRadius
auto-applies the SAME values to its mirror on the right (index `leftCount - 1 - i` in the right-side half of
the flat array, given the generator's own left-then-right ordering, §2) — one `syncMirror(i)` call after any
segment edit, a no-op once `symmetryRelax > 0` (independent sides by the user's own explicit choice).

---

## §5 Corner rounding — reusing exact primitives, one new small solver

`cornerRadius` (0 = sharp, as today; >0 = fillet) on a segment applies to the vertex it SHARES with the NEXT
segment in the flat array (matching `pathloop.js`'s own `jointRadius`-on-keypoint convention, §2). Three cases,
by the two adjacent primitives' own types:
- **L–L**: exact via `_lineIntersect` (already exported, T51) — the SAME ray-offset-and-intersect construction
  `intersectRays` uses, expressed with this session's own primitive.
- **L–A / A–L**: exact via `_lineCircleIntersect` (already exported) — the fillet circle's own center lies on
  a line offset from the straight segment by `r` AND at distance `arcR ± r` from the arc's own center; this
  reduces to a line-circle intersection with a SHIFTED line, not a new formula, just a reuse of the existing
  primitive with the right inputs.
- **A–A**: genuinely NOT covered by any existing primitive — a new, small `_arcArcFillet` (ported from
  `solveArcArcFillet`'s own two-circle-intersection formula, Ground-truth #6) is the one real new piece of math
  this design needs.

Each solved fillet SHORTENS both adjacent primitives to their own new tangent points (same "trim, don't
re-derive" shape `_closedRing`'s own join-trimming already established) and inserts one new short `A` between
them — the segment's own `cornerRadius` never changes the OTHER segment's own geometry, only the shared vertex.

---

## §6 Generated shape ↔ the fill — link, regenerate, detach

**The generated path IS the linked boundary — no new link mechanism.** §3's own output `d` is emitted as an
ordinary `<path>` on the active layer, `stampBoundaryRef`'d (T49, unchanged) the FIRST time a shape is
generated, exactly like a hand-drawn pick — `PATTERN.boundary.shapeId` points at it, `PATTERN.shape.source =
'generated'` records WHY (so the panel knows to show the Shape-refinement controls rather than just "Shape
linked").

**Editing any `PATTERN.shape.*` field (seed, a proportion, a segment's style/bulge/cornerRadius,
symmetryRelax) regenerates the path in place**: re-run §3, replace the LINKED element's own `d` (same element,
same `data-boundary-ref` id — an in-place geometry update, not a delete+recreate, so the link survives without
re-stamping) — then §9's own commit-only refill (T49, unchanged — `refreshBoundaryPatterns`, already fires on
every commit) picks up the new boundary shape and refills automatically. No new commit-hook wiring needed.

**A hand node-edit on the generated path DETACHES it from the generator — the same "ownership, not a second
mechanism" answer SE13 §10 already gave for a picked shape moving.** Concretely: the generated `<path>` itself
is NOT `OWNERSHIP_ATTR`-tagged (it isn't Lattice-generated content, it's the BOUNDARY SOURCE — same as any
hand-drawn shape a user picks today) — so nothing about node-editing it needs new detection at all. What DOES
need one small, explicit rule: once a user drags one of the generated path's own NODES (Select/Node mode,
ordinary path editing — no new gesture), `PATTERN.shape.source` should flip from `'generated'` to `'picked'`,
so a LATER edit to `PATTERN.shape.seed`/proportions/segments in the panel does NOT silently overwrite the
user's own hand-tuned geometry. Detection: the SAME commit hook (`_notifyChange('commit')`) already fires after
a node-drag; a lightweight check — does the linked element's own current `d` still match what §3 would produce
from the CURRENT `PATTERN.shape` params? — flips the flag when it doesn't. Flagged as **open question 3**:
is a per-commit geometry recompute-and-compare the right trigger, or should this be gated more narrowly (e.g.
only Node-mode drags on that specific element, tracked explicitly) — a real implementation-cost/precision
tradeoff, not resolved here.

---

## §7 The waist zone (Ground-truth #4's own synthesis)

A THIRD proportion (`PATTERN.shape.proportions.waist`, between 0 and `neck - 5`) inserts one more keypoint pair
(left/right) between the base corners and the neck — a torso pinch below the shoulders, the same `getWidth`-
style independent width range as every other zone (`wWaist = fullW * mix(0.35, 0.70, random())`, narrower than
the shoulder's own 0.75-1.15 range but wider than the neck's 0.10-0.28 — a declared starting range, tunable).
Two NEW segments appear where the reference had one (base→shoulder-taper became base→waist, waist→neck), each
independently styleable like any other segment in §2's own flat array — no special-casing beyond "one more
zone in the same loop that already builds shoulder/neck/head."

---

## §8 Output exactness

Every segment resolves to `L` or `A` only (§3) — ZERO new export code, the same claim SE13 §8 already
established for its own boundary pieces: `OUTLINE_KINDS`' `path` entry (`editor-outline-preview.js`) and the
Fusion-geometry export path already handle any `<path>` built from `M`/`L`/`A`/`Z`, regardless of whether a
human or this generator drew it. Carve/Outline/Fusion export need zero new decline-kind handling — worth
proving live (same discipline T49's own live check used), not just re-asserted, at whichever slice actually
wires emission.

---

## §9 UI — desktop panel + phone drawer

**One new `TOOL_PANELS` entry** (`editor-drawer.js:27`, MOB3's own declared table — "a future tool with its
own options panel is one entry here, not a new mechanism"): `shapeLattice: { panelId:
'editorShapeLatticePanel', label: 'Shape Lattice' }` — the drawer's own tab-switching, section-collapse, and
snap-height mechanics apply for free, zero new drawer code. Desktop: the SAME panel markup renders as an
ordinary sidebar panel (MOB3's own `display:contents` wrapper, unchanged).

Sections, top to bottom (mirroring the box Lattice panel's own established per-section markup shape — one
wrapper div + a `font-weight:600` heading span each, T49's own MOB3-compliant convention):
```
┌─ Shape Lattice ─────────────────────┐
│ Shape                               │
│   [ Generate silhouette ]           │  <- rolls a new seed, same convention as box Lattice's own Generate
│   [ Pick shape... ]     Shape linked│  <- T49's own picker, unchanged
│   Seed  [ 8261 ]                    │
│   Proportions  (dual-range-ish,     │
│     3-handle: waist/neck/chin)      │
│   Widths  shoulder waist neck head  │  <- 4 sliders, null = auto
│   Symmetry  [======----] relax      │
│                                     │
│ Segments                            │
│   [ dropdown: L1  L2  Head  R1 ... ]│  <- or tap the segment on canvas
│   Style   [straight|curve|kink]     │
│   Bulge   [====------] (curve only) │
│   Corner radius [==--------]        │
│                                     │
│ Fill                                │  <- IDENTICAL to the box Lattice's own Rails/Ties/Nodes/Colors/
│   (same Rails/Ties/Nodes/Colors/     │     Widths/Ending/Border sections — literally the same markup,
│    Widths/Ending/Border rows)        │     reused verbatim, not re-typed
│                                     │
│ [   Generate / Regenerate    ]     │
│ [   Detach all               ]     │
└──────────────────────────────────────┘
```
The 3-handle proportions control is the one genuinely NEW widget (the reference's own 2-handle vertical track,
`main.js:179-260`, extended to 3) — everything else reuses an EXISTING control shape already in this codebase
(segmented buttons, sliders, a `<select>` for the segment list, matching the Ending-rule `<select>` T49 already
built).

---

## §10 Slices (browser-provable, matching SE7b/SE13's own established shape)

**Slice 1 — the pure generator, no DOM.** `editor-shape-lattice-generator.js`: seed → keypoints → segments →
primitives (§3), the straight/curve/kink style table (§4, no fillets yet — `cornerRadius` always 0), the waist
zone (§7). Verify: a fixed seed produces byte-identical output across two calls; `symmetryRelax:0` produces an
EXACT mirror (right-side points/bulges equal the left's own reflection); every output primitive is `L` or `A`
only (no `C`/`Q` ever emitted); an independent oracle check of `decomposeSegment`'s own bulge→radius formula
against `arcCenterParam`'s own inverse (both must agree on the SAME arc).

**Slice 2 — fillets.** `_lineIntersect`/`_lineCircleIntersect`-based L-L/L-A/A-L solves (§5) + the one new
A-A Apollonius solver. Verify: a known 90° corner with `cornerRadius=R` produces a fillet arc of EXACTLY radius
R, tangent to both original edges (perpendicular-distance check, same discipline this session's own join tests
already use); an L-L, an L-A, and an A-A case each independently verified against a hand-derived expected
center.

**Slice 3 — live wiring.** The new tool (`TOOL_PANELS` entry, panel markup, `properties-shape-lattice.js`),
segment picking (list + canvas tap), mirroring, the generate/regenerate/detach flow (§6), the box Lattice's own
simplification (Boundary row removed, migration rule from §1). Verify: a live CDP run — generate a silhouette,
screenshot; edit one segment's style, confirm ONLY that segment (and its mirror, at relax=0) changed shape;
hand-drag a node, confirm `PATTERN.shape.source` flips to `'picked'` and a later seed change no longer
overwrites it; Outline-export a shape-filled layer, confirm zero new decline kinds (§8); the box Lattice's own
Generate on an old boundary-mode layer reverts it to board-fill, per §1's own migration rule.

---

## Open questions for Fred

1. **Migration rule (§1)**: the box Lattice's own Generate force-writes `extent.mode:'board'` unconditionally
   on an old boundary-configured layer — confirm, or should it warn/ask first instead of silently reverting?
2. **Style vocabulary (§4)**: v1 ships straight/curve/kink only, per the dispatch's own explicit ask — worth
   any of the reference's OTHER declared-but-unwired names (`step`/`notch`/`s-bend`/`ellipse-*`) in v1, or
   genuinely deferred to "declared, not yet wired"?
3. **Detach-on-node-edit detection (§6)**: a per-commit geometry recompute-and-compare, or a narrower trigger
   (Node-mode drags on that specific element only)? A real precision/cost tradeoff, not resolved here.
4. **Waist zone defaults (§7)**: the declared width range (0.35-0.70× fullW) and its own min-separation-from-
   neck (5%, matching the reference's own neck/chin gap) are this design's own first guess, not measured
   against any reference target silhouette — confirm or retune.
5. **Where does the generator draw FROM** — the board's own bbox (`innerW`/`innerH` a straight analog of
   `pathloop.js`'s own `ctx`), or a caller-given region the same way `PATTERN.extent:'rect'` already lets the
   BOX Lattice target a sub-area? The dispatch doesn't say; named here since it changes §3's own signature.

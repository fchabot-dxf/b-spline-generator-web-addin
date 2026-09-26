# SE15 — Constrained Fusion sketches for Lattice / Shape Lattice

Design only. No product code changed this turn (T60, docs-only dispatch — "NO FUSION," the advisor does all
Fusion-side verification). File:line references are against lane-b HEAD (post `431d777`, T59 merged — the Shape
Lattice tool's own axis-locked handles + tap-a-segment + detach). Nothing under `editor/`/`main/` was edited.

## What this closes (Fred's ask)

ROADMAP.md's own "Queued — SE15" entry (2026-09-25), quoted verbatim since every design decision below traces
back to it: "when using lattice and shape we could send the sketches as actual Fusion constrained sketches" …
"no need to fully lock them though." Instead of SVG import (plain curves, today's ONLY path — see Ground truth
below), the app writes a declared SKETCH MANIFEST (entities: lines/arcs/circles; constraints: tangent,
coincident, horizontal/vertical, symmetric, equal, tie-end-on-rail; a few named parameters where natural) and the
add-in builds it via the Fusion API. **PARTIALLY constrained by design**: keep relationships so it drags
coherently in Fusion; don't dimension everything (no over-constraint, light solver load on big lattices). Two
later refinements, both direct quotes, both load-bearing for this design:
- "if possible add a dimension for stroke width and make it a param" → stroke = a DIMENSIONED OFFSET of each
  centerline (distance = width/2), driven by Fusion USER PARAMETERS per kind (`rail_width`, `tie_width`,
  `node_radius`, `border_width`); round caps = half-circle arcs tangent to the offsets, centered on the
  centerline's own ends.
- "no length needed though" → NO length/position dimensions on rails/ties/nodes; only WIDTH (offset) dimensions
  **+ the few shape params** — read together with the first quote, this means the shape PRESET's own geometry
  (hourglass/bottle) is the one place that DOES get a small number of driving dimensions (see §4), while lattice
  pieces (rails/ties/nodes) get relationship constraints and width only, never a length or position dimension.

Order, Fred's own: shape presets first ("small, clear win"), lattice second (+ a plain-geometry fallback for
huge lattices). Outline/inlay geometry: offsets of the constrained centerlines where feasible. After SE14
(shipped, T58-59). Needs Fusion verification (advisor) — this doc, and the browser-side slices it describes, stay
browser/no-Fusion, per this turn's own dispatch.

---

## Ground truth — how geometry reaches Fusion TODAY, read directly, not assumed

Three files read this turn, in full or in the relevant part, not assumed from memory of earlier design docs:
`bspline-frame-builder/b-spline-gen/html/main/export-flow.js` (415 lines, read in full), `.../editor/layers.js`
(lines 1-190, the `FUSION_GEOMETRY`/`TOOLING_DEFAULTS` declarations), `.../editor/editor-io.js` (lines 300-400,
`getLayerSvg`/`bakeSvgForCarving`), `.../main/stamp/fusion-geometry.js` (60 lines, read in full),
`.../core/fusion-bridge.js` (lines 1-100, `sendFusionPayloadChunked`).

**1. Today's export is a STEP file (the 3D relief) plus an OPTIONAL, SEPARATE SVG "stamp" payload — Lattice/
Shape Lattice geometry has never been a Fusion SKETCH entity at all, only a baked 2D mask.** `sendToFusion`
(export-flow.js:304-366) builds `stepVariants` (3D solid/surface bodies, `generateThickenedStep`) and, only when
`options.includeSVG`, a `stamp.layers[]` array — each entry `{index, config:{profile,depth}, svg}`, where `svg`
is a PRE-BAKED, DPI-SCALED string (`bakeSvgForCarving`, editor-io.js:383-399) meant for the RASTERIZER/carve-mask
pipeline (a stamp/relief pass on the terrain), not a CAD-native sketch a user could select, drag, or pattern.
`bakeSvgForCarving`'s own doc comment is explicit about why this matters for THIS design: "Fusion's importer
reads raw pixel coords (1 unit = 1/dpi inch) and ignores viewBox/scale/element transforms" — every coordinate is
baked into DPI-scaled pixels before it ever leaves the browser, a real fragility (SE8d/SA-ROUNDTRIP-2's own
history of bugs from exactly this) the manifest below sidesteps entirely by declaring geometry in real MODEL
INCHES and letting the add-in do its OWN, single, explicit unit conversion (§1).

**2. The bridge itself: `adsk.fusionSendData` (Fusion's own native HTML-palette-to-Python-add-in channel),
chunked.** `sendFusionPayloadChunked` (core/fusion-bridge.js:78-97) streams a JSON string in 256KB chunks via
three event types (`generate_start`/`generate_chunk`/`generate_finish`) "to bypass Fusion-web bridge limits."
This is the SAME channel the manifest travels over (§5) — no new transport needed, just a new top-level payload
key (or a new event-type triple, see §7's own coexistence question) the Python side recognizes.

**3. `PATTERN.fusionGeometry`/`FUSION_GEOMETRY` (layers.js:60-76) is a PRE-EXISTING, ALREADY-SHIPPED per-layer
3-way picker — 'centerline' | 'outline' | 'both' — but it's a picker over HOW THE SAME FLAT SVG GETS BAKED**
(does the carve mask use the raw centerline, a true stroke-offset outline via `OUTLINE_KINDS`, or both stacked),
not a picker over WHAT KIND OF FUSION ENTITY gets produced. `_fusionLayerSvg` (export-flow.js:107-111) swaps in
the layer's own pick right before baking — still produces a flat SVG string either way. This existing mechanism
is the direct model for §7's own "how the new option coexists" answer: a 4th value in the SAME declared table,
not a parallel/competing mechanism.

**4. The Lattice/Shape Lattice editor model itself** (my own deep familiarity from T56-T59, re-confirmed against
the actual current source this turn where it mattered — `editor-lattice-pattern.js`/`editor-shape-lattice-
generator.js`/`editor-shape-lattice-interaction.js`, unchanged since T59's own `431d777`):
- `computePattern(PATTERN, {extent, occupied})` → `{segments, nodePoints}` in LATTICE-cell coordinates.
  `segments[i]` is `{kind:'rail'|'tie', a:{i,j}, b:{i,j}}` — ALWAYS a straight line (this tool has never drawn a
  curved rail or tie); `fromLattice(pt, spacing)` (editor-lattice.js) converts to model inches, the SAME
  conversion `generatePattern` itself already applies before calling `emitSegment`.
- `PATTERN.orientation` ('horizontal' | 'vertical') fixes which axis rails run on; ties always run the
  PERPENDICULAR axis — i.e. every rail segment's own `a.y === b.y` (or `a.x===b.x` if vertical) and every tie's
  own the opposite, an EXACT, closed-form fact about this generator's own output, not something that needs
  measuring per-piece.
- `nodePoints` are plain `{i,j}` lattice points — always circles once emitted (`emitNode`), never anything else.
- `generateSilhouette(region, shape)` (T55/T58, editor-shape-lattice-generator.js) → `{preset, keypoints,
  segments, primitives, cx, params}`. `primitives` is the SAME flat `{type:'L'|'A', ...}` list this whole
  codebase already treats as canonical (SE13 §8's own "zero new export code" claim) — circular, UNROTATED arcs
  only (`rx===ry`, `phi` always `0` — T58's own established, tested invariant, `primitivesToPathD`'s own doc
  comment). `params` (T59's own new return field) is the FULLY RESOLVED param set (explicit or seed-jittered) —
  exactly the values a manifest-producing function needs to populate Fusion user parameters with.
- T55's own closed-form derivation already PROVES exact tangency at every real joint (both presets' own solver
  doc comments; `tests/editor-shape-lattice-generator.test.js`'s own tangency-at-every-joint check, `_arcWorld
  PointTangent` as an independent oracle) and, for hourglass specifically, PROVES the shoulder/hip arcs are
  ALWAYS exactly 90° with the SAME radius (`cornerRadius`) and the waist arc is ALWAYS exactly a semicircle —
  i.e. the EQUAL and TANGENT constraints this design declares (§2) aren't approximations of what the generator
  produces, they're restatements of facts the generator's own math ALREADY guarantees, unit-tested since T55.

**5. `frame-builder/fb_engine/` already has almost everything the add-in side needs, DATA-DRIVEN, with the exact
"skip + report, never abort" contract the dispatch itself asked for — read this turn by a research agent I
delegated to (not assumed, not invented; every claim below is file:line-cited in its own report, kept in this
session's own record).** Summary, organized the same way §5 below uses it:
- **Geometry** (`fb_engine/geometry.py`, `geom_step` dispatching on `geom["Type"]`): `Line` →
  `sketchLines.addByTwoPoints` (working); `Arc3Point` → `sketchArcs.addByThreePoints` (working). `Circle`/
  `ArcCenterPoint`/`Slot` are DECLARED in the type list `_process_sequence` reads but have **no dispatch branch**
  — a silent no-op today, a real, small, disclosed gap this design needs filled (nodes and round caps are
  circles/center-defined arcs, §2/§4).
- **Constraints** (`fb_engine/constraints.py`, `constraint_step` dispatching on `rel["Type"]`): `Coincident`,
  `Collinear`, `Horizontal`, `Vertical`, `Tangent`, `Parallel`, `Equal` all WORK today, each a thin call to the
  matching `sketch.geometricConstraints.add*`. **The failure handling already matches the dispatch's own "skip +
  report, never abort" ask, already shipped**: a wrong target count logs "CONSTRAINT SKIP" and returns; any
  exception logs "CONSTRAINT FAIL" (plus related constraints) and the build continues; a missing entity id logs
  "CONSTRAINT MISS." `Perpendicular`/`Concentric`/`Midpoint`/`PointOnCurve` are declared but undispatched (same
  gap shape as geometry's own). **There is no `addSymmetry` anywhere in this repo** — the ONE place the source
  templates needed bilateral symmetry (`sketches/template_1/phases/p02_11_symmetry.py`), it's built as TWO
  `Equal` constraints instead, with an explicit comment warning a redundant `Equal` risks
  `VCS_SKETCH_OVER_CONSTRAINTS`. This is load-bearing for §2's own symmetry design below: reuse the SAME
  validated "two Equal, not one Symmetry" pattern rather than reaching for an API this codebase has never
  actually exercised.
- **Entity addressing**: every id can carry a `:S`/`:E`/`:C` suffix (start/end/center point of a named entity),
  resolved by `BuildContext.resolve_entity`. This design's own manifest (§1) reuses this EXACT convention rather
  than inventing a second one — a tie's own endpoint is `tie7:S`, a silhouette arc's own center is `seg2:C`.
- **Dimensions + the parametric-offset building block** (`fb_engine/dimensions.py`, `offsets.py`):
  `sketchDimensions.addDistanceDimension`/`addRadialDimension`/`addDiameterDimension` exist and already support
  being driven by a user-parameter EXPRESSION (`_apply_expression` renames the dimension's own parameter and
  sets `.expression`, not a literal value — exactly "a dimension for stroke width... make it a param"). **The
  stroke-width mechanism itself already exists**: `_try_parametric_offset` builds
  `sketch.geometricConstraints.createOffsetInput(curveCollection, valueExpr)` →
  `.addOffset2(offsetInput)`, then renames `offsetConstraint.dimension.parameter` and sets its `.expression` to
  the SAME string a `rail_width`-style parameter would resolve to — a direct, already-proven template for §4.
  **One real, disclosed gap**: this code was built for offsetting CLOSED LOOPS (a whole boundary shape's own
  inward/outward offset); offsetting a SINGLE OPEN line or arc (one rail, in isolation) has never been exercised
  in this codebase — flagged as something the advisor verifies live in Fusion (§4/open questions), not assumed
  to "just work" by analogy.
- **User parameters**: TWO existing mechanisms. `b-spline-gen.py`'s own `_sync_user_parameters(design, params)`
  (today: only `widthIn`/`heightIn`, called from `_handle_generate` for a real — non-preview — send) is the
  natural, minimal extension point for `rail_width`/`tie_width`/`node_radius`/`border_width`/the shape params.
  `fb_engine`'s own `ParametricSketchBuilder._sync_user_parameters` is a more general create-if-missing-then-set-
  expression version, worth modeling the extension on even if the actual call site stays in `b-spline-gen.py`.
  **A genuine undo-safety trap, already documented in this codebase's own history** (`ensure_tilt_param`'s own
  docstring, and `ROADMAP.md`'s own open audit finding A2-1): a user parameter created INSIDE a Fusion command's
  own `Execute` can be silently orphaned by Ctrl+Z. Directly relevant to this design because —
- **A structural difference this design MUST address, not inherit blindly**: `b-spline-gen.py`'s own bridge
  handler (`PaletteHTMLEventHandler.notify`) runs a send's ENTIRE build directly inside the HTML event callback —
  **not** inside a Fusion command at all. `frame-builder`'s own equivalent instead routes every build through a
  hidden command's `Execute`, via `palette_scaffold.py`'s `schedule_hidden_build` — "which makes one undo unit."
  Building a constrained sketch (real geometry + constraints + DIMENSIONS + PARAMETERS, exactly the class of
  object the undo-orphaning trap above warns about) directly in the event handler, the way `b-spline-gen.py`
  builds its plain SVG import today, is the WRONG precedent to copy for this specific feature. §5 below adopts
  `schedule_hidden_build`'s own pattern instead, even though the rest of `b-spline-gen.py` doesn't use it yet —
  a disclosed, deliberate divergence from this file's own existing convention, not an oversight.
- **Performance**: nothing in `b-spline-gen.py` itself batches, defers compute, or reports progress for a large
  build — only the JS-side 256KB chunking and a spacing-scaled poll timeout exist there. `fb_engine` DOES have
  the real building blocks: `deferred_compute(sketch)` (a context manager, always restores
  `isComputeDeferred=False` on exit even on an exception), and `_build_blocks`'s own established ORDER — live
  projections first, then geometry+constraints+dimensions together inside ONE deferred-compute window, a manual
  `Pulse` (flip `isComputeDeferred` off then on), THEN offsets/miters in a SECOND deferred window (a pulse is
  needed before an offset's own result curves can be named — `offsets.py`'s own comment). §6 reuses this exact
  block order rather than inventing a new one.
- **What does NOT exist anywhere in this repo**: any code that reads/parses SVG markup back into structured
  geometry (`b-spline-gen.py`'s own `_prescale_svg` is an explicit no-op; the SVG is handed whole to Fusion's own
  `importManager.importToTarget`) — confirming §3's own framing: the manifest must be produced DIRECTLY from the
  editor's own pattern/shape DATA, never by re-parsing SVG output. Also confirmed: `PATTERN.fusionGeometry`
  ('centerline'/'outline'/'both') has **zero** Python-side counterpart today — every mode's SVG lands in Fusion
  through the exact same `importToTarget` call, with no branch on which mode produced it (§7).

---

## §1 The declared SKETCH MANIFEST

One manifest per LAYER (matching every other per-layer send today — `stamp.layers[i]`), sent as a NEW sibling
field, `stamp.layers[i].sketchManifest`, alongside (not replacing) the existing `.svg` — see §7 for exactly which
layers get one at all. Deliberately shaped to be a near-direct FEED into `fb_engine`'s own already-working
`geom_step`/`constraint_step`/`dimension_step`/`offset_step` dispatch (Ground truth #5) — reusing its own
`Type`/`Targets` vocabulary and its own `:S`/`:E`/`:C` entity-suffix convention, not a parallel format the add-in
would need its own separate interpreter for.

```jsonc
{
  "version": 1,
  "layerId": "3",                    // editor._layers[].id — names the Fusion sketch, ties failures back to a layer
  "sketchName": "Shape Lattice — Layer 3",
  "units": "in",                     // ALWAYS inches — every coordinate below is a real model-space number,
                                      // never a DPI-baked pixel (Ground truth #1's own fragility, deliberately not repeated)
  "region": { "x": 0, "y": 0, "w": 7, "h": 9 }, // the board rect this was generated against — diagnostic only, the add-in never needs it

  "entities": [
    // Lattice: every rail/tie is a Line; every node is a Circle. §2.
    { "id": "rail0", "type": "Line", "p1": [0.25, 1.5], "p2": [6.75, 1.5] },
    { "id": "tie3",  "type": "Line", "p1": [2.0, 1.5], "p2": [2.0, 3.0] },
    { "id": "node5", "type": "Circle", "center": [2.0, 1.5], "radius": 0.075 },

    // Shape Lattice: one entity per PRIMITIVE (generateSilhouette's own
    // `primitives`, T58's own established L/A shape) — a NEW "ArcCenter"
    // geometry type (§5's own gap #1), not Arc3Point: this generator
    // already computes center+radius+angles directly (T55's own closed
    // form), and re-deriving a valid THIRD point for addByThreePoints
    // from that would be strictly more, riskier work for no benefit.
    { "id": "seg1", "type": "Line", "p1": [3.5, -4.5], "p2": [3.5, -2.079] },
    { "id": "seg2", "type": "ArcCenter", "center": [2.652, -1.66], "radius": 0.848,
      "startAngleDeg": 0, "sweepDeg": 90 }
  ],

  "constraints": [
    // Lattice — relationships ONLY, per Fred's own "no length needed":
    { "type": "Horizontal", "targets": ["rail0"] },            // PATTERN.orientation fixes this per-rail, not guessed
    { "type": "Vertical",   "targets": ["tie3"] },
    { "type": "Coincident", "targets": ["tie3:S", "rail0"] },  // "tie-end-on-rail" — a POINT-on-LINE coincidence, not point-to-point

    // Shape Lattice — restating facts the generator's own math already proves (Ground truth #5):
    { "type": "Tangent",  "targets": ["seg1", "seg2"] },
    { "type": "Vertical",  "targets": ["seg1"] },              // a "horn" segment — same X at both ends, always
    { "type": "Equal",    "targets": ["seg2", "seg4"] },       // hourglass: shoulder/hip arcs share cornerRadius
    // Symmetry: TWO Equal constraints (mirrored pairs), reusing the SAME
    // pattern the existing sketches/template_1 symmetry phase already
    // validated — NOT addSymmetry (Ground truth #5: doesn't exist here, unproven).
    { "type": "Equal", "targets": ["seg2", "seg9"] },
    { "type": "Equal", "targets": ["seg1", "seg10"] }
  ],

  "parameters": [
    // Recorded ALWAYS (Fusion userParameters — visible, named, reusable
    // by the person downstream); DRIVES a dimension only where listed
    // under "dimensions" below (never for lattice pieces — Fred's own
    // "no length needed" applies to every rail/tie/node's own position,
    // only to WIDTH does a dimension apply).
    { "name": "waist_reach",   "value": 0.55,  "unit": null },
    { "name": "corner_radius", "value": 0.22,  "unit": null },
    { "name": "rail_width",    "value": 0.07,  "unit": "in" },
    { "name": "tie_width",     "value": 0.07,  "unit": "in" },
    { "name": "node_radius",   "value": 0.075, "unit": "in" }
  ],

  "dimensions": [
    // Shape preset ONLY (§2/§4): a FEW driving dimensions, tied to the
    // shape's own parameters — this is what makes the hourglass/bottle
    // draggable-in-Fusion via its OWN named parameters, not free geometry.
    { "type": "Radial", "target": "seg2", "expression": "corner_radius * halfWidth_expr" },

    // Width offsets — EVERY rail/tie/node gets one, driven by its OWN
    // kind's shared parameter (§4). One offset dimension per KIND-GROUP
    // where the add-in can batch them (a curve collection, §4's own
    // "batched vs per-piece" performance switch), or one per piece as
    // the disclosed fallback.
    { "type": "Offset", "targets": ["rail0", "rail1", "rail2"], "expression": "rail_width / 2", "id": "rail_offset_group" }
  ],

  "groups": {                        // purely organizational — one Fusion sketch, but the add-in can still
    "rails": ["rail0"],               // fold these into named sketch layers/attribute groups for later selection,
    "ties": ["tie3"],                 // matching FrameBuilder.ID's own existing attribute-tagging convention
    "nodes": ["node5"],
    "silhouette": ["seg1", "seg2"]
  }
}
```

A degenerate/empty layer (nothing generated, or a Lattice pattern with zero rails/ties — a real, already-handled
state elsewhere in this codebase, §2's own "declined gracefully" convention) produces `{ entities: [],
constraints: [], parameters: [], dimensions: [] }` — the add-in's own job is then a no-op sketch (or none at
all), not an error.

---

## §2 Entities and constraints, per piece kind — each one derived from an EXISTING, already-true fact about the
generator's own output, not invented for this doc

**Lattice (rails/ties/nodes) — relationships only, exactly matching Fred's own "no length needed."**

| piece | entity | constraint(s) | derived from |
|---|---|---|---|
| rail | `Line` | `Horizontal` (orientation='horizontal') or `Vertical` (orientation='vertical') | `computePattern`'s own rail segments always share one coordinate (`a.y===b.y` horizontal, `a.x===b.x` vertical) — `PATTERN.orientation`, editor-lattice-pattern.js — a closed-form fact about this generator's own output, not measured per-piece |
| tie | `Line` | the OPPOSITE axis constraint from rails (perpendicular by construction); `Coincident` (point-on-line, `tie:S`/`tie:E` against whichever rail(s) it touches) | ties always run perpendicular to rails (same file); "tie-end-on-rail" is Fred's OWN named constraint (ROADMAP.md:765) — `fb_engine`'s declared-but-unwired `PointOnCurve` (Ground truth #5) is the natural home, or a plain `Coincident(point, line)` (Fusion natively supports point-ON-a-line, not just point-to-point) if `PointOnCurve` isn't filled in time — SAME Fusion call either way, just which fb_engine wrapper reaches it |
| node | `Circle` | none required; `Coincident` to the rail/tie it sits on IF it sits at a tie-end or crossing (most nodes do — `PATTERN.nodes.ends`/`.crossings`) | `computePattern`'s own node emission (`nodePoints`) — a node's own point is already, by construction, the SAME point as a tie endpoint or a rail/tie crossing; declaring the coincidence is free (the data already agrees), not solved |
| border | the boundary shape's OWN entities, offset (§4) | inherits whatever the boundary shape itself declares (a hand-drawn shape has none; a generated silhouette inherits §2's own shape rules below) | `editor-lattice-pattern.js`'s own Border piece is explicitly "the SAME d/shape geometry, just re-stroked" (T49) — same principle here: no NEW geometry, an offset of the EXISTING boundary entities |

**Shape Lattice (hourglass/bottle silhouette) — the one place a FEW driving dimensions apply (§4's own "shape
presets first" ordering, Fred's own).**

| segment kind | entity | constraint(s) | derived from |
|---|---|---|---|
| a "horn" (straight, always) | `Line` | `Vertical` — EVERY horn in both presets connects two points sharing the SAME local X (`hw` for hourglass, `neckHalfW`/`bodyHalfW` for bottle — `_solveHourglass`/`_solveBottle`'s own `P(hw, ...)` construction) | closed-form, not measured |
| top/bottom edge (straight, always) | `Line` | `Horizontal` — both presets' own top/bottom edges connect the mirrored L/R points at the SAME Y (`-hh`/`hh`) | closed-form |
| an arc segment (curve, by default) | `ArcCenter` | `Tangent` to its own two neighboring segments (ALWAYS true, T55's own proven invariant — Ground truth #4) | `_arcPrimitive`'s own construction |
| hourglass shoulder ↔ hip arc | (existing `ArcCenter` pair) | `Equal` (both share `cornerRadius`) | `_solveHourglass`'s own single `cornerRadius` variable feeding BOTH |
| bottle neck ↔ hip arc | (existing `ArcCenter` pair) | none — `radiusNeck`/`radiusBody` are genuinely DIFFERENT values (`_solveBottle`'s own two separate derived radii) — declaring `Equal` here would be WRONG, not just unneeded | closed-form (the ABSENCE of a relationship is itself a fact worth stating, so a future editor doesn't add one by habit) |
| every right-side entity ↔ its LEFT mirror | (existing entities) | TWO `Equal` constraints per mirrored PAIR (matching each own radius AND, for a `Line`, an equal-length declaration) — NOT `addSymmetry` (Ground truth #5) | both solvers' own `P()`/`M()` mirror construction — every left point is the EXACT mirror of its right counterpart about `cx`, by construction |
| a `kink` segment (2 `Line`s, per-segment override) | two `Line` entities sharing one endpoint (the apex) | none beyond the shared point (already coincident by construction — both lines were built FROM the same apex coordinate) | `_bulgeApex`'s own construction |

**What deliberately gets NO constraint at all**: the apex point of a `kink` segment isn't pinned to any
particular X/Y (Fred's own "no length/position needed" — a user who drags the sketch in Fusion can freely reshape
a kink's own depth); a segment's own two ENDPOINTS (where it meets its neighbor) ARE `Coincident`-worthy in
principle (two adjacent primitives already share the exact same point, per the flat keypoints loop,
editor-shape-lattice-generator.js's own `keypoints[i] -> keypoints[(i+1)%n]` contract) — **declared as
`Coincident` explicitly** (not left merely "close enough" by shared floating-point value), since Fusion's own
solver needs the RELATIONSHIP stated, not just numerically-equal starting coordinates, for it to survive a drag.

---

## §3 Producing the manifest — a pure function, same "no DOM" contract every other editor-shape-lattice-*.js
module already sets

`buildSketchManifest(pattern, region)` (naming TBD at implementation; `editor-shape-lattice-manifest.js`? — a
NEW module, not folded into an existing one, since NEITHER `editor-lattice-pattern.js` (pure geometry, no Fusion
concept at all) NOR `properties-shape-lattice.js` (DOM-touching, panel-specific) is the right home). Pure: same
`{editor, region} -> data` shape `generateSilhouette`/`computePattern` themselves already use — takes the layer's
OWN `pattern` object (exactly `layer.pattern`, the same object `currentPattern(editor)` reads — no new state)
plus the resolved `region`, returns the manifest object from §1. No DOM, no Fusion API, no `editor` object at
all — testable with a plain object, same as `computePattern` itself.

**Two independent producers, matching §2's own two piece-kind tables, composed by the SAME top-level function**:

1. **`_manifestFromLattice(pattern, extent)`** — calls `computePattern(pattern, {extent, occupied:[]})` (the SAME
   pure function `generatePattern` itself calls, editor-lattice-pattern.js:928) to get `{segments, nodePoints}`
   in LATTICE-cell coordinates, then `fromLattice(pt, spacing)` (already exported, same file) to model inches —
   the IDENTICAL two-step pipeline `generatePattern`'s own DOM-emit loop already runs, just building manifest
   entities instead of calling `emitSegment`/`emitNode`. One `Line` entity per segment (kind-tagged for §2's own
   H/V constraint choice, from `PATTERN.orientation`); one `Circle` per node point (`PATTERN.widths.nodeRadius`).
   Ties get a `Coincident` constraint against whichever rail entity shares their own `a`/`b` lattice coordinate
   (a plain equality check on the ALREADY-COMPUTED `{i,j}` pairs — no geometric search needed, since
   `computePattern`'s own row/column construction means a tie's own endpoint coordinate IS the rail's own
   coordinate whenever they're meant to connect, by construction, same reasoning §2 gives for nodes).
2. **`_manifestFromShape(shape, region)`** — calls `generateSilhouette(region, shape)` (unchanged,
   editor-shape-lattice-generator.js) to get `{preset, keypoints, segments, primitives, cx, params}`. Walks
   `primitives` (the SAME flat list `primitivesToPathD` already walks) building one `ArcCenter`/`Line` entity per
   primitive; `Tangent` between every adjacent PAIR (trivial — adjacency IS array order, `primitives[i]` to
   `primitives[i+1 % n]`, same wraparound `generateSilhouette` itself uses); the `Equal`/mirror constraints from
   §2's own table, keyed off the SAME segment-index arithmetic `mirrorSegmentIndex` (T59,
   editor-shape-lattice-interaction.js) already established for the Segments panel — reused directly, not
   re-derived, for exactly the same reason T59 itself reused it rather than a second mirror-index formula.
   `params` (T59's own new resolved-params field) becomes the `parameters` list directly — already the exact
   value set (explicit-or-jittered) this needs, with zero extra resolution work.

Both producers share `_toEntityId(kind, index)` (a small declared naming scheme — `rail0`, `tie3`, `node5`,
`seg1` — so a constraint's own `targets` array can reference an entity by a STABLE string, matching `fb_engine`'s
own `entity_map`/id-string convention, Ground truth #5) and the width/border parameter table (§4).

**Called from where**: `export-flow.js`'s own `sendToFusion` (Ground truth #1), alongside the EXISTING
`_fusionLayerSvg` call — same `layersToExport.map(...)` loop, one more field per layer object. Gated on §7's own
per-layer choice (a NEW 4th `FUSION_GEOMETRY` value, or a genuinely separate toggle — open question, §7).

---

## §4 Stroke width — a dimensioned offset, driven by a Fusion user parameter, round caps as tangent half-circles

Fred's own two-part ask, read together: "add a dimension for stroke width and make it a param" + "round caps."
This turns EVERY centerline entity's own visual "width" (today: an SVG `stroke-width` attribute, purely
cosmetic, editor-lattice.js's own `emitSegment`) into REAL, closed, offset sketch geometry — usable for the
Outline/inlay export path (§7) as actual curves, not a re-derived stroke outline the way `OUTLINE_KINDS` computes
one today (editor-outline-preview.js).

**The offset itself — `fb_engine/offsets.py`'s own `_try_parametric_offset`, reused as-is (Ground truth #5)**:
`sketch.geometricConstraints.createOffsetInput(curveCollection, ValueInput.createByString(expr))` →
`.addOffset2(offsetInput)` → rename `offsetConstraint.dimension.parameter` and set its `.expression` to
`"rail_width / 2"` (or `tie_width`/`node_radius`/`border_width`, per kind). One offset CONSTRAINT can cover a
whole CURVE COLLECTION (multiple entities at once) — §6's own batching plan groups every rail of a given width
into ONE collection, ONE offset constraint, ONE dimension, rather than one per piece, whenever nothing else about
those pieces differs (this is a genuine, existing Fusion capability this codebase's own code already uses for a
closed boundary loop — the open, disclosed question is whether the SAME call accepts a collection of many
DISJOINT open lines at once as cleanly; if not, the fallback below is the SAME mechanism run once per piece).

**A rail/tie needs the offset on BOTH sides** (its own two long edges) — `createOffsetInput`'s own directional
semantics (one call, one side) mean this is likely TWO offset constraints per group (one for `+width/2`, one for
`-width/2`, expressed as `rail_width / 2` and `-(rail_width / 2)` or via Fusion's own two-sided offset input, if
one exists — an open question for the advisor's own live check, §"Open questions," not assumed either way in
this doc).

**Round caps — one pair of `ArcCenter` entities per centerline piece, at each of its own two ends**: center =
that end's own centerline point (already a named entity point, `rail0:S`/`rail0:E`); radius = the SAME
`width/2` expression driving the offset (so a cap radius can never drift out of sync with its own offset width —
one parameter, two consumers); the arc spans exactly 180°, its own start/end points `Tangent` to the two offset
lines it joins. This is new geometry `fb_engine` has never built (no round-cap precedent found this turn) but is
NOT novel MATH — it's the exact same "semicircle whose center is the chord's own midpoint" fact
`editor-shape-lattice-generator.js`'s own `_bulgeFromRadius`/`_arcPrimitive` semicircle special-case (T55) already
uses for an entirely different reason; the SAME closed-form construction ports directly.

**Which pieces get a width dimension at all**: every rail (`rail_width`), every tie (`tie_width`), every node
(`node_radius`, a RADIAL dimension on the node's own circle directly — `fb_engine`'s `addRadialDimension` already
does exactly this, no offset construction needed for a circle that's already the right shape), the boundary/
border piece if enabled (`border_width`, `PATTERN.boundary.border.width` — `_effectiveBorderWidth`,
editor-lattice-pattern.js, already resolves the SAME "explicit width, or inherit the live boundary shape's own
stroke" duality this parameter's own VALUE should read from). The silhouette's own boundary centerline itself
(the hourglass/bottle outline) is NOT separately offset by a rail/tie/node width — it's either left as a bare
centerline (no border) or gets its own `border_width` offset when Border is enabled, matching how
`generatePattern`'s own Border piece already works today (Ground truth §2's own table).

---

## §5 The add-in side — reusing `fb_engine`, filling its own real (small) gaps, and one deliberate divergence
from `b-spline-gen.py`'s own current pattern

**The receiver**: a new branch inside `PaletteHTMLEventHandler.notify`'s own `_handle_generate` (`b-spline-
gen.py:746-757`, Ground truth #5) — reads `payload["stamp"]["layers"][i]["sketchManifest"]` when present,
alongside the existing `.svg` handling, not instead of it (a layer can carry both — §7).

**Build inside a hidden command, not the event handler directly — a deliberate divergence from how
`b-spline-gen.py` builds its OWN plain SVG import today.** `_import_single_layer_svg` runs straight inside the
bridge callback; this feature must NOT copy that, because it creates the exact class of object (parameters +
dimensioned constraints) `ensure_tilt_param`'s own docstring and `ROADMAP.md`'s own open finding A2-1 warn gets
silently orphaned by Ctrl+Z when created outside a command's `Execute`. `frame-builder`'s own
`palette_scaffold.schedule_hidden_build` already exists and already solves this (Ground truth #5) — reused as-is,
not reinvented, even though it's a pattern from the OTHER add-in in this same package, not from `b-spline-gen.py`
itself. One hidden command, one undo unit, per manifest send.

**Build sequence — reusing `_build_blocks`'s own established ORDER (Ground truth #5), not a new one**:
1. `sketches.add(plane)` — the plane choice matches today's own SVG-import placement (`_import_single_layer_svg`,
   an offset construction plane above the body peak) unless a reason emerges to differ; naming
   `manifest["sketchName"]`.
2. `deferred_compute(sketch)` window 1: every `entities[]` entry via `geom_step` — `Line`/`Arc3Point` unchanged;
   **two new geometry types to add, both small, both following the SAME dict-dispatch shape every existing type
   already uses**:
   - `Circle` → `sketch.sketchCurves.sketchCurves.sketchCircles.addByCenterRadius(centerPoint, radius)` — already
     DECLARED in `_process_sequence`'s own type list, just needs the one missing dispatch line.
   - `ArcCenter` → `sketch.sketchCurves.sketchArcs.addByCenterStartSweep(centerPoint, startPoint, sweepAngle)` —
     a genuinely NEW type (not declared anywhere yet); `startPoint` is derived from `center + radius * (cos
     startAngle, sin startAngle)`, matching the SAME forward-parametrization convention
     `editor-shape-lattice-generator.js`'s own `_arcPointAt`/`primitivesToPathD` (T58) already use — the add-in
     computes this ONE small trig step itself rather than the manifest carrying a redundant third point.
   Then every `constraints[]` entry via `constraint_step` — `Horizontal`/`Vertical`/`Tangent`/`Equal`/`Coincident`
   unchanged; **one gap to fill**: `PointOnCurve` (declared, undispatched) → `sketch.geometricConstraints.
   addCoincident(sketchPoint, sketchLine)` — Fusion's OWN `addCoincident` already accepts a curve (not just a
   point) as the second argument for exactly this "point lies somewhere along a line" relationship (this is a
   thin wrapper around an EXISTING Fusion call `constraint_step` already imports, not a new API surface). The
   SAME "skip + report, never abort" logging `constraint_step` already has for every other type
   (CONSTRAINT SKIP/FAIL/MISS) applies automatically — no new failure-handling code needed, just two new `elif`
   branches feeding the SAME machinery.
3. Manual `Pulse` (`isComputeDeferred` False→True, `offsets.py`'s own documented reason: an offset's own result
   curves can't be named/referenced until the sketch has actually recomputed once).
4. `deferred_compute(sketch)` window 2: `dimensions[]` (radial/diameter/distance via `dimension_step`, unchanged)
   then the width offsets (§4, `offset_step`/`_try_parametric_offset`, the one open "single open line" question
   flagged there) then the round-cap arcs (new geometry, tangent-constrained to their own offset pair).
5. `_sync_user_parameters` (b-spline-gen.py's OWN version, extended — Ground truth #5) — called ONCE per send,
   BEFORE step 2 needs to reference any of them by name in an expression (a parameter must exist before a
   dimension's own `.expression` string can reference it — same "two-step birth" ordering
   `frame_engine._create_skeletal_parameters` already established for its own different reason, reused here for
   the same structural reason: create the param at a placeholder value, THEN let dimensions reference it by
   name).

**Failure handling — inherited for free, not rebuilt**: every constraint/dimension call already routes through
`constraint_step`/`dimension_step`'s own existing CONSTRAINT SKIP / CONSTRAINT FAIL / CONSTRAINT MISS logging
(Ground truth #5) — a single bad entity id, an over-constrained request, or an unsupported combination logs and
the build CONTINUES, never aborts the whole sketch. This is already the dispatch's own explicit ask
("skip + report, never abort"), already proven in production for 7 of the ~9 constraint types this design needs
— the 2 gaps (`PointOnCurve`, the new `ArcCenter`/`Circle` geometry) inherit the SAME logging path the moment
they're wired in, by construction (they're new `elif` branches inside the SAME dispatch function, not a parallel
one).

---

## §6 Performance for big lattices (hundreds of pieces)

**What gets constrained vs plain, Fred's own explicit ordering**: "shape presets first (small, clear win),
lattice second (+ plain-geometry fallback for huge lattices)." A shape preset's own entity count is FIXED and
small (12 for hourglass, 10 for bottle, T55/T58 — never grows with board size), so it's ALWAYS fully constrained,
no threshold needed there at all. A Lattice pattern's own rail/tie/node count scales with board size and density
(`PATTERN.rails.count`/`.ties.count`, T56/T57 — hundreds of pieces on a large, dense board is the realistic case
the dispatch itself names) — this is where a size threshold and a fallback matter.

**Size threshold — a declared constant, not a magic number inline, matching this whole codebase's own
convention** (e.g. `SE15-SKETCH-PIECE-THRESHOLD`, a JS-side constant the manifest-producing function reads):
below it, EVERY rail/tie/node gets its own H/V + tie-on-rail constraints + a batched-group width offset (§4);
at/above it, `_manifestFromLattice` falls back to PLAIN geometry for rails/ties/nodes specifically — still
`Line`/`Circle` entities (so the add-in still builds real, selectable sketch geometry, just unconstrained beyond
what a `Line`/`Circle` already implies) with NO `constraints[]` entries for that group at all, and the width
still applies as a SINGLE dimension driving a SINGLE offset over the WHOLE kind-collection (the batching §4
already describes is exactly this fallback's own "one dimension for hundreds of rails" mechanism — not a
separate code path, the SAME one, just with the per-piece relationship constraints skipped). The silhouette
itself is UNAFFECTED by this threshold regardless of how large the surrounding lattice is — it's always small,
always fully constrained.

**Where the threshold's own NUMBER comes from**: not guessed in this doc — the advisor's own live Fusion
verification (this turn's dispatch: "workers stay browser/no-Fusion") is what actually measures solver time per
constraint count on a real design; this doc names the MECHANISM (a size-gated fallback) and the SHAPE of the
number (rail/tie/node COUNT, not board area or spacing directly, since count is what `PATTERN_DEFAULTS`'s own
existing count-mode fields, T56, already declare and the user already sees/controls) rather than pre-committing
to an unverified threshold value — flagged explicitly under Open questions.

**Compute-deferral reuse, not reinvention**: §5's own build sequence ALREADY wraps geometry+constraints in one
`deferred_compute` window and dimensions+offsets in a second, with a `Pulse` between (`fb_engine`'s own
`_build_blocks` order, Ground truth #5) — this is the SAME mechanism that keeps a hundred-plus-entity sketch from
recomputing after every single `addByTwoPoints`/`addCoincident` call; nothing extra needed for "big" beyond what
"correct" already requires.

**Progress feedback**: `b-spline-gen.py` has no progress-reporting mechanism of its own beyond
`_send_progress(msg)` (a few text pings today, Ground truth #5); `fusion-exporter/exporter.py`'s own
`ui.createProgressDialog()` + `.wasCancelled` polling is the one precedent in this repo for a long, cancellable
Fusion-side operation — worth reusing its own SHAPE (not its own code, a different add-in) for a manifest build
large enough to take visible time, gated behind the SAME size threshold above (a small shape preset never needs
one).

---

## §7 Coexistence with the current SVG path, and with Outline/Both

**Not a replacement — a genuinely SEPARATE delivery, because it serves a different purpose (Ground truth #1).**
The existing `.svg` payload feeds a 3D RELIEF/carve pass (a rasterized stamp baked onto the terrain mesh); the
manifest produces a flat, selectable, draggable, CAD-native 2D sketch — a person could want the relief carve, the
flat sketch, both, or (skipping the relief for this one layer) only the sketch. This design does NOT make the
manifest an alternative encoding of the SAME `.svg` field — `stamp.layers[i]` gets BOTH fields
(`.svg` unconditionally as today, `.sketchManifest` only when applicable), and the add-in decides independently
whether to run the existing `_import_single_layer_svg` stamp-import, the new manifest build, or both, per what
the layer's own settings ask for.

**Where the choice lives — extending the EXISTING `FUSION_GEOMETRY` table (layers.js:72-76), not a parallel
mechanism**, matching how that table's own docstring already frames itself ("a future value is one entry here,
not a UI rewrite," Ground truth #3): a 4th value, e.g. `'constrained-sketch'` — `{ value: 'constrained-sketch',
label: 'Constrained Sketch', hint: 'A real, lightly-constrained Fusion sketch instead of a flat import.' }`.
**Gated on the layer actually HAVING a `.pattern`** (Lattice or Shape Lattice content — `getLayerPattern`,
editor-lattice-pattern.js, already the one place this codebase checks "does this layer even have Lattice
settings") — a hand-drawn shape or text layer has no structured entity/constraint data to build a manifest FROM
at all (Ground truth §3's own "declared gracefully" framing), so the picker itself should only OFFER this 4th
value for a layer where it can actually produce something, the same "don't offer what would just decline"
principle `showsOutline(l)` (layers.js:160-162) already applies to the outline picker's own availability.

**How it composes with Outline/Both — it doesn't need to, because §4 already IS the outline answer for this
path.** Today's `centerline`/`outline`/`both` choice governs how the FLAT SVG gets baked (`_getLayerSvgForFusion`,
Ground truth #3) — a question that stops applying the moment a layer's own choice is `'constrained-sketch'`,
because the manifest's own width-offset geometry (§4) already produces REAL outline curves as first-class sketch
entities, driven by a parameter, exactly what "Outline/inlay geometry: offsets of the constrained centerlines
where feasible" (ROADMAP.md's own words) asks for — there's no SEPARATE outline SETTING to reconcile; picking
`'constrained-sketch'` means "give me the centerline AND its own true offset, both live," every time, the offset
just being real Fusion geometry now instead of a browser-side recomputed path.

**Python-side dispatch**: `_handle_generate`'s own per-layer loop (today: always `_import_single_layer_svg`)
reads `layer_config.get("fusionGeometry")` — a NEW field the JS-side payload needs to include per layer (today's
payload only carries `{profile, depth}` per layer, Ground truth §3; adding `fusionGeometry` there is a small,
additive payload change) — `'constrained-sketch'` routes to §5's own hidden-command manifest build INSTEAD OF
`_import_single_layer_svg` for THAT layer specifically; every other value keeps today's exact behavior,
unchanged, byte-for-byte.

---

## §8 Slices (browser-provable manifest + tests; the add-in builder itself verified by the advisor in Fusion —
this turn's own dispatch: workers stay browser/no-Fusion)

Fred's own explicit order: shape presets first ("small, clear win"), lattice second (+ the plain-geometry
fallback for huge lattices, §6). Matches this codebase's own established SE13/SE14 slicing shape (pure math
first, DOM/emit second, live-wiring third) — reused here as SHAPE PRESET first / LATTICE second / ADD-IN
INTEGRATION third, rather than a pure/DOM/live split, since the "pure" and "DOM" halves are BOTH entirely
browser-side for this feature; the real dividing line is which DATA SOURCE the manifest is built from, and only
the add-in half needs Fusion to prove.

**Slice 1 — the shape-preset manifest, pure.** `buildSketchManifest`'s own `_manifestFromShape` half (§3):
hourglass + bottle, both presets, across seeds/regions — entities (Line/ArcCenter) match `generateSilhouette`'s
own primitives exactly (byte-for-byte coordinate cross-check, the SAME "independent oracle" discipline this
codebase's own tangency tests already use, not a re-derivation of the same math); every Tangent-constrained pair
is verified against the SAME primitive data (adjacent primitives genuinely share endpoints, per T55's own already-
proven guarantee — this slice's own test doesn't re-prove tangency, it proves the MANIFEST correctly RECORDS a
fact the generator already established); the Equal/mirror constraint set matches §2's own declared table exactly
(hourglass: shoulder≡hip, NOT waist≡anything; bottle: NO neck≡hip; both: two-Equal mirroring, not one Symmetry);
parameters match `generateSilhouette`'s own `params` return field 1:1. Non-vacuous: a deliberately WRONG
mirror-index formula (or a `Symmetry`-instead-of-`Equal` mutation) must fail this slice's own test.

**Slice 2 — the lattice manifest, pure.** `_manifestFromLattice` (§3): entities match `computePattern`'s own
segments/nodePoints (same cross-check discipline); H/V constraint choice matches `PATTERN.orientation` for every
piece, not just a sampled few; tie-on-rail Coincidence only where the underlying lattice coordinates genuinely
agree (a tie whose own endpoint does NOT land on any rail gets NO false Coincident — a real negative case to
test, not just the positive one); the size-threshold fallback (§6) produces the declared "entities only, no
per-piece constraints, still a batched width offset" shape above the threshold, and the FULL per-piece
constraint set below it — both branches tested, at both sides of the boundary, not just one representative case.

**Slice 3 — add-in integration** (this turn's own dispatch: Fusion-verified by the advisor, not built or run by
a worker). Wires §5's own manifest→Fusion-API build (the two new `geom_step`/`constraint_step` branches, the
`schedule_hidden_build` wrapping, `_sync_user_parameters`'s own extension) and §7's own payload/dispatch change.
Verify list for the advisor's own pass: a shape preset arrives as a real sketch with the declared constraints
present (inspectable via Fusion's own UI/API, not just "it imported without erroring"); dragging the resulting
sketch's OWN geometry in Fusion stays tangent/H/V/mirrored, matching what the browser's own axis-locked handles
already guarantee (T59) — the whole POINT of this feature, proven end to end; a rail_width/tie_width/etc.
parameter edit in Fusion's own parameter list live-updates every offset+cap that parameter drives; a deliberately
BAD manifest (an unresolvable target id, an impossible constraint combination) is skipped-and-reported, never
aborts the rest of the sketch (§5's own inherited guarantee, worth proving live once, not just trusted from
reading `constraint_step`'s own code); a real "hundreds of pieces" lattice send, timed, to give the threshold
(§6) a real number instead of a guessed one.

---

## Answers (advisor, MEASURED in Fusion 2026-09-25, scratch sketch deleted after)
1+2. `sketch.offset(ObjectCollection[oneOpenLine], directionPoint, dist)` works on a SINGLE OPEN line: ONE side per
   call → two calls per centerline; each creates a SketchOffsetConstraint + a SketchOffsetCurvesDimension. Setting
   that dimension's `parameter.expression = 'rail_width / 2'` (a user parameter) WORKS: changing the parameter from
   0.1→0.3 in moved the offsets to ±0.15 in. `geometricConstraints.createOffsetInput/addOffset2` exist but take a
   std::vector (a Python list), not an ObjectCollection — the classic `sketch.offset` path is proven; use it.
3. Timing: 100 rails × 2 offsets = 20.6 s (~0.1 s per piece, before caps/param wiring). A typical lattice (6-7 rails +
   8-13 ties ≈ 20 pieces) ≈ 2-4 s — fine. Threshold default: 60 pieces constrained; above → plain geometry (declared,
   tunable).
4. Placement: keep `_import_single_layer_svg`'s construction-plane placement (peak of the part + 5 cm, one plane per layer) — CONFIRMED by Fred 2026-09-25: "ok it's fine like that".
5. Default: a constrained-sketch send REPLACES that layer's plain SVG sketch, and the carve STAMP still runs
   (relief + editable sketch from one send). Revisit after use.
6. Noted as extension points; nothing to build.

## Fusion coincidence rules (advisor MEASURED 2026-09-25, prompted by Fred: "Fusion doesn't like geometry placed exactly then made coincident")
- Separate points at identical coords + addCoincident: OK. Point exactly on a curve + addCoincident(point, curve): OK.
- `SketchPoint.merge(other)` fuses two points into ONE with no constraint = what UI snapping does ("auto-coincident").
- addCoincident on points that are ALREADY one point (shared/merged) or already forced together -> "Failed to solve"
  (redundant = over-constrained). That is the real quirk, not exact placement.
- Fred 2026-09-25: "I don't want merging of points, I need to be able to separate the coincident joints" -> EVERY
  joint = separate points + ONE explicit Coincident (point-point or point-on-curve), exact placement; no merge, no
  shared points between pieces; never a redundant second constraint on the same pair.

## Width decision (Fred 2026-09-25)
UPDATE (Fred: "box lattice needs to be slots too"): BOTH Box and Shape Lattice = center-to-center SLOTS, centerline
end points fixed (anchored slots grow evenly on stroke_width edits; free ones drift lopsided - measured), nodes built
on the slot centerline end points. Offsets removed.

## LOOSE CONTOUR (Fred 2026-09-26: "dont use symmetry either" / "no radius dim though, leave the sketch loose for now")
Constraint vocabulary for SE15/SE15b sketches: NO Fix, NO Symmetry, NO radius dims, NO length dims. Allowed:
slots + the `stroke_width` width dim, the contour's overall width/height dims = `widthIn - contour_margin` / `heightIn - contour_margin`, with a NEW user
parameter `contour_margin` = 0.25 in (Fred: "W and H is good", "-.25 then", "instead of a param lets make a new one"); point-to-point on corner points; the app draws the contour 1/8" inside
the board so both sides match), Coincident joints (separate points), Tangent at contour joints, Horizontal /
Vertical. Geometry is INSERTED in position (symmetric by coordinates) and left loose — drift on a width edit is accepted.
Measured before this ruling (for the record): Symmetry needed an origin-anchored axis, and without size dims the edges
ran off on a width edit; revisit only if Fred asks for a held shape.

## NO FIX (Fred 2026-09-25: "never use Fix") — advisor MEASURED
All slots, NO Fix, relationships only (rails Horizontal, ties Vertical, tie ends Coincident on rail centerlines): zero
failures; stroke_width 0.07→0.2 moved centerlines 0.005", back to 0.07 returned exactly. Fix + relationships together =
over-constrained (T65 failure). This supersedes every "anchor / isFixed" note above.

## Open questions for Fred / the advisor (this doc's own defaults above; revisit after Slice 3's own live pass)

1. **Two-sided offset (§4)**: does `createOffsetInput`/`addOffset2` accept a SINGLE call for both sides of an
   open line, or does this genuinely need two separate offset constraints per centerline (one per side)? Changes
   §4's own entity count per rail/tie, not the underlying mechanism.
2. **Offsetting a single OPEN line/arc, not a closed loop (§4/§5)**: `fb_engine`'s own parametric-offset code has
   only ever been exercised on closed boundary loops (Ground truth #5) — confirm it behaves the same for one
   isolated rail segment, or find the actual difference and adjust §4's own construction.
3. **The size threshold's own NUMBER (§6)**: this doc names the mechanism and what it's gated on (piece count),
   not a value — needs one real timed "hundreds of pieces" Fusion build (Slice 3's own verify list) before a
   number goes in `SE15-SKETCH-PIECE-THRESHOLD`.
4. **Sketch placement**: reuse `_import_single_layer_svg`'s own offset-construction-plane placement as-is, or
   does a constrained sketch (meant to be dragged/edited, not just viewed) want a different plane/origin
   convention? Not resolved here — a real UX call, not a geometry one.
5. **Does `'constrained-sketch'` ever want to ALSO send the plain `.svg`** for the SAME layer (so a person gets
   both the relief-carve stamp AND the flat sketch from one send), or is picking it meant to SUPPRESS the stamp
   entirely for that layer? §7 assumes "both fields present, add-in decides" without pinning down whether the
   STAMP import itself still runs — a real per-send-intent question, not just a payload-shape one.
6. **Style vocabulary for constraint TYPES beyond what's declared here**: `Perpendicular`/`Concentric`/
   `Midpoint` are ALSO declared-but-undispatched gaps in `fb_engine` (Ground truth #5) — none of them are needed
   by THIS design's own entity/constraint tables (§2), but worth naming as available, cheap extension points
   (same shape `PointOnCurve`/`ArcCenter`/`Circle` are filled in §5) if a future refinement wants one.

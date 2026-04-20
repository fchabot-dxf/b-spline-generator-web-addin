# Template Maker — Constraint Workflow Context Sheet

Session date: 2026-04-18
Scope: constraint selection → phase-block emission, plus the crash-fix chain that unblocked it.

---

## 1. How the app works now

### 1.1 End-to-end flow for constraints

```
User draws geometry in Fusion sketch
        │
        ▼
User selects geometry ──► Rename ──► FrameBuilder.ID stamped on each entity
        │
        ▼
User applies constraint (perp, coincident, tangent, …)
        │
        ▼
User selects constraint ──► Generate
        │
        ▼
ownership_gate.is_framebuilder_owned(constraint)
   └─ walks constraint's subtype-specific target slots
   └─ passes iff EVERY target carries a FrameBuilder.ID
        │
        ▼
relation_hints._hint_constraint(constraint)
   └─ emits: Constraints.<Type>("horn_TL", "brace_BR")
        │
        ▼
phase_parser._build_constraint_step(...)
   └─ emits step dict:
     {'Type': 'PerpendicularConstraint',
      'Targets': ["horn_TL", "brace_BR"]}
        │
        ▼
FrameBuilder runtime at phase-run time
   └─ reads Targets, calls sketch API directly:
     sketch.geometricConstraints.addPerpendicular(lineA, lineB)
```

### 1.2 Three ownership paths (ownership gate)

A sketch entity is "safe to emit" if it matches one of:

| Path | Applies to | How ownership is established |
|------|-----------|------------------------------|
| Direct | Seed geometry (lines, arcs, circles, splines, points) | Carries `FrameBuilder.ID` attribute — stamped by Rename |
| Derived point | SketchPoint at a curve's start/end/center | Inherits parent curve's ID → `"horn_TL:E"` |
| Target-derived | Constraints and dimensions | Every target must itself be owned (recursive). Constraint itself is NEVER stamped. |

### 1.3 Subtype dispatch (relation_hints.CONSTRAINT_TARGET_PROPS_BY_TYPE)

Per-subtype map of which property slots Fusion exposes on each constraint / dimension class. Used by BOTH the ownership gate and the emitter — same map, no drift.

Covered constraints:
CoincidentConstraint, HorizontalConstraint, VerticalConstraint, HorizontalPointsConstraint, VerticalPointsConstraint, ParallelConstraint, PerpendicularConstraint, CollinearConstraint, EqualConstraint, SmoothConstraint, TangentConstraint, MidPointConstraint, ConcentricConstraint, SymmetryConstraint, PolygonConstraint.

Covered dimensions:
SketchLinearDimension, SketchAngularDimension, SketchRadialDimension, SketchDiameterDimension, SketchConcentricCircleDimension, SketchOffsetDimension, SketchEllipseMajorRadiusDimension, SketchEllipseMinorRadiusDimension.

Not covered by `CONSTRAINT_TARGET_PROPS_BY_TYPE` (returns empty tuple → falls through to `/* targets */` placeholder, user hand-edits): CircularPatternConstraint — multi-target collection, adding it is a localized task.

**OffsetConstraint is covered but via a different path** — see §1.6. It does not use the subtype dispatch table because its runtime shape is a `{'Type': 'Offset', ...}` Step, not a generic `{'Type': '<Constraint>', 'Targets': [...]}`.

### 1.4 Constraints carry no ID — by design

Three reasons, all pointing the same way:

1. **Fusion's API physically refuses it.** CoincidentConstraint (and likely siblings) raises `"3 : object does not support attributes"` when `.attributes` is touched. We cannot stamp an ID even if we wanted to.
2. **The runtime never looked a constraint up by name.** Names were debug-display only. Creation is target-driven.
3. **Targets are the identity.** `PerpendicularConstraint(horn_TL, brace_BR)` is unique — only one perpendicular relationship can exist between those two lines.

The parser (`phase_parser._build_constraint_step`) consequently treats every positional argument as a target. No "first arg = name" heuristic.

### 1.5 Seed + constrain in the same phase: when is it safe?

The author's working style is to draw every line with **independent endpoints** (no endpoint-snapping) and then apply Coincident explicitly between the points you actually want coincident. That workflow avoids Fusion's auto-coincidence path entirely — every endpoint is a distinct SketchPoint with its own role-derived ID (`horn_TL:E`, `brace_BR:S`) — so co-emitting is safe for every geometric constraint including Coincident.

| Constraint family | Safe to seed + constrain in one phase? | Why |
|-------------------|---------------------------------------|-----|
| CoincidentConstraint (author's workflow — no endpoint snapping) | YES | Each endpoint has a distinct role-ID. The explicit Coincident is the only one on that point pair. Runtime's deferred-compute wrap (§1.5.2) holds the solve until all seeds + the Coincident are in place; single flush moves the points together cleanly. |
| Geometric: perpendicular, parallel, collinear, concentric, tangent, horizontal, vertical, equal, midpoint, symmetry, polygon | YES | Seed coords capture already-satisfied state. Applying constraint is a no-op for the solver. |
| Dimensional: linear, angular, radial, diameter, offset, ellipse-major/minor | PREFER SPLIT | Seed coords are the as-drawn position. Parametric dimension forces a different value → solver moves geometry → behaviour depends on other constraints. Cleaner to seed with parametric expressions, then apply dimension. |

Rule of thumb: constraints that *express a relationship* co-emit with seeds; constraints that *force a value* go in a later phase.

#### 1.5.1 Why endpoint-snapping is a separate problem

If you DO draw by endpoint-snapping (line 2's start lands ON line 1's end), Fusion silently creates its own `CoincidentConstraint` on the shared point before Rename gets a chance. That auto-created constraint:

- Has no FrameBuilder attributes (Fusion picked the timing).
- Merges the two endpoints into a single SketchPoint with a Fusion-generated internal label that can't be renamed cleanly.
- Fails the ownership gate's derive-by-role lookup because the point is "owned" by whichever curve Fusion decided to attach it to first, often not the one you'd pick.

The author's no-snap workflow sidesteps all of this. The `CoincidentConstraint — YES` row above assumes that workflow. If you find yourself endpoint-snapping, split the phase: seed first, let Fusion's auto-coincidence fire invisibly at solve time, then in a LATER phase add any deliberate extras the author's templates need.

#### 1.5.2 The deferred-compute wrap (already in the runtime)

`parametric_engine.ParametricSketchBuilder._build_blocks` wraps every generated phase block in a sketch-compute defer cycle. The pattern:

```
sketch.isComputeDeferred = False        # projections live
for proj in block["Projections"]: project_step(...)

sketch.isComputeDeferred = True         # ─────────────── START OF DEFERRED REGION
for step in block["BuildSequence"]:     #   seeds, constraints, dimensions
    dispatch_by_step_type(step)
for vd in block["VolatileDimensions"]:  #   snap-seed dims (applied then deleted)
    dimension_step(..., is_snap_only=True)

sketch.isComputeDeferred = False        # PULSE — solver runs once with everything placed
sketch.isComputeDeferred = True         # back into deferred for offsets

for step in block["Steps"]: step_step(...)   # offsets
for m    in block["Miters"]: miter_step(...) # corner miters

sketch.isComputeDeferred = False        # FINAL FLUSH — block complete
```

**What this buys you** as the template-maker user:

1. **No intermediate auto-coincidence.** Even if two seed endpoints happen to land at identical coords inside the deferred region, the solver doesn't run until the pulse — and by then your explicit Coincident step has already claimed the relationship. Fusion sees the explicit one, doesn't add a duplicate.
2. **No ghost generic-named points.** Solver doesn't create any intermediate entities during the deferred region. Every SketchPoint that exists at pulse-time came from a named Seed, so FrameBuilder.IDs are intact.
3. **Cheap intra-phase constraint ordering.** You can emit constraints in any order within the BuildSequence — the runtime only has to satisfy them once (at the pulse), not incrementally.

**How to use it** (in practice — it's mostly automatic):

- **You don't need to add anything to your phase block to get deferred compute.** Just emitting the `BuildSequence` list is enough; `_build_blocks` does the rest. The `'Type': 'Pulse'` step exists (§1.5.3) for rare mid-sequence forces, not for the end-of-sequence solve.
- **Order within BuildSequence**: geometry first, then constraints, then dimensions. `_process_sequence` dispatches by step type but the runtime doesn't reorder — if you put a constraint before its target geometry, it fails. The template maker's generator emits in the correct order by default (Seeds → Constraints → Dimensions), so this "just works" as long as you don't hand-reorder the dict entries.
- **Mixing independent sub-groups**: if you want a mid-block solve (e.g., finalize geometry A before adding geometry B that depends on A's solved position), insert a `Pulse` step between them — see §1.5.3.

#### 1.5.3 Manual pulse (intra-phase solve)

There's a `Pulse` step type dispatched in `_process_sequence`:

```python
{'Type': 'Pulse'}
```

It toggles `isComputeDeferred = False` then `True` again, forcing a solve without ending the deferred region. Useful when you need the solver's output from step *N* as input to step *N+k* (e.g., offsets that depend on the final position of a line that a Coincident will move). Most phases don't need this — the end-of-block pulse is enough.

The template maker does not currently emit `Pulse` steps automatically. If you need one, hand-edit the generated BuildSequence and add `{'Type': 'Pulse'},` at the boundary.

### 1.6 OffsetConstraint — dedicated path

OffsetConstraint doesn't fit the generic `Constraints.<Type>(target1, target2)` mould for three reasons:

1. **Runtime shape differs.** The engine treats an offset as a `Step` (`{'Type': 'Offset', ...}`) in the BuildSequence, not a regular constraint. `sketch.geometricConstraints.addOffset2(...)` internally builds the OffsetConstraint *and* its owning dimension in a single call.
2. **Targets are collections + a scalar.** `parentCurves` / `childCurves` are `SketchCurveList` collections; `dimension.parameter.expression` is a scalar string. The generic per-subtype-slot walk can't be pointed at a collection without drift.
3. **UX is inverted.** Users click the **offset-result (child) curves**, not the OC glyph itself. The scan has to reverse-lookup the owning OC from any selected child.

#### End-to-end flow

```
User selects offset-result curve (or the OC glyph)
        │
        ▼
_expand_offset_picks(entities)   ← template_payload_builder.py
   ├─ is_offset_constraint(ent)?                 → keep OC (dedup by entityToken)
   ├─ find_owning_offset_constraint(ent)?        → replace child with owning OC
   └─ else                                        → pass through unchanged
        │
        ▼
is_framebuilder_owned(oc)        ← ownership_gate.py
   └─ ent_type.endswith('OffsetConstraint')
       └─ parents = offset_hint.parent_curves(oc)
       └─ return all(is_framebuilder_owned(p) for p in parents)
        │
        ▼
_build_entity_hint(oc)           ← template_payload.py
   └─ if ent_type == 'OffsetConstraint':
       return offset_hint.build_offset_step(oc)
   → emits: Offset.From(["horn_TL", "horn_L"],
                        distance="hornOffset",
                        targets=["offset_horn_TL", "offset_horn_L"])
        │
        ▼
phase_parser._build_offset_step(args)
   → step dict:
     {'Type': 'Offset',
      'SourceID':     ['horn_TL', 'horn_L'],
      'DistanceExpr': 'hornOffset',
      'TargetIDs':    ['offset_horn_TL', 'offset_horn_L']}
        │
        ▼
FrameBuilder runtime → fb_engine/offsets.py:offset_step
   └─ addOffset2(parents, plane, distance_expr) — direction from sign of expr
```

#### TargetID naming rules (offset_hint.derive_target_names)

| Input | Output | Rationale |
|-------|--------|-----------|
| N sources, N children | `['offset_<name_i>' for i]` | 1:1 by index — the common case |
| 1 source, 1 child | `['offset_<source>']` | — |
| Mismatched counts | `['offset_<first>_01', '_02', …]` | Not clever on purpose — if you hit this, rethink the sketch |
| No named sources | `['offset_01', '_02', …]` | Indicates stale proxy or untagged parent chain |

Child-curve Fusion-generated labels are deliberately **not** consulted — they change between rebuilds and would produce unstable TargetIDs.

#### Omitted on purpose

- **Direction** — `addOffset2` reads direction from the sign of `DistanceExpr`. A flipped direction after geometry edits signals topology damage (merged segments or a broken loop) — that's a parent-repair problem, not a `Direction` field problem. User's hand-written templates don't set it either.
- **CornerIDs** — rectangle-corner naming is a downstream hand-edit concern the author handles after generation.

#### Ownership gate branch

OffsetConstraint is checked **before** the generic `'Constraint' in ent_type` branch, because `'OffsetConstraint'.__contains__('Constraint')` would otherwise route it through `target_props_for` — which returns `()` for OffsetConstraint and would reject the whole thing. The gate walks `parent_curves(oc)` directly; each parent must itself pass the gate (direct FB.ID or derived).

OCs themselves carry no FrameBuilder attributes — ownership flows purely from the parents. Matches the constraint-no-name principle (§1.4) via a slightly different mechanism (collection walk instead of per-slot walk).

#### Dedup

`_expand_offset_picks` uses `oc_identity_key(oc)` which prefers `entityToken` (Fusion's canonical identity) with an `id()` fallback. Picking the parent OC *and* one of its children collapses to a single entry regardless of selection order.

### 1.7 Selection strategy

| You select | You get in the generated block |
|-----------|---------------------------------|
| Geometry only | `Seeds.*` statements only |
| Constraint only | `Constraints.*` step only. Works iff target geometry has already been renamed (possibly in an earlier phase). |
| Geometry + constraint | Both, in one block. Typical "seed phase with its geometric relations" case. |

The constraint's target walk is **selection-independent** — it reads FrameBuilder.ID directly off the targets regardless of what's currently picked. So if the geometry is already tagged, selecting it again with the constraint only changes whether its seed statement appears in *this* block, not whether the constraint resolves correctly.

### 1.8 Dimension identity — prefix-scoped Name, raw Expression

Dimensions carry a quirk constraints don't: the step's `Name` field ends up written onto `dim.parameter.name` by the runtime (see `fb_engine/dimensions.py` — the rename is a side-effect of creating and linking the dim to its expression, and `delete_dimension_by_name` reads that exact name back). That means dim-entity names share a namespace with Fusion's user parameters. A dim named `widthIn` collides with an existing user parameter `widthIn`; Fusion either refuses the rename or silently auto-suffixes, and either way the dim's identity becomes unpredictable.

`dimension_hint.py` enforces the split convention:

| Field | Namespace | Rule |
|-------|-----------|------|
| `Name` (dim-entity identity) | user-parameter namespace — must stay clear | Raw tag distinct from every user param → keep as-is. Raw tag collides → prepend `dim_`. `dim_<raw>` also collides (pathological) → suffix `_x`. |
| `Expression` (value source) | reference *into* user-parameter-land | Pass through unchanged — reads the raw parameter name (`widthIn`, `hornOffset`, `radius`). No prefix, no decoration. |

Result:

```python
{'Name':       'dim_body_width',         # unique in parameter namespace
 'DimType':    'SketchLinearDimension',
 'Expression': 'widthIn',                # references existing user param
 'Targets':    ['point_A', 'point_B']}
```

`delete_dimension_by_name('dim_body_width')` finds that dim unambiguously because no other parameter shares the tag. The user's template can still reference `widthIn` in the Expression slot — the two namespaces never meet.

Every rewrite fires one detection-log line:
```
DIM NAME COLLISION: 'widthIn' matches an existing user parameter — renamed to 'dim_widthIn' to keep the dim's identity in its own namespace.
```
No warning on the happy path (raw tag already distinct) — detection.log stays signal, not noise.

The target walk is still owned by `relation_hints._constraint_targets` — `dimension_hint.build_dimension_hint` imports it lazily to avoid the `relation_hints ↔ dimension_hint` circular dependency that would otherwise land when `template_payload` is doing a full rebuild.

---

## 2. What changed this session

Two problem classes were solved: the rename handler taking Fusion down with a native access violation, and constraints never appearing in the generated phase block.

### 2.1 Crash-fix chain (rename no longer segfaults Fusion)

Symptoms at session start: pressing "Rename" on a selected CoincidentConstraint (or on a second pass over a mixed selection) took Fusion down with no Python traceback — a native AV.

| File | Change | Why |
|------|--------|-----|
| `rename_selection.py` → `_existing_fb_id` | Moved `hasattr(ent, 'attributes')` inside the `try/except` | Python 3's `hasattr` only swallows `AttributeError`. Fusion raises `"3 : object does not support attributes"` as a `RuntimeError` — leaked past `hasattr` and crashed the handler. |
| `ownership_gate.py` → `_has_framebuilder_attribute` | Same `hasattr`-inside-try fix | Same trap, different call site — surfaced during payload rebuilds triggered by rename. |
| `template_naming.py` → `get_parent_sketch_prefix` | Wrapped `getattr(ent, 'parentSketch', None)` in try/except | `getattr` with default only catches `AttributeError`; Fusion's proxy slot refusal escaped. |
| `template_naming.py` → `make_unique_label` | Only call `get_parent_sketch_prefix` when `base_label.startswith('Sketch')` | The result was thrown away for non-Sketch labels, but the call itself was a native-AV hazard on constraint subtypes. Eliminated the dead probe — constraints now bypass that path entirely. |
| `rename_selection.py` → `set_entity_fb_name` | Returns `True/False` based on whether a write actually landed | CoincidentConstraint rejects `.attributes` at the type level. Previously counted as "renamed" anyway → bogus `renamed=1` → `deferred_rebuild.schedule()` fired → post-rename rebuild re-probed the stale proxy → native AV. Now counts honestly. |
| `rename_selection.py` → `rename_selection` loop | Removed the `new_label != base_label` guard; always calls `set_entity_fb_name` for entities that pass `_existing_fb_id` | The guard silently skipped writes for first-of-its-kind labels (a single CoincidentConstraint, a first Sketch_Line). Caused "renamed=0" on the first rename press. |

Result: rename now either succeeds (for stampable entities) or logs `"stamp REJECTED by subtype — not counted"` and moves on. No crashes.

### 2.2 Constraint-emission chain (constraints now reach the phase block)

Symptoms: template maker generated code for geometry but never for constraints.

| File | Change | Why |
|------|--------|-----|
| `entity_helpers.py` → `get_fb_name` | Prefer `FrameBuilder.ID` over legacy `FrameBuilder.name` (with name fallback for old data) | `set_entity_fb_name` writes `ID` first, but `get_fb_name` was only reading `name`. Result: freshly-renamed entities looked nameless to the emitter → `_label_for_entity` returned `"Entity"` → ownership gate failed. |
| `template_payload.py` → `_label_for_entity` | Recognize `"Entity"`, `"None"`, `"Sketch*"`, `"Vertex of*"` as non-labels; fall through to `objectType.split('::')[-1]` | Old code trusted the sentinel `"Entity"` as a real label, wasting the stamp cycle and failing the dedup check. Now a CoincidentConstraint that can't carry an attribute gets the label `"CoincidentConstraint"` via its objectType — good enough since constraints don't need unique IDs. |
| `relation_hints.py` → `_hint_constraint` | Drop the constraint-name first arg. Emit `Constraints.<Type>(target1, target2)` instead of `Constraints.<Type>("name", target1, target2)`. | Matches reality: constraints can't be stamped, don't need IDs, runtime ignores the name. |
| `phase_parser.py` → `_build_constraint_step` | Remove dual-shape heuristic. Every arg is a target. | Old heuristic ("first arg quoted → name") silently consumed the first target (`"horn_TL"`) as a Name field, leaving only the second target in Targets. The "constraints missing targets" bug. |
| `test_mixed_entities_and_rename.py` → `test_constraint_on_lines_uses_quoted_names` | Assertion flipped: expect NO `'Name'` field on constraint rows; expect both targets in `'Targets'`. | Test was written against the old name-ful shape; updated to match the no-name reality. |

Result: `{'Type': 'PerpendicularConstraint', 'Targets': ["horn_TL", "brace_BR"]}` lands in the phase block. All 26 tests pass.

### 2.3 OffsetConstraint support (session addendum)

Symptoms: selecting offset-result curves produced untagged-entity warnings and no phase step. OffsetConstraint glyph picks fell through to the generic `'Constraint' in ent_type` branch which returned `()` targets and emitted a `/* targets */` placeholder.

| File | Change | Why |
|------|--------|-----|
| `offset_hint.py` (NEW) | Dedicated module with `parent_curves`, `child_curves`, `distance_expression`, `derive_target_names`, `find_owning_offset_constraint`, `is_offset_constraint`, `oc_identity_key`, `build_offset_step` | OffsetConstraint has collection-shaped targets + a scalar expression — doesn't fit the generic single-slot target walk. Dedicated module keeps the safe-walk pattern localized. All slot probes go through `_safe_getattr` to swallow Fusion's `RuntimeError` on subtype-refused slots. |
| `template_payload.py` → `_build_entity_hint` | Added `if ent_type == 'OffsetConstraint': return build_offset_step(ent)` **before** the generic `if 'Constraint' in ent_type` branch | OC's objectType contains "Constraint" — would otherwise route through `_hint_constraint` and emit `/* targets */`. |
| `template_payload_builder.py` → `_expand_offset_picks` (NEW), `build_payload_items` | Pre-pass resolves child-curve picks to their owning OC and dedups direct OC picks via `oc_identity_key` | User's UX is to click offset-result curves, not the OC glyph. Pre-pass collapses N child-curve picks to 1 OC entry. |
| `ownership_gate.py` → `is_framebuilder_owned` | Added `ent_type.endswith('OffsetConstraint')` branch **before** the generic constraint branch; walks `parent_curves(oc)` and requires every parent to pass the gate | OC never carries FB attributes itself. Ownership flows from parents. Must be checked before the generic branch because `'OffsetConstraint'.__contains__('Constraint')` would otherwise trigger the (empty) `target_props_for` walk. |
| `phase_parser.py` → `_build_offset_step`, dispatch `if head.startswith('Offset.')` | New parser route for the `Offset.From(...)` statement form | Converts the emitted statement into `{'Type': 'Offset', 'SourceID': [...], 'DistanceExpr': ..., 'TargetIDs': [...]}` — matching exactly what `fb_engine/offsets.py:offset_step` reads. |
| `test_offset_hint.py` (NEW) | 10 tests covering direct-OC pick, child-curve lookup, same-OC dedup, cross-OC expand, parent+child dedup, untagged-parent rejection, statement round-trip, naming rules, identity helpers, and sketch walk | Locks in the grammar and the dedup behavior. |
| `test_template_generator.py` | Flipped the stale `'seeds.append('` assertion to `"'Type': 'Line'"` | Pre-existing stale test — the code-preview format changed to phase-step dict literals earlier this session. |

Result: offset-result curves resolve cleanly to `Offset.From(...)` statements that parse into the right runtime shape. All 10 offset tests pass; all other suites still green.

### 2.4 Architectural decision recorded

**Constraints carry no FrameBuilder ID.** This is permanent, not a workaround. See §1.4 for reasoning. The code reflects this at three layers:

- Emitter drops the name (`_hint_constraint`).
- Parser refuses to interpret any arg as a name (`_build_constraint_step`).
- Gate uses target-derived ownership instead of self-ownership for constraints (`is_framebuilder_owned`).

All three must stay aligned — if one layer starts expecting a name again, the other two break.

### 2.5 Dimension name convention (session addendum)

Symptoms: an emitted dim named `widthIn` collided with the existing user parameter `widthIn`. Fusion either rejected the rename or silently auto-suffixed it, leaving the dim's `dim.parameter.name` unpredictable — which broke `delete_dimension_by_name` lookups downstream.

| File | Change | Why |
|------|--------|-----|
| `dimension_hint.py` (NEW) | Dedicated module with `derive_dim_identity`, `check_and_resolve_name`, `_current_user_param_names`, `_dim_expression`, `build_dimension_hint` | Enforces the prefix-scoped Name / raw Expression split from §1.8. `derive_dim_identity` is pure (no I/O) and drives the rewrite rule; `check_and_resolve_name` adds the user-param fetch and the detection-log warning on rewrite. `build_dimension_hint` delegates the target walk back to `relation_hints._constraint_targets` via lazy import to avoid a circular dependency. |
| `template_payload.py` → `_build_entity_hint` | Replaced `return _hint_dimension(...)` with `from dimension_hint import build_dimension_hint; return build_dimension_hint(...)` | Routes every dim emission through the naming convention. `_hint_dimension` is no longer the entry point — it's still imported at the module top for back-compat but nothing in the active path calls it. |
| `test_dimension_hint.py` (NEW) | 10 tests: three pure-function cases for `derive_dim_identity` (pass-through, prefix, double-collision suffix), three for `check_and_resolve_name` (rewrite logs, pass-through silent, `get_design_params` failure tolerated), four for `build_dimension_hint` (prefix on collision, pass-through, statement round-trip through `phase_parser._build_dimension_step`, tolerates missing parameter) | Locks in both the rule and the emitter shape. Round-trip test pins the generator-to-parser contract. |

Result: dim-entity names are guaranteed unique within user-parameter namespace. The rewrite path is audit-logged. All 10 dimension tests pass; all other suites still green.

---

## 3. Known follow-ups (not addressed this session)

- **Flickering ownership gate readout.** The palette sometimes shows "1 owned, 0 unowned" and "0 owned, 1 unowned" on back-to-back rebuilds for the same selection. Likely a timing race between the deferred-rebuild scheduler and a mid-rebuild selection-change event; gate logic itself is correct.

---

## 4. Quick reference

**To add a new constraint subtype to the dispatch:**
1. Add `"<ConstraintName>": ('propSlot1', 'propSlot2')` to `CONSTRAINT_TARGET_PROPS_BY_TYPE` in `relation_hints.py`.
2. Verify the slot names against Fusion's API docs — wrong slot names cause silent ownership failures, not crashes (thanks to the try/except guard in `_constraint_targets`).
3. Run the test suite. No other changes needed — ownership gate and emitter pick it up automatically.

**To debug a constraint that silently disappears:**
1. Check `template-maker-detection.log` for `"is_framebuilder_owned"` entries around the constraint.
2. Verify every target geometry has a FrameBuilder.ID (select and inspect via Fusion Inspector).
3. If the constraint's objectType isn't in `CONSTRAINT_TARGET_PROPS_BY_TYPE`, it falls through to the `/* targets */` placeholder — add it.
# STALE-PARAMS-DESIGN — R3 design, R4 IMPLEMENTED (Bspline group)

**Status: R4 implemented and merged (this doc's §1-2 below is the R3 design as originally written; read it
alongside the rulings here, which override it where they differ — nothing in §1-2 was edited in place, so
history stays legible).** R3 was a plan; the advisor + Fred amended it twice during R4, and R4 built exactly
the amended version. Plan of record: `HANDOFF-REG-ADDIN.md` §3 item 5, `FB-APP-DESIGN.md` §4 (read from
`origin/fb-app`, not checked out), and `NEXT-SESSION-reg-addin.md`'s own R4 rulings (the living copy — this
section mirrors it for anyone reading this file in isolation).

## R4 rulings (advisor + Fred, 2026-09-26) — override §2 below where they differ

1. **DELETE ON, not log-only.** The design's own §2f Q1 recommended a log-only rollout first; Fred overruled
   it live ("just apply it") — candidates ARE deleted (`deleteMe()`), every decision still logged.
2. **ONE registry, additive only in `frame-builder/`:** `ParameterSchema.LATTICE_OWNED_PARAMS` +
   `is_lattice_owned()` sit right beside `BOARD_OWNED_PARAMS`/`is_board_owned()`
   (`frame-builder/fb_engine/parameter_schema.py`) — that file is the ONLY change allowed in `frame-builder/`.
   The cleanup logic (`b-spline-gen/param_ownership.py`) reads this registry; it holds no name list of its own.
   This also answers §2a's flagged question: lattice params share the board's `Bspline` tag group (one Send
   surface, one tag) — confirmed, not just proposed.
3. **AMENDED, reversing §2b's "stamp, never name" rule: registered NAME is the whole ownership test.**
   Fred's second amendment ("take over existing params") replaces §2b/§2c's "a param matching a known name but
   lacking the stamp = Fred's, never touched" with the opposite: **a registered name is ours, whether or not an
   older build stamped it.** The stamp is still written (every touch — see item 5), but the CLEANUP decision no
   longer gates on it; `param_ownership.compute_stale_params` reads the registry directly. The stamp is now an
   audit breadcrumb ("adopted": a stale registered param found unstamped is logged, then still deleted like any
   other stale candidate), not an ownership gate. §2b/§2c below describe the ORIGINAL (name+stamp) rule for
   the historical record; it was never shipped.
4. **Reference guard = `Parameter.dependentParameters` only** — §2c(a)'s hand-rolled expression regex-scan was
   dropped per the ruling; only §2c(b)'s live-API check shipped, still flagged "verify live" (no Fusion access
   this loop). `param_ownership.py`'s own guard additionally treats "no `dependentParameters` on this object at
   all" as kept-not-deleted (can't prove unreferenced → never delete) — a defensive case §2c didn't spell out.
5. **Stamp on every touch (create AND update)**, matching the board's own `_ensure_bspline_param_tag` exactly —
   reversing this doc's originally-committed §2f Q2 recommendation, which Fred's second amendment overturned
   (item 3 above is the reason: name alone decides ownership, so gating the stamp write itself no longer matters
   for safety the way it did under the original rule).
6. **Scope: `Bspline` group only.** Frame params (`FrameBuilder.owner`) are seat C's; `parametric_engine.py` /
   `solid_coordinator.py` were not touched.
7. **`b-spline-gen.py` footprint: one call**, in `_handle_generate`'s Finalise block (non-preview path, after
   `_import_all_svg_layers` returns — so `des.userParameters` reflects this Send's own just-synced params),
   guarded in its own try/except. `stale_params` merged into the existing `last_send.json` via a new
   `_merge_last_send_key` helper (the payload snapshot dump, `_dump_last_send`, runs earlier and is unchanged).
8. **No undo-transaction claim** — §2d's "one Send = one undo step" reasoning was dropped per the ruling
   (a palette-driven Send may not be one Fusion command transaction); moot while every delete happens inside
   the same `_handle_generate` call regardless.

**What shipped, file:line:**
- `frame-builder/fb_engine/parameter_schema.py` — `_LATTICE_OWNED_PARAMS` (7 names) + `LATTICE_OWNED_PARAMS` +
  `is_lattice_owned()`, beside the board equivalents.
- `b-spline-gen/sketch_manifest_builder.py` — `_stamp_bspline_owner(ctx, param, name)` (idempotent, touch-based),
  called from both the create and update branches of `_sync_manifest_parameters`.
- `b-spline-gen/param_ownership.py` (new) — `compute_stale_params(user_params, payload_names, logger=None)`,
  pure/no-`adsk`, returns `{deleted, kept_referenced, adopted, failed}` (every key always present).
- `b-spline-gen/b-spline-gen.py` — one `compute_stale_params(...)` call + `_merge_last_send_key('stale_params',
  stale)`, in `_handle_generate`'s Finalise block; `payload_names` = `set(params.keys())` (covers the board
  names, whatever the payload actually carried) unioned with every `manifest['parameters'][*].name` across
  `stamp_data['layers']` (the same source `_import_all_svg_layers` reads — no new plumbing needed to collect
  the lattice names this Send touched).
- Tests: `frame-builder/fb_engine/test_lattice_owned_params.py` (6), additions to
  `b-spline-gen/test_sketch_manifest_builder.py` (3, touch-stamp + adoption), `b-spline-gen/test_param_ownership.py`
  (13, the decision matrix). All mutation-checked (see WORK-LOG-reg-addin.md's R4 entry).

---

## 1. Survey — every user parameter the add-in creates today (facts, file:line)

Three independent writers exist. None of them delete anything today; the only "cleanup" candidate that
exists is `FB-APP-DESIGN.md`'s own sketch (quoted in §2a), which is a plan, not code.

### 1a. Board params — `b-spline-gen.py` ("Send B-spline")
- `_sync_user_parameters(design, params)` — `b-spline-gen.py:602-657`. Fixed `param_map = {'widthIn': ('widthIn',
  'in'), 'heightIn': ('heightIn', 'in')}` (`:617-620`) — **only these two names, always created/updated, never
  conditional.**
- Create-or-update: `user_params.itemByName(f_name)`; if missing, `user_params.add(f_name, ValueInput
  .createByString(str(val)), unit, 'Design Master Parameter')` (`:629-645`). If present, overwrites
  `.expression` **unless** the existing expression is non-numeric (a formula like `'d3 - 1'`) AND resolves to
  the same value the palette already has — then the formula is preserved (`_expression_is_numeric`,
  `:578-599`, and the skip-write branch `:630-639`). This is the one place in the codebase that already treats
  "the user wrote a formula here" as a signal to leave a parameter alone; it is Fusion-expression-shaped, not
  the JS-side FORMULA-FIELDS values (those are pre-evaluated to a number before Send ever sees them).
- **Ownership stamp: EXISTS.** `_ensure_bspline_param_tag(param, f_name)` (`:660-676`), called on every create
  **and** every update (`:655`) — idempotently adds a `UserParameter.attributes` entry `('Bspline', 'owner',
  '1')`. This is the only param family with a stamp today. `FB-APP-DESIGN.md` (origin/fb-app) calls this tag
  `Bspline.owner=1` and marks it "(exists)" — confirmed, matches.
- Called from `_handle_generate` (`b-spline-gen.py:1039-1042`) only `if not is_preview:` — a live preview never
  touches user params.

### 1b. Constrained-sketch / lattice params — `sketch_manifest_builder.py` ("Send B-spline", Shape Lattice /
constrained-sketch mode, SE15)
- `_sync_manifest_parameters(ctx, parameters)` — `sketch_manifest_builder.py:704-752`. Loops an **arbitrary
  list** the manifest declares (`manifest.get("parameters")`, called at `:916` from `build_constrained_sketch`).
  Names are NOT a fixed map — they come from the JS side's own declared pushes (fixed literal names in
  practice, not per-layer-prefixed): `stroke_width`, `rail_width`, `tie_width`, `node_diameter`, `half_width`,
  `contour_width`, `contour_height` (`html/editor/editor-sketch-manifest.js:506,512,516,526,759,772,787,795`).
  A future name (e.g. NODE-D's `node_diameter` replacing `node_radius`, ROADMAP.md "Queued — NODE-D") is
  entirely plausible, so **this family cannot be enumerated by a fixed name list** the way board params can.
- Create-or-update: `user_params.itemByName(name)`; update `.expression = str(value)` if present, else
  `user_params.add(name, ValueInput.createByString/createByReal(...), unit, "SE15 constrained sketch
  parameter")` (`:726-748`). The `"SE15 constrained sketch parameter"` string is a **comment argument to
  `.add()`**, i.e. Fusion's parameter description field — it is NOT an attribute and NOT machine-checkable at
  delete time (Fusion doesn't index by description).
- **Ownership stamp: MISSING.** No `attributes.add(...)` call anywhere in this function. **This is the gap
  the design below has to close** — these params are written by the same Send surface as 1a (so they should
  carry the SAME `Bspline.owner=1` tag), but today nothing stamps them.
- No expression-preservation rule here (unlike 1a) — every call overwrites `.expression` unconditionally.

### 1c. Frame params — `frame-builder/fb_engine/` (standalone Frame Builder palette; `FB-APP-DESIGN.md` §4
"Send frame", not yet built)
- **Declared names** (`ParameterSchema` + `template_data.py`, cross-checked against the generated
  `frame-defs.json` — `python -c` dump this turn): per template, `SKETCH_1_PARAMETERS` + `SKETCH_2_PARAMETERS`
  + `SKETCH_3_PARAMETERS` from e.g. `frame-builder/sketches/template_1/template_data.py:30-70`:
  `widthIn`, `heightIn` (`ReadOnly`, see below), `boundingboxoffset`, `ck_arc_shoulder_weld`,
  `ck_arc_hip_weld`, `ck_skel_shoulder_equal`, `ck_skel_waist_equal`, `frame_thickness`. Confirmed identical
  shape in `template_2` (minus the `ck_*` toggles).
- `widthIn`/`heightIn` appear in the FRAME templates too (`ReadOnly: True`) but are **never written** by the
  frame side — `ParameterSchema.is_board_owned(name)` (`parameter_schema.py:37,66-69`, list
  `_BOARD_OWNED_PARAMS = ('widthIn', 'heightIn')`) is checked and **skipped** in
  `ParametricSketchBuilder._sync_user_parameters` (`parametric_engine.py:257-315`, the `continue` at `:284`) —
  "FB-ORDER (Fred: 'only Send to Fusion can create' widthIn/heightIn)" comment at `:271-282`. **This declared
  list is the ONE existing piece of machine-checked cross-writer ownership in the repo today** — worth
  building the new design as a peer of it, not a replacement.
- `frame_thickness`, `boundingboxoffset`, `ck_*` (and any other key present in `ui_data`, since the loop is
  generic over `ui_data.items()` minus the board-owned skip) are created/updated by
  `ParametricSketchBuilder._sync_user_parameters` (`parametric_engine.py:257-315`): create via
  `params.add(name, ValueInput.createByReal(0.0), ParameterSchema.default_unit(name), "Hybrid UI Pre-Sync")`
  (`:295`) if missing, then `.expression = str(resolver.wrap_expression_if_factor(name, val) or val)` (`:304
  -310`) always (no preservation rule — every sync overwrites).
- `frame_height_offset` — **declared nowhere** in `template_data.py` (confirmed: absent from all three
  `SKETCH_N_PARAMETERS` lists and from the generated `frame-defs.json`'s per-template `Parameters` — checked
  by dumping the JSON this turn). It is created ad hoc by `SolidCoordinator._sync_offset_param`
  (`fb_engine/solid_coordinator.py:72-99`) from the Solid Builder palette's "Start Offset" field
  (`fb_engine/frame_definition.py:50-54` declares the **name string** `FRAME_BOTTOM_PARAM =
  "frame_height_offset"` as a constant, but nothing in the sketch declarations lists it as a `Parameter`
  dict — it's a name constant, not a schema entry). `FB-APP-DESIGN.md` §1.2's own param table calls this out
  identically ("nowhere (created ad hoc)" / "undeclared") — confirmed still true, unchanged since that survey.
- **Ownership stamp: MISSING**, for all of 1c (`frame_thickness`, `boundingboxoffset`, `ck_*`,
  `frame_height_offset`). No `attributes.add` call in `parametric_engine.py` or `solid_coordinator.py`.
  `FB-APP-DESIGN.md` §4 already plans this exact tag as **"NEW"**: `FrameBuilder.owner=1` — my design adopts
  that name rather than inventing a second one (§2a).

### 1d. Explicitly NOT a param — per-piece width/colour overrides (UI5, `NEXT-SESSION.md`, `NEXT-SESSION-lane-b
.md` "OVR-FUSION"/UI3 AMEND 3): "override width gets NO Fusion param" (Fred's ruling, seat B's T75 item 3 reads
the override back from sketch-entity **attributes** instead). Nothing to clean up here — confirmed by reading
the ruling, not by finding delete-worthy code (there is none, by design).

### 1e. What marks a param as "ours" today, summarized
| Family | Names | Tag today | Writer |
|---|---|---|---|
| Board (1a) | `widthIn`, `heightIn` (fixed, always both) | `Bspline.owner=1` — **exists** | `b-spline-gen.py` only |
| Lattice (1b) | arbitrary, JS-declared (currently 7 literals) | **none** | `sketch_manifest_builder.py`, same Send |
| Frame (1c) | fixed per-template + `frame_height_offset` | **none** (planned: `FrameBuilder.owner=1`) | `parametric_engine.py` / `solid_coordinator.py` |
| Override (1d) | n/a | n/a — not a param | n/a |

---

## 2. Design

### 2a. ONE declared ownership list, cross-checked against `FB-APP-DESIGN.md`
> **Confirmed as shipped (R4 rulings 2-3):** lattice params DO share the board's `Bspline` tag/registry —
> the flagged question below is answered, not just proposed.


`FB-APP-DESIGN.md` §4 ("Parameter ownership, one declared registry", read from `origin/fb-app`, not checked
out) already sketches:
```
PARAM_OWNERS (generated into frame-defs.json from ParameterSchema + template params)
  board: widthIn, heightIn                      writer: Send only      tag Bspline.owner=1   (exists)
  frame: frame_thickness, boundingboxoffset,    writer: frame_engine   tag FrameBuilder.owner=1 (new)
         frame_height_offset, ck_*
```
This survey's names match that table exactly for board and frame **except for one gap FB-APP-DESIGN.md
doesn't mention**: it has no entry for family 1b (lattice/constrained-sketch params) — `stroke_width`,
`rail_width`, `tie_width`, `node_diameter`, `half_width`, `contour_width`, `contour_height`. Those are written
by the SAME "Send B-spline" surface as board params (both live in `b-spline-gen.py`'s call graph), so this
design proposes they carry the **same** `Bspline.owner=1` tag as board params, rather than inventing a third
tag — one Send-surface, one tag. **Flag for the home advisor:** please confirm this against fb-app's plan, or
say if lattice params should get their own tag/group instead (e.g. if a future "Send frame" vs "Send B-spline"
split ever wants to distinguish "board" from "lattice" cleanups independently).

Declared list lives in ONE new module, mirroring `ParameterSchema`'s existing "one source of truth" pattern:

```python
# fb_engine/param_ownership.py (new) — imported by both b-spline-gen (board+lattice) and
# frame-builder (frame), so there is exactly one place that lists every family.
class ParamOwnership:
    BOARD_OWNER_GROUP = "Bspline"     # existing group name, unchanged (b-spline-gen.py:674)
    FRAME_OWNER_GROUP = "FrameBuilder"  # new, per FB-APP-DESIGN.md §4

    # Fixed names this add-in ever creates, by group. NOT exhaustive for the lattice family
    # (see is_owned_by_stamp below) — this list is for the SURVEY / a human-readable audit,
    # never for the delete decision itself (stamps decide that, not names — see 2b).
    BOARD_FIXED = ("widthIn", "heightIn")
    LATTICE_KNOWN = ("stroke_width", "rail_width", "tie_width", "node_diameter",
                     "half_width", "contour_width", "contour_height")
    FRAME_FIXED_PER_TEMPLATE = ...  # derived from frame-defs.json at runtime, not hardcoded here
    FRAME_ADHOC = ("frame_height_offset",)
```

### 2b. Proving "created by us" at delete time: STAMP, not name
> **SUPERSEDED (R4 ruling 3, Fred's "take over existing params" amendment):** the shipped rule is the
> opposite — registered NAME alone is ownership, stamped or not. Kept below for the historical record only.


**Proposal (as the checklist asked): an attribute stamp written at creation, checked at delete time — never a
name match.** This is the only approach that survives family 1b's arbitrary/evolving names (§1b) and protects
against a name COLLISION with something Fred typed himself (e.g. if Fred's own design happens to already have
a parameter literally named `frame_thickness` before ever running this add-in — a real risk `FB-APP-DESIGN.md`
§1.2 already flags for `boundingboxoffset`'s two-declaration history).

- Stamp = `UserParameter.attributes.add(<group>, "owner", "1")`, `<group>` ∈ `{Bspline, FrameBuilder}` per
  §2a. Written at EVERY create (already true for board, §1a) and — this is the change — at every create for
  1b and 1c too (currently missing, §1b/§1c).
- **A parameter that matches a known/declared name but lacks the stamp is Fred's and is NEVER deleted or
  overwritten-as-if-ours by the delete pass** — it can still be *read* (e.g. board-size sync already reads
  `widthIn`/`BSG_widthIn` permissively, `b-spline-gen.py:568-569`), but delete only ever acts on stamped
  parameters. This directly implements the checklist's "a param that matches a name but lacks the stamp =
  Fred's, NEVER deleted."
- Corollary for family 1b: since names are open-ended, the delete pass's candidate set is **"every stamped
  `Bspline`-group param that is NOT in this Send's current payload names,"** not "every known lattice name
  minus the payload." A future JS-side rename (e.g. `node_radius` → `node_diameter`, ROADMAP "NODE-D") then
  self-heals: the old stamped `node_radius` shows up as stale next Send and gets removed under the ordinary
  rule, with no code change needed here.
- One more real risk this catches: **a stamp surviving a name rename.** If the JS side renames a param, the
  OLD name is still stamped `Bspline.owner=1` and will be correctly proposed for deletion (per the reference
  guard, 2c) rather than silently orphaned forever, which is the entire point of this feature per the
  dispatch's problem statement.

### 2c. The delete rule
> **PARTIALLY SUPERSEDED (R4 rulings 3-4):** step 1 ("owned + stamped") is gone — replaced by "registered
> name" alone; step 3a (the hand-rolled expression regex-scan) was dropped, `dependentParameters` (3b) is
> the ONLY reference guard shipped. Step 3c (skip + log, never retry) shipped as designed.


A stamped-owned parameter `p` is deleted when **all** of:
1. **Owned + stamped** — `p.attributes.itemByName(<its group>, "owner")` exists and is truthy (§2b).
2. **Not in this Send's payload** — `p.name` is not one of the names this specific Send/build is about to
   create-or-update (board: `param_map` keys; lattice: `manifest["parameters"][*].name`; frame:
   `ui_data.keys()` minus board-owned).
3. **Not referenced elsewhere** — the reference guard, below. Anything referenced is **kept**, and the reason
   is logged (never silently ignored) — this is the safety-critical rule, since Fusion doesn't offer a
   built-in "what depends on this parameter" query beyond expression text scanning:
   - **a. Other user parameters:** scan every OTHER user parameter's `.expression` string for `p.name` as a
     whole word (`re.search(rf'\b{re.escape(p.name)}\b', other.expression)`) — a param can reference another
     by name in its own expression (Fusion's own formula language), and Fusion will refuse the delete anyway
     if any *feature* dimension references it (see below), but a parameter-to-parameter reference is silent —
     Fusion happily deletes a param that only another param's expression uses, breaking that other param's
     value into whatever last-resolved-cm the expression parser falls back to. This MUST be checked in
     Python, not assumed.
   - **b. Feature/sketch dimensions:** Fusion's own `Parameter.dependentParameters` (an
     `ObjectCollection` — real Fusion 360 API on `UserParameter`, exposed via the base `Parameter` class) IS
     the built-in "what feature dimensions reference this" query and should be checked FIRST — if non-empty,
     keep + log which features, no need to hand-scan feature expressions. (Confirmed as a real API surface to
     verify live in R4/whoever builds it — not fabricated from memory; flagged here as "verify in a live
     Fusion session" rather than asserted as tested, since this design turn has no Fusion access.)
   - **c. A stamped param that fails to delete** (Fusion raises, e.g. because 3a/3b missed something) is
     logged as a WARNING and left in place — never retried destructively, never silently swallowed. Matches
     the codebase's existing "skip + report, never abort the rest" discipline (`sketch_manifest_builder.py`
     doc comments at `:785-788`, `projections` handling).

### 2d. Ordering vs. the rebuild, undo, dry-run/log
> **PARTIALLY SUPERSEDED (R4 ruling 8):** the undo-transaction paragraph was dropped per the ruling.
> Ordering (delete after geometry) and the `last_send.json` shape shipped close to as designed here — see
> the R4 rulings' "What shipped" list for the exact call site and merge mechanism.


- **Ordering: delete AFTER the new sketches/params exist**, not before. Reason: the reference guard (2c) must
  see the NEW payload's parameters already created/updated (so a param that's merely being renamed this Send
  — old name stale, new name fresh — doesn't trip a false "nothing references the old one" before the new
  one exists to take over any expression that pointed at the old value). Concretely: run the delete pass as
  the LAST step of `_handle_generate` (board+lattice) / `SolidCoordinator.run` (frame), after
  `_sync_user_parameters`/`_sync_manifest_parameters`/`ParametricSketchBuilder._sync_user_parameters` and
  after the new geometry builds — mirroring where `_dump_last_send` already sits relative to the sync calls
  today (`b-spline-gen.py:1040-1050`, sync then dump; delete slots in right after the geometry step
  completes, before/alongside that same dump).
- **Undo:** no new transaction-grouping machinery. Every existing destructive call in this codebase
  (`occ.deleteMe()`, `group.deleteMe()` — `b-spline-gen.py:228,245,254`) already runs inside the ONE Fusion
  command-execute that a single Send already is, so it is already one Fusion undo step end-to-end; adding
  `param.deleteMe()` calls to the SAME execute keeps that guarantee for free. Ctrl+Z after a Send undoes the
  whole Send, params included, same as it already undoes the occurrence replacement. No special-casing needed
  — flagged here so nobody re-derives it and adds a redundant transaction wrapper in R4.
- **Dry-run / log output:** `last_send.json` (`b-spline-gen.py:152-163`, written by `_dump_last_send`) gets a
  new top-level key, always present (empty list when nothing was stale) so Fred/the advisor can always find
  the same shape:
  ```json
  "stale_params": {
    "deleted": ["old_node_radius"],
    "kept_referenced": [{"name": "frame_thickness", "reason": "referenced by dependentParameters: Frame_1:Extrude3"}],
    "kept_unstamped": ["frame_thickness"],
    "failed": [{"name": "x", "error": "..."}]
  }
  ```
  `kept_unstamped` only ever appears if a name COLLIDES with a known name but isn't ours (2b) — an explicit
  signal, not silence, for exactly the case the checklist worried about. A `--dry-run`-equivalent (compute the
  candidate list, log it, delete nothing) is worth a hidden debug flag for Fred to sanity-check before trusting
  the real delete on his live designs the first few times — proposed as an open question (§2f, Q1).

### 2e. Tests (for R4 to write; none exist yet — this turn is docs only)
- **pytest shim** (`bspline-frame-builder/b-spline-gen/` and `frame-builder/`, matching each family's existing
  test file):
  1. Declared list: `ParamOwnership` groups match `FB-APP-DESIGN.md`'s registry names (a text-fixture test
     reading the committed doc, or a hardcoded expected-set test the two must be kept in sync manually with a
     comment cross-reference, since one is Python and one is Markdown).
  2. Stamp check: creating a param via each of the three writers (mocked `adsk` stub, matching this repo's
     existing stub pattern) results in the correct group tag; updating an EXISTING unstamped param (simulating
     "Fred's own pre-existing param with a colliding name") does **not** retroactively stamp it as owned merely
     by being touched for value-sync — only a genuine create writes the stamp, EXCEPT board params, which
     already have the "stamp on every touch" precedent (`_ensure_bspline_param_tag`, called on update too,
     `b-spline-gen.py:655`) that predates this design — cross-check this is intentional (Q2, §2f) rather than
     silently pick one behavior for the new groups.
  3. Reference guard: a fake param graph where param A's expression contains param B's name → B is kept +
     logged, never deleted, even when B is otherwise a stale, stamped, out-of-payload candidate.
  4. Dry-run: candidate list computed correctly with `deleted: []` semantics (no `deleteMe()` call recorded on
     the mock) — cheap regression net for the eventual live flag.
- **Live-check script for Fred** (`HANDOFF-REG-ADDIN.md` §3 item 1 already lists a related live check for T75
  /T76 — this slots in next to it): build a design with one Send, add a manual parameter that happens to share
  a name pattern (e.g. type `frame_thickness` by hand before ever running Frame Builder), Send again, confirm
  `last_send.json`'s `stale_params.kept_unstamped` names it and it survives in the Parameters table.

### 2f. Open questions for Fred (each with a recommended default)

1. **Dry-run first?** Recommended: YES for the first shipped version — a hidden log-only mode (or simply:
   ship R4 logging `stale_params` fully for a few of Fred's own Sends before the actual `deleteMe()` calls are
   un-commented), since this is irreversible on his real designs and there is no live-Fusion test harness in
   this dev loop today (NO FUSION is the standing rule for reg-addin turns) — the safest rollout is "prove the
   candidate list looks right on his own documents first."
2. **Touch-stamps vs. create-only-stamps for the NEW groups (Frame, Lattice)?** Recommended: match the
   existing board precedent exactly (stamp on every touch, `_ensure_bspline_param_tag` already does this) for
   consistency across all three families, rather than special-casing the two new ones — one rule, one mental
   model, and it only ever matters for the edge case in 2e.2 (a pre-existing same-named Fred param that this
   add-in later "updates" — but 2c's delete rule never fires on an unstamped param regardless, so touch-
   stamping an already-Fred-owned-by-collision param would be the one behavior change worth Fred's explicit
   sign-off, since it reclassifies a param he typed as "ours" the next time a build happens to touch it).
3. **Should lattice params (1b) share the board tag or get their own?** Recommended default: share
   `Bspline.owner=1` (§2a) — flagged to the home advisor already; needs Fred/fb-app sign-off since it touches
   the plan of record in `FB-APP-DESIGN.md`.
4. **Cross-Send scope: does "Send frame" ever delete "Send B-spline"'s stale params, or vice versa?**
   Recommended: NO — each Send's delete pass only ever considers params stamped with **its own** group (2a's
   registry already enforces this: `FB-APP-DESIGN.md`'s own line "Frame params carry the frame tag, so a board
   cleanup can never touch them" — this design adopts that as a hard rule, not just a recommendation).

---

## 3. ROADMAP pointer

See `ROADMAP.md`, new line added under the existing Queued-entries list this turn (this repo's existing
`## Queued — NAME: … (Fred date)` entries were not rewritten): points here and at `HANDOFF-REG-ADDIN.md` §3
item 5 for the checklist this design answers.

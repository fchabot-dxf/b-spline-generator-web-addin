# WORK-LOG — fb-app (seat C)

Append-only log for the `fb-app` channel. The advisor owns NEXT-SESSION-fb-app.md / ROADMAP.md.
The worker appends here. Kept separate from main's WORK-LOG.md so the two branches never conflict
on one file (same convention as WORK-LOG-lane-b.md).

## Turn 0 — F1: FB-APP design doc — DONE — NO FUSION, NO CODE

**Seat.** Session 9f, epoch 1. It took seat C only after the advisor confirmed. Before that it
checked that 7f (named earlier by mistake) had made no edits and armed no waiter. It started in
main's tree first, found turn 288 already claimed by the live seat-A worker (uncommitted edits
there), and stood down without touching anything.

**Output.** `FB-APP-DESIGN.md` at the worktree root covers all five checklist items. Only
`FB-APP-DESIGN.md` and this log were written.

**How the inventory was grounded (measured, not read off comments):**
- **The templates serialize.** `get_template_logic()` for T1 and T2 was run in plain Python, and
  `json.dumps` succeeded: 15,884 and 11,455 bytes. The block `Type` vocabulary was enumerated from
  that output. This is the fact the whole §2 contract rests on: the export serializes the real source
  and does not re-encode it. `PhaseFile` was measured as a bare filename, so it is deterministic.
- **Dead params.** `Skel_Frame_Taper` and `Skel_Slot_Tolerance` appear only in `fb_value_resolver`'s
  base requirements (repo-wide grep), and the extrude hard-codes `"0 deg"`.
- **Line numbers.** Every `file:line` cite in the doc was re-grepped after writing, and five stale
  line numbers were corrected before commit.
- **Two helper reports, spot-checked.** A read-only Explore agent covered the app side and another
  covered the Send path. I checked the claims the design depends on:
  - `target_cname = "Clean"` (b-spline-gen.py:419) vs `CORE_SUBCOMP_HINT = "clean solid"`
    (document_discovery.py:46)
  - the `Bspline.owner` stamp (:661-674)
  - `isExported` as the single export gate (layers.js:140)
  - three.js r128 full build (palette.html:15), which includes `ExtrudeGeometry`

**Design decisions and why:**
- **The JSON is derived; the phase files stay the one source.** fb_engine keeps reading the Python. A
  byte-compare freshness test gates the checked-in JSON. The app is static on Pages, so the JSON has
  to be a file.
- **The app preview keeps its own closed-form silhouette solver** (`generateSilhouette`), plus parity
  goldens recorded once from Fusion. Evaluating the seed expressions is not an option: the seeds are
  deliberately 0.001 off-target and radius-deleted, so they are not the solved shape. A JS constraint
  solver would be a second implementation.
- **New declarations instead of inference:** `FRAME_REGIONS` / `FRAME_FEATURES` (replacing
  bounding-box profile classification), a layer `role` registry (instead of three new booleans),
  `core.top` as a declared target face (instead of a hand pick), an `AestheticCore` attribute stamped
  by Send (instead of the now-dead name hint), and a `PARAM_OWNERS` registry with a new
  `FrameBuilder.owner` tag.

**Marked UNVERIFIED in the doc** (needs Fusion):
- whether the frame bars lie inside the silhouette (inferred from miter IDs and VOID = centred)
- the bar-height mapping `carveZ` ↔ `frame_height_offset`
- whether the solved T1 geometry keeps the seeds' L/R shoulder asymmetry
- re-Send behaviour against a `to_face` that points at the old, deleted body

**The top risk** is that last one, together with `_create_incremental_component` adding a new
`Frame_N` on every Send. Stage S7 and open question 1 for Fred cover it.

**Map / traps.** ARCHITECTURE.md is not contradicted by anything found this turn, so it was not
edited. This turn only writes one doc, and a map edit on this branch would collide with main. A
candidate trap for the advisor to add on main: discovery's `"clean solid"` rung
(document_discovery.py:46) can no longer match, because Send names the component `"Clean"`
(b-spline-gen.py:419). Check it with `grep -n 'clean solid\|target_cname' …`.

**Processes.** None spawned beyond two read-only Explore agents, both finished. Capacity is fine; this
was a read-and-write turn with plenty of room left.

## Turn 2 — F2: FB-APP's UNVERIFIED items measured live + S0 clean-up — DONE — FUSION (scratch doc only)

**Fusion hygiene: how it was kept.**
- **No module or path swapping.** Before touching anything I diffed the installed add-in's
  `fb_engine/` and `sketches/` against this worktree with `diff -rq --strip-trailing-cr`: **identical**,
  CRLF only. So I called the already-loaded `frame_engine_core` / `fb_engine.*` directly, with **zero
  sys.path or sys.modules changes**, and afterwards confirmed no worktree path or module was present.
- **Fred's document was only read.** The only open doc (unsaved "Untitled", B-Spline Set + inlay) was
  used read-only: face normals, and a `TemporaryBRepManager.copy` of its Clean panel so the
  measurements use a real Send body.
- **Scratch document.** All building happened in a new scratch doc. It was closed via the one handle
  I created (`close(False)`, never saved), and my temporary `builtins` attrs were deleted.
- **Fred's document afterwards:** still 1 occurrence and the same 6 timeline items as before.

**Measured** (T1, 7×11 in board, `frame_thickness` 0.75):
- **item 1, face.** All 6 panel faces are NURBS, none planar.
  - Extruding to the underside (n.z = −0.99), the bars stop at the panel: its volume is 187.5 cm³
    after the trim.
  - Extruding to the top face (n.z = +0.99), each long bar is +21 cm³ bigger (211.7 vs 190.3), and
    that extra runs through the panel's edge.
  - Fred's "bottom face" is confirmed. The declared name is now `core.underside`. The resolver picks
    by normal, not "planar face".
- **item 2, re-Send.**
  - Deleting the body (as `_remove_last_import` does) puts the 4 BAR extrudes in warning ("Face 1
    missing … cached geometry"), `TRIM_CUT` vanishes, and nothing rebinds.
  - Deleting `Frame_1` and rebuilding gives `Frame_1` again, all features healthy, and bar volumes
    identical to the first build (190.28 / 92.40 / 81.14 / 189.69).
  - Per AMEND 1, S7 = delete the frame by attribute, then rebuild.
- **item 3, bar height.** Bar bottoms sit at exactly z = −2.54 cm (= `frame_height_offset` −1 in),
  and the tops follow the sculpted underside (0.99–1.65 cm). Per AMEND 3d it is a Z position; name
  and value are kept. The panel's lowest point is −0.113 cm, not exactly 0.
- **item 4, FB-ORDER.** It moved `Frame_1` + its 3 sketches before `Plane for L1` as a unit. **But**
  the solid build's extrudes + `TRIM_CUT` land AFTER the inlay, because FB-ORDER runs only at the end
  of the sketch build. That is added to S6.
- **Bonus 1.** `find_aesthetic_core_body()` returns `None` on Send's real structure. The dead
  `"clean solid"` rung is confirmed live, so full synthesis makes no joints.
- **Bonus 2.** `FrameBuilder()` without `external_logger` crashes (`frame_engine.py:124`: calls
  `.DebugLogger` on an instance). Not fixed (out of scope); noted for S5.
- **Screenshots:** `~/.bspline-status/shots/seatC/1644_F2_bottomface-bars.png`,
  `1646_F2_resend-rebuild-timeline.png`.

**S0 (item 5):**
- **Removed** `FBValueResolver.get_base_frame_requirements` and its loop in
  `_create_skeletal_parameters`, and the `'Taper'`→`'deg'` unit rule.
- **Sweep, every link accounted for:**
  - Callers of `get_base_frame_requirements`: the only one is removed (repo-wide `grep -a`).
  - The `'Taper'` unit rule's only beneficiary was `Skel_Frame_Taper`.
  - Params persisted in existing Fusion docs are **kept, with reason**: no cleanup exists, and user
    documents are not touched.
  - UI / HTML / JS references: none (grep).
  - Docs: `parameter_schema`'s docstrings updated. Its module-history docstring still mentions the
    old base-requirements path; left as history.
- **Behaviour change, stated:** a `boundingboxoffset` edited in an existing doc is no longer reset
  to 0.635 cm on every build. The template's ReadOnly master is created only when missing. Net effect
  on `frame_thickness`: none (the template's expression won anyway).
- **Tests.** 6 new tests in `test_board_params_ownership.py`, reusing its fake-adsk scaffold and
  eviction fix. Against the pre-change engine files, restored from my scratch copy (not from HEAD),
  **4/6 fail**. The 2 that pass are the "every template declares `frame_thickness` +
  `boundingboxoffset`" guards: they pin something already true, which guards the removal.
- **Fast tier:** `pytest frame-builder + test_bspline_frame_builder + b-spline-gen` gives
  **109 passed, 0 failed** (baseline 58 before adding b-spline-gen to the run, all green).
- **Stale docs:** STALE banners added to both templates' semantic-phase `.md` files. Not rewritten.
- **GATE, not done:** `template_catalog.py` has **no consumer at all** (grep), so the whole module is
  dead. Option A: delete it. Option B: keep it and fix the T3/T4 + "Metric" text. Recommendation: A.
  The advisor decides.

**Amendments absorbed (8):**
- **Q1:** re-Send = delete + rebuild.
- **Q2:** `defaultTemplate: null`, frame none by default.
- **Q3 (3 → 3d, final):** `frame_height_offset` is the Z position of the frame bottom. Name and
  negative value kept, labelled "Frame bottom (z)".
- **Q4 / 4b:** appearance default `3D Ash - Unfinished`, 5 woods declared once. Measured: **three**
  divergent lists exist today (the palette's 5 woods; `APPEARANCE_PRESETS`, which has no Mahogany or
  Cherry but has Enamel / Aluminum / Brass; the `'Polished Chrome'` fallback). I corrected my F1 doc's
  "Polished Chrome default" error.
- **Optional:** tint the bars in the 3D preview by the chosen wood (noted).
- All §5.4 answers are marked ANSWERED, and S7 is shrunk.

**Not measured:** whether the solved T1 geometry keeps the seeds' L/R shoulder asymmetry. That needs
a curve dump, so it stays with the S4 parity fixture, still marked UNVERIFIED in the doc.

**Processes / capacity.** No processes left behind (checked below). Capacity is fine.
- **AMEND 5 (Q5), absorbed after the entry above.** The frame and the inlay artwork are unrelated,
  with no clipping. Q5 is marked ANSWERED. The design's "bonus reuse" (a Shape Lattice filling the
  frame's inner edge) is **dropped**, since it contradicted this. The 3D-preview trim clip is kept: it
  previews the real Fusion `TRIM_CUT`, not the artwork.

## Turn 4 — F3: FB-ORDER solids fix (live) + S1 frame-defs.json + template_catalog deleted + S4 goldens + UI design — DONE — FUSION (scratch only)

**item 1: FB-ORDER.** Root cause, as F2 measured: nothing re-ran the reorder after the solid build.
- **The fix.** One helper, `timeline_order.ensure_frame_before_inlay`, with a declared
  `BENIGN_NOT_MOVED_REASONS`. It replaces frame_engine's two copies of the reorder-and-warn block,
  and `SolidCoordinator.run` now ends with it (step 6).
- **Live, first try (worktree helper after the installed solid build):** the 4 extrudes moved but
  **`t1_TRIM_CUT` stayed after the inlay**. Measured why:
  - The cut feature's `parentComponent` is **Clean**, the body it cuts, not Frame_1.
  - Also: **`TimelineObject.canReorder` is a METHOD `canReorder(beforeIndex)`**. The algorithm read
    it as a property, a bound method that is always truthy, so the any-refusal-moves-nothing safety
    net could **never** fire on real Fusion. Measured: `trim.canReorder(<inlay idx>)` = True,
    `trim.canReorder(3)` = False.
  - The old test fake modelled a bool, which is how this hid.
- **Fixes:**
  - A declared `FRAME_MEMBER_ATTR = ("FrameBuilder", "FrameComponent")`. `extrusion_engine` stamps
    it on every feature it creates (bar and trim), and `is_frame_timeline_item` reads it before
    component ownership.
  - The algorithm calls `canReorder(earliest_inlay_index)`, and the fake is now a method recording
    the index it was asked about.
- **Live, second run** (worktree `extrusion_engine` + `timeline_order`; for that one `exec` the
  `fb_engine.timeline_order` name was pointed at the worktree copy and restored in a `finally`,
  confirmed): `Frame_1` → 3 sketches → 4 extrudes → `TRIM_CUT` → `Plane for L1` → `Source - L1`.
  All healthy, bar volumes identical to F2 (190.28 / 92.40 / 81.14 / 189.69). The trim carries the
  tag with parent Clean.
- **Evidence:** the before/after timeline lists come from the API. The viewport shots
  (`1703_F3_fborder-before/after.png`) do not show the timeline strip. A desktop grab showed VS
  Code, not Fusion, and included private chat, so it was deleted at once. I did not bring Fusion to
  the front on Fred's desktop.
- **Tests:** `test_timeline_order.py` +6, and a new `test_solid_coordinator_reorder.py`. Mutations:
  - removing the `SolidCoordinator` call → 1/1 red;
  - `canReorder` read as a property → 4 red (including 2 pre-existing refusal tests that only pass
    now that the fake is honest);
  - no member-attr check → 3 red.
  - Weaker, as stated: the new `TestEnsureFrameBeforeInlay` tests fail pre-change only on import
    (the helper didn't exist); their block-ordering assertion pins what the algorithm already did.

**item 2: S1.**
- `fb_engine/frame_definition.py` (pure) holds `DEFAULT_TEMPLATE = None`, `APPEARANCE_OPTIONS` (the
  palette's 5 woods) / `DEFAULT_APPEARANCE`, `FRAME_BOTTOM_PARAM` / `DEFAULT_FRAME_BOTTOM_EXPR`,
  `EXTRUSION_SETTINGS` (inventoried from the palette: offset, wood, face pick; the end offset is
  SolidCoordinator's literal), `COMMON_FRAME_FEATURES` and `build_frame_defs()`.
- Each `template_data.py` declares `FRAME_SILHOUETTE_PRESET` / `FRAME_REGIONS` / `FRAME_FEATURES`
  and returns them as the spec's "Frame" key.
- `tools/gen_frame_defs.py` (plus `--check`) writes `b-spline-gen/html/data/frame-defs.json`
  (73 KB, sorted keys, LF). Its source hash normalizes CRLF.
- **Consumers aligned to the one declaration:**
  - `appearance_manager.APPEARANCE_PRESETS` is now `list(APPEARANCE_OPTIONS)`. The old list (Ash /
    Maple / Pine + Enamel / Aluminum / Brass) was imported by solid_coordinator but **never read**.
  - `solid_builder_ui`'s fallbacks ("Polished Chrome", "-1 in") now read the declaration.
  - The palette HTML stays static, and a test fails if it drifts.
- The hot-reload bootstrap wipes the whole `fb_engine` package (`bspline-frame-builder.py:186`),
  so the new module reloads.

**item 3: template_catalog.py DELETED.**
- **Why:** it was not the natural list. `template_resolver` already discovers templates from their
  folders (the generator uses that), and the catalog listed non-existent T3/T4 with stale "Metric"
  text.
- **Sweep:** a repo-wide `grep -a` found no importer and no docs besides the design doc / log.
  Nothing else to sweep.

**item 4: tests.** `test_frame_defs.py`, 10 tests: freshness, schema, declaration (every region id is
created by the template's blocks), a renamed id goes red, palette woods/offset == declaration, and
presets exist in the app's `PRESETS`. Mutations:
- a phase-literal edit → freshness red;
- T2's "Frame" key removed → 2 red;
- a palette wood renamed → 1 red.

**Extra F3-item-6 (advisor): S4 goldens RECORDED.**
- `tools/repro/record_frame_parity.py` runs inside Fusion: one scratch doc per case, closed in a
  `finally`, a declared flat-box core, dumped keyed by `FrameBuilder.ID`.
- Output: 6 files in `tests/fixtures/frame-parity/`. 4 are healthy 4-bar frames. Both 5.51×1.97
  cases give 0 bars: the safe zone is 1.47 in, less than 2 × 0.75, so they are kept as degenerate
  goldens and a validity rule is added to the design.
- **The last UNVERIFIED closed:** solved T1 is exactly L/R mirror-symmetric (Δ = 0 to 5 dp).
- No inverted waist was reproduced (all 12 waist arcs pinch correctly).
- `test_frame_parity_goldens.py` has 9 tests. Mutation: one mirrored-arc radius +0.01 plus a
  dropped bar → 2 red; restored from a scratchpad copy.
- **Two recorder bugs of mine, fixed on the way:**
  - A core proxy taken before the frame build went stale (`body.appearance` →
    InternalValidationError getObjectPath).
  - I passed ui_data frame_thickness = "0.75 in", which exposed a real engine bug (below).
  - A failed-run shot and its fixtures were deleted.
- **Engine findings, logged and not fixed (advisor: they are F4):**
  - (1) `BuildContext.resolve_val` (build_context.py:58) does `float(ui_data[name])`. A unit string
    becomes a silent 0 cm (FAIL RESOLVE) and the offset "created no geometry". A bare number is
    taken as cm.
  - (2) `addOffset2` fails ("argument 2 vector<SketchCurve>") and falls back to a non-parametric
    offset in most builds.
- A safety check blocked one mutation-restore command that had an `rm` on a root-level path, and
  nothing in it ran. I redid it with the backup in the scratchpad and no removal.

**Design (AMENDs 1–7b + Q6).** `FB-APP-DESIGN.md` covers:
- **§3 rewritten:** the cut-profile headline (§3.0); two doors, with the sidebar FRAME section
  second after STOCK DIMENSIONS holding the extrusion settings, and editor [Frame | Artwork] tabs;
  the persisted frame record data model; the ownership table; one silhouette engine shared with the
  Shape Lattice; acceptance screenshots T1+T2 × desktop+mobile.
- **The earlier LAYER_ROLES / guide-layer proposal is dropped:** the frame is the board's shape,
  not a layer.
- **§4:** two send buttons.
- **S8:** waist-inversion check + reproduce/fix. Risks 7–9 added. All 6 open questions are marked
  ANSWERED.
- **NEW GATE for Fred (§3.2):** the on-canvas shape handles can't reach Fusion parametrically,
  because the templates have no shape params (drivers retired). Options: (a) declared shape params
  in the templates, recommended; (b) send fixed geometry; (c) no handles in v1.

**Not done / flagged:**
- AMEND 1 and the extra-item messages asked me to add checklist lines (F3-item-5, F3-item-6) to
  NEXT-SESSION-fb-app.md. **Not done: that file is the advisor's.** Both items are done; please
  add the lines.
- Fusion is left clean: the scratch docs are closed, Fred's doc still has its 6 timeline items, no
  claude modules or worktree paths remain, and the advisor was told twice when I was out.
- Fast tier: **135 passed, 0 failed.** `gen_frame_defs --check` is fresh.

## Turn 6 — F4: FB-FIX (unit resolver, list-typed addOffset2, board-too-small) — items 1-3 DONE (fakes) / item 4 NOT verified live (bridge hung)

**item 1: the ONE unit resolver.**
- `ParameterSchema.UNIT_TO_CM` (cm/mm/m/in/inch/inches/"/ft) plus `ParameterSchema.to_cm(value,
  default_unit)`, and a `ResolveError`.
- `BuildContext.resolve_val`'s shadow-state branch now parses the UI value with the param's
  DECLARED unit:
  - `'0.75 in'` gives 1.905 cm (it was a silent 0);
  - a bare `0.75` is **inches** (it was taken as 0.75 cm, a latent wrong-units bug);
  - toggles (en_/ck_) stay unitless.
- A failed resolve raises `ResolveError` (logged FAIL RESOLVE). `offset_step` re-raises it instead
  of swallowing it as OFFSET CRASH, so `build_template` reports "CRASH in Sketch" and stops.
  Never a silent 0.
- Numeric literals in blocks keep meaning cm (unchanged).

**item 2: addOffset2.** The root cause was the argument type: `createOffsetInput` wants a Python
list of SketchCurve (SWIG std::vector), and the code passed an ObjectCollection.
- `_as_curve_list(coll)` now converts it.
- A declared `OFFSET_SIDE = "inward"` + `_ensure_inward`: if the result bbox is larger than the
  source, the driving expression is flipped to `-(<expr>)`, keeping it parametric. Which sign Fusion
  picks by default is UNVERIFIED (needs live).
- The fallback log went DEBUG → WARNING: "FALLING BACK to a NON-parametric offset".

**item 3: board too small.**
- `frame_definition.FRAME_FIT` (rule + message) and `frame_fit(w, h, ft, bbo)`, emitted into
  `frame-defs.json` as `fit` (regenerated; fresh).
- `FrameBuilder._check_frame_fit()` runs after `_create_skeletal_parameters` in both build paths.
  It reads the doc's own params, warns "FRAME FIT: Board too small …", and sets `self.fit`, which
  `build_frame_logic` / `build_sketch_logic_v3` now return (they returned None before).
- Warn, not abort, per spec. Known gap: the hourglass waist can be stricter than this bbox rule.

**Tests** (+13 pure in test_fb_fix.py, +10 engine in test_board_params_ownership.py): to_cm table,
never-zero cases, fit rule incl. **the rule predicts every live golden (0 bars ⇔ too small)**,
resolve_val cases, addOffset2 gets a list (fake mirrors the SWIG TypeError), the fallback is a
WARNING, and the build-level fit warning. Mutations, each file's pre-change copy restored from the
scratchpad:
- build_context → 4 red (the 2 that pass pin already-true behaviour: toggles, expressions);
- offsets → 2 red;
- frame_engine → 2 red;
- fit rule min→max → 5 red.

⚠ **Trap hit:** the min→max mutation is the same file size, and the restore landed in the same
second, so the stale `.pyc` stayed valid and the "restored" run still showed 5 red. Deleting that
module's pyc cleared it. Saved to memory. Fast tier: **168 passed, 0 failed**; frame-defs fresh.
Checkpoint commit 5a28608 (pushed before the live attempt).

**item 4: NOT VERIFIED LIVE.**
- The advisor granted a ~15 min window.
- My harness (scratchpad `f4_live.py`) did everything in ONE fusion_execute call:
  - snapshotted every fb_engine.* / sketches* / template_loader / frame_engine_core module;
  - loaded the worktree fb_engine as a package by file location (no sys.path change);
  - built T1 7×9 with `ui_data frame_thickness='0.75 in'`, extruded, and edited
    `frame_thickness` → 0.5 in with `adsk.doEvents()`;
  - restored the modules in a `finally`.
- **The bridge timed out, and 3 tiny follow-up probes timed out too.**
- A PrintWindow capture of Fusion's own window (to the scratchpad, NOT the published shots folder)
  shows the UI responsive with only Fred's `Untitled*` tab, so my scratch doc appears closed and the
  `finally` most likely ran. That is **UNCONFIRMED**: I cannot read sys.modules without the bridge.
- The advisor was told at once, with the recommendation: Fred saves (his doc is unsaved), then
  restarts Fusion or reloads the add-in properly before using the Frame Builder here.
- I restarted nothing (unsaved user doc). Nothing measured from this run; the goldens were not
  re-recorded.
- Lesson saved to memory: one short step per fusion_execute; never leave a module swap spanning a
  slow step.

**Queued (advisor heads-up):** F5 SIL-RESOLVE (the Shape Lattice hourglass loops at a high corner
radius). Not started.

**Processes:** clean. Capacity is fine. Item 4 wants a fresh, **short-step** live pass once the
bridge is back.
- **CORRECTION to the item-4 entry above (advisor's root cause).**
  - The bridge did not hang because of my script. This PC's Fusion shows **"Session Suspended —
    suspended by FredASUS-TUF"**: Fred opened Fusion on his other machine, and his account allows
    one session.
  - So the "one short step per call" lesson was the wrong diagnosis; the memory note is rewritten to
    the real cause.
  - What still stands: the sys.modules restore is unconfirmed. The advisor is handling the Fusion
    restart / add-in reload with Fred before the Frame Builder is used here.
  - **F4 item 4 = BLOCKED (Fusion unavailable)**, not failed. Items 1-3 are done.

## Turn 8 — F5: SIL-RESOLVE — silhouette arcs never invert — DONE — NO FUSION

The merge check: origin/main was already merged into fb-app at dispatch (b1fa602) and it is clean.
The worktree had no node_modules, so I ran `npm ci` (lockfile, gitignored).

**Two root causes, both measured. Fred's loop had BOTH.**
1. **The solver.** The hourglass waist radius was `hw*waistReach - hw*cornerRadius`: NEGATIVE
   whenever cornerRadius > waistReach. The clamp was written as `cornerRadius <= 0.95 - waistReach`,
   but the condition that matters is `cornerRadius < waistReach`.
   - Fred's sliders (waist reach ~28% of 0.05..0.92 = 0.294, corner radius ~70% of 0.04..0.6 =
     0.432) sit squarely in that zone. The guard reports selfIntersection (shoulder <-> hip): the
     "fish".
   - AMEND 1's target (a shallow 0.4 in waist with a 1.75 in shoulder radius) was **impossible in the
     old model**: shared-column arcs force Rs + Rw = depth.
   - Bottle: the derived hip centre `neckCenterY + hw(1 - neckWidth)` fell below the bottom edge on
     wide/short boards (notTangent, 196 of 343 at 12×6).
2. **Stale segments.** The panel stores `shape.segments` after every Generate and passes them back;
   they were reused **verbatim**, with bulges solved for the OLD params. Measured: at Fred's params
   that alone gives 8 non-tangent joints even with the fixed solver, while a fresh solve is clean.
   Only a preset switch ever cleared them.

**Fixes (declared, one source each):**
- **Feasible ranges.** `feasibleParamRanges(preset, region, params, stroke)` + `PARAM_ORDER`
  (hourglass: waistCenterY → waistReach → cornerRadius; bottle: neckWidth → skeletonX →
  neckLength), with `WAIST_MIN_RADIUS_OF_DEPTH = 0.5` and `HORN_MIN_OF_HALF_HEIGHT = 0.02`. The
  solvers resolve every param inside its range via `_resolveParams`; the old hand-written clamps are
  gone. Explicit in-range values are honoured exactly (tested); only a genuinely infeasible value is
  clamped.
- **Generalized hourglass tangency** in ONE exported `hourglassConstruction()`:
  - `Rw = max(depth - Rs, 0.5*depth)`. While `depth - Rs >= 0.5*depth` this is exactly the old
    shared-column shape (**existing in-range designs unchanged**; the old generator tests pass
    untouched).
  - Past it the centres separate, with external tangency and half-height
    `dy = sqrt(d(2(Rs+Rw) - d))`, which reduces to the old `dy = d`.
  - Junctions lie on the centre line; stroke inset as before.
- **Zero-length horns** (found by the sweep: a param exactly at its feasible edge made the arc
  start at the corner) now get a declared minimum horn length.
- **Segment ownership** `_mergeSegments`:
  - A stored segment is USER-owned if the editor wrote it (`writeSegmentStyle` now stamps
    `user: true`) or its style/dir differs from the solver's. The second rule keeps legacy styled
    segments saved before the flag.
  - Everything else is re-solved each time.
  - The result reports `hasUserSegments`.
- **The guard** `outlineDefects(primitives, {requireTangency})` (F3 AMEND 7b, shared with the future
  frame preview): positive radii, no arc past a half-turn, no zero-length line, tangency at every arc
  joint (skipped when the user has styled segments, since a kink is deliberate), and a simple loop.
  - `regenerateSilhouette` runs it before drawing. A defective outline is **never drawn**: the last
    valid one stays, and the editor hint says why. Defects sit on `editor._shapeOutlineDefects`, NOT
    on the saved pattern (two existing tests deep-compare `p.contour` and caught my first attempt).
- **Handles.** `editor-shape-lattice-interaction.js` used a hand-copied duplicate of the old algebra
  AND the buggy clamp. It now uses `hourglassConstruction` for anchors and `feasibleParamRanges` for
  every drag clamp.
- **Sliders.** `syncFieldsFromPattern` sets each slider's min/max from the feasible range (so no dead
  zone) and shows the RESOLVED value.
  - Visible effect: corner radius now spans 0.05..0.95 where the static HTML said 0.6, so Fred's
    large radii are reachable. It shrinks live when a deep off-centre waist leaves less room.
- **Precision cap found on the way.** `_arcPrimitive` clamped the bulge at ±0.999, which rebuilt
  near-semicircle arcs with a visibly wrong radius and centre (0.013 off on a 200-wide board). That
  is exactly the new waist just under a semicircle. Now ±(1 - 1e-9).

**One existing test's contract changed, stated.** `reuses an explicit segments array verbatim ...
across a seed change` pinned the stale-bulge behaviour. It now asserts the user-styled segment is kept
verbatim and the rest equal a fresh solve.

**Tests.**
- New `tests/silhouette-resolve.test.js` (14):
  - Fred's case (clean, radius kept);
  - the AMEND 1 target (clean, Rs = 1.75 in kept, pinch at hw − 0.4 in, Rw < Rs);
  - a dense sweep: both presets × 7³ slider grid × 5 boards (7×9 portrait, 9×7 landscape, 12×6,
    5×5, 3×2 small) × 2 strokes, all clean;
  - resolved values within the declared ranges; in-range values honoured exactly;
  - stale segments re-solved; a user kink survives; legacy styled segments count as user-owned;
  - the guard catches a crossing loop.
- `properties-shape-lattice.test.js` +2: the slider max follows the range; a looping user-styled
  outline is not drawn, the elements are unchanged and the hint is shown.
- **RED FIRST:** before any solver change, Fred's case, the target and both sweeps failed on
  geometry (Fred: 2 × selfIntersection; the target: 2).
- **Mutations** (each restored from a copy, the suite green after: 101/101):
  - waist radius allowed negative → 4 red;
  - segments reused verbatim → 2 red;
  - preview guard removed → 1 red;
  - slider range not wired → 1 red;
  - no minimum horn → 2 red.
- Touched specs: 365 pass. **Full vitest: 1285 passed / 70 files, 0 failed** (run once, because the
  generator feeds much of the app).

**Screenshots** (`shots/seatC`):
- `1757_F5_before-after-outlines.png`: HEAD vs F5 solver, Fred's case + AMEND 1 target.
- `1759_F5_app-fred-case-BEFORE.png` / `-AFTER.png`: the real app from the styled server.
  - Served from the `bspline-frame-builder` folder: BEFORE = a `git archive` of HEAD on :8785,
    AFTER = the worktree on :8784.
  - Driven by the new `tools/repro/shape_lattice_fred_case.mjs` (CDP, no deps, kept to re-run).
  - BEFORE reproduces Fred's photo exactly (fish loops at the waist); AFTER is a clean hourglass at
    the same sliders.
- Both servers and Chrome instances were stopped afterwards (exit 127 = my own kill).

**For Fred's eye (declared, tunable, not guessed further):** the AMEND 1 target's waist arc is 0.2 in
(0.5 × depth), which reads a bit pinched at a 0.4 in depth. `WAIST_MIN_RADIUS_OF_DEPTH` is the one
knob. Raising it rounds the waist but moves the switch point, so more existing shapes would change.

**Coordination:** seat B's T76 edits lattice layers, not this solver. The files touched are the
generator, the handles module and the Shape Lattice panel.

**Processes:** clean. Capacity is fine.

## Turn 10 — F6: S2 part 1 — editor board = frame cut profile, frame record, sidebar FRAME section — DONE — NO FUSION

Gate 3.2 = (c) per the dispatch: no shape handles. Palette and editor edits are kept small and
additive, and I pushed a checkpoint mid-turn, since Fred now owns the regular add-in.

**item 1: the app reads the generated definition.**
- `tools/gen_frame_defs.py` now also writes `html/data/frame-defs.js` (`export default {...}`): the
  SAME render as the JSON. The Fusion palette runs from file://, where fetch() of a JSON file is
  unreliable but ES-module imports already work.
- `--check` and the Python freshness tests cover both files.
- New `tests/frame-defs.test.js`: version 1, no default frame, the 5 woods with Ash, frameBottomZ =
  a -1 in Z position, each template's preset exists in PRESETS with matching shapeParams keys,
  params complete, and JS module == JSON.
- **New declared data:** `FRAME_SHAPE_PARAMS` per template (gate (c): the frame's shape = template +
  declared params), FITTED to the S4 7x9 goldens:
  - T1 hourglass {waistReach 0.32, cornerRadius 0.19, waistCenterY 0};
  - T2 bottle {neckWidth 0.618, skeletonX 0.83, neckLength 0.16}.
  - **MEASURED:** the T1 pinch is 0.0013 in off at 7x9 (shoulder r 0.6175 vs 0.6242). At 12x6 it is
    **0.44 in** off (shoulder r 1.09 vs 0.42), because Fusion's solve is not scale-invariant. Closing
    that at every size is S4's parity job; it is asserted at 7x9 only and stated in the test.
  - I first wrote "~0.002" into that test comment before measuring. I caught it, measured, and
    replaced it.

**item 2: the frame record** (`core/frame-record.js`).
- `{recordVersion, templateId (null = none), params (overrides only), frameBottomZ, appearance}`.
  `normalizeFrameRecord` is the ONE gate (an unknown template, an undeclared wood, junk numbers, or
  board-owned / undeclared params all resolve to the defaults); `setFrameRecord` is the ONE write.
- `P.frame: null` in DEFAULT, so it rides the existing `persistableP` serializer (session, undo,
  projects). `updateP` was not used because it `parseFloat`s objects to NaN.
- **Old projects:** `applySnapshot` copies P keys but never resets missing ones, so a pre-frame
  project would have KEPT the current session's frame. Now a missing `frame` key sets null
  (2 lines + `syncFramePanel`).
- Tests: normalize cases, JSON project round trip, localStorage session round trip, and 2
  `snapshot-manager` load tests (an old project reads as none; a saved frame restores).

**item 3: the sidebar FRAME section** (`main/frame-panel.js` + ~20 lines of palette HTML), second
after STOCK DIMENSIONS, collapsed with a one-line "— none" summary:
- Template (None + defs templates), Frame bottom (z) (-1), Wood (the 5 declared), a fit warning,
  and [Edit frame shape ✎] (a stub that opens the SVG editor, gate (c));
- every option comes from the definition; the summary shows the template name;
- `initFramePanel()` sits after `initSkeletonEditor()` in main.js.

**item 4: HEADLINE, the cut profile** (`editor/editor-frame-profile.js`).
- A pure `frameCutProfile(defs, record, board)`: the safe-zone region (board minus
  boundingboxoffset), the template's preset + shapeParams through the SAME `generateSilhouette` the
  Shape Lattice uses, the F5 `outlineDefects` guard, and the declared fit rule (`frameFit`, mirrors
  Python FRAME_FIT, agrees with all 6 goldens).
- `drawFrameProfile(editor)` draws into `editor._bgLayer`: an even-odd shaded cut-away (the board
  minus the outline) plus the green profile.
  - The background layer is never exported and sits under the grid and the artwork, so the
    **artwork is untouched by construction** (tested: nothing added to the sketch layer).
  - It redraws in place, is removed on "none", and is **never drawn if the guard fails**.
  - Called from the end of `sync3DBackground` (which clears that layer) and on every record change.
  - Decoupled via `setFrameProfileProvider`; the editor module never imports app state.

**Tests / gates.** 21 new JS tests + 2 in snapshot-manager + 1 Python. Mutations, each restored:
- an unknown template kept → 1 red;
- the guard not gating the draw → 1 red;
- drawn into the artwork layer → 2 red;
- an old project keeps the current frame → 1 red;
- no redraw-in-place → 1 red.

Full vitest: **1380 passed / 74 files, 0 failed** (with the F6 tests). Python frame-builder:
120 pass. Checkpoint commit `9173fbd` (18 files) pushed before the shots.

**item 5: shots** (`shots/seatC/1814_F6_{T1,T2}_{desktop,mobile}_{sidebar,editor}.png`, 8 files).
- The styled server (the `bspline-frame-builder` folder), driven by the new
  `tools/repro/frame_profile_shots.mjs` (CDP). The template is picked through the real `<select>`.
- It read back, for all 4 runs: profile drawn, 0 defects, fit ok, 7x9, no page errors.
- T2's narrow neck is at the top, matching Fusion.
- The server and Chrome were stopped after.

**Not in this stage (stated, not silently skipped):**
- grid / snap / fit-to-view do not yet follow the outline (AMEND 1 mentions it; F6 item 4 did not
  require it);
- the 3D trimmed panel + bars is S3;
- "Edit frame shape" is a stub;
- the round trip is tested via P / JSON / localStorage + applySnapshot, not via a real cloud
  save/load click-through.

**Processes:** clean. Capacity is fine.

## Turn 12 — F7: S3 — 3D trimmed panel + wood bars; editor grid/snap/fit follow the outline — DONE — NO FUSION

**Mapping (measured, not re-derived):** `drape-svg.js` DRAPE_TEXTURE_FLIPY's own measurement says
SVG y=0 (the top) samples v=1, i.e. world +H/2. So editor (x, y) → world (x − W/2, H/2 − y). Two
existing helpers disagree about row 0 (`buildHeightField` vs `buildLiveBrushColours`); I followed the
measured drape, not either comment. It is tested: T2's narrow neck lands at world +y, as in Fusion.

**item 1: trimmed panel** (`core/preview/frame-mesh.js`, pure arrays + thin THREE wrappers).
- Panel triangles whose (x, y) centroid is outside the cut profile are dropped by an **index filter**.
  The untrimmed index is kept in `geometry.userData.fullIndex` and restored for "none". The drape
  overlay SHARES this geometry, so it is trimmed for free.
- An **edge wall** along the exact outline, from the bilinear-sampled underside to the top surface,
  hides the ≤ one-cell jag. It uses a clone of the panel material.
- TerrainPreview additions, small and additive: a `setFrameProvider((W, H) → spec)` +
  `refreshFrame()` + `_applyFrame()` called at the end of `update()`, and meshes disposed in
  `_dispose()`.
- **The provider is asked with the grid size actually drawn.** A pushed spec would go stale when
  Fusion's `sync_board` sets widthIn without a DOM change.
- **One source:** `frameSolidSpec` (editor-frame-profile.js) samples the SAME `frameCutProfile` the
  editor draws. Tested: `spec.outline == sampleOutline(profile.primitives)`.

**item 2: bars.**
- The ring between the outline and the frame's inner edge is a **quad strip between corresponding
  samples**. Same template, safe zone inset by frame_thickness, so the primitive topology is the same
  (fixed fractions per primitive); the corner pairs are the miter lines. That avoids needing a
  polygon triangulator: `three` isn't in node_modules.
- Straight, no taper, from frame-bottom z up to the underside.
- **Honest limit:** the inner edge is exact on the straight runs (matching F2's measured ±2.5 in)
  and an approximation of Fusion's true offset on the arcs.
- **Wood colours:** `APPEARANCE_PREVIEW_COLORS` is declared in `frame_definition.py` beside the wood
  list and emitted as `appearance.previewColors`. A Python test fails if a wood lacks one.
- **Live:** a wood or record change calls `refreshFrame()` (no terrain rebuild).

**item 3: F6 leftovers (AMEND 1).**
- **Grid:** the grid layer is clip-pathed to the profile, so there is no grid in the cut-away. It is
  replaced (not stacked) and unclipped for "none".
- **Snap:** `_snap` is wrapped by `frameSnapGate`. A snap landing in the cut-away returns the raw
  point; inside, snapping is unchanged.
- **Fit:** `fitView` frames the profile region, aspect preserved (the limiting side fits exactly).
- Editor edits are one line each in editor.js and editor-view.js.
- **Behaviour note:** with a frame, the fit zoom is ~1.06, not 1 (the file's comment says "zoom 1 =
  fit"). That comment holds with no frame.

**item 4: tests + shots.**
- **Tests:** `tests/frame-3d.test.js`, 15 tests, covering:
  - one source; T1/T2 correspondence; no frame → null;
  - the world mapping;
  - every kept triangle inside, some cut, T1+T2;
  - no frame restores the exact index;
  - bars' z = {frame bottom, underside}; the wood colour applied and changing live; frame_thickness
    moving the inner edge only;
  - the snap gate; the fit region; grid clip / unclip / replace.
  Plus the Python previewColors check.
- **Mutations**, each restored (15/15 green after):
  - no trim → 2 red;
  - bars top not the underside → 1;
  - world y not flipped → 1;
  - snap always → 1;
  - fit ignores the frame → 1;
  - wood colour ignored → 1;
  - grid not clipped → 1.
- One wrong expectation of mine, the fit width, was caught by the test: the aspect-preserving fit is
  correct; the assertion was fixed.
- **Shots** (`shots/seatC/1827_F7_*`, driven by the new `tools/repro/frame_3d_shots.mjs`, which
  reads the preview's own state back through the page's shared modules):
  - t1_desktop_3d, t1_mobile_3d, t2_desktop_3d, t2_mobile_3d: trimmed panel + Ash bars. Read back:
    2 frame meshes; T1 kept 253,983 / 306,240 index entries, T2 241,689; no page errors.
  - **Live proof on one page, no reload:** `_live-wood` (Ash → Mahogany through the real `<select>`;
    bar colour read back `#d9c9a3` → `#7a3b2e`), `_live-thickness` (frame_thickness 0.75 → 0.4 via
    the record; the inner edge moves and the outline/trim is unchanged, as expected).
  - Desktop vs mobile kept-counts differ slightly (253,983 vs 255,156). My read: the thickened
    underside offsets bottom vertices along the normals, and each fresh session's terrain differs,
    so the centroid test shifts a little. Stated, not proven further.
- Gates: vitest touched specs green; Python 120 pass; `gen --check` fresh. Checkpoint `481c4cc` pushed
  before the shots.

**Not in this stage:** grid snapping ONTO the outline itself (only gating); the bars are one ring,
not 4 separate bodies (the miter lines are implicit at the corner correspondences); the handles/Frame
tab is gated (3.2).

**Processes:** the server and Chrome were stopped (127 = my kill). Clean. Capacity is fine.

**Amendments absorbed (4; the 4th superseded the 3rd).**
- **Bar tops follow the SCULPTED underside.** `samplePairedOutlines(outer, inner, cell)` gives both
  loops the same step count per primitive pair, each step <= one terrain cell, and `ringArrays` adds
  rows ACROSS the ring width (<= one cell). Every top vertex is the bilinear underside z.
  - My first ring had only edge samples: a straight edge sampled its start point only, so a 6.5 in
    top edge was ONE flat quad. Fixed.
  - The edge wall is also always densified.
- **"Code it right + prove it by tests", no runtime guards.**
  `tests/frame-3d-sweep.test.js`:
  - a sweep over 2 templates × 5 boards (7x9, 9x7, 12x6, 5x5, 4x3.5) × 3 frame bottoms (-2, -1,
    -0.25) × 3 sculpts (flat, waves, tilt), at least 40 frames checked: every bar vertex finite,
    inside the board, every top above the bottom and ON the underside (1e-4);
  - the top sampled at least every cell along both loops;
  - at least ceil(0.75/0.1) = 8 rows across the ring;
  - the frame is never rebuilt on render ticks (the real `_startLoop` driven 20 ticks → provider 0
    calls), and `refreshFrame` rebuilds it once.
  - Mutations: no rows across → 1 red; coarse along the loop → 3; top not on the underside → 2;
    rebuilt every tick → 1; restored 23/23.
- **Loose volume sanity vs the Fusion goldens** (flat core, bottom -1 → volume = ring area × 1 in).
  MEASURED app vs Fusion: T1 7x9 **-11.1%**, T1 12x6 **-18.9%**, T2 7x9 **-5.4%**, T2 12x6
  **-10.3%**.
  - Always smaller: the inner edge is the template solved on the inset safe zone, shallower at the
    arcs than a true offset. At 12x6 the outline itself carries S4's known 0.44 in gap.
  - The amendment's "e.g. within 10%" was an example and Fred said no precision chase, so the bound
    is **20%** with these numbers in the test: a way-wrong detector (half or double), stated rather
    than tuned. **Flag for the advisor:** tighten when S4 lands a true offset.
- **Close-up acceptance shot:** `1833_F7_t1_closeup-bar-meets-underside.png`. A low camera at the
  T1 waist; the Ash bar meets the panel along a wavy seam, which is the sculpted underside, and the
  cut-edge wall follows the sculpted top.
- **Timing, measured in-page** (the superseded amendment asked; cheap to report): `refreshFrame()`
  takes **156 ms with a frame vs 1 ms without** (mean of 10, 7x9 at 0.05 in, about 102k panel
  triangles through point-in-polygon against the dense outline).
  - It runs only on frame-input or panel changes (tested), never per tick, but it adds that to each
    terrain rebuild while a frame is on.
  - Not optimised (not asked). A bbox prefilter or a raster mask would cut it if it matters.
- Full vitest: **1403 passed / 76 files, 0 failed**. Python 120 pass, frame-defs fresh.

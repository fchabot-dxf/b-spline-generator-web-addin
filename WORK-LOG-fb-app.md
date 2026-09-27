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


## 🔨 turn 14 — F8 (seat C, epoch 1): S4 parity, editor Frame/Artwork tabs, true inner offset, the bar-top BLOCKER, the focus rule

Commits (fb-app, all pushed): `2a039a1` item 1 parity · `a9d6fc5` items 2-4 + the true-offset
amendment · `742ca5b` the bar-top blocker · `6f6f043` the focus rule / artwork lock / one line colour.
The Trim offset amendment is **not wired: it is a GATE** (below).

### Item 1: S4 parity (committed as 2a039a1 earlier this turn)
- **Cause of the 12x6 gap:** the app solved the template with one fixed set of fractions, and one
  construction was missing a degree of freedom. Fusion's T1 waist at 12x6 is a MAJOR arc (235°).
- **Fix:** a model fitted to the goldens (`fb_engine/frame_shape_fit.py`, emitted in frame-defs as
  `shapeModel`), major-arc support in the silhouette engine, and optional waist/body radii.
  My F5 guard's "half-turn" arc rule was wrong: it is now a full turn.
- **Tolerance 0.1 in, measured both ways:** T1 7x9 0.021, 12x6 0.023 (was 0.44), 5.51x1.97 0.043;
  T2 7x9 0.010, 12x6 0.065. T2 5.51x1.97 is excluded and the exclusion is declared in the fit: Fusion's
  own body arc there is not tangent to the horn.

### Items 2-4: editor [Frame | Artwork] tabs (a9d6fc5)
- **Frame tab:** template, thickness and wood fields editing the SAME frame record as the sidebar,
  with the live cut profile.
- **Artwork tab:** today's editor with the profile as background.
- **[Edit frame shape]** opens the Frame tab; "Open SVG Editor" opens the Artwork tab.
- **Mobile:** the drawer tab label follows the mode (Frame / Layers).
- **Round trip test** (`tests/frame-tabs.test.js`): Frame → Artwork → Frame → save → reload keeps the
  record intact, and the artwork layer records zero writes other than its display opacity.
- **Fred: "see the frame thickness and miter lines in the editor".** Done: the band (wood tint), the
  inner edge and the 4 miters, drawn from the same inner loop the 3D bars use.

### AMEND: the inner edge is the TRUE offset (a9d6fc5)
- **New module:** `editor/outline-offset.js`.
  - Lines are shifted along their inward normal; arcs stay concentric at r − t (convex) or r + t
    (concave). Pieces are re-joined at tangent joints and intersected at corners.
  - A collapsed piece (convex r ≤ t, or a piece whose joints cross) is merged across. It stays as a
    zero-length placeholder, so the result has the same count and order (bars and miters pair by index).
- **Root choice, the one subtle part:** of two intersections, take the one on the true erosion
  (inside, and ≥ t from every piece), otherwise the one nearest the original joint.
  - Nearest-reference alone picked the outside root at T1 4x3.5.
  - Distance-equals-t alone broke the merged regime.
  - The sweep caught both.
- **No inner edge when the frame does not fit** (the declared fit rule). Fusion's own offset at T1
  5.51x1.97 flips outside the board, and the test asserts both facts.
- **Inner edge vs Fusion's `inner_*` curves:** T1 7x9 0.020, 12x6 0.016; T2 7x9 0.010, 12x6 0.064 in.
  This is the outline's own gap carried through.
- **Bar volume vs the goldens:** T1 7x9 **−0.18%**, 12x6 **−0.09%**, T2 7x9 **−0.00%**, 12x6
  **−0.35%** (F7: −11.1 / −18.9 / −5.4 / −10.3%). The tolerance goes from 0.20 to **0.01**.
- **Mutations** on the offset: no collapse (10 red), sign flipped (14 red), nearest-reference root only
  (1 red), the pre-change inner edge (8 red).

### F8 BLOCKER: bar tops on the board's BOTTOM face (742ca5b)
**MEASURED first** (`tools/repro/frame_bartop_measure.mjs`; Fred's two scenes, T1 Mahogany and T2 Ash,
7x9, carve 1.5, read back from the DRAWN meshes).
- The tops were **not flat**: 541-668 distinct z values.
- They were **never above the drawn top face**, and on the right surface at default settings (median
  0.004 in).
- So the advisor's "flat tops near the top" reading was not it. Three real causes:
  1. **Position error.** The thickened underside is offset along the surface NORMAL, so its vertices
     sit off the x,y grid: 0.15 in at Thicken 0.2, 0.54 in at 1.0. The bars sampled it as a regular
     grid, so the bar top missed the drawn bottom face by up to **0.37 in** (p95 0.18) at Thicken 1.0.
     This is Fred's "top side isn't adjusted to the bottom face".
  2. **Centroid trim.** It left a sawtooth gap inside the outline where the bar shows from above:
     0.13% of the ring at Resolution 0.05, **3.2% at 0.15, 7% at 0.4**, up to 0.26 in in from the
     outline. This is the wood poking through.
  3. **The white ledge.** The outline wall was the panel material with `vertexColors = false`, which
     renders as plain #ffffff.

**Fix** (`core/preview/frame-mesh.js`):
- `panelSurface`: heights from the drawn triangles themselves. The bar top is the LOWEST face at x,y,
  i.e. the underside, or the slanted side wall where the offset underside pulled in.
- `clipPanelToOutline`: triangles wholly inside stay in the panel index. Triangles the outline crosses
  are clipped exactly (triangle ∩ polygon, Weiler-Atherton against the convex triangle) into a separate
  `frame-panel-rim` mesh, with position, colour, uv and normal interpolated barycentrically, so there
  is no shading seam.
  - It is a separate mesh because appending vertices to the panel geometry would break
    `setThickenOverlay` (colour arrays sized to the grid) and the export.
- The wall (`frame-panel-wall`) carries the panel's own top colours, as the panel's own side walls do.

**Removed, with every link swept:**
- `trimIndices` and `sampleGridZ`: no production caller left.
- Their tests: "sampleGridZ reads the underside" is deleted.
- The sweep's on-grid underside check: it could not fail on the real bug (on-grid underside), so it is
  replaced by a check against the drawn faces.

**Degenerate cases found by the tests on the way** (each fixed at the cause):
- Sutherland-Hodgman bridges two pieces when a concave outline crosses one triangle twice, so I
  replaced it with Weiler-Atherton.
- A chain entering or leaving exactly at a polygon vertex on the boundary was dropped (strict ties).
- A triangle only touching the outline was decided by its vertices, which are ambiguous on the
  boundary; it is now decided by the centroid.
- A chain running along a triangle edge with the interior outside is zero-width; it is now dropped.

**Tests:**
- `tests/frame-bartop-drawn.test.js`: real `buildSolidMesh`, normal-offset underside,
  `tests/helpers/drawn-panel.js` (its own face lookup, independent of `panelSurface`).
- Red first on the old code: bar tops up to 0.94 in off the drawn underside, bars visible from above
  (up to 485 samples), panel drawn outside the outline (up to 1046).
- Plus area conservation: clipped top-face area == outline area at spacing 1.0 / 0.4 / 0.15.
- The sweep and frame-3d now use a real solid.
- Mutations: the old frame-mesh (8 red); first piece only (1); strict ties (2); vertex-decided (2);
  drop-filter off (2); wall uncoloured (1).

**After the fix, in the app:** 12 combos (T1/T2 × defaults, Thicken 1.0, Resolution 0.4 / 0.15 +
Thicken 0.5 / 0.03, Carve 3 + new seed):
- bar top vs the drawn underside **0**, bars visible from above **0**, tops above the top face **0**,
  wall colours on;
- pixel check on the close-up: wall (190,160,118) tan, bar (114,55,40) mahogany.
- Shots: `1942_F8bartop_*`.
- `refreshFrame` takes 153 ms with a frame (was 156).

**Not covered:**
- **Sculpt Bottom** is a paint brush, not a DOM toggle, so it was not driven in the app. It is covered
  by construction (it only moves the underside vertices, and the heights are now read from the drawn
  faces) and by the sculpted fixtures. A live Sculpt Bottom check is one for Fred.
- **Known gap:** the drape overlay shares the panel geometry, so it does not cover the ≤ 1-cell rim
  mesh.

### AMEND: Frame tab shows the artwork faded + locked; symmetric focus rule; one line colour (6f6f043)
- **`setEditorFocus(editor, tab)`** (`editor-frame-profile.js`):
  - Frame tab: the artwork layer is faded (the same `_sketchLayer`, no second copy),
    `editor._artworkLocked` is set, and the art is deselected.
  - Artwork tab: the frame profile and its shading are the faded ones.
- One declared value, **`INACTIVE_LAYER_OPACITY = 0.4`**, for both tabs.
- **The lock** is read by the editor's own keyboard gate (`_isEditorActive`), which covers Delete, tool
  keys and Ctrl+C/V/A, and by the global Ctrl+Z/Y.
  - Tested: the editor gate, through the real `initInteraction` with real keydown events.
  - Not tested: the global undo line (`wireGlobalEvents` pulls in the engine).
- **`FRAME_OUTLINE_COLOR`** for every frame line; the green outline is gone.
- The new tests fail 4/22 on the old code.
- Shots with a real artwork (paths + a circle): the artwork's SVG is read back **unchanged** across the
  switch. `1947_F8focus_*`, T1/T2 × desktop/mobile.
- **Mix-up noted:** Fred's message "can we show the art in the frame editor" first reached me directly.
  I began a no-dim change, Fred said it wasn't for me, and I reverted it (clean tree, nothing
  committed). It then arrived properly as this amendment.

### GATE: the "Trim offset" field (boundingboxoffset). NOT wired.
The amendment said to check `readOnly` first, and it does **not** mean "the palette hides it".
- In the Python build, `ReadOnly` marks a **master parameter**. `fb_engine/frame_engine.py`
  (`_create_skeletal_parameters`, PHASE 1, around l.309):
  - creates it once, from the template default (0.25 in), only if it does not exist yet
    (`if existing: continue`);
  - never feeds it a UI or payload value (PHASE 2, the resolver, skips ReadOnly).
- So a changed value sent from the app would be **silently ignored by the build**. The preview would
  then no longer match Fusion.
- The standalone palette also treats it as external, as a hidden input
  (`ui/html/sketch_builder_palette.html` ~l.324).

Options:
- **(A)** Make `boundingboxoffset` a normal (non-ReadOnly) template param in `template_data.py`, so
  the resolver writes the payload value on every build. This changes the standalone palette too (it
  becomes an editable field). It is a Python change on the add-in side.
- **(B)** Keep it ReadOnly and make it app-owned like widthIn/heightIn (the app writes the Fusion
  user parameter). This touches the ownership registry in `parameter_schema.py`, which R4 is editing
  (hands off in F8/F9).
- **(C)** Preview-only field: rejected, it breaks preview == Fusion.

My pick: **(A)**. It is the declared path the other frame params already take, and it creates no new
Fusion param.

### Fred's question "are there handles on the profile arcs?"
Not yet: gate 3.2 was (c), numeric fields. Fred has since chosen (a), so handles are F9 (per the
amendments: one binding table, param-bound only once proven by goldens, seeded otherwise).

### Other
- Merge-hygiene heads-up noted: after merging main, rerun `tools/gen_frame_defs.py`, never
  hand-resolve.
- `FB-APP-DESIGN.md` §4 lattice row (coordination amendment) not done this turn.
- Gates:
  - fast tier: 25 files / 450 tests green after the last change;
  - earlier this turn: frame suites 88/88;
  - the full vitest was 1415 before the blocker work. I did not re-run the full suite (it is the
    advisor's merge gate).
- **Processes:** the http.server (8784) and my Chrome instances are to be stopped at pass. Capacity
  is fine; no fresh session needed.

- **F4 item 4: DONE, live-verified by Fred** on his machine ("frame builder looks fine"; unit resolver / addOffset2 / fit rule, merged 6dfdcaf). Noted: lane2 (BOUNDARY-GUIDE) edits core/preview/index.js; my 3D work stays in frame-mesh.js (this turn did not touch index.js).


## 🔨 turn 16 — F9 (seat C, epoch 1): Trim offset (gate A) + frame shape handles

Commits (fb-app, pushed): `d074c49` merge origin/main · `56abaf1` item 1 · `7276b23` items 2-3.

### Merge of origin/main (d074c49)
- frame-defs.js/.json conflicted. As the heads-up said, I regenerated them with
  `tools/gen_frame_defs.py` (`--check` fresh), not hand-resolved.
- The sweep test (`frame-3d-sweep`) timed out once in the full parallel run (5952 ms vs vitest's 5 s
  default): F8 made it heavier, with real solids plus a drawn-face lookup per combination. It passes
  alone (~2.5 s). I did not argue flake: its timeout is now declared (30 s, reason in the line).
  Gate after the merge: 1566 / 85 files green.

### Item 1: Trim offset, gate A (56abaf1)
- **Python:** `boundingboxoffset` loses `ReadOnly` and gains `Expose: True` and `Min: 0.0` in both
  `template_data.py`, the path `frame_thickness` already takes.
  - The resolver (`_create_skeletal_parameters` PHASE 2) now writes the sent value on every build:
    it updates an existing doc and gives a new doc the value at birth.
  - The standalone palette shows it editable (intended). Its "ReadOnly params (widthIn, heightIn,
    boundingboxoffset)" comment was corrected.
- **App:**
  - Sidebar FRAME section: "Trim offset (in)" (`#frameTrimOffset`).
  - `FRAME_PARAM_FIELDS` (main/frame-panel.js) now declares the frame's numeric fields. My F8
    thickness field moved into it, so there is one sync/wire loop instead of two copies.
  - The field writes the frame record, so the cut profile, trim, fit rule, inner edge and 3D follow;
    measured live: at 0.75 the safe zone goes 6.5x8.5 → 5.5x7.5 and T1 keeps 82,858 → 61,729
    triangles.
  - It is a formula field: `formula-fields.js` gains a FRAME section with the name "trim", read from
    the record.
  - **"Carried in the payload":** the value lives in `record.params` and `framePayload()` carries it
    (items 2-3). [Send frame] itself is S5, not built.
- **Registry contract:** `formula.test.js` (reg-addin's contract: "every field has a P key", "every
  name reads a finite P value") would have been violated. Rather than weaken it, it now STATES the
  FRAME binding: FRAME fields must be in `FRAME_PARAM_FIELDS`, and FRAME names are finite once a frame
  is chosen.
- **Tests:**
  - Python: 3 × 2 templates (existing doc takes the sent value, a new doc is born with it, the
    default without one); **6/6 fail on the old templates** (bytecode cleared first).
  - JS: 4 (field → record, live profile + fit, save → reload + template reset, formula scope);
    **4/9 fail on the old code**.
- **Shots:** `1957_F9trim_T{1,2}_{default,0.75}.png`.
- **Live check for Fred (Fusion, his machine):**
  1. Reload the Frame Builder add-in (restart Fusion, and delete the palette first if it caches:
     see the reload gotcha).
  2. Open a board doc that already has a frame (so `boundingboxoffset` exists).
  3. In the Sketch Builder palette the BBox Border field is now editable. Set it to 0.5 in and
     rebuild.
  4. Expected: `boundingboxoffset` = 0.5 in in Modify → Change Parameters, and the frame outline
     sits 0.5 in from the board edge on every side.
  5. Set it back to 0.25 and rebuild; expected back to 0.25.
  6. If step 4 still shows 0.25: the existing doc's param was not updated. Report the log line
     `DEPENDENT (Updated): boundingboxoffset -> …` (or its absence).

### Items 2-3: frame shape handles (7276b23)
- **Binding table:** `FRAME_HANDLES` in `template_data.py` (T1 waistReach / cornerRadius /
  waistCenterY; T2 neckWidth / skeletonX / neckLength), generated into frame-defs `handles`.
  - It lives in Python so the app now and S5 later read ONE source.
  - `test_frame_defs.py` checks every entry: key in the app's PARAM_ORDER for that preset, basis
    hw/hh/h, binding = "seeded" or `{param}` of an EXISTING frame-owned param.
  - FB-APP-DESIGN.md §3.2.1 names the source and holds a snapshot.
- **Every handle is SEEDED.** No Frame Builder param controls any shape feature: the shape comes from
  the literal seeds in `phases/p02_*` (`p02_02_anatomy.py` pins, `p02_09` seed radius dims). So there
  is nothing to bind, and no golden-recording step list for Fred until a template gains a matching
  param (then: `record_frame_parity.py` at 2-3 values of it).
- **Where each piece lives:**
  - `editor/frame-handles.js`: pure; reuses the Shape Lattice's own `computeParamHandles`.
  - `seeds` in the record: additive, still v1. The gate keeps declared seeded keys only, and a
    template change resets them.
  - `framePayload()`: seeds go out as plain values; frame params are the only params.
  - `frameCutProfile`: seeds and bound params override the fitted model, so every consumer follows.
- **Drag UI:** handles are drawn only in the Frame tab, and the drag goes through the Frame tab's
  shield (`touch-action:none`, 16 px grab, pointer capture). The editor redraws per move and the 3D
  refreshes once on release.
- **File fence** (`properties-lattice.js`, `properties-shape-lattice.js`): not touched; I only
  IMPORT `computeParamHandles` from `editor-shape-lattice-interaction.js`.
- **Found in the shots:** the editor's own window-level `pointermove` drew its hover snap-crosshair
  under the drag. `handlePointerMove` now returns first under the same declared lock
  (`_artworkLocked`).
  - Tested with a recording-proxy editor (the handler reads only `_artworkLocked` when locked, and
    more when unlocked). My first attempt at that test was a chain of hand stubs, which was brittle,
    so I replaced it.
  - The root cause of the test noise: `initInteraction` window listeners outlive a test. The earlier
    keyboard test now leaves its mock locked.
- **Tests** (`tests/frame-handles.test.js`, 10):
  - table single source (drawn == declared; a removed entry isn't drawn);
  - seeded → seeds + payload.seeds, `params` untouched, payload param names == the template's frame
    params;
  - bound (a synthetic binding onto `frame_thickness`, only to exercise the path) → the param in
    inches in the payload;
  - drag → record → save/reload, and a template change resets;
  - a real pointer drag through the shield (a far press does nothing).
- **Mutation results:**
  - Pre-change code: 9/9 red.
  - Seeds ignored: 3 red. Gate open: 1 red.
  - **No reset survived at first:** T1 and T2 keys are disjoint, so the gate already drops them. I
    added a test where two templates share a key; the no-reset mutation now goes red.
- **Real app** (desktop + mobile touch): the first handle was dragged with real PointerEvents
  (board → screen via the SVG screen CTM). The handle landed exactly on target, `seeds` was written
  and `params` was `{}` on T1 and T2. Shots: `2011_F9handles_T{1,2}_{desktop,mobile}_frame-tab{,-dragged}.png`.

### Gates / processes / notes
- Final fast tier: JS 1581 / 86 files green; Python fast tier 205; frame-defs fresh.
- The http.server (8784) and my Chrome are stopped at pass.
- **Not done / known:**
  - no handles for the optional radii (`waistRadius`, `bodyRadius`): computeParamHandles has none,
    and the dispatch said reuse it;
  - the Frame tab shield still blocks canvas zoom/pan (pre-existing from F8);
  - S5 must map each seed to its Fusion sketch seed (UNVERIFIED, needs Fusion).
- Capacity fine.


## 🔨 turn 18 — F10 (seat C, epoch 1): S5 [Send frame], code + fake-Fusion tests; live = Fred

Commits (fb-app, pushed): `6f9d2ec` items 1-3 · this commit: item 4 (FB-APP-DESIGN.md §4.1 + this log).

### What the reading found (an Explore pass mapped the plumbing, file:line; the key facts)
- **`frame_engine.build_frame_logic` is broken.** `frame_engine.py:231` calls
  `self._create_assembly_joints`, which exists nowhere. The resulting AttributeError is swallowed as
  "CRASH in run_full_synthesis" and skips FB-ORDER. It stays hidden only because no AestheticCore is
  ever found.
  - **Chosen:** `build_sketch_logic_v3`, the Sketch Builder palette's own full-build path. It ends
    with FB-ORDER.
  - Not fixed here (a separate item): the dead call in `build_frame_logic`.
- **Every `ui_data` key becomes a USER PARAMETER** (`parametric_engine._sync_user_parameters`).
  So the payload params are filtered to the template's own declared params (tested), and the seeds
  never travel in `ui_data`.
- **The R4 stale-param logger at b-spline-gen.py:1458 is already broken.** It passes
  `SimpleNamespace(log=_log)`, but `_log` takes one argument and `compute_stale_params` calls
  `log(msg, level)`; the TypeError is swallowed by its try. Fenced, **not touched**: this is for
  the reg-addin seat.
- **Nothing in production stamps AestheticCore**, and discovery's name hint "clean solid" never
  matches "Clean". So the handler resolves the body from b-spline-gen's own hierarchy
  (B-Spline Set / Clean / solid "panel", the literals `_handle_generate` builds) and passes it in.
  - That is a mirror of those literals; editing `_handle_generate` to declare them was out of the
    file fence. **Flagged.**

### Item 1: the button (JS)
- `#btnSendFrame` plus `#frameSendHint` in the FRAME section.
- `frameSendState()` declares enabled / disabled and the hint:
  - no frame: "Pick a frame template";
  - outside Fusion: "Open this app from the Fusion add-in";
  - seeds present: "N handle shape change(s) are not sent yet".
- The press sends `framePayload()` as `send_frame`. The reply `frame_result` is a new branch in
  main.js's handshake, and it goes to the one status line.
- The panel re-syncs on Fusion detection; otherwise the button would stay disabled in Fusion,
  because the mode is set after init.
- Real app (fake `adsk` injected before load): the button sent exactly the frame record, and both
  replies rendered. Shots: `2029_F10send_*` (web-disabled, fusion-ready, sending, built, no-body).

### Item 2: the add-in side
- **b-spline-gen.py, additions only:**
  - `frame_engine = None`, injected by the root file (`_bs.frame_engine = _engine`, the palettes'
    own pattern);
  - `_find_bspline_core_body`;
  - the `send_frame` dispatch plus `_handle_send_frame`. It merges `frame` into last_send.json and
    replies `frame_result`; a crash is reported to the palette.
- **`fb_engine/send_frame.py`** (pure, collaborators injected). Steps as in FB-APP-DESIGN.md §4.1:
  - refuse clearly first;
  - delete by attribute: the frame occurrences, plus the TRIM_CUT in Clean via `FrameComponent`;
  - the sketch build with the filtered `ui_data`;
  - the solid to `core.underside` (declared bound n.z ≤ −0.9) at `frameBottomZ`, in the wood.
- **Dropped an extra `ensure_order` call I had first written:** both builds already run FB-ORDER, so
  the extra call was untestable decoration.

### Item 3: tests
- **`fb_engine/test_send_frame.py` (9):** the real `ensure_frame_before_inlay` on the shared
  FakeItem/FakeTimeline, with a world whose attributes and components delete with their owners.
  - body → Frame_1 block → inlay;
  - a re-send leaves exactly one Frame_1 and one TRIM_CUT;
  - a later inlay then a re-send still lands before every inlay;
  - no body / no template / unknown / no downward face are clear errors with nothing touched;
  - `ui_data` holds only declared params, and no seed becomes a param;
  - the solid gets the underside, the bottom and the wood;
  - seeds are reported as not applied.
- **`b-spline-gen/test_send_frame_handler.py` (8):** the real `notify` dispatch, the body finder,
  the root-injected engine passed through, last_send.json, and a crash reported.
- **`tests/frame-send.test.js` (6).**
- **Mutations** (restored from my copies; pyc cleared): keep TRIM_CUT 2 red, `ui_data` unfiltered
  1, delete before the body check 1, face ignored 1, no dispatch 3. The pre-change files fail all.
- **Isolation fix:** in the combined Python run another test swaps the `adsk` stub, so the fixture
  patches the `adsk` the module bound at import.

### Item 4: Fred's live step list
FB-APP-DESIGN.md §4.1 has the full list: deploy/reload; B-spline then frame; re-send; the other
order; no body; seeds; and what to send back (`last_send.json` `frame` key,
`frame-builder-debug.log`, `b_spline_gen_log.txt`, a screenshot of the browser tree and timeline).

### GATE: seeds → Fusion (not built; your call)
The dispatch said "map each declared seed to its phase dim". **There is no such dim:**
- T1's only seed dims (`seed_rad_*`, `p02_03`) are radii, and `p02_09` deletes them;
- T2 has none (`p02_04_arcs.py` is literal points only);
- the Fusion outline is under-constrained after `p02_09`.

So seeds are carried in the payload and reported `applied: false`, and the UI says so. Options
(§4.1): (A) plain driving dims added only when a seed is present, proven per handle by goldens at
2-3 values; (B) move the literal seed points only (unprovable); (C) leave it app-only. I recommend
**(A), T1 first**.

### Gates / processes
- JS fast tier: 1587 / 87 files green.
- Python fast tier: 222 green.
- frame-defs fresh.
- Server and Chrome stopped.
- Capacity fine.


## 🔨 turn 20 — F11 (seat C, epoch 1): LIVE on Ranchy — [Send frame] proven + seeds option B

Commits (fb-app, pushed): `3a55fd0` item 1 (live-found fixes) · `7241974` item 2 (seed geometry) · this
commit: docs (FB-APP-DESIGN.md §4.1) + this log. **Fred's add-in is back on MAIN** (f3dd036), verified
running with main's code.

### Hygiene (all hard rules held)
- **Docs:** each document I created was tagged `claude/scratch=F11` the moment it was created.
  Every call asserted the ACTIVE doc carried that tag before touching anything, because both docs
  were named "Untitled". The 19 case docs closed by their own handles in `finally`; at the end I
  closed only the tagged docs.
- **Fred's doc:** "Untitled" (untagged, modified) was left untouched; it is the only doc open now.
- **Deploys:** stop → deploy from my worktree → delete the palette → `run()` in separate calls. The
  palette was never open. The final MAIN deploy mirrored the folder, so no fb-app file is left in
  AddIns.
- **Modules:** nothing added to `sys.path` / `sys.modules`. Scripts ran via `exec` into a local
  namespace, using the deployed add-in's own modules.
- **Bridge:** one call (cases 1-3) timed out on the bridge side, but its results were written and
  no doc was left open. Nothing else went wrong.

### Item 1: [Send frame] live (payload from main's capture_send_payload.mjs, shape-lattice stencil)
- No body → the clear error, nothing created (also "frame before B-spline").
- **B-spline → frame:** `Frame_1` + 3 sketches + 4 bars + TRIM_CUT, all healthy.
  - `boundingboxoffset` 0.5": frame extent ±3.000 × ±4.000 in on 7x9 (the gap measured).
  - `frame_thickness` 0.75", `frame_height_offset` −1.0", bar bottoms z = −1.000.
  - Every bar 0.00000 in from the panel (`measureMinimumDistance`).
  - No frame user params beyond the template's own.
- **Re-send:** exactly one `Frame_1` / one TRIM_CUT, healthy.
- **B-spline re-send** (the extrudes go Warning, the TRIM_CUT goes with the body, as §4 says) → Send
  frame → rebuilt, healthy, body → frame block → inlay.
- **Three live-found bugs, each fixed at the cause, red first in tests:**
  1. **FB-ORDER never moved a frame built after the inlay.** Measured: a sketch inside `Frame_1`
     refuses `canReorder(<before the inlay>)` while `Frame_1`'s occurrence is still after it. The
     old "check everything up front" could never pass.
     - Now: each item is checked right before its own move. A refusal rolls back the already-moved
       items (reverse order, each before its original successor, dependency-safe).
     - Also measured: `reorder(beforeIndex)` lands the item before the item currently at that
       index, in both directions, and Fusion drags dependencies along when moving an item earlier.
       My probe did that to T1_3; I restored it and checked health.
     - The fake now mirrors the measured semantics. The old pinned test ("checked at the inlay
       index") was updated to the per-move meaning.
  2. **Inlay prefixes** `"Plane for L"` / `"Source - L"` missed the lattice's
     `"Plane for pattern lattice-…"` plane. Now `"Plane for "` / `"Source - "`, b-spline-gen's own
     naming.
  3. **0 bars after a B-spline re-send:** every bar failed "InternalValidationError : face".
     - Now: `send_frame` takes a `find_core_body` callable and re-resolves the underside face right
       before the solid build.
     - Proved by measurement, not argued. The first rerun logged "early face valid: True" (a
       different state), so I reproduced the exact failing sequence, which logged
       "**early one valid: False**", and the fresh face built 4 bars.
- **Wood finding (for Fred, not changed):** "3D Cherry - Unfinished" and "3D Maple - Unfinished" are
  NOT in this Fusion's libraries (there: "Cherry", "3D Maple - Painted"). They silently fall back to
  the body's material; Pine was seen on the first send. Mahogany proven.
- Shot: `2044_F11live_T1_sendframe_iso.png`.

### Item 2: seeds, option B (advisor/Fred: "simply seed it in position")
- **`FRAME_SEED_MAP`** (template_data T1 24 entries, T2 14 → frame-defs `seedMap`): lines, Arc3Points,
  skeleton pins (outer end = the arc centre) and T1's temporary seed radius dims ← app primitive +
  S/E orientation.
  - T2's arc ends were ambiguous by position, so I read them from its chain constraints.
  - Every orientation is checked against the template's literal seeds; a flipped `arc_waist_R` flag
    goes red (orientation error 2.64 vs 0.07).
- **App:** `frameSeedGeometry()`; `sendFrame` adds `seedGeometry` when seeded.
- **Add-in:**
  - `fb_engine/seed_geometry.py` (pure, on a copy): only those seeds move, as plain values;
  - `frame_engine` takes `data['seed_geometry']` (never ui_data);
  - `send_frame` refuses a bad one BEFORE deleting anything (tested).
- **Live parity:** 19/19 pass (S4 method, both ways, 0.1 in).
  - Covered: T1 waistReach / cornerRadius / waistCenterY and T2 neckWidth / skeletonX / neckLength
    at 20/50/80% of each feasible range, plus T1 seeded + `frame_thickness` 0.5.
  - Max 0.005 / 0.010 in (the sampling floor). Every timeline healthy; params only the template's
    own.
  - Negative control: a built value vs another value's app outline gives 0.26–1.70 in, so the check
    is sensitive.
  - End to end through the real handler on the real body: `seeds.applied` true, healthy.
  - Shot: `2059_F11live_T1_seeded-waist_top.png`.
- **Every handle matched; none becomes app-only.**
- My F10 claim "option B parity can't be proven" was WRONG; corrected in §4.1.

### Gates / notes
- Fast tier: JS 1592 / 88 files; Python 229; frame-defs fresh.
- Server and Chrome stopped.
- Amendment (queue): SHAPE-PARAMS is unblocked after F11 and rebases onto R7. No action here.
- Not verified live: the palette UI click path itself (the payload was replayed into the same
  handler the palette calls). The palette-side JS is covered by the headless shots and tests.


## 🔨 turn 22 — F12 (seat C, epoch 1): real wood names + SHAPE-PARAMS + Fred's panel rulings

Commits (fb-app, pushed):
- `c648eca`: merge origin/main (clean; frame-defs fresh; full vitest 1656 green);
- `52649ec`: item 1 (woods);
- `6074fd9`: items 2-3 (SHAPE-PARAMS);
- `630ef38`: the panel amendments;
- this commit: the log.

### Item 1: woods name REAL Fusion appearances (52649ec)
- **Fusion window:** the advisor granted a read-only one. One bridge call listed `app.materialLibraries`
  (Fusion 2705.1.15): no documents, no deploy, no add-in stop/start, Fred's Untitled untouched. I
  messaged the advisor the moment it returned.
- **Fixture:** `tests/fixtures/fusion-appearance-library.json` (4 non-empty libraries, 304 names).
- **Mapping:**
  - Ash, Mahogany and Pine stay "3D … - Unfinished" (they exist);
  - Cherry "3D Cherry - Unfinished" → **"Cherry"** (the only cherry, in the Appearance and Material
    libraries);
  - Maple "3D Maple - Unfinished" → **"3D Maple - Painted"** (the only maple; it is PAINTED, flagged
    for Fred: maybe a different wood fits better).
- **Migration:** `APPEARANCE_RENAMED` (frame-defs `appearance.renamed`) lets a saved project keep its
  wood; `normalizeFrameRecord` applies it. Tested in the real snapshot-load path too.
- **Unknown names are errors:**
  - `test_frame_defs` validates the declared list against the recorded library (red on the old
    list);
  - `send_frame` refuses an undeclared wood instead of Fusion silently keeping the body's material;
  - the standalone Extrude palette lists the same names (the existing equality guard).
- **Mutations:** old list 1 red, no rename in the gate 2, no wood check 1.

### Items 2-3: SHAPE-PARAMS (6074fd9)
**Design, chosen so nothing old can change:**
- **Declared params:** hourglass `waistRadius`, `cornerRadiusTop`, `cornerRadiusBottom`; bottle
  `bodyRadius`. They are in PARAM_ORDER, with ranges.
- **Defaults** (`DERIVED_PARAM_DEFAULTS`, which replaces F8's `OPTIONAL_RADIUS_PARAM`): each defaults
  to TODAY's rule:
  - the old coupled waist, `max(d − Rs, 0.5d)`;
  - the shared `cornerRadius` for both corners, so an old pattern's single corner migrates to both
    at resolve time, with no stored-data migration;
  - the shared column for the bottle body.
- **Resolution:** absent → today's rule, unclamped (feasible by construction); explicit → clamped
  into its range. The panel's sliders and handles come from `SHAPE_PARAM_KEYS`.
- **Construction:** per-side tangency (each corner meets the waist arc on its own), with the
  major-waist test generalised. `bottleConstruction` is extracted so the solver and the handles
  share one copy of the algebra.

**Frames: "never get the new params".** `computeParamHandles` takes the consumer's keys. The Shape
Lattice passes `SHAPE_PARAM_KEYS`; frames pass their binding table's keys, so they still get
`cornerRadius`. Frame outlines are unchanged: the migration fixture includes the frames' fitted
inputs.

**The sweep found two real holes in the new param space; both are fixed in the DECLARED ranges:**
1. **Closed notch.** At 2S = d the notch half-span is 0 and the waist arc has no length (NaN
   radius). The tangency floor is now strict (+ε), in the waist and corner ranges.
2. **Keyhole.** A MAJOR waist (R + Rw < d) swings each corner arc past its own vertical extreme, so
   the notch must hold both: dy ≥ R per side. This gives
   - `Rw ≥ (d − Rs)²/2d`,
   - `R ≥ d − sqrt(2d·Rw)` (while Rw ≤ 2d).

   Today's derived rule always satisfies it (dy = sqrt(2d·Rs) ≥ Rs); the migration and the "resolved
   inside range" test confirm it.

**Tests:**
- **Migration:** 128 cases recorded from the generator BEFORE the change reproduce to 1e-9.
  - Covered: both presets, jitter-only, each old param pinned, random explicit params, 4 boards,
    3 strokes, plus the frames' fitted inputs.
  - A start angle is compared modulo 2π: 20 cases flipped exactly 2π at atan2's branch cut, the same
    arc.
- **New-param dense sweep** (together, and each ALONE): more than 10k hourglass combinations,
  clean and honoured exactly.
- The pinned handle/slider tests now read `SHAPE_PARAM_KEYS`. The F5 slider test moved to the
  bottom corner, the one that actually loses room with a low waist, and checks top ≥ bottom.
- **Mutations:** waist default 48 red; top-corner default 67; corner keyhole 1. The waist keyhole
  **survived at first**: the sweep always set all three params, so the corner bound caught it. Adding
  the single-param sweep (only the waist moved) makes it red.

**Real drags** (PointerEvents on the canvas, desktop + mobile touch): every new handle moved its
value, with no defects. Shots: `*_F12shape_*` (hourglass: before + after top corner / bottom corner
/ waist radius; bottle: before + after body shoulder).

**Swept:** `tools/repro/shape_lattice_fred_case.mjs` still drove the removed `shapeParam-cornerRadius`
slider, so it now sets both corners to Fred's 0.432. No other caller of the retired id.

### Fred's panel rulings (amendments; 630ef38)
- **Order:** Boundary → Contour [checkbox, stroke, shape preset + sliders, Segments] → Rails → Ties
  → Nodes.
- **Markup moved only:** no id renamed, no wiring changed. The two blocks are sub-blocks of the ONE
  Contour section, so the collapser doesn't treat them as sections.
- **Shape seed:** the field is hidden (kept, saved, same id). **The dice button stays visible**: in
  the code, the Generate button re-rolls only the FILL seed, so the dice is the only way to roll a
  new shape. The amendment said "Generate still re-rolls it", which does not match the code. **Open
  for Fred:** should Generate also roll the shape?
- **R7's guard** ("Shape/Segments still come before Boundary") is INVERTED to the new ruling (red on
  the pre-move markup, 2 of 15). Stale comments about the old position were fixed.
- Shots: `*_F12panel_*`.

### Gates / processes
- Final: full vitest 1789 / 92 files; Python fast tier 242; frame-defs fresh.
- Server and Chrome stopped. Capacity fine.


## 🔨 turn 24 — F13 (seat C, epoch 1): FRAME-GEN

Commit (fb-app, pushed): `a830598` items 1-3 · this commit: the log. No Fusion (seeds proven live in F11).

### Item 1: [Generate]
- **`generateFrameSeeds(tpl, region, seed, t)`** (pure, `editor/frame-handles.js`):
  - every SEEDED handle of the template is drawn in PARAM_ORDER, inside its feasible range and
    conditional on the ones drawn before it (so F5's and F12's bounds hold);
  - values come from the declared band `FRAME_GEN_BAND` = [0.1, 0.9] of each range. That is a
    design choice, not a guard: every value in the range is valid, and the band keeps generated
    frames off the extremes;
  - the draw is the solver's own seeded one (`seededUnit`, now exported), so there is one PRNG;
  - the results are written as the handles' seeds (the F9/F11 path), so [Send frame] builds exactly
    what is shown (tested: payload seed geometry == the drawn shape).
- **`genSeed`** in the frame record (additive; the gate keeps an integer) makes a shape
  reproducible. A template change resets it along with the seeds.
- **Found by the 200-generate test:** a valid OUTLINE can still be an invalid FRAME.
  - ~5% of T1 draws had a waist deep enough that the frame's two inward offsets cross at the
    centreline, closing the frame's opening. Measured: seed 3, waistReach 0.78, a 1.44 in pinch for
    2 × 0.75 in of frame. T2 has the same with narrow necks.
  - The Shape Lattice ranges can't know the frame thickness, and a handle drag could reach the same
    value.
  - **Fix, declared:** `FRAME_MIN_OPENING_IN` = 0.25 in, and `frameParamRanges()` narrows
    `waistReach` / `neckWidth` by the frame thickness: `hw − d − t ≥ 0.125` for the waist, and
    `nhw − t ≥ 0.125` for the bottle neck. Used by Generate AND by the frame handles' drag clamp
    (`frameHandles(tpl, prof, t)`, with the record's thickness).

### Item 2: tweak + Undo
- **The Frame tab's own history:** Generate, a handle drag (one step at press) and a template change
  are each one step.
- **Controls:** `[Undo]` (disabled when empty) and Ctrl/Cmd+Z while the Frame tab is open. The
  artwork's undo is locked there since F8, so the two histories never mix.
- **Behaviour:** a tweak keeps `genSeed` (it is still that generated shape, tweaked) and persists
  through save/reload.
- **Guard:** the keydown listener is wired once per page (`initFramePanel` can run again).

### Item 3: tests + shots
- **`tests/frame-gen.test.js`:**
  - 200 generates per template: all valid frames (outline + inner edge), every value honoured
    unclamped inside its range, all 200 distinct;
  - same seed → same shape; the band;
  - the opening rule (a drag past the centreline stops exactly at the minimum opening, and the inner
    edge stays clean);
  - generate → real shield drag → save → reload → Undo → Ctrl+Z → empty;
  - template reset + Undo brings the shape back; payload == the shown shape.
- **Mutations:** no frame rule 4 red; no drag clamp 2; no undo step on drag 1; no `genSeed` reset 1.
- **Shots:** `*_F13gen_*`. T1 + T2 × desktop + mobile: 3 generated shapes (real [Generate] clicks,
  all defect-free) + 1 tweaked by a real pointer drag; Undo enabled afterwards.

### Notes
- The `stamp-editor/` copy of `editor-frame-profile.js` is generated by `sync_stamp_bundle.py` and is
  not tracked, so nothing to keep in step here.
- Gates: full vitest 1799 / 93 files; Python fast tier 242; frame-defs fresh.
- Server and Chrome stopped. Capacity fine.


## 🔨 turn 26 — F14 (seat C, epoch 1): S6 declared features + S8 waist inversion (live)

Commits (fb-app, pushed): `5d2f541` S6 + S8 · `7b3df08` the wood amendment + dice ruling · this
commit: the log. Fusion window used (F11 rules): tagged scratch docs only, each closed by its own
handle. Fred's "Untitled" was never touched. MAIN redeployed and verified at the end.

### Item 1: S6, the extruder reads the DECLARED features
- **`fb_engine/declared_profiles.py`** (pure). A sketch-3 profile is known by the FrameBuilder.ID of
  its curves (`profileLoops → profileCurves → sketchEntity`):
  - it touches the declared `surround` curve → the `trim` feature;
  - it touches an `outline` curve → a `bars` feature. The bar is the miter split in outline order
    (each miter starts a bar), named by `bodyNames`;
  - it touches neither → the opening, no feature.
  - `extrude_plan` takes op, start (`frame_height_offset` → the synced parameter, else the literal),
    extent (toFace + offset / throughAll), taper, and the build order from the feature.
  - A profile the declaration can't place (two bars fused, stray ids, a missing feature) is logged
    as NOT BUILT. It is never guessed.
- **Wiring:**
  - `frame_engine._create_incremental_component(style_id)` stamps `FrameBuilder.TemplateId`.
  - `solid_coordinator._declared_frame` resolves that template's "Frame" block and passes it as
    `extrude_profiles(..., declared=)`.
  - The bbox classifier stays only when there is no stamp (stated, and logged).
  - Both paths now build the same per-profile plan. `_build_extent_defs` is gone (it had no other
    caller).
- **MEASURED, why "neither" and not "inner ids only":** at T2 12x6 the opening's 10 inner curves
  carry NO id. The offset step tags them (log: "Assigned ID=inner_…"), then Fusion re-solves the
  offset later in the build and the replacement curves lose the attribute. The goldens' inner ids
  are therefore not reliable per build.
- **Live, flat core (the S4 goldens' declared core), T1/T2 × 7x9/12x6:**
  - every bar volume and the panel volume equal the golden (ΔV 0.00000);
  - the timeline is healthy;
  - the declared role equals the old bbox role on every profile;
  - the real profile ids + areas are recorded in `tests/fixtures/frame-profiles-live.json`, and
    `test_declared_profiles_live` classifies them to the golden's bars (area × 1 in = volume).
  - Unstamped fallback (stamp deleted before the solid build): also exact, and the log shows the
    bbox path.
- **Live, the real app payload (F11 capture), both Send orders:**
  - T1: B-spline → frame, then B-spline re-send → frame. Identical bars, one Frame_1, one TRIM_CUT,
    healthy, order body → frame block → inlay.
  - T2: the same, at Trim offset 0.25 (0.5 inverts, see S8).
- **My own slip, recorded:** I hid every body for a screenshot, and the next trims failed with "No
  target body found": automated cut participants skip hidden bodies. I turned them back on and the
  trims came back. It was not a code bug.

### Item 2: S8, the waist inversion, REPRODUCED and FIXED
- **Reproduced by accident with the app's own payload:** T2, 7x9, `boundingboxoffset` 0.5 (F9's Trim
  offset), thickness 0.75, no seeds.
  - The waist arcs cross into an X, and `horn_TL` ends up at x = +3.757 (outside the ±3.0 safe
    zone).
  - The timeline is HEALTHY.
  - 0 bars: the declared extruder refused the 3-bar profiles. The old bbox path would have extruded
    two bogus "frame_top" bodies.
  - Shots: `2153_F14s8_T2_payload_sketch2`, `2204_…_PRE`.
- **Declared sweep** (flat core, sketch only; T1/T2 × 7x9, 12x6, 9x7, 6x6, 10x14 × bbox 0.25 / 0.4 /
  0.5 / 0.75 / 1.0):
  - **16 of 50 inverted:** T2 from 0.5 on 4 boards (10x14 from 0.75), T1 at 1.0 on 7x9 and 12x6.
  - 0.25 and 0.4 never inverted.
- **Cause:** the p02 seeds are fractions of the whole board (`widthIn * 0.464286` = 3.25 = the
  safe-zone corner on 7 in, at bbox 0.25). They were fit at 0.25 and don't follow a smaller safe
  zone, so the coincident constraints drag points across and the solver takes the mirrored branch.
- **Fix, declared:** `fb_engine/seed_basis.py`.
  - The sketch-2 seeds (Line/Arc3Point Points, the temporary seed Radius) are fractions of the seed
    board, `(widthIn − 2*(boundingboxoffset − 0.25 in))`. Both templates apply it in
    `get_template_logic`.
  - It references existing params only, and adds no Fusion param.
  - At 0.25 it gives exactly the old seed at every size (unit-tested over 4 boards).
  - Sketches 1 and 3 keep the board. F11's `seed_geometry` still overrides the mapped seeds after it.
- **After the fix:**
  - the sweep gives 0 of 50 inverted, all healthy;
  - the post-fix bbox-0.25 builds match the goldens (T1/T2 × 7x9/12x6) with a point delta of 0.0 in.
- **The failing golden:**
  - `tests/fixtures/frame-inversion/template_2_7x9_bbox0.5.json` was recorded by
    `record_frame_parity.py`, which now takes `params` (recorded in meta) and `scratch_tag`.
  - Recorded PRE-fix, `test_frame_inversion` was red 2/2 (inverted; 0 bars).
  - Re-recorded post-fix, it is green: 4 bars, healthy.
  - The invariant (`fb_engine/outline_invariants.py`): left curves at x ≤ 0, right curves at x ≥ 0,
    and every point inside the safe zone.
  - It applies to the goldens a Send can produce. FRAME_FIT-refused boards are skipped with the
    reason, because T2 5.51x1.97's arcs overshoot by 0.045 in with the sides intact (a known
    degenerate case).
- Per Fred's rule there is NO runtime guard. FB-APP-DESIGN §4 step 5 is marked dropped, and §5.3
  item 9 is rewritten with the evidence.

### Mutations (restored from my copies; pyc cleared)
- **S6/S8, 10 mutations:** no surround rule 6 red; wrap to bar 0 1; multi-bar accepted 1; start
  ignores the declaration 1; opening needs ids 3; coordinator never declares 2; no TemplateId stamp 1;
  no seed board 3; seed fit bbox 0.3 1; radius seeds skipped 1.
- **Woods, 4 mutations:** Cherry back on the list py 5 / js 2; an unlisted wood kept js 2; Oak colour
  missing 1; Oak missing from the Extrude palette 1.
- **Pre-change tree:** the new test modules import modules that don't exist yet. The S8 golden red
  was shown on the recorded pre-fix build.

### Amendments absorbed
- **Woods (Fred: "keep only 3D grain ones", "yes oak"):** Ash (default), Mahogany, Pine,
  "3D Maple - Painted", "3D Oak - Painted".
  - Cherry is out. A saved Cherry frame gets Ash through the gate's existing unlisted→default rule
    (migration test).
  - I first built an `APPEARANCE_RETIRED` map, but mutation showed it changed nothing (the fallback
    already lands on Ash), so I removed it. The old rename `3D Cherry - Unfinished → Cherry` went
    with it.
  - New tests: "3D " prefix + in the library, and Fred's exact list.
  - Oak has a preview colour (#b88a55) and an Extrude palette option. Oak was applied live on all 4
    bars.
- **Dice (FYI):** recorded in FB-APP-DESIGN: keep it, the dice re-rolls the outline, Regenerate
  re-rolls the fill.

### Notes
- **Sweep of Cherry references:** only migration text is left (the tests and the F12 history
  comment).
- **Bridge:** I sent 3 sweep chunks in parallel by mistake. All 3 replies timed out, but Fusion
  finished all 50 cases (the JSONL is complete), no doc was left open, and the next call answered.
  Lesson: one bridge call at a time.
- **MAIN redeploy:** MAIN's worktree carries another seat's uncommitted editor work (the snap
  resolver: `editor-snap-resolver.js`, editor-*.js), so that is what is deployed now.
- **Gates:** Python fast tier 279 passed / 2 skipped; frame-defs fresh; frame JS specs 133/133 (13
  files). The full suite is the advisor's gate.
- **Shots:** `seatC/*_F14s6_*`, `*_F14s8_*`.
- **Capacity:** fine.


## 🔨 turn 28 — F15 (seat C, epoch 1): formula fields for the remaining numeric fields

Commits (fb-app, pushed): `1c3b1ca` items 1-4 · this commit: the log. NO FUSION. No deploy.

### Item 1: the stamp layer transform (tx / ty / rotation / scale)
- **One attach path:** `bindLayerOnlyNumber(inputId, sliderId, field, { formulaScope })`
  (`main/stamp/_dom-binders.js`) calls `attachFormula` on its number input. It is the same binder
  every sidebar formula uses, not a copy.
  - The binder's own `input`/`change` listeners stay unchanged: `attachFormula` holds formula text
    back and commits a plain number through them, so the slider, the remask and the undo snapshot
    all behave as they do for a typed number.
- **Declared:** `STAMP_TRANSFORM_FIELDS` in `main/formula-fields.js` (id, layer field, name
  x / y / rotation / scale).
  - `transform.js` now builds its 4 binds FROM that table, so there is one source.
  - `stampTransformScope(activeLayer)` = the stock names + the ACTIVE layer's own values, read live.
    A layer switch changes what `x` means, which the test checks.
- **Where the value lands (measured in Chrome):** in `window.svgEditor._layers[activeLayerIdx]`, the
  single tooling store since SE5a. My first readback of `P.stampLayers` looked wrong for that
  reason; the binder's own accessor is what the driver reads now.

### Item 2: sculpt Strength / Hardness, which had NO write path
- **Stated as asked:** there was no file:line that writes them.
  - `bindControls` (`main/ui-bindings.js:29-40`) binds each P key to `INPUT_PAIRS[key] || key`.
    The P keys are `sculptTopStrength` / `sculptBotStrength` (`core/state.js:88,94`, read by
    `core/sculpt-interaction.js:55`).
  - The CAD restyle `5842d90` (2026-04-20) renamed the inputs to `sculpt{Top,Bot}Hardness`, and
    nothing aliased them. It also changed the range from 0.001–0.1 to 0–1, value 0.5.
  - **Effect:** the field and slider did nothing. The brush always used 0.03 / 0.008 while the field
    showed 0.5.
- **Fix, declared (no new code path):**
  - `INPUT_PAIRS` maps `sculptTopStrength → sculptTopHardness` (and bottom); `SLIDER_PAIRS` points
    at the `…HardnessSlider` ids. `bind()` and `syncUItoParam` both read these.
  - The markup takes the brush's real range, 0.001–0.1 step 0.001 (`dZ = -screenDY * strength`,
    in/px; 0.5 would be enormous), defaulting to the P values.
  - Then the fields are attached like the other SCULPT fields, with the name `strength`.
- **Behaviour change for Fred:** the Strength field now actually changes the brush. It starts at the
  brush's real default (0.03 top / 0.008 bottom), not the fake 0.5. Saved projects already carry
  the P values, so nothing to migrate.

### Item 3: Frame bottom (z) + Frame thickness
- Both join the FRAME section, next to Trim offset. Names: `trim`, `bottom`, `thickness`, all
  reading the frame record live.
- Frame bottom commits through `frame-panel`'s own `change` handler (`frameBottomZ`). Thickness
  commits through the `FRAME_PARAM_FIELDS` handler and clamps to the template's 0.25–1.5 (min/max
  put on the input by `syncFramePanel`).
- The thickness field is the editor Frame tab's `editorFrameThickness`, the only thickness field
  there is.

### Item 4: tests + shots
- **`tests/formula-fields-f15.test.js`** (14 tests), through the real paths:
  - `initTransform → bindLayerOnlyNumber` on a live active-layer accessor;
  - `initFramePanel` + `attachFormulaFields`;
  - the declared alias + `syncUItoParam`;
  - the markup range.
  - Per field: a formula evaluates, a result clamps (rotation 270 → 180, scale → 0.1, thickness →
    1.5 / 0.25), a bad formula keeps the old value, and the dropdown lists the declared names.
- **`tests/formula.test.js`:** the R2 guard "never declares frameBottomZ / stamp / hardness" could no
  longer fail, so it is INVERTED. It now asserts the F15 fields ARE declared, that the stamp
  transform is not a sidebar P field (it lives on the layer), and that the only `editor*` id is the
  Frame tab's thickness.
- **Real Chrome (`tools/repro/formula_f15_shots.mjs`, real key events, desktop + mobile touch):** every
  check ok:
  - stamp X = width/4 → layer tx 1.75;
  - rotation+500 → 180;
  - `x+*` kept;
  - strength\*2: 0.03 → 0.06, and strength\*100 → 0.1;
  - bottom = -height/9 - trim → -1.25, and a bad formula is kept;
  - thickness width/10 → 0.7.
- **Found by the mobile shot:** the formula dropdown ran off a 390 px screen's right edge, hiding the
  values (`2229_F15_mobile_stamp`).
  - Fixed in the shared binder: `popupLeft` keeps the preview and dropdown inside the viewport
    (`core/formula-field.js`).
  - This affects every formula field, and is an improvement for all of them.
  - Shots after the fix: `2230_F15_mobile_*`, `2232_F15_desktop_*`.
- **Mutations (restored from my copies), 9 of 9 killed:** transform passes no scope 5; binder never
  attaches 5; layer scope not live 1; no hardness alias 2; old slider id 1; frame bottom not
  declared 4; hardness not declared 2; popup not clamped 1; old hardness range 1.
- **Pre-change tree:** the new test imports `STAMP_TRANSFORM_FIELDS`, which doesn't exist there.

### Notes
- **Sweep:** the formula-fields header comment is rewritten (the old "deliberately NOT here" list is
  now covered). There are no other references to the old `sculptTopStrengthSlider` id.
  `stamp-editor/` is generated and untracked.
- **Seat A:** the edits are in `ui` files seat A doesn't hold for H1 (`state.js` INPUT_PAIRS,
  `formula-*`, `stamp/*`, the sculpt and stamp markup). Not the toolbar, not the drag/snap paths,
  not `lattice-piece-panel.js`.
- **Gates:** the 21 spec files that import a touched module: 299/299. The full suite is the
  advisor's gate.
- Server stopped. My headless Chrome instances exited (none left with my profiles).
- **Capacity:** fine.

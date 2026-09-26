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

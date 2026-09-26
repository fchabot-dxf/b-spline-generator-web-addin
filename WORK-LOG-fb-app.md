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

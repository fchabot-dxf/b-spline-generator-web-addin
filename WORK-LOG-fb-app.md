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

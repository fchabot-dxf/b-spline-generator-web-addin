# Inset Window (T82 item 2/6): the live Fusion check

**DONE, T82 item 6 (live build, 2026-10-02).** No Fusion build existed as of T82 item 5 — this seat (B)
built the APP half only (data shape, 2D/3D preview, drag UI, the geometry every consumer shares) and
verified it there. The Fusion/CAM half (§5 of INSET-WINDOW-DESIGN.md) is T82 item 6, built directly by seat
B once a Fusion bridge became available this session (this file originally assumed it would be handed to a
different seat; it wasn't). The live check below ran via `fb_engine.send_frame.send_frame()` directly
(the real collaborators: `frame_engine.build_sketch_logic_v3`, `solid_coordinator.build_solid_logic_v3`),
against a simple stand-in "B-spline panel" body (not the real terrain generator) -- see §3 for why that
needed its own fix, and what it does and doesn't prove.

## 0. What exists today, and what doesn't

**App side (done, tested, A/B-confirmed byte-identical when off):**
- `core/inset-window.js`: `insetWindowGeometry(record, frameThickness, panelLip, widthIn, heightIn)` — the
  ONE declared geometry function (outer/inner/hole rectangles, board-local), null when disabled or
  geometrically invalid. `insetWindowOuterRect(rec, widthIn, heightIn)` is the ONE place the record's own
  centre-based storage converts to that board-local form.
- `core/frame-record.js`: `record.insetWindow = {enabled, cx, cy, w, h}` (T82 item 5: `cx`/`cy` the window's
  own centre, inches, from the BOARD CENTRE, +y UP -- Fusion's own sketch convention, so the Fusion side
  below reads it directly, no corner conversion), normalized (type-checked) but NOT clamped against the
  frame or board (Fred's own ruling, design note §3). An OLD-shape record (`{x1,y1,x2,y2}`) migrates on read.
  Carried in `framePayload()`.
- 2D editor (Frame tab): the window's own outer/inner rectangles drawn, a dark cutaway for the hole, drag to
  move (body) or resize (any corner) — `main/frame-panel.js`'s own `_wireWindowDrag()`.
- 3D preview: the hole is a real absence of panel mesh — an EXACT clip against the hole rectangle
  (`core/preview/frame-mesh.js`'s own `applyFrameToPanel`, `_polyMinusRect`; T82 item 3 replaced the
  original whole-triangle centroid cull, which left a jagged terrain-grid-shaped edge), with a wall at the
  hole's own edge so it reads as a real cut, not a flat decal. **T82 item 3 (superseded the line below):**
  the window's own 4 bars ARE now drawn in the 3D preview too, in the frame's own material, between the
  window's outer/inner rectangles — their top follows the panel's own underside and their bottom is that
  underside offset down by `frame_height_offset` (so they sit behind/under the panel by construction and
  are hidden from the front by the panel's own overhang, never visible from the top/front view, but visible
  from the back/side/bottom — matching Fred's own phone shot and what a real Fusion build will look like).
- Sidebar toggle: "Inset window" checkbox, off by default, in the FRAME panel.

**Built and live-confirmed:**
- The Fusion sketch geometry (outer + inner RectangleCenter, 4 corner miters; a 3rd hole rectangle only when
  `panel_lip > 0` and it wouldn't clamp shut) — `fb_engine/inset_window.py`, design note §5 step 1-2.
- The 4 new bar bodies (`frame_window_top/bottom/left/right`), same `Frame_N` component as the main bars,
  same Z rule (`frame_height_offset` start, `core.underside` extent) — design note §5 step 3.
- The hole cut feature (`window_cut`, a through-all pocket), with its own distinct timeline name
  (`t1_WINDOW_CUT`, confirmed live — does NOT collide with the main `t1_TRIM_CUT`) — design note §5 step 4.
- `declared_profiles.classify()`'s window-aware branches — design note §5 step 5 (corrected TWICE; the first
  live build caught a real bug the fake-Fusion tests missed, see §3).
- CAM: the `_populate_frame_geometry()` fix (`mm_builder.py`) confirmed via fake-Fusion + A/B tests (not yet
  exercised against a REAL Manufacture workspace this turn — the live check below stopped at the Design
  workspace; see "Not yet done").

## 1. Live results (2026-10-02, template_1, frame_thickness=0.75, no panel_lip)

Both board sizes: window `cx=0,cy=0`, sized to clear the window's own bars floor (`w,h > 2*frame_thickness`)
AND template_1's own hourglass waist pinch at that board size (picked empirically, not from a formula --
see §3's own overlap-case note). 7x9: `w=h=1.8`. 9x12: `w=h=2.5`.

- [x] Exactly 4 `frame_window_*` bodies, in the SAME `Frame_1` component as the main bars, built from new
  regions in the existing frame-enclosure sketch (confirmed: no second component, no new sketch).
- [x] Built bars == declared: 4 main + 4 window = 8 bar bodies at both sizes, all positive volume (smallest
  ~11-19 cm3, comfortably over the 0.5 cm3 floor), no `(1)`-suffixed duplicates.
- [x] 0 overlap between any pair of real bodies (pairwise `TemporaryBRepManager` boolean intersection, both
  sizes) -- excludes the stand-in panel itself, which the window_cut legitimately pockets into.
- [x] Timeline healthy and grouped: `Frame_1:1` occurrence -> 3 sketches -> 4 main bar extrudes -> TRIM_CUT
  -> 4 window bar extrudes -> WINDOW_CUT, in order, at both sizes (17 timeline items total, same shape both
  boards).
- [x] The hole is visible from the top (iso-top-right screenshot) and from the bottom (bottom screenshot) --
  a clean square cut through the window's own subframe, both board sizes.
- [x] The 4 corner miters are axis-aligned 45 deg bisectors (no T7-style derivation needed, confirmed by the
  exact vertex-id pairing in `window_miters()`).
- [x] CAM (Manufacture workspace): exercised live, T82 item 7 -- see §5.
- [x] Degenerate case (lip clamps the hole shut): live-tested, T82 item 7 -- see §5.
- [x] Overlap case (window crosses the main frame's own actual opening boundary, not just its bounding box):
  HIT UNINTENTIONALLY on the first attempt (a naive w=3,h=2 window at 7x9 crossed template_1's own hourglass
  waist pinch) and did NOT degrade gracefully at the time -- `classify()` raised `DeclaredProfileError` for
  every affected profile, refusing the whole build. CONTRADICTED Fred's own ruling ("ugly but not broken,
  then it's my responsibility") for this specific case. Fixed, T82 item 7 -- see §5.

## 2. What's genuinely confirmed vs not

- The DECLARED-PROFILE DISPATCH (classify/extrude_plan/CAM naming) is confirmed live, both board sizes,
  with a REAL multi-bar template (template_1, so the CAM fix's own "classic 4 bar names present" case is the
  one actually exercised, not T6/T11's already-working N-bar path).
- The STAND-IN PANEL is NOT a real B-spline terrain -- a flat box, straddling the frame's own sketch plane
  (see §3). It proves the FRAME/WINDOW's own engine code (my actual changes this turn); it does NOT newly
  prove the pre-existing underside-detection/extrude-to-face machinery against real terrain, since that was
  already proven in prior sessions' own live checks (T7, T11, panel_lip) using the real generator.
- CAM's Manufacture-workspace layout itself was NOT run live (no Manufacture setup was created in this
  scratch document) -- only the fake-Fusion `test_mm_builder_frame_layout.py` tests + the `abcam.py` A/B
  comparison confirm the `_populate_frame_geometry` fix.

## 3. Test-harness lessons (stand-in panel), for whoever builds the next one of these

Getting a believable stand-in "B-spline panel" took 3 real, measured fixes -- recorded here since the next
live check that needs one (without the real terrain generator) will hit the same things:

1. **`Point3D.create()` takes CENTIMETERS, not the design's display unit.** Passing inch values straight in
   silently builds a body at 1/2.54 scale. Always multiply by 2.54 (or build everything through
   `ValueInput.createByString('X in')`-based constructs instead of raw `Point3D` coordinates).
2. **A bar's own `start` (frame_height_offset) must land OUTSIDE/BELOW the stand-in panel's own solid
   volume, not within it.** `ToEntityExtentDefinition` with `matchShape/isChainFaces=True` (what
   `extrusion_engine.py` always passes) reliably FAILS ("the extrusion profile falls outside the boundary of
   the selected body") when the extrude's own start plane sits strictly between the target body's own top
   and bottom faces. MEASURED: a 3-inch-thick panel (start -1in, comfortably inside its 0 to -3in range)
   failed on every bar; a thin, real-panel-like 0.25in panel (start -1in, now BELOW the panel's own bottom at
   -0.25in) built every bar correctly. Make the stand-in panel THIN (a fraction of an inch), matching a real
   carved panel's own actual thickness, not an arbitrary round number.
3. **A through-all CUT's own one-sided direction depends on the profile's own winding, which can differ
   between two profiles in the SAME sketch** (MEASURED: template_1's own TRIM profile and its BAR profiles
   wind oppositely -- a shoelace-sum sign check on each profile's own longest loop confirmed it). The
   production code hardcodes `PositiveExtentDirection` for every cut; this works against a real terrain
   because real terrain has panel material on both sides of the frame's own sketch plane (Z=0) somewhere in
   its own footprint, so "search one specific way" reliably finds it. A stand-in panel built ENTIRELY on one
   side of Z=0 doesn't have that guarantee, and "positive" can search the empty side, failing with "body not
   found to extrude through" even though the panel plainly exists. Fix: build the stand-in panel STRADDLING
   Z=0 (half above, half below -- e.g. +0.125in to -0.125in), not flush with one face at the sketch plane.
   None of this is a bug in `extrusion_engine.py`/`solid_coordinator.py` -- both are pre-existing, unchanged
   this turn, and have already been proven against real terrain in prior sessions' own live checks.

## 4. What was sent back (counts, screenshots)

- Gate: `pytest` at `bspline-frame-builder/` 873 passed/25 skipped; `vitest` 3078 passed; `gen_frame_defs
  --check` fresh; A/B (`abpy.py`) hash unchanged (`88aa3aea7ef452be2e1dc27587d5733c5edb0c70f44ad1205c83d4162b5e38a4`);
  A/B (`abcam.py`) per-case: only the case with an extra `frame_*` body changed, by exactly one layout move.
- Live: 0 errors at both 7x9 and 9x12 (template_1), 8 bar bodies + 1 cut each, 0 overlap, healthy timeline,
  distinct cut names, hole visible top and bottom.
- Screenshots (scratchpad, this session): `t82i6_7x9_iso.png`, `t82i6_7x9_bottom.png`, `t82i6_9x12_iso.png`,
  `t82i6_9x12_bottom.png` (plus an early `t82i6_7x9_front.png`, a flat edge-on view of the oversized stand-in
  panel, less useful -- the iso/bottom pair is the one that actually shows the window).
- The overlap-case crash (§1) and the degenerate-lip simplification (§1) are flagged, not fixed -- out of
  this turn's own required scope, named rather than silently left.

## 5. T82 item 7 (hardening): results (2026-10-03)

All 3 flags from §1 above, closed:

1. **Overlap degrades, never raises** -- fixed in `declared_profiles.classify()`: the final catch-all now
   returns `(None, None)` (no feature, material keeps it) for a profile touching any mix of the main frame's
   own `inner` ids and ANY window-related ids (outer/inner/hole/miter), not just the window's outer loop as
   before. Narrowly targeted: a profile touching something from NEITHER set still raises. Pure tests (no
   Fusion) use the EXACT curve-id combinations measured live during item 6's own overlap crash.
2. **Degenerate lip, live-tested**: 7x9, window w=h=1.8, frame_thickness=0.75, panel_lip=0.2 (needs >= 0.15 to
   clamp `1.8 - 1.5 - 2*lip` to <= 0). Result: panel_lip param created (0.2 in), all 4 window bars built with
   the SAME volumes as the no-lip case (confirming the bars are genuinely unaffected by the clamp), zero
   `window_hole_*` curves in the sketch (confirming no hole rectangle was drawn), zero errors -- matches
   `inset_window.py`'s own documented SIMPLIFIED behaviour exactly (cuts the full inner rectangle, same as no
   lip, rather than nothing).
3. **CAM Manufacture, live, once, on a window build**: `cam_engine.cam_coordinator.run(classifier=...,
   mode='bspline', skip_templates=True, skip_machine=True)` on a 7x9 window build (template_1, w=h=1.8) built
   all 3 MMs (stock/bspline_set/frame) and all 4 Setups (Stock/B-spline Back/B-spline Top/Frame), `ok: true`,
   zero errors. The Frame MM's own snapshot held all 8 bar bodies (4 main + 4 window) with 11 move features,
   laid out in ONE continuous row (verified by sorted X-ranges: 1.31-3.0, 3.55-5.24, 5.79-6.54, 7.09-7.84,
   8.39-9.14, 9.69-10.44, 10.99-11.74, 12.29-13.04 in, each strictly past the previous, zero pairwise
   overlap via `TemporaryBRepManager`) -- the window's own 4 bars genuinely continue the main row, confirming
   the `_populate_frame_geometry`/`_lay_out_other_bars` CAM fix live, not just via fake-Fusion tests.
   Screenshot: `t82i7_cam_layout.png` (top view of MM-Frame, the 4 main bars then the 4 small window bars in
   one row).

**New test-harness lessons** (beyond §3's own 3), for whoever drives CAM live from a script next:
- A body obtained via `occurrence.component.bRepBodies` is in its NATIVE definition context; a cross-
  component extrude (the bars, built inside `Frame_1`, targeting a face on a body that lives in a SIBLING
  component like "B-Spline Set") needs the ROOT-CONTEXT PROXY instead: `occurrence.bRepBodies.item(i)`, not
  `occurrence.component.bRepBodies.item(i)`. Using the native reference fails late and obscurely
  (`EXTRUDE_CREATION_FAIL_ERROR - ... invalid argument toEntityOne`), not at the point the wrong body
  reference was taken.
- `cam_coordinator.run()` leaves the frame MM active; `app.activeProduct` then returns the CAM product, not
  the Design, so a next `FrameBuilder()`/`send_frame()` call's own `_require_board_params` fails to find the
  board params that plainly exist (it reads `Design.cast(app.activeProduct)`, which is now the wrong
  product). Reactivate the Design workspace first:
  `app.userInterface.workspaces.itemById('FusionSolidEnvironment').activate()`.
  Both of these cost one failed live round before being found -- keep this list growing for the next person.
- MEASURED, not fully explained: re-running `cam_coordinator.run()` a second time in the SAME document after
  an EARLIER run captured an empty Frame_1 (bodies added after that first run) kept producing an empty Frame
  MM snapshot on every subsequent rebuild in that document, even after `adsk.doEvents()` and confirming the
  Design itself had all 8 bodies. A FRESH document (build the frame correctly, THEN run CAM exactly once)
  avoided it entirely and worked on the first try. Flagged as an open question, not chased further under live
  Fusion time -- if it recurs, suspect the CAM product retaining some reference to the document's OWN state
  as of its first acquisition in that document, not a live link.

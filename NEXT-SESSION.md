# NEXT — seat A — H23 items 24 + 25: cross-document deletion on Send, then un-hide Template 10

**Ball: worker (seat A) · epoch 6 · H23 item 24, then item 25.** Your cf3805f was live-verified by the advisor at
6x9 AND 7x9 (4 bars each, real b-spline joined; shots `shots/seatA/h23_item23_t10_*_live_advisor*.png`). The 6x9
send also needed b98c0f5 (`UNDERSIDE_MAX_NORMAL_Z` -0.9 -> -0.7, measured). Items 21-23 are closed.

⚠ **The main checkout holds seat B's UNCOMMITTED inset-window WIP** (`bspline_gen_palette.html`,
`editor/editor-frame-profile.js`, `main/frame-panel.js`, `tests/inset-window-handles.test.js`). It is NOT yours:
never `git add -A`/`commit -a`, never checkout/stash/discard those paths. Commit BY PATH only. If item 25 needs to
edit `frame-panel.js`, stop and tell the advisor first instead.

## Item 24 — Send deletes the previous B-Spline Set in ANOTHER document (data loss, top priority)
MEASURED twice by the advisor (2026-10-01): with doc A active, a real Send built a B-Spline Set in A; then a NEW doc B
was created/activated and a second Send ran there -> doc A's B-Spline Set was DELETED. Cause:
`b-spline-gen.py` `_remove_last_import()` deletes `last_imported_occurrences`, an in-memory module list that
remembers occurrences from whatever document the LAST import happened in. Fred's own open doc survived only because
its set predates the current add-in process.
- Fix at the cause, the declare way: the previous import is found by its TAG (`_bspline_set_occurrences(des)`
  already exists and is document-scoped) in the ACTIVE design only. The in-memory list must never be the source of
  a deletion; if it is still needed for anything else, it must be keyed by / checked against the active document.
  Check every caller of `_remove_last_import` (append/preview paths included) and `current_import_group`.
- Test first (fake-Fusion, pure python, like `fb_engine/test_send_frame.py`'s World): two documents, import in A,
  switch to B, Send in B -> A untouched. Mutation-test it.
- Live check through the real handlers (`PaletteHTMLEventHandler()._handle_generate(payload)` with a payload
  captured by `tools/repro/capture_send_payload.mjs`; a scratch copy with a longer 15s load wait is what worked last
  night): fingerprint two scratch docs (user parameter), Send in A, new doc B, Send in B, confirm A keeps its set.
  Close ONLY your fingerprinted docs, by handle. Deploy from a clean scratch worktree at origin/main, NOT this
  checkout (it holds seat B's WIP).
- Commit as 'H23 item 24: ...', PUSH immediately.

## Item 25 — un-hide Template 10
- `FRAME_HIDDEN = False` in `template_10/template_data.py`, `python tools/gen_frame_defs.py`, full suite
  (vitest + the three pytest roots) + `gen_frame_defs --check`. T1-9 picker entries must be unchanged.
- Shot of the picker showing T10, and a fresh Generate at 7x9 (served app, headless), to `shots/seatA/`.
- Commit as 'H23 item 25: ...', PUSH immediately. Then pass back with explicit test counts (state any known
  failure counts in the pass note itself).

## Item 26 — `FrameBuilder()` without `external_logger` crashes (after 25)
`fb_engine/frame_engine.py:133` calls `logger.DebugLogger(addin_root)` — `logger` there is the module-level logger
INSTANCE, not the `fb_logger` module (line 45 uses `fb_logger.DebugLogger` correctly). One-line fix + a test that
constructs `FrameBuilder()` with no logger under the fake adsk. Seat B's finding. Commit 'H23 item 26: ...', push.

## Item 27 — Template 7's arc chain has the same crossed welds T11 had (after 26)
Fusion's `SketchArc` start/end ALWAYS run counter-clockwise (fusion360-quirks skill, section 1 — read both new
entries first). T7's body arcs run clockwise in loop direction, so `p02_03_welds.py`'s `arc_body_R:E -> side_R:S`
(and the mirror) join the wrong physical ends; T7 has never been live-built. Apply the T11 recipe that built exactly
(lane-b 5cd8e76; read its p02_02/p02_03/p02_04 + `fb_engine/test_t11_fusion_expressions.py`):
- each arc's middle seed point is its TRUE arc midpoint in closed form (fb_engine/t7_geometry.py has the circles),
  not a sideways-pushed chord hint; no seed Radius dimension; no 0.001-in nudges;
- welds declared against the CCW rule (table in the docstring); a pure-python test that derives each arc's
  physical :S/:E from the sign of its 3-point turn and checks every weld joins coincident points;
- live build through the real engine at 7x9 and 9x12 with `tools/repro/fusion_t11/live_build_readback.py`
  (`git show origin/lane-b:tools/repro/fusion_t11/live_build_readback.py` — copy it, point FB at a clean worktree);
  every arc within 1e-4 in, 5 miters OK. Sketch shots to `shots/seatA/`. Then T7's LIVE_CHECK.md items.
Commit 'H23 item 27: ...', push.

**Item 27, part 2 — declare it for EVERY template (Fred: yes).** Generalise T11's two pure-python checks into ONE
parametrised test over all templates (discover them the way gen_frame_defs does), at 7x9 + 9x12 + 6x9:
1. **Weld orientation:** evaluate every sketch-2 Line/Arc3Point's Points (expressions -> numbers, with
   widthIn/heightIn/boundingboxoffset), derive each arc's PHYSICAL :S/:E from the sign of its 3-point turn (CCW ->
   as declared, CW -> swapped; fusion360-quirks), resolve projected anchors, and assert every Coincident weld joins
   two coincident points (tolerance = the template's own nudge, so T1's existing 0.001 convention isn't a false
   failure; say which templates still carry nudges).
2. **Seed midpoint:** each Arc3Point's middle point lies on the circle through its ends at the angular midpoint
   of the intended (minor unless declared major) branch -- REPORT (xfail with the measured offset), don't fail,
   for templates whose hint-seeds still build correctly live today; T7/T11 must pass.
3. **Convex radius vs bar (advisor probe C1/C2, 2026-10-02, fusion360-quirks):** every CONVEX arc radius of each template's DEFAULT outline must exceed frame_thickness at 6x9/7x9/9x12. At or below it, Fusion's addOffset2 refuses the whole enclosure loop and the engine silently falls back to a non-parametric offset with fewer curves (T11 7x9: shoulder/hip 0.715 < 0.75 -> 9 curves instead of 13; very likely T10 item 21's same root). Report every template/size that fails; don't change shapes here -- the advisor decides per template.
Expected: T7 fails check 1 until its weld fix lands (that's the point). List every other failure in the pass note
with the exact template/weld -- fix the ones that are clearly crossed welds, ask before touching anything that's
live-verified today (T1-T6, T8, T10).

## Item 28 -- building-step cleanup, from the advisor's step-removal A/B (2026-10-02, after item 27)
Measured with `tools/repro/fusion_t11/step_removal_ab.py` (lane-b; real engine, baseline vs one step type removed,
every tagged curve of sketches 2-3 compared, baseline reproduces itself exactly):

| step | T1 7x9 | T1 9x12 | T8 9x12 | T10 9x12 | verdict |
|---|---|---|---|---|---|
| Pulse | identical | identical | identical | identical | **REDUNDANT -- remove** |
| 0.001 nudges | outline identical, frame differs* | identical | identical | outline identical, FRAME DIFFERS 2.18 in | KEEP until T10's frame dependency is explained |
| seed Radius + DeleteDimension | outline moves 2.6 in | - | 0.09 in | 0.14 in | **load-bearing (seeds are rough) -- keep** |
| Equal | 0.014 in | 0.024 in | identical | 0.061 in | keeps left = right -- keep |
| Horizontal / Vertical | 2.97 in | - | 4.06 in | 4.04 in | **load-bearing -- keep** |
*T1 7x9's frame always goes through the silent non-parametric offset fallback, even in the baseline (see below).

**ORDER (Fred): STABILISE FIRST. Pruning for speed is a separate, later item (29) -- do NOT remove any step in item 28.**

**Item 28 = STABILISE the findings (Fred: "stabilise what you found now"), so none can silently regress:**
(1) make the parametric-offset fallback LOUD: when `offsets.py` falls back from addOffset2 to sketch.offset, record it
in the build result (`fit`/send result gets e.g. `offsetFallback: [sketch names]`) and log it at ERROR, not WARNING;
fake-Fusion test. Don't change the fallback itself. (2) turn item 27 part 2's report-only check 3 into a DECLARED
known list: the test asserts the exact set of (template, size) whose convex radius <= frame_thickness equals a
`KNOWN_CONVEX_RADIUS_BELOW_BAR` declaration (today: T1/T3/T4/T5/T8/T10 at 6x9 + 7x9, plus whatever T7/T11 give) --
a new template or a shape change that adds one trips the test; fixing one shrinks the list.

## Item 29 -- prune for SPEED (LATER: only after item 28 is merged, and only with timing evidence)
Fred: "stabilise before focusing on actually pruning with speed intention". First TIME a real Send stage by stage
(panel import, stamps, each frame sketch, extrusions, trim; replay a captured payload through `_handle_generate`) --
measured 2026-10-01: the frame part takes ~16 s of a 25 s Send in a real document vs ~1-2 s in an empty one, so the
cost is per-step recompute next to the heavy panel, not step count alone (try deferring compute across the whole
build). Then prune where the timing says it pays: Pulse (A/B: identical on T1/T8/T10), and the nudges only once the
T10 frame dependency (stripping them moves T10's inner horn 2.18 in) is explained. Each removal re-checked with
`tools/repro/fusion_t11/step_removal_ab.py` on two templates at 7x9 + 9x12.

## Item 30 -- CANCELLED (Fred chose WARN ONLY: no convex-radius guard; the Frame editor's red warning, T82 item 4, is the whole answer). Kept for the record -- was: PREVENT, don't detect: the add-in must never hand Fusion geometry that errors or falls back (after 28)
Fred: "the goal is that the add-in produces no errors". Today's biggest known violation: the hourglass family
(T1/T3/T4/T5/T8/T10, and T11/T12/T13 as they land) at 6x9/7x9 has a convex shoulder/hip radius (0.643) below
frame_thickness (0.75), so every such Send makes Fusion's addOffset2 refuse and the engine fall back (non-parametric,
fewer curves). Prevent it in the APP, before Send, keeping the user's thickness and clamping the SHAPE:
(1) Generate's isValid rejects any outline whose smallest convex radius <= frame_thickness + 0.05 (same retry pattern
as cf3805f's reflex-arc gate; re-measure GENERATE_MAX_ATTEMPTS); (2) the radius handles clamp at that floor;
(3) the template DEFAULT/fitted shape at small boards clamps the corner radius up to the floor (declare the floor
once, e.g. CONVEX_RADIUS_MARGIN_IN, next to frame_thickness; the app's smallestConvexArcRadius from T82 item 4 is the
measure). (cancelled) Done = item 28's KNOWN_CONVEX_RADIUS_BELOW_BAR list is EMPTY for every shipped template at 6x9/7x9/9x12,
AND a live Send of T1 at 7x9 (real captured payload) builds with ZERO fallback/warning lines in the engine log
(tools/repro/fusion_t11/live_build_readback.py counts them). Shapes change slightly at small boards (rounder
shoulder/hip) -- shots before/after at 7x9 for Fred. Commit 'H23 item 30: ...'.

**Separately, for the advisor + Fred (not this item):** your item 27 part 2 check 3 plus this A/B prove that the
SHIPPED hourglass templates (T1, T3, T4, T5, T8, T10) at 6x9 and 7x9 have a shoulder/hip radius (0.643) below the bar
(0.75), so EVERY such Send builds the frame through the non-parametric fallback (logged as a WARNING only).

## Item 32 -- "no errors": every Send leaves timeline group "Group1" UNHEALTHY (advisor probe, 2026-10-02)
Fred's goal: the add-in produces no errors. In EVERY live Send replayed today (T1/T10/T11/T12/T13, 6x9..12x16, real
captured payloads through _handle_generate) the timeline item "Group1" reports healthState != Healthy with an EMPTY
errorOrWarningMessage. Find what Group1 is (which feature inside it carries the warning -- open the group, check each
item's healthState/message; likely the stamp import group, b-spline-gen.py timeline grouping), why it is unhealthy,
and fix the cause (not the reporting). Also the item-29 side finding: the empty-doc T1 frame build hits
VCS_SKETCH_SOLVING_FAILED + an offset fallback that the full-pipeline run doesn't -- explain it (report; fix only if it
can reach a real Send). Tools: tools/repro/capture_send_payload.mjs (--template/--board), underside_extrude_probe.py /
send_stage_timing.py patterns. Kill only PIDs you started. No guards without Fred. Commit 'H23 item 32: ...'.

## Item 33 -- editing frame_thickness / boundingboxoffset AFTER a build silently duplicates bars (advisor probe, 2026-10-02)
MEASURED, 3 cases, timeline HEALTHY in all: replay a real Send (T1), then change a user parameter in Fusion --
6x9 thickness 0.75 -> 1.0: frame_left, frame_bottom and frame_right become the SAME U-shaped body (each 437.28 cm3,
bbox = the whole board, pairwise overlap 437.28 cm3; union 561.36 = correct total), frame_top stays right; same
signature at 6x9 with boundingboxoffset 0.25 -> 0.5, and 9x12 thickness -> 1.4 (3 bars x 882.79). Smaller edits
(6x9 -> 0.6, 9x12 -> 0.6/1.0) stay correct. A FRESH Send at 1.0 builds 4 correct separate bars (159/119/159/124,
no overlap). So the bar split (the miter cuts / body split in the solid build) does not survive a parametric
recompute past some size change. Find WHY (which feature stops splitting -- SolidCoordinator / extrusion_engine; check
each split feature's health and its tool/target references after the edit) and fix the cause so an edit gives the
same 4 bars a fresh Send would. Repro: tools/repro/fusion_t11/bar_merge_confirm.py (+ param_edit_after_build_probe.py),
results *_2026-10-02.jsonl next to them; captured payloads via capture_send_payload.mjs --template=template_1
--board=6x9. A bar-overlap check (pairwise intersection volume == 0) belongs in the readback tools afterwards.
Kill only PIDs you started; no guards without Fred. Commit 'H23 item 33: ...'.

## Item 34 -- CANCELLED (Fred: a native Fusion edit that breaks the model is acceptable -- "I can see it's broken", he undoes). Kept for the record -- was: make Fred's workflow correct: he DOES edit frame_thickness / border in Fusion's Parameters dialog
Fred (2026-10-02): "i do change it in fusion". Item 33 proved a native edit can merge 3 bars into one overlapping U
(timeline healthy) whenever the thickness passes a convex radius, on any board; a fresh Send is always correct. Not a
guard -- the goal is that his edit gives the same 4 bars a Send would. STEP 1 = FEASIBILITY, report before building:
(C1) auto-rebuild: can the add-in detect the Parameters dialog finishing (ui.commandTerminated for the parameters
command id, or a cheaper hook), read the changed frame parameters, and re-run ONLY the frame build (the Send's frame
path: delete the previous frame by attribute + build_sketch_logic_v3 + solid) with the new values? Measure the time,
confirm bars come out identical to a fresh Send (tools/repro/fusion_t11/bar_merge_confirm.py pattern), and that an
unrelated parameter edit does NOT trigger it. (C2) robust model: is there a way to split/extrude the bars so the
native recompute cannot merge them (e.g. each bar's profile bounded by its own miter lines rather than a shared
region)? Prototype in a scratch doc only. Report both with numbers; no production change until the advisor (and Fred
if it changes behaviour he sees) picks one. Kill only PIDs you started; leave UI-cowork / API-claude code open.
Commit 'H23 item 34: ...'.

## Item 37 -- underside detection is a hair-trigger bound on a 5-point average; make it robust (+ a stamp feature warning)
MEASURED (advisor, 2026-10-02, at the moment send_frame picks the face): real carved panels' true undersides score
-0.98, -0.98, -0.97, -0.95, -0.90, -0.90, -0.86 (item 23) and NOW -0.6975 (T7 7x9, payload
bspline-frame-builder/scratch/no_underside_t7.json, 402 in2, by far the largest downward face; next-best -0.548) -> the
-0.7 bound REFUSED the frame. The score (`_face_downward_z`) averages n.z over pointOnFace + the face's few corner
vertices, and a doubly-curved sheet's corners tilt -- moving the bound per new panel is whack-a-mole. Fix the METHOD:
score each face by its AREA-WEIGHTED mean normal over a UV grid (face.evaluator: parametric range, e.g. 9x9 samples,
weight by local area / or use the face's mesh normals), pick the LARGEST face whose weighted n.z is clearly downward
(e.g. the most-downward by weighted score, with an area-dominance sanity check against the top face), and keep a
refusal only for bodies with no downward face at all. Tests with fakes reproducing the measured numbers (all 8 panels'
corner-vs-mean pattern), then LIVE: replay all 7 captured payloads (tools/repro/fusion_t11/underside_results_2026-10-02.jsonl
+ underside_t7_7x9_refused_2026-10-02.jsonl list them; the T7 one above must now build its bars, min distance 0,
overlap 0) with tools/repro/fusion_t11/underside_extrude_probe.py. ALSO: on that T7 Send (and an earlier 6x9 one) the
STAMP timeline feature "Source - L4 - ballnose (0.12")" is genuinely unhealthy (a real feature, not a group) -- find
its warning text and cause (Fred's "no errors" goal); report, fix only if clearly ours. No guards. Commit 'H23 item 37: ...'.

## Item 38 -- Template 7's frame is incomplete: no roof bars + a sliver on each side (worker finding, 2026-10-02)
Fresh post-fix T7 Sends, 7x9 AND 9x12: bodies = frame_base, frame_side_left (+ 'frame_side_left (1)' 0.082 / 0.005
cm3), frame_side_right (+ '(1)' sliver); NO frame_roof_left / frame_roof_right at all. In T7_3_frame_enclosure the eave
(roof -> neck arc) miter does not separate the regions: the roof regions span 2 bars ('one profile spans 2 bars
(proj_arc_neck_L, proj_roof_L): a miter did not split it' -> NOT BUILT, silently), and a 0.02 cm2 sliver region next
to proj_arc_neck_R/L is classified as a bar. Find the cause (the eave inner corner is a line-CIRCLE corner,
t7_roof_eave.eave_inner_corner; item 27 changed T7's arcs/seeds -- check the ResolveInnerCorners direction/distance and
the miter endpoints against the live geometry) and fix it so T7 builds exactly its 5 declared bars, 0 slivers, 0 overlap,
at 6x9/7x9/9x12. THEN, for all 13 templates, extend tools/repro/fusion_t11/item35_all_templates_sweep.py (and the
readback tools): built bar bodies must EQUAL the declared FRAME_BARS names -- none missing, no extra '(1)' bodies, no
body under 0.5 cm3 -- and add the profile classifier's 'NOT BUILT' log lines to the counted failures. No guards.
Commit 'H23 item 38: ...'.

## Item 71 -- the top colour DECAL, wired into Send as an OPTION with good config (Fred, 2026-10-03)
Fred approved the item 68 decal for the real Send, optional and configurable. Declared settings (persisted with the
project, in the VIEW tab/section of the sidebar -- Fred: 'in view tab' -- a 'Fusion colour decal' group):
  - enabled: off by default
  - resolution: 40 / 100 / 150 dpi (default 150)
  - opacity: 0-100 % (default 100)
  - layers: a checkbox per artwork layer currently in the project (default: all visible layers)
On Send, when enabled: render the transparent PNG (item 68's tool, made a real module, not a repro script), send it
with the payload, and the add-in applies ONE decal to the Stamped top face (item 68's proven call), REPLACING any
earlier decal from a previous Send (dedupe proven in item 68). When disabled, remove a previous decal if present.
Errors never fail the Send: log, toast 'colour decal skipped: <reason>', and carry on. Name the decal 'Artwork
colours' in the timeline. Tests: the settings round-trip; the PNG respects the layer choice and opacity; the
Python side replaces and removes it. LIVE (holder file = f3): Send with it on (decal present, 1 only), re-Send
(still 1), turn it off and Send (0). Time added. Shots. Fusion order: de now, then you. Commit 'H23 item 71: ...'.

## Item 69 -- SPIKE: the board's EDGE colours in Fusion as a wrapped strip decal (Fred chose option A, 2026-10-03)
The top decal works (item 68). Now the board's own side edge band (~0.25 in; the same band 67d colours in the
preview): (1) app side: 'unroll' the edge colours into a long thin transparent PNG (length = outline perimeter,
height = the panel's edge band), using the SAME perimeter sampler 67c uses, so it lines up with the rim; (2) Fusion,
on the 'DECAL test - 2026-10-03' doc (it's yours; Fred has looked or will look at it -- duplicate it rather than
altering it if he hasn't said he's done; a copy named 'DECAL edge test'): apply it to the panel's side faces with
isChainFaces=True, positioned/scaled so it wraps around. Answer with shots (whole board + close-up at Fred's rim
angle + a corner): does Fusion wrap it around the band, or project/stretch it? Do the colours line up with the top
decal's rim? Seconds? If it can't wrap, say so plainly and estimate option B (split the side face at each colour
boundary + an appearance per segment) instead of forcing it. Leave the test doc open for Fred. Commit 'H23 item 69: ...'.

## Item 67d -- edge colour on the BOARD's edge only, never the frame (Fred, 2026-10-03)
Fred: "the frame shouldn't change colour, only the board edge, which is only about .25 in". Today (67c) the whole
side wall, frame included, takes the artwork colours. Restrict it to the B-spline PANEL's own side wall (its
thickness band, ~0.25 in, at whatever height the panel sits); the FRAME's walls keep their wood/appearance look,
and so does any wall below the panel. Keep 67c's alignment and crispness. Test: frame-wall vertices keep the frame
colour; panel-wall vertices take the edge colour. Before/after shots at the same angle. No Fusion. Do it now, while
you wait for your Fusion turn for item 68. Commit 'H23 item 67d: ...'.

## Item 68 -- SPIKE: artwork colours in Fusion as ONE decal (Fred, 2026-10-03). Measure, don't build it out.
Fred wants the artwork's colours visible in Fusion, the cheap way. Fusion's API has decals (checked by the advisor):
component.decals.createInput(imageFilename, faces) -> DecalInput{transform, opacity, isChainFaces,
creationOccurrence, targetBaseFeature}; decals.add(input). PNG/JPEG/TIFF.
(1) App side (no Fusion): on Send, render the artwork's colour layers to a TRANSPARENT PNG (alpha = 0 where no
    artwork; the same colours as the 3D preview) at a declared resolution (e.g. 40 px/in), board-aligned, and ship
    it with the payload (or write it next to the STEP).
(2) Fusion spike, ONE real board (a T1 Send with lattice + a striped contour): apply the PNG as a decal on the
    Stamped body's top face with isChainFaces, scaled/positioned to the board. Answer with screenshots: does the
    PNG transparency show the wood through? Does the image line up with the carved grooves (over the whole board,
    and on steep slopes)? Seconds added to a Send? Does it survive a re-Send (old decal removed, no duplicates)?
(3) Report + shots to the advisor; no wiring into the normal Send until Fred sees it.
Fusion: ask the advisor for 'Fusion free' (b5 and de go first). Commit 'H23 item 68: ...'.

## Item 67c -- wall colours must ALIGN with the rim, crisp (advisor review of 1214_item67b_after_closeup-rim.png)
Full-height wall colour is in (fd5dfd0). Two things still wrong in your own after close-up:
 1. MISALIGNED: the wall's black/white bands do not sit under the rim's black/white dashes. A black rim dash sits
    over a white wall band, and the wall bands are much wider than the dashes. Requirement: the wall colour at
    perimeter position s == the top artwork's colour at the SAME outline point s, exactly. Check the perimeter
    parametrisation the wall uses against the one the stripe/contour drawing uses (arc length from the same
    start point, same direction, same units?) and the sampling density (a 0.25 in dash needs wall vertices at
    least that dense, e.g. split at every colour boundary).
 2. BLURRY: band edges fade over a wide gradient. Use flat colour per wall segment (split vertices at the colour
    boundary, or a 1D texture with NEAREST filtering), never vertex-colour interpolation across a boundary.
Test: sample N points along the outline; for each, the wall colour (top AND bottom of the wall) == the rim colour
there (pure, no WebGL). Shots: the same two views plus a straight-on side view of one wall with the rim visible,
so alignment can be judged by eye. And re-check Fred's triangles: your 'before' rim shot does not show them, so
build his exact setup (oblique view, striped black/white contour like his 10.png) before declaring them gone.
Commit 'H23 item 67c: ...'.

## Item 67b -- item 67 REWORK (advisor review of 1130_item67_after.png, 2026-10-03)
Item 67 is accepted as a step (8c40319: the shared sampler, the toggle, and the manual-tie proof are good). But the
brief was 'that colour continues straight down the side wall for the wall's FULL HEIGHT'. In the after shot the
walls are still plain grey/beige below a thin green lip. Fred colours his real board's edges, so the preview must
show the WHOLE wall in the edge colour (green under the contour, a red band where a rail meets the edge, the stripe
colours under a striped contour), top to bottom.
Saw-teeth: Fred's close-up (black/white striped contour, oblique view of the rim) shows alternating
wall-colour/stripe-colour TRIANGLES along the rim. 'z mismatch < 0.01 in' does not explain what he saw. Reproduce
HIS case first (a striped contour, his camera angle, zoomed on the rim), capture it, and fix what you see. If it's
per-vertex colour interpolation across a triangle that spans two colours, give the wall its own vertices (split
along the colour boundaries), so each triangle has one colour.
Before/after shots of the SAME two views: the whole board, and the close-up rim at Fred's angle. Commit 'H23 item
67b: ...'.

## Item 67 -- 3D preview: colour the board's side walls 'teint dans la masse' (Fred, 2026-10-03, screenshot)
Fred colours the real board's edges to match the artwork, so the preview should show it: wherever the top artwork
(lattice rails/ties/nodes/contour, stripes, stamp colours) reaches the board's outer edge, that colour continues
straight down the side wall for the wall's full height; elsewhere the wall keeps today's wood look. Implementation
idea (measure first): the side-wall mesh in core/preview (frame-mesh.js / the panel mesh) gets per-vertex or
per-strip colours sampled from the SAME colour source the top surface uses, at each boundary point -- one shared
sampler, not a second colour pipeline. Applies to the panel's outer walls and, if present, the frame's outer walls.
A toggle in the 3D view ('Colour edges', default ON, persisted) in case he wants the plain look. ALSO FIX the saw-teeth (Fred's close-up 2026-10-03): along the rim, alternating triangles of wall colour and surface/stripe colour show where the side wall's top edge does NOT share the surface's own edge vertices (different sampling, or the grid cut by the outline). Make the wall's top edge and the surface's boundary use the SAME vertices along the true outline, so there's no gap and no teeth. Before/after close-up shots at the same angle. Tests: a rail
crossing the boundary yields a wall band of that colour at the right position and full height; no artwork at the
edge leaves the wall unchanged. Before/after screenshots (the same angle as Fred's shot) into shots/seatA. No
Fusion. Commit 'H23 item 67: ...'.

## Item 66 -- Shape Lattice: ties must never be generated ON or touching the boundary/contour (Fred, screenshot, 2026-10-03)
Fred's shot: a T13 frame with Offset from frame on; the generator placed a tie right on the right-hand contour, half
inside the green border. Rule: a generated tie (its whole stroke, i.e. centreline +/- half the tie width, and its
end nodes) keeps a clearance from the contour/boundary of at least the contour's own half-width + the tie's
half-width + a declared gap (DECLARE it once, e.g. TIE_CONTOUR_CLEARANCE_IN, in the lattice pattern module).
Ties that can't satisfy it are skipped or moved (the same way Count's minimum is honoured, T80 item 1). Covers
rect Lattice AND Shape Lattice, every template's contour, with and without Offset from frame.
(1) Reproduce headless (same seed Fred-style: T13 at 7x9, Offset from frame, a few seeds). (2) Fix in the
generator (editor-lattice-pattern.js / tie placement), not a post-hoc delete. (3) Pure test: over 13+ templates x
50 seeds, no generated tie stroke comes closer than the clearance to the contour. (4) Before/after screenshots
into shots/seatA (per the screenshot rule). Commit 'H23 item 66: ...'.

## Item 65 -- re-run the matrix on deployed e11e15d + triage the 2 SILENT cases (advisor, 2026-10-03)
Item 64 accepted (e6bc609, 122/133). Since then the advisor pushed: the drag-stop also refuses outer.defects
(5cbf1be), a line-meets-arc corner fallback (3bf4638), and a far-slid edge + collapsed-corner-run fallback (e11e15d).
Live spot checks by the advisor: T10 waistCenterY min, T2/T13 neckLength max, T5 x2, T11 x2 are all BUILT now.
Deployed: e11e15d.
(1) Regenerate the payloads (your generator uses the shared drag-stop predicate, which now includes outer defects),
    run the full matrix live, and publish the table.
(2) Triage the 2 SILENT cases (T10 archRise:min, T12 taperAngle:min): what fails and where, file:line. Fix it if it
    is app-side JS or harness; if it's in inner_corners.py or a phase file, report it to the advisor and don't fix.
(3) Known open: T13 neckWidth:min, where the 2 top miters cross because the top bar is shorter than its miters. Just
    report it; the advisor takes it.
Fusion is yours. Commit 'H23 item 65: ...'.

## Item 64 -- the matrix must test REACHABLE range ends now that the guards exist (advisor, 2026-10-03)
Item 63 (d) accepted (326be4d). The advisor did (b) the square-corner miter fallback (7d5a5a3: 23 of 31 MITER MISS
cases now BUILT) and (a) Fred's undercut guard (d92ae70: outlineHasUndercut, read by Generate + the drag-stop).
Deployed d92ae70. The advisor keeps fixing the last 8 corner cases; do NOT touch inner_corners.py or phase files.
Your part, tooling only:
(1) h23_item61_make_full_matrix_payloads.mjs: a handle's tested end must be where a DRAG actually stops, i.e. the
    range end, pulled back by the same guards the drag-stop uses (undercut + no-hooked-tip), by bisection like
    frame-panel.js's _clampDragPatchToNoHookRule. Reuse its predicate; don't copy it (export it if needed). Record
    for each case both the declared range end and the reachable end.
(2) Regenerate the payloads, then ask the advisor for 'Fusion free' and run the full matrix live. Publish the new
    matrix (BUILT/total per template) in WORK-LOG.
Commit 'H23 item 64: ...'.

## Item 63 -- range-end crashes, option A: one class at a time, smallest first (advisor, 2026-10-03)
Item 61(1) accepted (8f8c566): 133-case matrix, 76/57, 4 classes. Order (yours): d, a, b, c. This pass: (d) then
the PILOT of (a).
(d) The JS NaN in the taper/archRise math (payload with null points). Find the formula, fix it, add a pure test
    asserting every matrix payload has finite points (run the generator over all 133). Commit separately.
(a) PILOT on template_1 ONLY: the shoulder/waist/hip 3-point seeds are baked decimals ('from the inspector output').
    First answer with file:line: does the Send's seedGeometry (item 42, every Send) overwrite those Points? If it
    does, the baked decimals aren't the cause -- re-check what actually reflexes. If they're the cause, replace them
    one arc at a time with derived via-points (T7's live-expression pattern / closed_form_arc.py), checking
    goldens --check after EACH arc so nothing like the 242-test break happens; stop and report if a change moves
    a golden. Re-run T1's 11 matrix cases live: the REFLEX ones should turn BUILT; report the rest.
Don't touch T3/T4/T5/T10/T11/T12 yet; the pilot shows whether the recipe holds first. Fusion is yours.
Commit 'H23 item 63: ...'.

## Item 61 -- range-end crash family on SHIPPED T1/T2 (and likely T12/T13): measure all, then fix at the root (advisor, 2026-10-03)
Item 60(C) accepted (ad5869d) -- excellent, and thanks for correcting (B)'s premise. Decision: (A) + your permanent-
sweep idea first; T10's taper (B') waits.
(1) PERMANENT SWEEP FIRST: promote h23_item60_make_all_handle_payloads.mjs + item60_shipped_taper_sweep.py into the
    standing live sweep: every template x every declared handle x {min, default, max}, at 7x9. The verdict per case is
    BUILT (all declared bars, no '(1)', nothing < 0.5 cm3, 0 NOT BUILT, 0 MITER MISS, 0 REFLEX ARC) -- not just
    preview==build points. Run it once and publish the full matrix (template x handle x end) in WORK-LOG.
(2) ROOT FIX by failure class, not per case:
    - REFLEX ARC at p02_11_symmetry: apply the recipe that fixed T7/T10/T11 (exact closed-form seeds, Fix the arc's
      own endpoints after its welds, CCW-correct welds) to the shared T1-family chain. Confirm on T1 AND T12.
    - 'one profile spans 2 bars': is it a missing ResolveLineCircleCorner at a corner that only appears at the
      extremes (an arc whose offset vanishes -> isTopologyMatched=False changes the topology)? Probe, then declare.
    Pure tests that fail on today's code. Goldens --check stays green (defaults must not move).
(3) Re-run the matrix: target 100% BUILT. Anything still failing gets listed with its value. Do NOT narrow a handle's
    range to dodge a crash (that's a guard, and Fred decides guards); bring the list to the advisor instead.
Fusion is yours. Separate commits per class. Commit 'H23 item 61: ...'.

## Item 60 -- the skeleton-pin gap (item 59's GATE): check the shipped templates first, then fix it once (advisor, 2026-10-03)
Item 59 accepted as a gate (7628ac2): construction fix kept, handle withheld -- right call. Your options C then B,
in that order, same pass:
(C) SHIPPED TEMPLATES FIRST (Fred may already hit this): live preview==build with the taper (or any handle that
    moves a pinned skeleton point) at BOTH range ends + default for T1, T2, T12, T13 and anything else whose
    FRAME_SEED_MAP has kind:'pin' entries, at 7x9. Why didn't item 46's 13/13 sweep catch it -- did its Generate
    seeds leave pinned points at their literals? Make the sweep cover every declared handle's range ends so it can
    catch this class from now on.
(B) FIX ONCE, DECLARED: kind:'pin' seedMap entries are declared data that no Python consumes. Make
    apply_seed_geometry (or the build-time SeedFrom resolver from item 47) consume pin entries generically, so a
    pinned skeleton line/point takes the sent position. No per-template patch, no waistMajor special case (you saw
    242 tests break). Unseeded path + goldens stay byte-identical (--check). Pure test: a pin entry moves the pinned
    entity. Then re-add T10's taperAngle handle and run item 59's 9 live cases: preview==build at every taper.
Report T1/T2/T12/T13 before/after. Fusion is yours. Commit 'H23 item 60: ...' (separate commits for C, B and the handle).

## Item 59 -- ARCHED + TAPER, template code (moved from seat C's F30 item 6 so three seats build in parallel) (advisor, 2026-10-03)
Item 58 accepted (fred-skills f5c7edb, 5ccf236). Fred approved Arched + taper after the advisor's Fusion retest of
the FIXED construction: FULL range -15..+15 deg, default 8 deg. T10 + the shared taperAngle construction (as T1/T2
already have). Source of truth for the geometry: fb-app's tools/repro/f30_item5_arched_taper_diagram.mjs at
4be8963 (git show origin/fb-app:...), INCLUDING its negative-taper fix: the waist arc's shoulder-side endpoint is
re-solved from tangency to the shifted shoulder circle, so the outline stays closed. Port that into production;
don't re-derive it. Its continuityCheck becomes a pure test.
Decide with data: a taperAngle handle on T10 itself (default 0 keeps T10 byte-identical: goldens --check) vs a new
template slot. Prefer the handle if T10's goldens, preview==build and Generate stay unchanged at taper 0. Say which.
Build rules: closed-form seeds, CCW welds, isTopologyMatched=False, ResolveLineCircleCorner at every line-meets-arc
corner, built == declared, no MITER MISS, miter at every joint, the hook guard + piece length in Generate (at -15
deg 7x9 a 0.44 in piece is rejected by Generate, NOT by narrowing the range). LIVE: -15/-8/0/+8/+15 at 7x9, and
-15/+8 at 6x9 + 9x12: all declared bars, preview==build, 0 errors. Sweep 13/13 (or 14/14) clean.
Commit 'H23 item 59: ...'.

## Item 58 -- record this week's Fusion findings in the fusion360-quirks skill, each CONFIRMED on varied cases (advisor, 2026-10-03).
Item 57 accepted (807fec3). Speed work pauses until Fred decides win #2. Fred's rule: a finding goes in the skill only
after varied re-tests (other shapes/docs/sizes), not one observation. Candidates from items 46-57:
 (a) Per-call cost of timeline operations (reorder, deleteMe on a feature) grows with document history: ms in an
     empty doc vs ~0.85 s each in a ~21-item real doc. Confirm with 3 doc sizes (count vs seconds).
 (b) timeline.markerPosition lets you CREATE features at a past position instead of reordering them later; on
     restore, the old index is stale (the timeline grew), so use moveToEnd() when it was at the end, else prior + K.
     Confirm on 2 different feature types (sketch + extrude) and 2 insertion points.
 (c) Deleting an occurrence removes the features inside its component; deleting them first is pure cost.
     Confirm with a component holding 1, 5 and 10 features.
 (d) addByThreePoints assigns start/end by geometric direction (always CCW), not argument order. The skill already
     has a CCW entry (16/16): check it says this, and extend it only if your 4 cases add something new.
Edit C:/Users/danse/APPS/fred-skills/fusion360-quirks/SKILL.md in the existing style (expected vs actual vs fix,
MEASURED numbers), and commit it BY PATH in that repo (git commit fusion360-quirks/ ...), then push. The probe
scripts go in tools/repro/fusion_t11/ on main. Scratch docs: fingerprint them and close only your own handles.
Commit 'H23 item 58: ...'.

## Item 57 -- speed win #1 from item 56: validate deferred compute across the WHOLE stamp build (advisor, 2026-10-03).
Item 56 accepted (2e8d847). Your prototype (send_stage_timing.py _apply_deferred_whole_build_variant) has a flagged
entity-id risk. Validate it properly: same real payload + fresh seed, A/B on every stamp sketch (curve count,
constraint count, dimension count, fully-constrained state, every entity id/attribute the later steps look up),
bodies/volumes, inlay health, marker == count, send-1 AND send-2 AND send-3. Keep it only if everything is
identical and it saves >= 1 s; otherwise revert and report the numbers. Win #2 (L4's 26 circle dimensions) waits on
Fred. Fusion is yours. Commit 'H23 item 57: ...'.

## Item 56 -- speed round 4, MEASURE + PROPOSE only (advisor, 2026-10-03). Item 55 accepted + deployed (405c34e).
Now: Send-1 ~16.2 s, Send-2 ~19.9 s. Items 51-55 found the pattern: each Fusion call costs more as the timeline
grows (~0.85 s per reorder/delete on the real doc). Make the full stage table for send-1 and send-2 on the real
payload (fresh today-valid seed): every stage > 0.3 s, its call count and per-call cost. For the stamp sketch
(_apply_constraints 2.2 s, _create_geometry 1.8 s): count constraints/curves per layer and the per-call cost; is it
per-call overhead (fixable by batching/fewer calls) or one big solve (not fixable cheaply)? Then propose the top 3
remaining wins with an estimated saving each, ranked. No production code this pass; WORK-LOG + pass back. The
advisor decides with Fred whether more speed work is worth it. Commit 'H23 item 56: ...'.

## Item 55 -- speed round 3: the re-Send delete (4.3 s) (advisor, 2026-10-03). Item 54 accepted (ea0f22d).
Fred re-Sends a lot, so a second Send at 24.5 s matters as much as the first at 16.2 s. The delete step goes from
0.02 s to 4.34 s. Measure how it deletes: feature by feature, body by body, or occurrence by occurrence? Does each
deleteMe trigger a full recompute? Try the smallest identical change, e.g. one deleteMe on the occurrence (or on
the timeline group) instead of many, or delete inside a single deferred/rolled-back marker window. Gate: after the
re-Send the doc is identical to a fresh Send (occurrences [B-Spline Set:1, Frame_1:1], 9/9 inlay healthy, marker ==
count, bodies/volumes equal), and a third Send also stays clean. Seconds before/after for send-2. One commit.
Fusion is yours. Commit 'H23 item 55: ...'.

## Item 54 -- the T7 'PROFILE 2/4 NOT BUILT' on the real payload (advisor, 2026-10-03). Items 52+53 accepted and DEPLOYED (a558509).
The real payload was captured 2026-10-02 21:52, BEFORE item 39's guard and item 40's narrower T7 Generate ranges, so
its T7 seeds may be a hooked shape that Generate can no longer produce. Check that first: run the payload's frame
record through today's isValid (miterStaysInsideWood + piece length). If it's rejected today, the anomaly is
explained: say so, then make a fresh payload (today's Generate seed, item-40 way) with the SAME stamp/stepVariants and
confirm 5/5 bars live with the inlay. If today's isValid ACCEPTS it, it's a real bug: probe which miter, root fix.
Also send-2 took 24.5 s vs 16.2 s for send-1: one line on where the extra 8 s goes (the delete?). No fix needed yet.
Fusion is yours. Commit 'H23 item 54: ...'.

## Item 53 -- BLOCKER before deploy: item 52's marker restore can leave the inlay rolled back (advisor review).
restore_marker_position sets markerPosition = prior_position, the index read BEFORE the frame features were
inserted. If the marker was at the end (count N) and the build inserts K features before the inlay, the timeline now
has N+K items, and restoring to N leaves the LAST K items (the inlay's own features) rolled back/suppressed. The sweep
and A/B may not see this if their docs have no inlay after the frame.
(1) Pure test with a fake timeline: marker at end, K inserts, then restore -> the marker must be at the END. Fix:
    if the marker was at the end before, restore with timeline.moveToEnd(); otherwise prior + K.
(2) LIVE on the real payload (has an inlay): after Send, markerPosition == timeline.count, every inlay feature is
    active and healthy, bodies/volumes identical to the pre-item-52 build; then a SECOND Send on the same doc is
    clean (no leftovers, marker at end).
(3) Re-time: does the 16.1 s hold?
The advisor will NOT deploy item 52 until this passes. Commit 'H23 item 53: ...'.

## Item 52 -- speed, round 2: the two real drivers item 51 localized (advisor, 2026-10-03). Item 51 accepted (de9fbdb).
(A) TIMELINE REORDER, ~5.2 s = 6 Fusion .reorder() calls x ~0.87 s, run TWICE per Send. Don't batch reorders (F11
    ordering dependency). Instead try NOT needing them: before building the frame, set design.timeline.markerPosition
    to just before the inlay's first feature, so new frame features are CREATED in place, then restore the marker.
    stamp-editor.py:868 already reads markerPosition; reuse that idea. If the marker approach isn't identical, at
    least answer why the reorder runs twice (sketch-build AND solid-build), and whether one pass is enough.
(B) STAMP SKETCH, ~5.8 s in build_constrained_sketch. It already defers compute, but projections run BEFORE the
    deferred window (the known quirk: project() returns nothing while deferred). Measure inside it: number of
    project() calls x cost, versus geometry+constraints, versus the final solve. Then the smallest change that keeps
    the result identical, e.g. project each source entity ONCE and reuse it (not once per target), or skip
    projections whose target is never constrained.
Each change: A/B identical (bodies, volumes, timeline order, stamp sketch curve/constraint counts), preview==build
13/13, seconds before/after on the real payload. One commit per change. If neither helps, say so with numbers.
Fusion is yours. Commit 'H23 item 52: ...'.

## Item 51 -- speed, the REAL costs (advisor, 2026-10-03). Item 50 accepted (4f96fe9): nudges stay, Pulse not worth it.
You were missing a real payload. Here is one: bspline-frame-builder/scratch/real_send_t7_7x9_full.json (5 MB, a
real palette capture from 2026-10-02 with stepVariants + stamp + frame; local only, don't commit). Replay it the way
the palette does: sys.modules['bspline_ui'].PaletteHTMLEventHandler()._handle_generate(payload) in a fresh,
fingerprinted doc.
(1) Time it stage by stage. Earlier numbers: stamp projection ~6.7 s, timeline reorder ~4.9 s of ~16 s. Report the
    top 5 stages.
(2) Attack the top 2. For each: why it costs (per-feature recompute? projecting every curve? a reorder that moves N
    features one at a time?), then the smallest change that keeps the result identical (A/B: bodies, volumes, timeline
    order, preview==build sweep 13/13). One commit per change; report seconds before/after.
(3) Fix step_removal_ab.py's OUT path (your flag).
Fusion is yours (the advisor's doc 'adv_taper_fp' stays open; don't close it). Commit 'H23 item 51: ...'.

## Item 50 -- item 29 un-parked: PRUNE FOR SPEED, now that the build is stable (advisor, 2026-10-03).
Fred: "stabilise before pruning". Stable now: preview==build 13/13, 0 MITER MISS, built==declared 13/13, gate green.
Earlier measurement: stamp projection ~6.7 s, timeline reorder ~4.9 s of a ~16 s real Send.
(1) Re-time a real Send stage by stage (send_stage_timing.py) for T1, T7, T10 at 7x9 in a document with a real
    B-spline panel. Report the top 5 costs.
(2) For each candidate removal (Pulse, explain/nudge steps, redundant solves, timeline reorder, projections):
    step_removal_ab.py A/B, keep a removal only if the A/B is identical AND the live sweep (preview==build,
    built==declared, MITER MISS) stays 13/13. One commit per removal, so any one can be reverted.
(3) Report before/after seconds per template. Don't remove anything a test or a recorded finding says is load-
    bearing (item 15/17 anchors, isTopologyMatched, ResolveLineCircleCorner).
Fusion: ask the advisor first (short probe pending for Fred). Commit 'H23 item 50: ...'.

## Item 49 -- item 18 resumed: declare seed derivation (advisor, 2026-10-03). Items 46-48 accepted: preview==build 13/13.
The literal seeds stay (Sketch Builder + golden recording use them, item 45), so they must be right. Use item 45's
file:line map. (1) Write the convention once in fb_engine (seed_basis.py or a sibling): a seed is solved from the
geometric relation it must satisfy (item 17's closed form), never a fitted widthIn*k / heightIn*k fraction; one
worked example + docstring, not a framework. (2) Audit every template's literal seed constants against it: list
each as DERIVED / FITTED-OK (with the reason it's still right) / WRONG (copied from a sibling or scales with the
wrong dimension). (3) Fix the WRONG ones, re-record affected goldens live, preview==build stays 13/13 and the
golden --check stays green. Ask the advisor for 'Fusion free' before live work (the advisor has a short Fusion
probe pending). Commit 'H23 item 49: ...'.

## Item 47 -- finish item 46: the T10 Arch-rise handle must actually change the build (advisor, 2026-10-03)
Item 46 accepted as a step (2e95a32; gate green). But its own live test proves the user-facing bug is still there:
both archRise extremes build IDENTICAL volumes, because top_S_anchor/top_E_anchor are literal Point steps that
apply_seed_geometry never touches. Same declaration, one level further: let a Point step take its position from a
seeded step's endpoint (e.g. 'SeedFrom': 'top_edge:S' / 'top_edge:E'), so the anchors follow the sent arch. Keep
item 15/17's anchor mechanism itself (they're needed for the chain to solve); only their position changes source.
Mind the :S/:E quirk you measured: pick the endpoint by POSITION (left/right), not by Fusion's start/end label.
LIVE: T10 7x9 at both archRise ends builds 4/4 with DIFFERENT volumes, and the preview==build sweep passes T10
(12/13 then, T5 left). Unseeded path and goldens unchanged (--check).
Log in WORK-LOG.md. Commit 'H23 item 47: ...'.

## Item 48 -- (queued after 47) T5 dip/shoulder: preview differs from build by 0.1-0.3 in (item 46's sweep finding).
Probe first: is the app's fitted shapeModel wrong, or does Fusion solve the seeded chain somewhere else? Fix at the
root; the sweep's preview==build must pass T5 (13/13).

## Item 46 -- T10's Arch-rise handle does nothing in Fusion; + a PREVIEW == BUILD check for all templates (advisor, 2026-10-03)
Item 45 accepted (26c126e): keep the literal path (Sketch Builder + goldens use it), resume item 18 after this.
(1) T10: p02_12's rebuild re-declares top_edge from the fixed 0.175*widthIn literal, and apply_seed_geometry pops the
    seed on the FIRST matching ID, so the rebuild never sees it. DECLARE the link instead of duplicating the formula:
    the rebuild step names its seed source (e.g. 'SeedFrom': 'top_edge'), apply_seed_geometry fills every step that
    references a seed, and the rebuild still uses a fresh addByThreePoints (keeps item 15/17's short-branch safety).
    Unseeded path unchanged (goldens stay valid -- confirm with --check).
(2) The general lesson: nothing checks that Fusion builds what the preview shows. Add it to the live sweep: for
    each template, Send a non-default Generate seed and compare the built Shape Outline against the payload's
    seedGeometry points (tolerance 0.01 in). T10 must fail before (1) and pass after. Plus a pure test that every
    step ID in FRAME_SEED_MAP either appears once or every duplicate declares its seed source.
(3) LIVE: T10 at 7x9 with archRise at both range ends builds 4/4 with the dragged rise; 13/13 sweep still clean.
Then item 18 (seed derivation audit) is next, using item 45's file:line map.
Log in WORK-LOG.md. Commit 'H23 item 46: ...'.

## Item 45 -- PLAN ONLY: does item 18 (declare seed derivation) still matter after item 42? (advisor, 2026-10-03)
Item 44 accepted (c0386c9; full gate green, 13/13, 0 MITER MISS). Checklist ticks updated: H16-H22 and most of H23
were done but never ticked; item 7 deferred (landscape-only sizes).
Since item 42, every Send carries the APP's seed geometry. So the Fusion-side literal `widthIn * k` seeds (item 18's
bug class) may now only be read by: the legacy unseeded construction, record_frame_parity/goldens, tests, or nothing.
(a) List every reader of those literal seed constants after item 42, with file:line, and whether a real Send can
    reach it.
(b) Then propose ONE of: RETIRE the legacy unseeded path (a removal is a sweep along the chain: list every caller,
    test and golden that goes with it), or DERIVE (item 18 as written) where a live reader remains. Include which
    goldens would need re-recording.
No code changes this pass; write the plan in WORK-LOG.md and pass back. I review it before anything is cut.

## Item 44 -- main is RED: re-record T10 goldens; make MITER MISS a permanent failure (advisor, 2026-10-03).
Item 43 accepted (96a62f8; 13/13 live). But the full gate is red: test_golden_freshness says template_10 goldens
are STALE (your flag). Main 96a62f8 is now DEPLOYED, so record_frame_parity.py reads the real fixed copy.
(1) Re-record tests/fixtures/frame-parity/template_10_* (all sizes). Expect frame_left == frame_right and 6 profiles
    at 7x9; full pytest green. Run the FULL python suite before pass-back (your fast tier missed this one).
(2) Declare it once: Fusion's offset never tags a line-meets-arc inner corner, so every such corner needs a
    ResolveLineCircleCorner step. Add a pure test over ALL templates: every corner frameMiters/miters.py expects has
    a resolved inner corner (no MITER MISS possible). The sweep script also counts 'MITER MISS' log lines (must be 0).
    Seat C's new templates (Flask, Arched Funnel, Tulip) will rely on this test.
(3) Why does template_7 have no goldens at all? If it should, record them; if not, say why in WORK-LOG.
Log in WORK-LOG.md. Commit 'H23 item 44: ...'.

## Item 43 -- T10 default builds 1/4 bars ("one profile spans 3 bars: a miter did not split it") (advisor, 2026-10-02).
Item 42 accepted (8e28cda): one build path, T7 default now 5/5 live, 12/13. T10 is the last holdout, and it matters
twice: Arched is a shipped template, and seat C's Arched + taper builds on T10.
(a) Probe first (feedback rule: inject the real geometry in a scratch doc, measure): which miter fails to split,
    and why -- a miter that misses its inner corner, an inner corner resolved from stale/baked values (like item 38
    part 1 for T7), a CW/CCW weld, or an arc on the wrong branch? Compare T10's default with the Generate seeds that
    DO build (item 23/cf3805f's 6x9/7x9 work).
(b) Fix at the root, same family as item 38 part 1 if it's the same cause. Pure test that fails on today's code.
(c) LIVE: T10 default at 6x9, 7x9 and 9x12 builds 4/4; 13/13 default sweep; re-run 4 T10 Generate seeds at 7x9.
Log in WORK-LOG.md. Commit 'H23 item 43: ...'.

## Item 42 -- one build path: T7/T10 unseeded defaults (advisor, 2026-10-02). Item 41 accepted (cd80bb0).
The unseeded path is what Fred hits if he picks T7 or T10 and Sends without touching Generate or a handle. Today it
builds a reflex arc (T7) or 1/4 bars (T10), while the SEEDED path is the one we've tested and fixed (8/8 live).
(a) Confirm with file:line when the app sends a record without seeds (fresh template pick? after a reset?).
(b) Preferred fix: DECLARE one path -- whenever seeds are absent, the app sends the seed geometry of the current
    (default) params, so every Send takes the seeded path. Fix the legacy unseeded construction only if (b) can't
    cover a real case; say which and why.
(c) Pure test: a fresh T7 and T10 record's Send payload carries seeds. LIVE: T7 + T10 defaults at 7x9 build all
    declared bars; all-template default sweep reaches 13/13. Fusion is free (seat B will ask me before its live part).
Log in WORK-LOG.md. Commit 'H23 item 42: ...'.

## Item 41 -- triage item 40's finding: T7 + T10 DEFAULT builds give 0 bars via _handle_send_frame (advisor, 2026-10-02).
Item 40 accepted (b0b644d). Is the 0-bar default real for Fred, or an artifact of skipping the app's own path?
(a) CODE FIRST (no Fusion): trace what Fred's real Send does -- the palette's message -> bspline_ui's handler(s) ->
    BuildContext. Does any step turn ui_data's DNA-formula strings into numbers before resolve_val sees them? Write
    the answer with file:line.
(b) If the real path can hit it, or you can't prove it doesn't: fix it at the root (resolve_val must never treat a
    formula string as a value), plus a pure test with a formula-valued default. If it can't: make the item 40
    harness go through the same entry point as the app, so the harness can't report a false 0 again.
(c) LIVE (ask the advisor for 'Fusion free' -- seat B is in Fusion now): T7 and T10 defaults at 7x9 build their
    declared bars, and the all-template default sweep reaches 13/13.
The advisor's own browser capture also fails here (NO CDP), so build payloads your item 40 way.
Log in WORK-LOG.md. Commit 'H23 item 41: ...'.

## Item 40 -- item 39 REVIEW follow-ups (advisor, 2026-10-02). Item 39 accepted (775b88d; full vitest 3110/3110).
Three things owed; (1) is required, it was in item 39's brief. ORDER: seat B is in Fusion first -- do (2), (3) and the payload captures, then ask the advisor for 'Fusion free' before (1)'s Sends:
(1) LIVE PROOF. The guard decides which shapes reach Fusion, so whether those shapes BUILD can only be shown in Fusion.
    Capture fresh T7 payloads (tools/repro/capture_send_payload.mjs, --template=template_7) for 4 Generate seeds each at
    7x9 and 9x12 (the guard now applies), Send them live: every one builds all 5 declared bars, no '(1)' bodies,
    nothing < 0.5 cm3, 0 NOT-BUILT log lines. Then item 38's owed all-template sweep: built bars == declared bars for
    every template's default at 7x9 (item35_all_templates_sweep.py + readback must COUNT '(1)' bodies, slivers and
    NOT-BUILT lines). Keep the payloads in scratch/ this time.
(2) T7 GENERATE RANGES: a 4% raw pass rate means T7's Generate mostly draws hooked shapes and survives by rejection
    sampling. Fred prefers simple, not-too-concave shapes. Measure which handle values pass, then DECLARE T7's
    Generate ranges narrowed to that region (data in template defs, not code). Target: >= 50% raw pass at every
    portrait size. Keep the retry as the backstop.
(3) THE FLOOR IS FRED'S CALL: 0.04t is about 0.03 in of clearance, i.e. still a thin tip. Render (real app geometry)
    a T7 eave close-up at the default, at the thinnest passing shape, and at 0.10t / 0.15t, with the clearance
    in inches labelled. Send it to the advisor; Fred picks the floor. Do NOT change the floor until he does.
Log in WORK-LOG.md (seat A's log), not WORK-LOG-fb-app.md. Commit 'H23 item 40: ...'.

## Item 39 -- FRED-APPROVED GUARD: no hooked corner tips (finishes item 38). Fred: "a guard isn't that bad, it prevents
awkward geometry where wood grain is important" -- a hooked tip is SHORT GRAIN (fibres run across a thin tip, it snaps); he chose option D (shots/fred/t7_eave_options_2026-10-02.png).
Declare ONE rule for every template (not a T7 patch -- Flask/Arched Funnel/Tulip, queued on fb-app, have the same kind of
line-meets-curve corner): at every frame corner, the straight miter from the outer corner to its inner corner must stay
inside the wood (it must not cross the outer boundary again), i.e. no tip that curls back into a hook. Enforce it the way
cf3805f enforces T10's reflex rule: (1) generateFrame's isValid rejects outlines that break it (re-measure
GENERATE_MAX_ATTEMPTS), (2) the drag handles stop before breaking it, (3) a pure test over all templates at
6x9/7x9/9x12: defaults and 500 Generate draws all pass. The app's inner-profile/miter geometry already has the corner
points (use it, don't re-derive). Template defaults must already pass (T7 default does -- picture D). LIVE: fresh T7 Sends
(several Generate seeds) at 7x9 + 9x12 build all 5 declared bars, no '(1)' bodies, nothing < 0.5 cm3, 0 overlap. Then re-run
the all-template sweep (built bars == declared). Item 38's part-1 fix (live eave corner) stays. Commit 'H23 item 39: ...'.

- [x] [H16-item-1] (Fred: "no, just a colour vs grey") The Save (disk) icon is in its normal COLOUR when there are unsaved changes and
      GREYED (like disabled Redo) when saved; still clickable; title "Save" / "Saved". One source of truth: the dirty flag
      cloud-project-manager already tracks. No badge dot.
- [x] [H16-item-2] REMOVE #dirty-dot from the header (a removal: no orphan CSS/ids/tests; rewrite any test that checked it to check the Save
      badge instead). Keep #fmCurrentFileLabel as is.
- [x] [H16-item-3] Tests (dirty -> badge on, save -> off, load -> off) + shots at 390 + 1366 (dirty and clean).
- [x] [H16-item-4] SEED OFFSET back in the SKELETON section (Fred: 'the seed offset could be surfaced in skeleton if it was removed'): Offset X / Offset Y (screens) as the H14 side-by-side SLIDER pair (value readout), bound to the SAME P keys seedOffsetX / seedOffsetY that H15 kept (no new params; saved projects unchanged). Place it next to Peak Shape / Density (which H15 moved there). Rotation stays removed unless Fred asks. Test: moving it pans the terrain like before; a saved project's offsets show in the sliders. Shots at 390 + 834.
- [x] [H16-item-5] REGION SCALE back, in the FILTER section with the seed offset (Fred: yes): a 'Map' group at the top of Filter: Region Scale (slider + value, bound to the EXISTING P key macroScale that H15 kept) above the Offset X / Offset Y slider pair (H16 item 4, which Fred moved to FILTER, not Skeleton). No new params; saved projects unchanged. Test: Region Scale zooms the underlying map as before; saved values show. Shots at 390 + 834.
- [x] [H17-item-1] MAP ZOOM: a NEW slider in Filter's 'Map' group (keep Region Scale untouched). Fred: 'add it in filters, not replace region'. A drawing-style zoom of the whole generated terrain: bigger value = bigger features; scales EVERYTHING the noise draws (coarse shapes, fine texture, detail/cluster masks) together, about the BOARD CENTRE, so the map looks like the same drawing enlarged. Implement once, at the (u,v) entry of the terrain sampler (u' = 0.5 + (u-0.5)/zoom, same for v) so every layer inherits it; seed Offset X/Y stays 'screens' at the zoomed size. Does NOT scale user stamps/sculpt, frame, edge fade or the board. New app P key (e.g. mapZoom, default 1 = today's terrain exactly, range ~0.25..4, slider + value); no new Fusion params. Tests: zoom=1 heightmap identical to before; zoom=2 centre sample equals zoom=1 centre; a feature at u=0.75 at zoom 1 appears at u=1.0 at zoom 2 (with symmetry off). Shots: same seed at zoom 0.5 / 1 / 2 (390) to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H17 item 1: ...'.
- [x] [H17-item-2] SEED OFFSET = PAN THE WHOLE MAP. Fred: 'the seed offset isnt what i wanted' -> chose 'pan the whole map': Offset X/Y must slide the ENTIRE drawing (coarse shapes + fine texture + masks) together, like moving a picture under the board window. Move the offset to the same (u,v) sampler entry as Map Zoom: zu = 0.5 + (u-0.5)/mapZoom + seedOffsetX, zv = 0.5 + (v-0.5)/mapZoom + seedOffsetY (units stay 'screens' = board widths at the zoomed size), and REMOVE the old coarse-only offset lines (terrain.js 'cx += seedOffsetX*cFreq*aspect' / cz) so it isn't applied twice. Mirror fold still happens AFTER the pan (mirror line stays at board centre; the drawing slides under it). Same P keys seedOffsetX/Y, no new params. Tests: offset 0 = heightmap identical to before; with symmetry off, sample at (u,v) with offset dx equals sample at (u+dx,v) with offset 0 for the fine AND coarse layers. Shots: same seed at Offset X 0 / 0.25 / 0.5 (390). Commit as 'H17 item 2: ...'.
- [x] [H17-item-3] OFFSET UNITS = SCREENS AT THE CURRENT ZOOM (spec of item 2, missed): today zu = 0.5 + (u-0.5)/mapZoom + seedOffsetX, so at zoom 2 an offset of 0.5 already pans a full screen and the '(screens)' label lies. Make it (u - 0.5 + seedOffsetX)/mapZoom + 0.5 (same for v) so Offset 1 = one board width at ANY zoom. Fix the comment. Test: zoom 2, offset 1 at u equals zoom 2, offset 0 at u+1 (symmetry off). No new shots needed. Commit as 'H17 item 3: ...'.
- [x] [H18-item-1] THREE NEW FILTERS, Fred-approved prototypes (Fred: 'all 5 are good, go on all five'; seat B builds N3/N5/N6/N7 in parallel on lane-b). Build N1 SANDSTONE WAVES (N1_protoStrata.js), N2 DRAPED SILK (N2_protoSilk.js), N4 ERODED HILLS (N4_protoEroded.js) from C:/Users/danse/.bspline-status/proto-filters/; the approved look at seed 42 is ids/N1_*.png, N2_*.png, N4_*.png (acceptance: before/after next to them). One module each in core/noise/ (sandstone.js, silk.js, eroded.js), registered in index.js after chest. KEEP THE LOOK, fix only defects (any crease on the mirror line: the filter receives folded su, su=0 centre, never re-fold; NOTE the prototypes must not read params.octaves: it is undefined in-app, use a fixed count or a tweak). 2-3 declared tweaks each (N1: layer count, layer depth, hill softness; N2: fold spacing, fold depth, fold sweep; N4: gully depth, gully density, slope bias), seed-driven, honour scale/roughness/warp. Tests: deterministic per seed, no NaN, sane range, centre-line slope continuous. Shots at seeds 42/7/123 to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H18 item 1: ...'.
- [x] [H19-item-1] OFFSET X / Y AS STEPPERS (Fred: 'these offset I want in steppers'). In Filter's Map group, replace the Offset X / Offset Y slider+value pair with two -/+ steppers side by side on ONE line (same stepper component + layout as Width/Height in Stock Dimensions; keep the '(screens)' sub-label inline). No slider. Step 0.05, typed values allowed, same P keys seedOffsetX/Y (no new params), no range clamp beyond what exists. Remove the now-unused slider ids from SLIDER_PAIRS/markup (sweep: no orphan bindings). Shots 390 + 834 to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H19 item 1: ...'.
- [x] [H20-item-1] EDITOR HEIGHTMAP BACKDROP IS UPSIDE DOWN (Fred, screenshots: SVG editor backdrop shows Anatomical ribs at TOP and chest V at BOTTOM; the 3D TOP view shows ribs at BOTTOM, V at TOP; the frame outline agrees in both, so only the terrain backdrop image is flipped vertically). Ground truth = 3D TOP view (+Y up). Find where the editor draws the heightmap/terrain backdrop and fix its row order at the source (one place; check whether other editor overlays, e.g. art/drape/stamp previews, share that path and are right or wrong too, and name each). MEASURE, don't reason: build a test with a known asymmetric terrain (e.g. a single bump in the +X/+Y quadrant, or read a real sample) and assert the backdrop pixel for that point is in the same board quadrant as the 3D/heightmap sample; must fail before the fix. Check it also with Mirror X on and off. Shots: editor + 3D top view side by side, Anatomical seed 42, to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H20 item 1: ...'.
- [x] [H20-item-2] BOX SELECT: TWO MODES BY DRAG DIRECTION, Fusion/CAD convention (Fred: 'box select should have the 2 way select mode, include and exclude'). Left->right drag = WINDOW (solid outline, light fill): selects only elements FULLY inside the box. Right->left drag = CROSSING (dashed outline, different tint): selects every element the box touches or encloses. Applies wherever the editor's marquee/box select runs (main Select tool, lattice/shape-lattice Select); one marquee implementation reads a declared mode from drag direction, no per-tool copies. Shift/multi-select add behaviour unchanged. Hit test: 'fully inside' = the element's whole geometry (not just its bbox corner) inside; 'touches' = any part of the stroke intersects or is inside. Tests: a piece half-inside is selected by crossing, not by window; direction flips the mode. Touch devices: same rule by drag direction. Shots of both boxes to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H20 item 2: ...'.
- [x] [H20-item-3] CLEAR ALL DOESN'T CLEAR ALL (Fred). editorClear (editor/tools/action-tools.js) only does editor._sketchLayer.clear(): the layer list, per-layer metadata (3D relief, colours, lattice ownership tags), and the Lattice / Shape Lattice pattern state + seed survive, so the panel still lists old layers and reopening a lattice tool brings old state back. Make Clear reset the ARTWORK to exactly the state of a brand-new editor session: one default layer, no elements, no lattice/shape-lattice patterns or their layer tags, no selection/guides/handles. Declare that 'fresh artwork state' ONCE (reuse whatever new-session/load path already builds it, e.g. editor-io.js around the load reset at ~855) and have Clear call it, rather than listing things to wipe in the click handler. Does NOT touch the Frame (Frame tab / frame record) or terrain settings. Undo must restore everything Clear removed (one undo step). Test: build a doc with a Shape Lattice (3D off on its layers) + a drawn path + an extra layer -> Clear -> state deep-equals a fresh session's artwork; undo -> original back. Commit as 'H20 item 3: ...'.
- [x] [H20-item-4] LAYER DELETE: DON'T ASK (Fred, screenshot of 'Delete "Ties" and its 3 elements?' confirm: 'dont ask'). Remove the window.confirm in editor/layers.js (~797): deleting a layer happens immediately, and ONE undo restores the layer, its elements, its order and its per-layer settings (3D relief, colour, lattice tag). Test that undo round-trip (must exist/prove it before removing the safety net). Leave the other two confirms alone (Clear all?; the cloud 'unsaved changes, reload?' one, which loses data undo can't restore) unless Fred says otherwise. Commit as 'H20 item 4: ...'.
- [x] [H20-item-5] LAYER SELECT = BRIEF FLASH, NOT A LASTING HIGHLIGHT (Fred: 'selecting a layer should signal or highlight what geometry it is momentarily but not forever, since it is distracting if I'm working on the canvas'). Clicking/tapping a layer row in the Layers panel briefly highlights that layer's geometry on the canvas (e.g. a glow/outline in the selection colour that fades out over ~1 s), then the canvas returns to normal. Remove any persistent active-layer highlight/dim if one exists today (name what you removed). Declare the flash once (duration/style as constants; one function any caller can use); re-clicking re-triggers it; switching layers mid-flash cancels the old one; respects prefers-reduced-motion (show briefly, no fade animation). Does not change element selection. Test: flash appears on layer select and is gone after the duration. Short clip or 2 shots (during/after) to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H20 item 5: ...'.
- [x] [H20-item-6] PRIORITY, do together with item 4: DELETED LAYERS COME BACK (Fred: 'I've been trying to delete layers and after a few layers they just come back'). REPRODUCE FIRST, measured: a doc like Fred's (Shape Lattice generated, some duplicated Ties/Contour/Rails/Nodes layers, plain layers too); delete layers one by one (and several in a row) and record after each step which layers exist; then trigger the usual follow-ups (a param change, Regenerate, closing/reopening the editor, a rebuild) and see which ones resurrect them. Suspects: a lattice/shape-lattice renderer that re-creates its layers when missing because the pattern state still exists (then deleting a lattice layer must drop that part of the pattern / the whole lattice when its last layer goes), undo-stack/snapshot restore, or a session save/load that restores a stale layer list. Fix at the cause: a deleted layer stays deleted until Undo. Test = the repro sequence, must fail before the fix. Coordinate with seat B's T80 item 4 (Shape Lattice adopting its existing layers by a declared identity): note in the WORK-LOG which layer-identity rule you rely on. Commit as 'H20 item 6: ...'.
- [x] [H20-item-7] GEOM SNAP ON BY DEFAULT (Fred: 'make snap to geometry on by default'). editor/editor-grid.js GRID_DEFAULTS: geometrySnap false -> true (the one declared default; the GEOM button reads it). Check whether a saved session/project persists grid snap state: if yes, only NEW sessions/projects default to on and a saved explicit off stays off (don't flip saved choices); if no persistence, just the default. Update any test pinning the old default. Commit as 'H20 item 7: ...'.
- [x] [H21-item-1] EDITOR 'Apply Stencils' -> 'Apply' (Fred screenshot: 'this button reads wrong now that we have frame, should be Apply only'). Rename the #editorApply button label (bspline_gen_palette.html ~1629) and its title/tooltip/aria text to 'Apply'; update any test or user-facing hint/tooltip that names the button. Historical mentions in BUGS_OPEN/ROADMAP/code comments may stay (they describe the past). Shot of the header to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H21 item 1: ...'.
- [x] [H22-item-1] LAYERS CAN'T BE REORDERED BY DRAG (Fred screenshot: lattice layers Contour/Nodes/Ties/Rails with drag grips; 'can't drag layer in an order I choose'). REPRODUCE with real pointer events (mouse + touch, Fusion palette too if it differs): drag a layer row by its grip above/below another. Find the cause: broken drag handling, or something RE-SORTING the list afterwards (e.g. a lattice/shape-lattice sync that enforces its own kind order, or a render that rebuilds rows from a fixed order). Fix: the user's order wins and persists (save/reopen, Regenerate, lattice re-sync must keep it); the order drives canvas draw order and whatever else layer order already means (3D/stamp/Fusion build order: state what layer order controls in each). One undo step per reorder. Test: reorder -> regenerate -> reopen -> order kept. Shots to C:/Users/danse/.bspline-status/shots/seatA/. Commit as 'H22 item 1: ...'.
- [x] [H22-item-2] FIX THE STAMP-PASS LAYER INDEX BUG YOU FLAGGED (H22 item 1 WORK-LOG): core/engine/apply-stamp-layers.js computes eLayer by indexing the full, unfiltered _layers with an index from the FILTERED (carved-only) passes array, so when any earlier layer is hidden/non-carved, a pass reads ANOTHER layer's depth/profile/suppression. Fix at the source: each pass carries its own layer (or its layer id) from _collectStampPasses (core/engine/rebuild.js), and applyStampLayers reads settings from THAT, never by position. Test (must fail before): layers [A hidden, B carved depth 0.1, C carved depth 0.3] -> B's pass uses 0.1 and C's 0.3; plus a reorder case. Check whether any other consumer does the same filtered-index-into-unfiltered lookup (sweep) and name them. Usage-limit cutoff likely: push a wip commit before long steps, keep a RESUME HERE line. Commit as 'H22 item 2: ...'.
- [x] [H22-item-3] FIX THE SECOND INSTANCE YOU NAMED (H22 item 2 sweep): stamp-mask-manager.js looks up P.stampLayers[idx] by POSITION where idx can come from a filtered list: make it join by layer id the same way item 2 did (one id-keyed lookup, reuse item 2's approach). Test that fails before (hidden/non-carved earlier layer). For the two adjacent position-based lookups you judged 'not confirmed broken': write a quick test for each; fix only if it fails, else leave and say so. Commit as 'H22 item 3: ...'.
- [x] [H23-item-1] LIVE FUSION CHECK, Template 3 (HANDOFF-ranchy.md section 4a + frame-builder/sketches/template_3/LIVE_CHECK.md): build by hand in a SCRATCH doc, record goldens with tools/repro/record_frame_parity.py at 7x9, 12x6, 5.51x1.97, run the f20 seeded parity check, the inversion sweep; fill the LIVE_CHECK ticks. If a build fails with a clear fix (e.g. drop one over-constraining Equal, see the handoff's 'most likely failures' table), fix it in that template's phases/*.py, rerun tests + the A/B byte-identical check (tools/repro/ab/). Then commit tests/fixtures/frame-parity/template_3_*.json, run python tools/gen_frame_defs.py (shapeModel becomes measured), tests, commit. Results (pass/fail, exact Fusion error text, log path, fix commit) in LIVE-RESULTS-ranchy.md. Commit as 'H23 item 1: ...'.
- [x] [H23-item-2] LIVE FUSION CHECK, Template 4 (HANDOFF-ranchy.md section 4a + frame-builder/sketches/template_4/LIVE_CHECK.md): build by hand in a SCRATCH doc, record goldens with tools/repro/record_frame_parity.py at 7x9, 12x6, 5.51x1.97, run the f20 seeded parity check, the inversion sweep; fill the LIVE_CHECK ticks. If a build fails with a clear fix (e.g. drop one over-constraining Equal, see the handoff's 'most likely failures' table), fix it in that template's phases/*.py, rerun tests + the A/B byte-identical check (tools/repro/ab/). Then commit tests/fixtures/frame-parity/template_4_*.json, run python tools/gen_frame_defs.py (shapeModel becomes measured), tests, commit. Results (pass/fail, exact Fusion error text, log path, fix commit) in LIVE-RESULTS-ranchy.md. Commit as 'H23 item 2: ...'.
- [x] [H23-item-3] LIVE FUSION CHECK, Template 5 (HANDOFF-ranchy.md section 4a + frame-builder/sketches/template_5/LIVE_CHECK.md): build by hand in a SCRATCH doc, record goldens with tools/repro/record_frame_parity.py at 7x9, 12x6, 5.51x1.97, run the f20 seeded parity check, the inversion sweep; fill the LIVE_CHECK ticks. If a build fails with a clear fix (e.g. drop one over-constraining Equal, see the handoff's 'most likely failures' table), fix it in that template's phases/*.py, rerun tests + the A/B byte-identical check (tools/repro/ab/). Then commit tests/fixtures/frame-parity/template_5_*.json, run python tools/gen_frame_defs.py (shapeModel becomes measured), tests, commit. Results (pass/fail, exact Fusion error text, log path, fix commit) in LIVE-RESULTS-ranchy.md. Commit as 'H23 item 3: ...'.
- [x] [H23-item-4] LIVE FUSION CHECK, Template 6 (HANDOFF-ranchy.md section 4a + frame-builder/sketches/template_6/LIVE_CHECK.md): build by hand in a SCRATCH doc, record goldens with tools/repro/record_frame_parity.py at 7x9, 12x6, 5.51x1.97, run the f20 seeded parity check, the inversion sweep; fill the LIVE_CHECK ticks. If a build fails with a clear fix (e.g. drop one over-constraining Equal, see the handoff's 'most likely failures' table), fix it in that template's phases/*.py, rerun tests + the A/B byte-identical check (tools/repro/ab/). Then commit tests/fixtures/frame-parity/template_6_*.json, run python tools/gen_frame_defs.py (shapeModel becomes measured), tests, commit. Results (pass/fail, exact Fusion error text, log path, fix commit) in LIVE-RESULTS-ranchy.md. Commit as 'H23 item 4: ...'.
- [x] [H23-item-5] LIVE FUSION CHECK of the 7 older flows never run live (HANDOFF-ranchy.md section 4b): one Send (B-spline + frame, second Send leaves no leftovers), Send with template None, Settings > Clear Fusion design, import_failed toast, CAM builder per-setup + BUILD confirm, Continue banner > Load & Send, hand-drawn layers land on their kind layer. Also check the moved Frame-tab controls in the Fusion palette (section 3). Results in LIVE-RESULTS-ranchy.md; fix what's clearly broken (one commit per fix, 'H23 item 5: ...').
- [x] [H23-item-6] TEMPLATE 5 SEED REWORK (from your item 3 finding): 12x6 flips and 5.51x1.97 fails because the dip/shoulder seed radius scales with heightIn only while the span it bridges scales with widthIn. Rework the seed in template_5 so each arc's seed radius and position derive from the dimension(s) it actually spans (declare the relation once), then re-run 12x6 and 5.51x1.97 live, record their goldens, rerun gen_frame_defs.py (the dip extractor needs >=2 valid sizes to fit), and re-check parity. Templates 1-4 and 6+ must stay byte-identical (A/B). Do it after item 5. Commit as 'H23 item 6: ...'.
- [x] [H23-item-7] (DEFERRED 2026-10-03: only 12x6 / 5.51x1.97 diverge -- landscape/odd sizes, Fred does portrait only) TEMPLATE 6 CLAMP DIVERGENCE (from item 4's frame-parity-app.test.js skip): frameCutProfile's own 'no seeds, show the default' computation clamps the tab height to the frame's minimum viable size (2x frame_thickness), but the recorded Fusion goldens (phases/p02_03's fixed seed fractions) have no such clamp. At 7x9 both sides naturally clear the minimum and agree; at 12x6 the golden's unclamped tab (1.251in) vs the app's clamped one (1.5in) push the app-vs-Fusion outline/inner-edge distance to ~0.25in (over the 0.1in test tolerance), and 5.51x1.97 diverges further. Fusion's own build is healthy and correct at both sizes -- this is a real app-vs-Fusion shape difference for a real user opening Template 6 at those board sizes without ever customizing the tab, not just a test-tolerance nuisance. Decide: should the app's own default preview stay clamped (matching the frame's minimum-part rule) even before Send, or should it show the golden's true unclamped shape until a user action forces the clamp? Then update tests/frame-parity-app.test.js's CLAMP_DIVERGENT_OUTLINE/CLAMP_DIVERGENT_INNER sets (or remove them) once decided.
- [x] [H23-item-8] BUG (Fred, phone screenshot C:/Users/danse/.bspline-status/shots/fred/frame_outside_canvas_2026-09-30.png): in the editor Frame tab the frame (looks like Template 3 Tapered Hourglass: the slanted top bars) is drawn PAST the board: its top runs above the red dashed board edge. Reproduce on main at the default board and the other sizes, identify the template, and find why the app's frame profile exceeds the board (provisional vs measured shapeModel after your goldens? a top-width/taper value not clamped to the board? the drawn outline offset?). The frame's OUTER edge must equal the board outline. Test: every template's outer profile stays within the board at 7x9, 12x6, 5.51x1.97 (would have caught this). Priority: before item 6. Commit as 'H23 item 8: ...'.
- [x] [H23-item-9] IMPORT_FAILED MUST NOT FREEZE FUSION (your item 5 finding): the failed-import path pops a BLOCKING ui.messageBox() next to the palette toast, freezing Fusion's main thread until someone clicks it. Remove the native messageBox on that path (all 4 call sites you found) and rely on the toast + the importing_done reset; keep a log line. Test: a broken payload returns with the toast, Fusion stays responsive, no modal. Commit as 'H23 item 9: ...'.
- [x] [H23-item-10] CAM BUILD CONFIRM, BUSY BRANCH, LIVE (your item 5 finding): Fusion exited when you reached the busy/confirm branch of the CAM builder. When Fred has Fusion open again: reproduce in a scratch doc (setups that hold operations, then BUILD), see whether the confirm path itself crashes Fusion, and fix. If it reproduces as a crash, capture the Fusion log path + last lines in LIVE-RESULTS. Commit as 'H23 item 10: ...'.
- [x] [H23-item-11] LIVE FUSION CHECK, Template 8 (Dipped Top + left-only wave, merged 8c94649): same process as items 1-4 (build in a SCRATCH doc, goldens at 7x9 / 12x6 / 5.51x1.97, f20 parity, inversion sweep, LIVE_CHECK ticks, gen_frame_defs). Commit as 'H23 item 11: ...'.
- [x] [H23-item-12] HIDDEN-ERROR SWEEP (from item 10: a bare undefined 'app' raised NameError every call and 'except Exception: _log_error' swallowed it, so CAM BUILD silently skipped its confirm and deleted operations). Run a static check for undefined names / unused-but-meant globals across ALL Fusion-side Python (b-spline-gen, frame-builder, CAM-builder, template-maker): e.g. 'python -m pyflakes' (pip install into a scratch venv if needed). Fix every real undefined-name bug (each with a test that fails before); list false positives. Also list every 'except Exception' that only logs inside a user-facing action and flag (don't change) the ones that hide a failure the user should see. Commit as 'H23 item 12: ...'.
- [x] [H23-item-13] LIVE FUSION CHECK, Templates 9 (I Shape, b4f4b88) and 10 (Arched Hourglass, bcf1245): redeploy main from a clean scratch worktree, then the same process as items 1-4 per template (scratch doc, goldens at 7x9 / 6x9 / 12x6 (portrait first; Fred works in portrait), f20 parity, inversion sweep, LIVE_CHECK ticks, gen_frame_defs). Leave the latest main deployed in Fusion at the end. Commit as 'H23 item 13: ...'.
- [x] [H23-item-14] PRIORITY: TEMPLATE 10 FAILS IN FUSION AT EVERY SIZE (your item 13 finding: the top arch SketchArc sweeps the wrong way around the correct circle, ~331 deg at 12x6, cascading into addOffset2 + miter/extrude failures). T10 is LIVE on the website, so a Send with it breaks now. Fix in template_10's own phases (not shared T1/3/4/5 code): create the arch so its sweep is the SHORT way (e.g. addByThreePoints with the apex as the middle point, or explicit start/end ordering + a sweep-direction check), keep the 1-DOF Symmetry + Tangent constraint scheme, verify live at 7x9, 6x9, 12x6 (sweep angle measured < 180 deg, offset + 4 miters + extrudes healthy), record goldens, gen_frame_defs, full suites, A/B T1-9 unchanged. Leave latest main deployed. Commit as 'H23 item 14: ...'.
- [x] [H23-item-15] T10 ARCH, NEXT APPROACH (for a fresh seat A session; read item 14 in LIVE-RESULTS-ranchy.md first): force the short branch GEOMETRICALLY instead of fighting the solver: add an APEX sketch point that is (a) Coincident to the arch SketchArc, (b) on the vertical symmetry line, and (c) on the board's top edge (or at the declared rise). The 331-deg long-way arc cannot pass through that apex point, so the only solution is the short arc. Seed the arc with addByThreePoints(start, apex, end) so the initial guess is already the right branch. Keep it parametric. Only if that fails, fall back to item 14's isolated pre-solve idea. Remember the TemplateLoader phase-module cache (stop/run the add-in after editing phases). Verify live at 7x9 / 6x9 / 12x6, goldens, gen_frame_defs, suites, A/B. Then un-hide T10 (flip the flag seat C adds in F29 item 1). Commit as 'H23 item 15: ...'.
- [x] [H23-item-16] INSET WINDOW, FUSION + CAM SIDE (app side merged 244c096; design INSET-WINDOW-DESIGN.md sections 5 + 8; steps in INSET-WINDOW-LIVE_CHECK.md): build the 4 hidden frame_window_* bars behind the panel (start at the panel underside, same frame_height_offset) + the window_cut pocket through the panel (hole = subframe inner rect shrunk by panel_lip), declared_profiles mapping, CAM picks the bars up via the N-bar path. Off = byte-identical. Verify live (scratch doc), tests. After item 15. Commit as 'H23 item 16: ...'.
- [x] [H23-item-17] TEMPLATE 10, SECOND HALF: shoulder/waist/hip "ears" (item 15's own confirmed-separate finding; see this file's top section for the full writeup/recommendation). Board-size-dependent reflex arcs in the 3-arc mutually-tangent side chain. Adapt the arch's closed-form-seed + direct-`Fix` technique to the 3-arc system (solve simultaneously, or decide which 1-2 points can be `Fix`-ed without over-determining the rest); treat the hip tip-weld `VCS_SKETCH_SOLVING_FAILED` as the same root cause. Verify at 7x9, 6x9 AND 12x6. STOP and report (don't keep burning rounds alone) if a clean fix doesn't land after a solid attempt. Only then: `FRAME_HIDDEN = False`, regenerate, full verification, merge with seat C's parked app-side (b31f5ed). Commit as 'H23 item 17: ...'.
- [x] [H23-item-18] (-> item 49) DECLARE SEED DERIVATION (cross-cutting, after item 17; Fred: "seeds are still using width height multiplicator formulas?" — yes, confirmed, and it's a recurring bug class, not cosmetic). Every template seeds its shape-outline with literal `widthIn * k` / `heightIn * k` magic constants, hand-picked per template, often copied from a sibling template without re-deriving for the new chain. Three confirmed incidents from this one root cause: Template 5's seed radius scaling with heightIn while the span it bridges scales with widthIn (H23 item 6); Template 10's `hw = widthIn * 0.464286` reused from Template 1, never derived for T10's own hip/shoulder chain (items 14/15/17); Template 12/13's seed computed off the raw board dimension instead of routing through `seed_basis.py` (seat C, F30 item 3). Pull the CLOSED-FORM DERIVATION TECHNIQUE item 17 used (solve the seed's radius/position from the actual geometric relationship it must satisfy, not a fitted fraction of one board dimension) into a declared, documented helper/convention in `fb_engine` — the one worked example plus a clear pattern to follow, not a framework. Then audit the EXISTING literal-constant seeds for which are actually suspect (reused across templates without re-derivation, or scaled by the wrong dimension for what they bridge) and fix those. This is NOT "rewrite every template's seeds" — leave seeds alone that are provably fine (fit directly for their own template, correct single-dimension span). Document the convention (a short addition to HANDOFF-ranchy.md's template-design rules) so a new template derives its seeds instead of copying a sibling's constants. Commit as 'H23 item 18: ...'.
- [x] [H23-item-19] FINISH + UN-HIDE TEMPLATE 10 (item 17's own open question; see this file's top section for the full reasoning). Merge seat C's parked app-side T10 work (fb-app b31f5ed, F29 item 2) with the now-measured Fusion geometry, reconciling any drift from Fred's hand-reconstructed model. Live-verify a REAL b-spline design sends, builds, AND joins/trims correctly into T10's frame (same bar just required of seat C's new taper templates) — not just the bare frame. Then `FRAME_HIDDEN = False`, regenerate, full suite + A/B (T1-9 unchanged). Document (don't fix) 12x6's T1-inherited limitation. Commit as 'H23 item 19: ...'.
- [x] [H23-item-20] GOLDEN FRESHNESS CHECK (from item 19's own finding, d7ec983: template_10's goldens sat stale through 3 real fix iterations, 14/15/17, with nothing in the pipeline ever flagging it — gen_frame_defs.py --check only validates generated defs against committed goldens, never goldens against a fresh Fusion build). Declare a freshness check: for each template's committed golden fixture (tests/fixtures/frame-parity/template_N_*.json), compare its own recorded source commit (or the golden file's own last-modified commit) against the last commit that touched that template's phases/*.py — if the phase files moved more recently than the golden, flag it (a test failure or a `--check`-style report, whichever fits the existing gen_frame_defs convention). Should have caught item 19's own 2-pass detour immediately. Commit as 'H23 item 20: ...'.
- [x] [H23-item-21] TEMPLATE 10'S REAL FRAME ENCLOSURE DEFECT (item 19's own finding, 38fff7a: live-verified with a real seeded b-spline send, only 2 of 4 bars build — frame_top/frame_right missing). Root cause already traced: `addOffset2` fails this seeded geometry's topology in `T10_3_frame_enclosure`, falls back to a non-parametric offset that merges 12 source curves into 6, losing `inner_proj_horn_TR` and the miter that depends on it. Find why the REAL seeded geometry (not Fusion's own unseeded defaults) trips this, and fix at that cause — not by patching the fallback to merge more carefully. Verify with the same real-seeded send-and-join check, 7x9 + 6x9, full suite + A/B. Parametric-offset topology issues have been hard for this template every time before — bounded attempt, stop and write up if it doesn't yield. Then `FRAME_HIDDEN = False`, regenerate, document 12x6. Commit as 'H23 item 21: ...'.
- [x] [H23-item-22] send_frame's `underside_face()` fails at 6x9 (item 21's own finding, 41455a0: real captured 6x9 payload gets empty `frame_occurrences: []` via the real production handlers, "no downward face" refusal). See this file's top section for the investigation priority order (check T1 at 6x9 first — tells you if this is a pre-existing general bug or T10-specific). Fix at the real cause, re-verify 6x9 AND 7x9 live, then un-hide T10. Commit as 'H23 item 22: ...'.
- [x] [H23-item-23] T10 6x9's reflex arc in `p02_12_arch_rebuild.py`'s Shape Outline (item 22's own finding, d00ef55: `REFLEX ARC: [unknown_arc] sweeps 200.3 deg`, same failure class as items 14/15/17's own arch branch-selection bug, now in the Rebuild primitive under a new seed condition). Apply the established playbook: seed through a known-correct point, `Fix` the endpoints directly, check `fusion360-quirks`'s own `Fix` entries first. Verify 6x9 AND 7x9 live, full suite + A/B, then `FRAME_HIDDEN = False`, un-hide. **PUSH immediately after committing — don't leave work unpushed in the shared main checkout** (today's own near-miss). Commit as 'H23 item 23: ...'.
Commit by path, push immediately, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 6 — H23 item 23 — <shas>"`.
- [x] [H23-item-24] SEND DELETES ANOTHER DOCUMENT'S B-SPLINE SET: `_remove_last_import` deletes the in-memory `last_imported_occurrences` from whatever doc last imported; find the previous import by tag in the ACTIVE design only. Fake-Fusion two-document test (mutation-tested) + live two-doc check. Commit as 'H23 item 24: ...'.
- [x] [H23-item-25] UN-HIDE TEMPLATE 10: FRAME_HIDDEN = False, regen, full suite + --check, picker + 7x9 Generate shots. Commit as 'H23 item 25: ...'.
- [x] [H23-item-26] FrameBuilder() WITHOUT external_logger CRASHES: frame_engine.py:133 uses the logger instance instead of fb_logger. One line + test. Commit as 'H23 item 26: ...'.
- [x] [H23-item-27] TEMPLATE 7 CROSSED ARC WELDS: apply T11's recipe (exact midpoint seeds, no seed Radius/nudges, CCW-correct welds + weld test), live-build 7x9/9x12 with tools/repro/fusion_t11; PLUS one all-template test: weld orientation (CCW rule) + seed-midpoint report + convex radius > bar report. Commit as 'H23 item 27: ...'.
- [x] [H23-item-28] STABILISE (no pruning): make the offset fallback loud (result field + ERROR log + test); convert convex-radius check 3 to a declared known list. Commit as 'H23 item 28: ...'.
- [x] [H23-item-29] (-> item 50) PRUNE FOR SPEED (after 28 merges): time a real Send stage by stage, then remove Pulse / explain nudges where timing says it pays, each re-checked with step_removal_ab.py. Commit as 'H23 item 29: ...'. Commit as 'H23 item 28: ...'.
- [x] [H23-item-30] CANCELLED -- Fred: warn only (T82 item 4's editor warning). Was: PREVENT FALLBACKS (Fred: 'the add-in produces no errors'): app keeps every convex radius > frame_thickness + margin (Generate gate, handle clamp, small-board defaults); known list empty + T1 7x9 live Send with zero fallback lines. Commit as 'H23 item 30: ...'.
- [x] [H23-item-32] NO-ERRORS: find + fix why timeline 'Group1' is unhealthy on every Send; explain the empty-doc T1 solve failure. Commit as 'H23 item 32: ...'.
- [x] [H23-item-33] (root-caused, fix -> item 34) PARAM EDIT AFTER BUILD DUPLICATES BARS: find + fix why the bar split doesn't survive a frame_thickness/boundingboxoffset edit (3 bars become one overlapping U body, timeline healthy). Commit as 'H23 item 33: ...'.
- [x] [H23-item-34] CANCELLED (Fred: he sees the break and undoes; no auto-rebuild, no lock, no CAM check). Was: FRED EDITS PARAMS IN FUSION: feasibility of auto-rebuild on the Parameters dialog (C1) vs a merge-proof bar model (C2), measured, before any production change. Commit as 'H23 item 34: ...'.
- [x] [H23-item-37] ROBUST UNDERSIDE: area-weighted face normal instead of a 5-point average vs a -0.7 bound (T7 7x9 panel scored -0.6975 and was refused); + the unhealthy 'Source - L4 - ballnose' stamp feature. Commit as 'H23 item 37: ...'.
- [x] [H23-item-38] (part 1 done c190ac6; part 2 -> item 39, Fred chose a guard) T7 INCOMPLETE FRAME: roof bars never built + sliver '(1)' bodies (eave miter doesn't split); fix + all-template 'built bars == declared bars' check. Commit as 'H23 item 38: ...'.
- [x] [H23-item-39] NO HOOKED TIPS (Fred-approved guard): the straight corner miter must stay inside the wood, for every template -- Generate rejects, handles stop, all-template test; T7 then builds all 5 bars live. Commit as 'H23 item 39: ...'.
- [x] [H23-item-40] item 39 follow-ups: (1) live T7 Generate-seed Sends at 7x9 + 9x12 + the all-template built==declared sweep, (2) declare narrower T7 Generate ranges (>= 50% raw pass), (3) margin-floor render for Fred. Commit as 'H23 item 40: ...'.
- [x] [H23-item-41] T7/T10 default 0-bar finding: trace the real Send path (code), fix at the root or fix the harness, then live 13/13 default sweep. Commit as 'H23 item 41: ...'.
- [x] [H23-item-42] one build path: a Send without seeds sends the default params' seed geometry; T7 + T10 defaults build live; 13/13 default sweep. Commit as 'H23 item 42: ...'.
- [x] [H23-item-43] T10 default 1/4 bars: probe which miter fails and why, root fix + failing-first test, live 4/4 at 6x9/7x9/9x12 and 13/13 sweep. Commit as 'H23 item 43: ...'.
- [x] [H23-item-44] main RED: re-record T10 goldens (full pytest green); all-template no-MITER-MISS pure test + sweep count; T7 goldens question. Commit as 'H23 item 44: ...'.
- [x] [H23-item-45] PLAN ONLY: after item 42, who still reads the literal seed constants? Propose retire-the-legacy-path vs derive (item 18), with the full caller/test/golden list. No code.
- [x] [H23-item-46] (partial: SeedFrom + live preview==build check done; the handle still has no effect -> item 47) T10 arch rise ignored by Fusion: declare the rebuild's seed source; live preview==build check for all templates; T10 archRise ends live. Commit as 'H23 item 46: ...'.
- [x] [H23-item-47] T10 arch-rise handle really changes the build: anchors take their position from the seeded arch's endpoints (by position); live different volumes at both ends; preview==build passes T10. Commit as 'H23 item 47: ...'.
- [x] [H23-item-48] T5 dip/shoulder preview vs build 0.1-0.3 in: probe, root fix, preview==build 13/13. Commit as 'H23 item 48: ...'.
- [x] [H23-item-49] declare seed derivation (item 18): convention in fb_engine, audit every literal seed (DERIVED / FITTED-OK / WRONG), fix WRONG + re-record goldens, preview==build 13/13. Commit as 'H23 item 49: ...'.
- [x] [H23-item-50] (nudges load-bearing, Pulse no gain; real costs not yet measured -> item 51) prune for speed: re-time a real Send, A/B each removal, keep only identical + 13/13 sweep, one commit per removal, before/after seconds. Commit as 'H23 item 50: ...'.
- [x] [H23-item-51] speed, real costs: replay a real full Send, time stages, attack the top 2 with identical A/B, fix step_removal_ab OUT path. Commit as 'H23 item 51: ...'.
- [x] [H23-item-52] speed round 2: timeline marker instead of reorders (or why twice); stamp sketch projections measured + reduced; A/B identical, seconds before/after. Commit as 'H23 item 52: ...'.
- [x] [H23-item-53] BLOCKER: marker restore must end at the timeline END (moveToEnd), live check with inlay + second Send. Commit as 'H23 item 53: ...'.
- [x] [H23-item-54] T7 NOT BUILT on the pre-guard real payload: today's isValid verdict, fresh payload live 5/5 with inlay, or a root fix; + where send-2's extra 8 s goes. Commit as 'H23 item 54: ...'.
- [x] [H23-item-55] speed round 3: re-Send delete 4.3 s -> measure how it deletes, smallest identical change, send-2/send-3 clean. Commit as 'H23 item 55: ...'.
- [x] [H23-item-56] speed round 4 MEASURE ONLY: full stage table send-1/send-2, stamp sketch per-call vs solve, top 3 remaining wins with estimates. Commit as 'H23 item 56: ...'.
- [x] [H23-item-57] (reverted, under noise) validate whole-stamp-build deferred compute: A/B identical over 3 Sends, keep only if >= 1 s saved. Commit as 'H23 item 57: ...'.
- [x] [H23-item-58] fusion360-quirks: timeline per-call cost vs history, marker insertion + restore rule, occurrence delete covers child features, CCW arc start/end -- each confirmed on varied cases. Commit as 'H23 item 58: ...'.
- [x] [H23-item-59] (gate: handle withheld -> item 60) Arched + taper template code (moved from seat C): port the fixed construction, taper handle on T10 vs new slot (data), full -15..+15, live 5 angles + sizes, sweep clean. Commit as 'H23 item 59: ...'.
- [x] [H23-item-60] (C done; B re-scoped -> after item 61) skeleton-pin gap: live-check T1/T2/T12/T13 range ends first, sweep covers every handle's range ends, consume kind:'pin' seed entries generically, re-add T10 taper handle + 9 live cases. Commit as 'H23 item 60: ...'.
- [x] [H23-item-61] (matrix + classes done; fixes -> 63+) range-end crash family: permanent every-handle x {min,default,max} BUILT sweep + matrix, root fix per failure class (reflex arc, unsplit profile), 100% BUILT or a list for the advisor; no range narrowing. Commit as 'H23 item 61: ...'.
- [x] [H23-item-62] (MOVED to seat B, T84 item 7) (after 61) T10 taper, re-scoped (B'): read p02_06/p02_07's Coincident/Tangent chain, fix the override, re-add taperAngle, item 59's 9 live cases.
- [x] [H23-item-63] (d) JS NaN in taper/archRise payload math + finite-points test; (a) pilot on T1: do sends overwrite the baked arc seeds? derived via-points arc by arc, goldens checked each step, T1 matrix re-run. Commit as 'H23 item 63: ...'.
- [x] [H23-item-64] matrix tests reachable ends (guard-clamped, shared predicate), regenerate, live full matrix when the advisor frees Fusion. Commit as 'H23 item 64: ...'.
- [x] [H23-item-65] (131/133; T10 archRise:min -> advisor's item 62; T13 neckWidth:min covered by the mitersCollide guard 578660e) re-run the full matrix on e11e15d (regenerated payloads) + triage the 2 SILENT cases. Commit as 'H23 item 65: ...'.
- [x] [H23-item-66] Shape Lattice: no tie generated on/touching the contour -- declared clearance, fix in the generator, pure test over templates x seeds, before/after shots. Commit as 'H23 item 66: ...'.
- [x] [H23-item-67] 3D preview: side walls take the edge colours of the artwork (teint dans la masse), shared colour sampler, 'Colour edges' toggle, tests, before/after shots. Commit as 'H23 item 67: ...'.
- [x] [H23-item-67b] (step: full-height walls done; alignment -> 67c) item 67 rework: walls coloured FULL height in the edge colours; reproduce Fred's striped-rim close-up and remove the triangles; before/after of both views. Commit as 'H23 item 67b: ...'.
- [x] [H23-item-67c] wall colour ALIGNED with the rim (same perimeter parameter) and crisp (no interpolation across colour boundaries); pure alignment test; side-view shot; re-check Fred's triangles in his exact setup. Commit as 'H23 item 67c: ...'.
- [x] [H23-item-68] SPIKE: artwork colours as one transparent-PNG decal on the Stamped top face -- alignment, transparency, time, re-Send; shots; no wiring yet. Commit as 'H23 item 68: ...'.
- [x] [H23-item-67d] edge colour only on the board (panel) edge, ~0.25 in; frame walls unchanged; test + shots. Commit as 'H23 item 67d: ...'.
- [x] [H23-item-69] (single wrap: negative; 12-decal: Fred said skip) SPIKE: edge colours as a wrapped strip decal on the panel's side faces; shots; alignment with the top decal; seconds; fall back to estimating option B if it can't wrap. Commit as 'H23 item 69: ...'.
- [x] [H23-item-71] top colour decal in Send: optional (off by default), dpi/opacity/layers config, replace-on-re-Send, remove-when-off, never fails a Send; tests + live on/re-Send/off + shots. Commit as 'H23 item 71: ...'.
- [x] [H23-item-72] BRICK ENGINE (Fred: "I need photo and brick engine"). A PURE JS module, no UI (seat C builds the Photo tab and plugs this into its Bricks mode later). New files only, e.g. bspline-frame-builder/b-spline-gen/html/core/bricks/ (engine.js, library.js) + tests/bricks-*.test.js, so there's no overlap with seat C's photo work on fb-app.
  INPUT (declared data): a brick sample library (18 real bricks, laid flat, PNGs in C:/Users/danse/.bspline-status/shots/advisor/bricks/, contact sheet brick_library_sheet.png; copy them into html/data/bricks/ + a bricks.json {id,image,source}); a piece library {id, bricks:1|2|3, offsets:[...]} with 2-brick offsets 0,1/6,1/4,1/3,1/2,2/3 and 3-brick staircase/zigzag/out-and-back shapes (reference shots/advisor/brick_piece_catalog.png, A1-A6, B1-B9; Fred is still picking which, so declare them all with an `enabled` flag); settings {brickLengthIn, brickHeightIn (ratio from the samples, ~3:1), jointWidthIn, jointDepth, suppression 0-1, topBias 0-1 (0.8), clumping 0-1, frame:{on, widthBricks 1|2, orientation 'upright'|'flat'}, seed}.
  OUTPUT: a height field sampler h(u,v) for the board (same contract as the other filters / the photo source, so it composes with symmetry).
  RULES (Fred): bricks FLAT in horizontal courses with half-brick stagger; each spot gets a random piece (seeded), each brick a random sample, flipped 180 at random, small height jitter; bricks RAISED, joints are GROOVES (Relief/invert handled by the shared toggle); NEVER stretched (brick size in inches, uniform scale; a test that the brick w/h ratio is identical on 6x9 and 9x12 within 2%); suppression removes whole pieces, weighted to the top, exact % regardless of clumping; clumping = noise scale of the removal score; brick frame follows the board outline with mitred corners (always miter).
  PREVIEW FIRST: render shaded previews (lit TOP-LEFT) to shots/seatA: default wall; suppression 30/60 x clumping 0.2/0.8; frame on (upright, 1 brick). Reference look: shots/advisor/brick_preview_flat_correct.png; Python prototype shots/advisor/brickwall_prototype.py (numbers only, don't port it). Commit as 'H23 item 72: ...'.
- [x] [H23-item-73] MASONRY follow-ups (f3): (a) P1a-corners: every band corner (frame bands + the wall's inner corners) filled by two end bricks cut along the diagonal: no white triangle, no overlap (test: coverage at corners ≥ 0.9 of the corner square); (b) data/bricks is 11 MB: re-encode the 47 samples as JPEG q85 at ≤ 480 px long side (they're textures, ≤ ~60 KB each, target total ≤ 3 MB), keep ids, update bricks.json; (c) the 3D height profile in the height adapter: declared per set {edgeRadiusIn, crown, chipRate, chipSizeIn, surfaceShare}, de-lit high-pass sample surface, grout depth/profile, all inside reliefIn 0.125" (max 0.25"). Reference shots/advisor/brick_3d_compare.png. Previews to shots/seatA. Commit as 'H23 item 73: ...'.
- [x] [H23-item-74] MASONRY surface + rocks (f3): (a) adapter sampleDetailAt: canvas-load the JPEG samples IN THE ADAPTER, de-light (high-pass), surfaceShare of reliefIn; preview next to shots/advisor/brick_3d_compare.png; make chips visible once in a preview; (b) P1c: Set 2 'White rocks' from shots/advisor/stones_white (10 stones, long ~2:1 + short ~1:1; JPEG <=480px), wider grout default; (c) 'fieldstone' layout (Poisson-disc seeds -> Voronoi clipped, shrunk by half grout, slightly rounded corners). Commit as 'H23 item 74: ...'.
- [ ] [H23-item-75] CURVED CONTOURS (f3): continuous brick placement through straight<->arc tangent transitions (no empty stretch, no stray tilted shards), each brick's outer face on the band's outer edge along arcs, fraction-piece fills at run ends. Test on real T1 + T12: coverage >=90% on every primitive incl. arcs; no gap between neighbours along the path > half a brick. Then (if time) the adapter photo surface (sampleDetailAt) from item 74(a). Commit as 'H23 item 75: ...'.
- [ ] [H23-item-76] (f3) ARCS AS VOUSSOIRS (built between the band's exact outer/inner offset arcs, radial joints at stations along the centre line, shrunk by grout; the arc's first radial line = the straight run's last joint), then the approved 8-piece set (whole, 3/4, 1/2, 1/4, queen closer, mitred 3/4, mitred 1/2, king closer; no thirds), seeded per-piece length variation on arcs + corners, cornerStyles (mitre default; lapped, block, stepped allowed: Fred OK'd non-mitred brick corners), and the 5 FRAME_PRESETS (soldier, soldier-stretcher, double-course, quoin-corners, header-band). Bar: meticulous cutting (piece-type membership, grout ±10%, min piece ≥ 1/4, zero overlap, coverage ≥ 95%) on T1, T12 and a square; close-up previews per preset. Commit as 'H23 item 76: ...'.
- [ ] [H23-item-77] (PARKED, Fred: "not now but note it") CAM BUILDER: clean + carved B-spline setups on the same part must sit in the EXACT same position. Stock is already identical (Fred's plan). To do: (1) stock MODEL POSITION aligned by the BOTTOM (Z bottom + fixed offset), never top/center, since the carved bbox is taller (bottom + outline are identical for both bodies); (2) WCS: a selected/shared point or stock top, never a model-bbox point ('box_point' in cam_engine/setup_builder.py drifts); applies to both sides incl. the flip; (3) every toolpath's HEIGHTS: Top = Stock top, Bottom = Stock bottom or the board's bottom face (selection), never 'Model top'. Written by the builder (setup_builder.py / templates), not by hand. (4) Fred measured: Fusion REFUSES rest machining across manufacturing models that aren't identical. So the carved setup's stock = FROM SOLID -> the CLEAN body (the clean board IS the in-process stock after the clean setup); rest machining 'from stock' inside the carved setup; small stock-to-leave for tool-radius leftovers. Probe in a scratch doc before building.
- [ ] [H23-item-78] (REDIRECTED by Fred: not a new template -- T10 itself must be NARROW HEAD + ARCHED TOP per his own reconstruction; old text follows for context) NEW TEMPLATE 18 "Arched Head" (Fred: "one template is missing: the narrow head with arched top"). = Template 11 (Hourglass Roof)'s body (narrow head above the eaves/shoulders, waist, base) but the pointed roof replaced by an ARCH over the narrow head (semicircular default, segmental via arch rise). DIAGRAM FIRST: render the proposal (app shape at 7x9 + handle ranges) to ~/.bspline-status/shots/seatA and STOP for Fred's OK before any Fusion work. Rules: ALWAYS MITER every bar joint (incl. arch-to-side), no hooked tips / short grain, moderate handle ranges (same as Funnel/Tulip), a top/head-width handle, arch rise handle with the 1/8in floor (like T10's archRise, MIN_ARCH_RISE_IN), the approved guards (undercut, outline defects, miters collide). Follow how T11 and T10 were built (sketches/template_11, template_10) + the template brief docs. Then the Fusion build at 7x9 + 9x12, goldens, the live matrix (BUILT criteria), frame-defs regen. Fusion only when fusion_holder.txt names you (ask the advisor).
- [ ] [H23-item-78b] TEMPLATE 10 = FRED'S RECONSTRUCTION (replaces 78; unfinished F29 item 2). Exact target (7x9, fractions of W/H, origin = board centre, y up) in ~/.bspline-status/shots/fred/t10_fred_reconstructed_sketch_dump_2026-10-01.txt (+ _constraints_2026-10-01.json): narrow head = top horns vertical at x=+-0.2735W from y=0.2523H down to -0.0154H; arch from (+-0.2735W, 0.2523H) through apex (0, 0.344H) [centre (0, 0.0515H)]; small shoulder arcs (centre +-0.2245W, -0.0154H) into a deep round waist (centre +-0.2063W, -0.1312H); hip arcs (centre +-0.2799W, -0.3455H) out to full width at y=-0.3455H; bottom horns on the board edge (+-0.4643W) down to the base at -0.4722H. FIRST: render target vs the current app T10 side by side to ~/.bspline-status/shots/seatA and STOP for Fred's OK. Then: the app geometry (frame-defs / handles: head width, arch rise >= 1/8in, waist, moderate ranges), the Fusion phases (always miter incl. arch-to-head), goldens 7x9 + 9x12, the live matrix, frame-defs regen. Taper/arch seeds (UnseededOnly etc.) must keep working.

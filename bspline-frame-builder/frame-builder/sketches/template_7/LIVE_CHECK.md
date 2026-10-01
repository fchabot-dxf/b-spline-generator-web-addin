# Template 7 (Diamond-top Hourglass): the live Fusion check

Template 7 has only been tested outside Fusion so far (seat B, no Fusion bridge). The app already draws it; its
shape MODEL is inherited from Template 1's own real, recorded goldens (not provisional — see the module doc
comment in `template_data.py`), since the shoulder/waist/hip ARCS are Template 1's own, unchanged. This session
in Fusion checks that the sketch actually SOLVES (the 45-45-90 peak construction and the new peak-pin
construction, §2 below, have never run inside real Fusion) and records geometry for the live check items below.

It takes about 20-30 minutes. A Claude session with the Fusion bridge (`fusion_execute`) can run every step
below for you. Each step opens its own scratch document and closes it without saving, so none of your own
designs are touched.

## 0. HISTORY — two real bugs found and fixed in the APP before any Fusion build happened

**Bug 1 (found by this session's own measurement, before Fred ever saw it): the peak protruded past the
board.** The first build (a literal "90 deg diamond peak, rise = run = the horn's own half-width") put the
peak `hw` above the safe zone's own top edge for every board size — confirmed by the JS-side sweep
(`tests/frame-3d-sweep.test.js`), which failed "outside the board" for literally every case.

**Bug 2 (Fred, 2026-09-30, a live phone screenshot of the app's own 3D preview): the SAME bug, seen live.**
"The diamond roof bars run above the board edge. The frame's outer profile must equal the board outline, so
the diamond apex sits ON the top edge of the board." This landed as the SAME finding from a different angle,
and settled the question §0 used to leave open (a narrower roof via an inset, vs. a taller board) — neither:
the peak is now PINNED to the board's own edge, never above it, regardless of board size.

**Both are FIXED, not disclosed-and-left:**
- The peak is pinned to the safe zone's own top edge (`editor-shape-lattice-generator.js`'s own `topEdgeY`):
  its own rise now comes OUT OF the horn's existing length (the horn gets shorter), never adds height above it.
- A SECOND, related overflow was found and fixed the same way while testing the fix: `hipFlare` (added by
  Fred's own reference-sketch amendment, see below) could push the widened base PAST the board's own left/right
  edge too. It is now capped at the `boundingboxoffset` margin (the same "outer profile = board outline" rule,
  sideways).
- `tests/frame-3d-sweep.test.js` no longer excludes Template 7 — it now passes the FULL sweep (5 board sizes x
  3 bottoms x 3 sculpts), and `tests/frame-template-7.test.js` has a dedicated board-bounds regression test at
  the three golden sizes (7x9, 12x6, 5.51x1.97), MUTATION-TESTED against both bugs (confirmed red when either
  fix is reverted, green when restored).

**The shape itself ALSO changed, per Fred's own reference sketch** (`template_sketches_2026-09-30.jpg`,
bottom-right): "a 90 deg diamond peak (two straight roof bars), a short horizontal ledge where each roof bar
meets the side, then the pinched waist, then hips that FLARE OUTWARD down to a wider flat base (bell-like)."
Two new frame-only params were added (`shoulderLedgeWidth`, `hipFlare`), both DEFAULT to 0 (no effect) for
every other hourglass-preset template, both exposed as T7's own handles. Fred's approved handle list is now:
**shoulder ledge width, waist reach, waist height, hip flare** (the shoulder/hip corner radii and the waist
radius keep their usual defaults but are no longer independent T7 handles).

A `frame-tab` screenshot of the corrected shape (desktop, headless Chrome) was taken and reviewed this session
— the diamond peak sits on the board's own top edge, the ledges are visible, the waist pinches, and the base
flares (subtly: it is capped at the `boundingboxoffset` margin, ~0.25 in on a 7 in board, so Fred may want a
bigger default `boundingboxoffset` on this template specifically if a more dramatic flare is wanted — not
changed here, since that is a different, explicit ask).

## 1. Install the new add-in
1. Deploy the add-in the usual way: `python DEPLOY_bspline-frame-builder.py` from the `bspline-frame-builder` folder.
2. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder` (and `CAM-builder`).
3. The Frame Builder template list should now show **Template 7 - Diamond-top Hourglass**.

## 2. Build it by hand once (10-15 min) — a NORMAL board now (7x9 is fine)

Unlike the first draft of this template, there is no longer a reason to reach for a tall/unusual board — the
peak is pinned to the board's own top edge by construction (§0), so a normal 7x9 should show the full shape
correctly. **The peak-pin construction (`safe_top_level` in `p02_03_loop.py`) has never run inside real
Fusion** — this is the one genuinely new thing to verify here; the 45-45-90 apex math itself is unchanged from
the first draft.

1. Open a new design with a 7 x 9 board and build Template 7 with its defaults.
2. Check these:
   - [ ] The timeline has no red or yellow items.
   - [ ] The outline is a pinched-waist, round-hipped hourglass topped by a short horizontal ledge on each
     side, then two straight roof lines meeting at a point ON the centre line. Both roof lines are the same
     length; the peak sits dead centre, AT (or very near) the board's own top edge — not sticking out past it.
   - [ ] The base is visibly a bit WIDER than the shoulders (the hip flare) — subtle at the default
     `boundingboxoffset` (0.25 in), not dramatic.
   - [ ] The peak's own angle reads as a right angle (90 deg) — sketch a construction angle dimension on it to
     confirm, or eyeball against a carpenter's square overlay.
   - [ ] The inner edge (frame_thickness inset) has 5 corresponding corners too, including at the peak.
   - [ ] There are 5 MITER lines (bar-to-bar joints): the peak, the two roof/ledge junctions, and the two
     base corners. The app's own 2D preview additionally draws a bend line at each ledge-to-horn WELD (a real
     90 deg kink in the outline, but the SAME physical bar, not a separate mitered joint) — 7 "corner-looking"
     lines total in the app, only 5 of which are real Fusion miters. Confirm Fusion itself builds only 5.
   - [ ] You get 5 bars: `frame_roof_right, frame_side_right, frame_base, frame_side_left, frame_roof_left`,
     and the trim cut works. `frame_side_right`/`frame_side_left` each now include their own ledge stub (6
     pieces per side, not 5) — confirm it is cut as ONE continuous piece, not split at the ledge.
   - [ ] Where each curvy side meets its own roof line (`shoulder_R`/`shoulder_L`, now at the roof/ledge
     junction, not at the horn directly), the corner is a genuine MITER (a visible kink), NOT a smooth tangent
     continuation.
3. If the build fails, send the log (see step 6). Look first for these lines:
   - `peak_on_safe_top`: an over-constrained hit here means `safe_top_level`'s own weld to
     `proj_off_corner_TR` conflicts with something — this is the NEW construction (§0), the most likely place
     a first-ever Fusion run of this template finds trouble.
   - `peak_45_equal`: an over-constrained hit here means the 45-45-90 construction pair
     (`peak_level_R`/`peak_rise_R`) conflicts with something.
   - `INNER CORNER peak`: a "no SketchPoint within ..." warning here specifically is the MOST LIKELY new
     failure — the peak's own inner-corner Direction is `(0, -sqrt(2))` (NOT the usual `(+-1,+-1)`, see
     `p03_03_inner_corner_resolve.py`'s own doc comment for the algebra); if this is wrong, the inner peak
     point will be off by a factor and the tolerance (0.05 cm) will miss it.
   - `MITER MISS`, and `NOT BUILT: one profile spans 2 bars`: a miter that did not split two bars.
4. With the sketch open, drag the existing Waist/Ledge/Flare handles a little (same as Template 1's own drag
   gesture). The peak should follow automatically (it has no handle of its own — its position is fully derived,
   see `editor-shape-lattice-generator.js`'s own `topPeak` doc comment): confirm the 90 deg angle is STILL
   exactly 90 deg after the drag, not just at the default, and the peak stays ON the top edge even as the ledge
   width changes.

## 3. Record the goldens (only once this build is confirmed correct)

Template 7 does not need its own goldens at all today (it inherits Template 1's own fitted model,
`{"from": "template_1"}` in `template_data.py`, plus two fixed-fraction features for the ledge/flare defaults)
and the app already works correctly without any. Recording its own goldens only makes sense if the shape gains
a genuinely NEW fitted feature later.

If ever needed:
```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_7", 7, 9), ("template_7", 12, 6), ("template_7", 5.51, 1.97)])
```

## 4. The app-seeded parity check (the "f20" check)

Same shape as every other template: `tools/repro/f20_seed_case.mjs` / `tools/repro/f20_live_parity.py` (set the
`SP` / `PARITY` paths at the top of that file first). Template 7 has 4 handles, all `"seeded"`: `waistReach`,
`waistCenterY`, `shoulderLedgeWidth`, `hipFlare` (Fred's own approved list — the shoulder/hip corner radii and
the waist radius are no longer independent handles for this template, see §0). Pass means: maxErr < 0.001,
healthy true, userParams has no new name (Template 7 adds no Fusion parameter of its own).

## 5. CAM (Manufacture)

Template 7's 5 bar names (`frame_roof_right`, `frame_side_right`, `frame_base`, `frame_side_left`,
`frame_roof_left`) match none of the 4 classic names, so CAM takes the SAME generic N-bar row layout Template 6
uses (`mm_builder.py`'s own `_populate_n_bar_frame_geometry`) — no CAM code change was needed. Check MM-Frame
layout and Frame setup toolpaths in Manufacture; screenshot the result. `frame_side_right`/`frame_side_left`
are now a slightly different SHAPE (an extra ledge stub) than Template 1's own plain sides — watch for whether
the generic row-layout rotation still picks a sensible orientation and bounding box for them.

## 6. Inversion sweep (bigger trim offsets)

`record_case` at `boundingboxoffset` 0.5 / 1.0, checked via `fb_engine.outline_invariants.outline_violations`
(same procedure as every other template) — expect `[]`. Also note whether a bigger `boundingboxoffset` makes
the hip flare visibly MORE pronounced (it should: the flare is capped at exactly that margin, §0).

## 7. What to send back

- The step-2 screenshots, the timeline state, the 45-45-90 peak measurement, and whether the peak sits ON the
  board's own top edge (not past it) at the default `boundingboxoffset`.
- The debug log if the build failed at any point (especially around `peak_on_safe_top`).
- §4's f20 JSON lines.
- The §5 CAM screenshot.
- The §6 inversion results, and whether the hip flare visibly grows with a bigger `boundingboxoffset`.
- Whether the overall shape (ledge + flare + peak) matches Fred's own reference sketch well enough, or needs
  the ledge/flare DEFAULT proportions tuned (`T7_SHOULDER_LEDGE_DEFAULT_OF_HW` / `T7_HIP_FLARE_DEFAULT_OF_HW`
  in `fb_engine/frame_definition.py` — a one-line change each, not a rebuild).

## 8. After this check (next coding session)

1. If the default ledge/flare proportions need tuning: change `T7_SHOULDER_LEDGE_DEFAULT_OF_HW` /
   `T7_HIP_FLARE_DEFAULT_OF_HW` in `fb_engine/frame_definition.py`, re-run `tests/frame-template-7.test.js`.
2. If goldens get recorded (only needed if the shape gains its own new fitted feature): run
   `python tools/gen_frame_defs.py` then `--check`.
3. Run all the tests (`npx vitest run`, `pytest` in `frame-builder` and `b-spline-gen`, and the repo root).
4. **A pre-existing gap, noticed but not fixed this turn (not Template 7's own responsibility):** none of the
   5 `tools/repro/ab/` scripts' own template lists include `template_6` either — only Templates 1-5 (now also
   7) were ever in them. Flagged for whoever owns Template 6's own live-Fusion follow-up.

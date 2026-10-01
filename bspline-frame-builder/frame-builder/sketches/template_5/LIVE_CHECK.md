# Template 5 (Hourglass Dipped Top): the live Fusion check

Template 5 has only been tested outside Fusion so far. The app already draws it, but it uses a
**provisional** shape: Template 1's measured shape with a dip added to the top edge (0.14 of the half-height
deep, 0.72 of the half-width wide on each side). This one session in Fusion checks that Fusion builds it,
and records the measurements the app needs for its real shape.

It takes about 30 minutes. A Claude session with the Fusion bridge (`fusion_execute`) can run every step
below for you. Each step opens its own scratch document and closes it without saving, so none of your own
designs are touched.

## 0. Install the new add-in

1. Deploy the add-in the usual way: `python DEPLOY_bspline-frame-builder.py` from the
   `bspline-frame-builder` folder.
2. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder`.
3. The Frame Builder template list should now show **Template 5 - Hourglass Dipped Top**.

## 1. Build it by hand once (5 min)

1. Open a new design with a 7 x 9 board and build Template 5 with its defaults.
2. Check these (at 7x9, defaults -- see "Known issue" in section 2 for 12x6 / 5.51x1.97):
   - [x] The timeline has no red or yellow items. (7 timeline items for the sketch phases, 0 unhealthy)
   - [x] The top edge has a smooth dip in the middle, about 0.6 in deep, with a short straight piece (about
     0.9 in) from each top corner before it starts. (measured: dip depth 0.594 in, stub length 0.91 in)
   - [x] The dip is centred and the same on both sides. The sides and the flat base look exactly like Template 1.
     (arc_top_shoulder_L/R and arc_top_dip all radius 2.4494 in, centers mirrored at x=+/-2.34)
   - [x] All four corners are square, and the four miter lines run at 45 degrees from each corner. (implied by
     a healthy timeline + correct bar extraction; not independently re-derived)
   - [x] You get 4 bars (frame_top, frame_right, frame_bottom, frame_left) and the trim cut works. frame_top
     is one curved bar that follows the dip. (bar names: frame_bottom, frame_left, frame_right, frame_top)
3. If the build fails, send the log (see step 5). Look first for these lines:
   - `top_dip_center_on_axis` (the dip's centre on the Y axis) and `top_shoulder_equal` (the two top shoulder
     arcs the same radius): the two constraints that keep the dip symmetric. "Over constrained" on one of
     them means it has to be removed.
   - `top_stub_weld_L` / `top_stub_weld_R` and the Tangent lines on `arc_top_*`: the dip's joints.
   - The two Horizontal constraints on `top_edge_L` / `top_edge_R`: the straight stubs lie flat on the top line.
   - `MITER MISS` or `INNER CORNER` warnings: the top-left miter now starts at `proj_top_edge_L:S`.
4. With the sketch open, drag the bottom of the dip up or down a little. The whole dip should move, and it
   should stay symmetric. Nothing on the sides should move.
   - Not verified by an actual sketch drag this session -- see the KNOWN ISSUE below instead: at 12x6 the
     dip's own symmetry breaks WITHOUT any drag at all (a plain default build), which is the more serious
     finding a drag test would have been checking for anyway.

**KNOWN ISSUE, found live, NOT fixed (see LIVE-RESULTS-ranchy.md item 3 for full detail):** at 12x6 (defaults,
no seeds), the top dip's LEFT/RIGHT tie (`top_shoulder_equal`, an Equal on the two shoulder arcs' RADIUS only)
does not keep the shoulders on their own correct sides at this aspect ratio -- measured: `arc_top_shoulder_R`
solves to a NEGATIVE x center (on the LEFT half of the board), `outline_violations()` correctly flags both it
and `top_edge_R` as "on the wrong side". At 5.51x1.97 the dip collapses into a degenerate split
(`frame_top`/`frame_top (1)`, two disconnected bodies, instead of the clean 0 bars Templates 1-4 give at that
size). Tried: replacing the Equal with a `Symmetry` constraint on the two shoulder arcs' centers about
Y_AXIS -- this DID reach Fusion (after finding and fixing a real, separate, and now-fixed dispatcher gap:
`fb_engine/parametric_engine.py`'s `_process_sequence` never had "Symmetry" in its `constr_types` allowlist,
even though `fb_engine/constraints.py` already implements `addSymmetry` -- kept that fix, it's safe and
correct regardless of Template 5's own outcome) -- but the added Symmetry constraint made the 12x6 sketch
UNSOLVABLE (`VCS_SKETCH_SOLVING_FAILED`) rather than fixing the flip, so it was reverted. Root cause not yet
found precisely; the seed geometry in `phases/p02_03_loop.py` scales the dip's radius by `heightIn` only
while the horizontal span it must bridge scales by `widthIn`, so at 12x6 (wide, short) the seed may simply be
too far from any valid solution for the solver to land on the intended (rather than mirrored) branch.
**Goldens recorded only at 7x9** (the sizes that build correctly); 12x6 and 5.51x1.97 deliberately left
unrecorded rather than committing broken data or using `fit.excluded` to hide a build bug.

## 2. Record the goldens (the real measurements)

In Fusion, through the bridge, run the recorder on Template 5 at the same three sizes the other templates use:

```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_5", 7, 9), ("template_5", 12, 6), ("template_5", 5.51, 1.97)])
```

This writes `template_5_7x9.json`, `template_5_12x6.json` and `template_5_5.51x1.97.json` into
`tests/fixtures/frame-parity/`. It is expected that 5.51 x 1.97 builds 0 bars, because that board is too small for the frame.

**Result: only 7x9 was actually committed** (4 bars, healthy, matches expectations). 12x6 and 5.51x1.97 both
recorded live but were DISCARDED, not committed -- see the KNOWN ISSUE in section 1: 12x6 flips asymmetric
(not the clean base case this step expects), and 5.51x1.97 gives a degenerate 2-piece `frame_top` split
instead of the "expected 0 bars" this checklist itself predicts. Both are genuine Fusion build bugs, not
goldens to trust.

## 3. The app-seeded parity check (the "f20" check)

This is what happens when you press **Send frame** from the app. The app sends its own seed positions, and
Fusion must end up with the same shape.

1. Make a case file on the computer (`TEMPLATE=template_5` picks the template; the last two numbers are the
   Top dip depth, as a fraction of the half-height, and the Top dip width, as a fraction of the half-width;
   `-` means "leave at the app's value"):

   ```
   set TEMPLATE=template_5
   node tools\repro\f20_seed_case.mjs t5_default.json 7 9 - - - - - - -
   node tools\repro\f20_seed_case.mjs t5_deep.json    7 9 - - - - - 0.3 -
   node tools\repro\f20_seed_case.mjs t5_narrow.json  7 9 - - - - - - 0.45
   node tools\repro\f20_seed_case.mjs t5_12x6.json   12 6 - - - - - 0.2 0.6
   ```

2. In Fusion, run `tools/repro/f20_live_parity.py` once per case (first set its `SP` / `PARITY` paths at
   the top to where the case files and `record_frame_parity.py` are). It prints a JSON line per case.
3. Pass means:
   - [ ] `maxErr` is below 0.001 (the arcs Fusion solved match the app's arcs, the three top arcs included).
     **FAILS in all 4 cases** (0.011 - 0.29 in observed) -- the shapeModel is still fully provisional for the
     dip (topDipDepth/topDipHalfWidth were never fitted -- see section 2's "known issue"), so the app's
     predicted arcs are the OLD provisional estimate, not a real fit; this is the expected consequence of
     that, per the advisor's own read, but the residual is far larger than Template 1/2's own real-fit
     residuals (<0.001 typical) so it deserves its own look once the build bug above is fixed and real
     goldens exist to fit from.
   - [x] `healthy` is true. (all 4 f20 cases: default, deep, narrow, 12x6 -- note the 12x6 f20 case, WITH
     explicit app seeds, stays symmetric and healthy; it's only the bare `build_frame_logic` DEFAULT path
     at 12x6, section 1's known issue, that flips.)
   - [x] `userParams` has **no** new name. In particular there is no `topDipDepth` or `topDipWidth`: only
     `widthIn` / `heightIn` and what Template 1 already has. (confirmed in all 4 cases)
   - [x] The three top arcs have the same radius (the app draws them that way). (confirmed in all 4 cases,
     including the seeded 12x6 case -- symmetric, just imprecise per the maxErr line above)

## 4. Inversion sweep (bigger trim offsets)

Record Template 5 at boundingboxoffset 0.5 and 1.0 on 7x9 and 12x6 into a scratch folder, not the
fixtures folder. Use `record_case("template_5", W, H, params={"boundingboxoffset": B})` from
`record_frame_parity.py`. Then check each result with `fb_engine.outline_invariants.outline_violations`:

- [ ] Every result gives `[]`. **FAILS at 2 of 4.** `outline_violations()` itself gave `[]` for all 4 (7x9/
  12x6 x 0.5/1.0), but the BAR COUNT/health told a different story: 7x9 @ offset 0.5 -> 4 bars, healthy
  (pass); 7x9 @ offset 1.0 -> only 2 bars (`frame_bottom`, `frame_right` -- `frame_left`/`frame_top` missing),
  healthy (a real, asymmetric loss the outline check alone didn't catch -- L/R asymmetry again, same family
  as the 12x6 flip above); 12x6 @ offset 0.5 -> 3 bars (`frame_top` missing), healthy; 12x6 @ offset 1.0 ->
  only 1 bar (`frame_top`), **timeline UNHEALTHY** -- a genuine Fusion build failure, not just an odd shape.
  Traced the 12x6/offset-1.0 case directly: `top_edge_L`/`top_edge_R` both collapse to meet exactly at
  (0, 2) -- the dip's width seed has been driven to 0 (a full-width flat top, no dip at all) but the arc
  chain collapses degenerately instead of cleanly disappearing. Same underlying cause as the other findings
  here: Template 5's dip has no "too small / too large an offset, don't even try" guard, and its fixed,
  height-scaled seed becomes a worse and worse starting guess as the safe zone shrinks. Not fixed this
  session -- see LIVE-RESULTS-ranchy.md.

## 5. What to send back

- The three `tests/fixtures/frame-parity/template_5_*.json` files.
- The printed JSON lines from step 3, one per case.
- The step 4 results: the list of violations per case, even if all are `[]`.
- The Frame Builder log, `...\AddIns\bspline-frame-builder\frame-builder\frame-builder-debug.log`. Do this
  especially if anything failed.
- A screenshot of the step 1 build, seen from the top.

## 6. After the goldens are in (next coding session)

**Not reached this session** -- only 1 of 3 goldens is trustworthy (7x9), and `gen_frame_defs.py`'s
dipped-top extractor needs at least 2 valid sizes to fit `topDipDepth`/`topDipHalfWidth` at all (confirmed:
running it with all 3 -- 2 of them broken -- left the shapeModel's `provisional` block in place unchanged,
same as running it with just the 1 good one). Once the 12x6/5.51x1.97 build bugs above are actually fixed and
re-recorded, the steps below apply as originally written:

1. Run `python tools/gen_frame_defs.py` and then `python tools/gen_frame_defs.py --check`. This replaces the
   provisional Template 5 shape with one fitted from the new goldens: the `provisional` block disappears,
   and `topDipDepth` / `topDipHalfWidth` are fitted. The other templates' entries must not change; only
   `sourceHash` changes.
2. Run all the tests (`npx vitest run`, and `pytest` in `frame-builder` and `b-spline-gen`). If a
   Template 5 golden was not "valid" for the dipped-top extractor (`fit.excluded`), look at why before
   trusting the fit.
3. Check the radii in the goldens. The app draws the three top arcs with one radius. Without Send frame,
   Fusion builds from the template's own seeds, which were made at 7 x 9. At 12 x 6 the shoulder and dip
   radii may come out a little different. If they differ by more than 0.01 in, the app needs a third dip
   value (a radius ratio) before the preview can match.
4. Consider adding `template_5` to `tests/frame-3d-sweep.test.js` (it needs the goldens).

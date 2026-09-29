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
2. Check these:
   - [ ] The timeline has no red or yellow items.
   - [ ] The top edge has a smooth dip in the middle, about 0.6 in deep, with a short straight piece (about
     0.9 in) from each top corner before it starts.
   - [ ] The dip is centred and the same on both sides. The sides and the flat base look exactly like Template 1.
   - [ ] All four corners are square, and the four miter lines run at 45 degrees from each corner.
   - [ ] You get 4 bars (frame_top, frame_right, frame_bottom, frame_left) and the trim cut works. frame_top
     is one curved bar that follows the dip.
3. If the build fails, send the log (see step 5). Look first for these lines:
   - `top_dip_center_on_axis` (the dip's centre on the Y axis) and `top_shoulder_equal` (the two top shoulder
     arcs the same radius): the two constraints that keep the dip symmetric. "Over constrained" on one of
     them means it has to be removed.
   - `top_stub_weld_L` / `top_stub_weld_R` and the Tangent lines on `arc_top_*`: the dip's joints.
   - The two Horizontal constraints on `top_edge_L` / `top_edge_R`: the straight stubs lie flat on the top line.
   - `MITER MISS` or `INNER CORNER` warnings: the top-left miter now starts at `proj_top_edge_L:S`.
4. With the sketch open, drag the bottom of the dip up or down a little. The whole dip should move, and it
   should stay symmetric. Nothing on the sides should move.

## 2. Record the goldens (the real measurements)

In Fusion, through the bridge, run the recorder on Template 5 at the same three sizes the other templates use:

```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_5", 7, 9), ("template_5", 12, 6), ("template_5", 5.51, 1.97)])
```

This writes `template_5_7x9.json`, `template_5_12x6.json` and `template_5_5.51x1.97.json` into
`tests/fixtures/frame-parity/`. It is expected that 5.51 x 1.97 builds 0 bars, because that board is too small for the frame.

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
   - [ ] `healthy` is true.
   - [ ] `userParams` has **no** new name. In particular there is no `topDipDepth` or `topDipWidth`: only
     `widthIn` / `heightIn` and what Template 1 already has.
   - [ ] The three top arcs have the same radius (the app draws them that way).

## 4. Inversion sweep (bigger trim offsets)

Record Template 5 at boundingboxoffset 0.5 and 1.0 on 7x9 and 12x6 into a scratch folder, not the
fixtures folder. Use `record_case("template_5", W, H, params={"boundingboxoffset": B})` from
`record_frame_parity.py`. Then check each result with `fb_engine.outline_invariants.outline_violations`:

- [ ] Every result gives `[]`. If one doesn't, a stub or arc has flipped to the wrong side (the F14
  problem), and the file is the evidence.

## 5. What to send back

- The three `tests/fixtures/frame-parity/template_5_*.json` files.
- The printed JSON lines from step 3, one per case.
- The step 4 results: the list of violations per case, even if all are `[]`.
- The Frame Builder log, `...\AddIns\bspline-frame-builder\frame-builder\frame-builder-debug.log`. Do this
  especially if anything failed.
- A screenshot of the step 1 build, seen from the top.

## 6. After the goldens are in (next coding session)

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

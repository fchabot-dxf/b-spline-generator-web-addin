# Template 4 (Offset Hourglass): the live Fusion check

Template 4 has only been tested outside Fusion so far. The app already draws it, but it uses a
**provisional** shape: Template 1's measured shape with the left waist moved up and the right waist moved
down. This one session in Fusion checks that Fusion builds it, and records the measurements the app needs
for its real shape.

It takes about 30 minutes. A Claude session with the Fusion bridge (`fusion_execute`) can run every step
below for you. Each step opens its own scratch document and closes it without saving, so none of your own
designs are touched.

## 0. Install the new add-in

1. Deploy the add-in the usual way: `python DEPLOY_bspline-frame-builder.py` from the
   `bspline-frame-builder` folder.
2. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder`.
3. The Frame Builder template list should now show **Template 4 - Offset Hourglass**.

## 1. Build it by hand once (5 min)

1. Open a new design with a 7 x 9 board and build Template 4 with its defaults.
2. Check these:
   - [x] The timeline has no red or yellow items. (12 timeline items, 0 unhealthy)
   - [x] The left waist pinch is higher than the right one (left centre about 60% up, right about 40%). (measured: left y=0.847 -> 59.4% up, right y=-0.853 -> 40.5% up)
   - [x] The top and bottom edges are full width and flat, the sides straight.
   - [x] Both waists have the same radius, and both shoulders and both hips too. (all 6 arcs: radius 0.6429, identical)
   - [x] You get 4 bars (frame_top, frame_right, frame_bottom, frame_left) and the trim cut works. (bar names: frame_bottom, frame_left, frame_right, frame_top)
3. If the build fails, send the log (see step 5). Look first for these lines:
   - `shoulder_arc_equal`, `waist_arc_equal`, `hip_arc_equal`: the three new constraints that tie the left
     and right radii together. "Over constrained" on one of them means it has to be removed.
   - `skel_*_pin_L:S` on `Y_AXIS`: the left pins now sit on the Y axis on their own (Template 1 welds
     them to the right pins). This is what lets the two waists have different heights.
4. With the sketch open, drag the left waist up or down a little. It should move on its own, and the
   right waist should stay put. If both move together, a left/right tie is still there.
   - [x] Verified via step 3's f20 seed cases instead of a manual sketch drag: `t4_high` seeds ONLY
     `waistCenterYLeft` (-0.35) and Fusion's solved right-waist arc center stays IDENTICAL to the
     unseeded default case (y=-0.8527 in both), while the left waist moves to y=1.4875 -- the left/right
     independence the drag check is after, confirmed by an actual different seeded height, not eyeballed.

## 2. Record the goldens (the real measurements)

In Fusion, through the bridge, run the recorder on Template 4 at the same three sizes the other templates use:

```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_4", 7, 9), ("template_4", 12, 6), ("template_4", 5.51, 1.97)])
```

This writes `template_4_7x9.json`, `template_4_12x6.json` and `template_4_5.51x1.97.json` into
`tests/fixtures/frame-parity/`. It is expected that 5.51 x 1.97 builds 0 bars, because that board is too small for the frame.

## 3. The app-seeded parity check (the "f20" check)

This is what happens when you press **Send frame** from the app. The app sends its own seed positions, and
Fusion must end up with the same shape.

1. Make a case file on the computer (`TEMPLATE=template_4` picks the template; the last two numbers are the
   Left waist position, as a fraction of the half-height, negative = up, and the Left waist reach, as a
   fraction of the half-width; `-` means "leave at the app's value"):

   ```
   set TEMPLATE=template_4
   node tools\repro\f20_seed_case.mjs t4_default.json 7 9 - - - - -
   node tools\repro\f20_seed_case.mjs t4_high.json    7 9 - - - -0.35 -
   node tools\repro\f20_seed_case.mjs t4_deep.json    7 9 - - - - 0.4
   node tools\repro\f20_seed_case.mjs t4_12x6.json   12 6 - - - 0.1 0.2
   ```

2. In Fusion, run `tools/repro/f20_live_parity.py` once per case (first set its `SP` / `PARITY` paths at
   the top to where the case files and `record_frame_parity.py` are). It prints a JSON line per case.
3. Pass means:
   - [x] `maxErr` is below 0.001 (the arcs Fusion solved match the app's arcs, both sides). (max observed 6.11e-05 across all 4 cases)
   - [x] `healthy` is true. (all 4 cases)
   - [x] `userParams` has **no** new name. In particular there is no `waistCenterYLeft` or
     `waistReachLeft`: only `widthIn` / `heightIn` and what Template 1 already has. (confirmed: widthIn, heightIn, boundingboxoffset, ck_arc_shoulder_weld, ck_arc_hip_weld, ck_skel_shoulder_equal, ck_skel_waist_equal, frame_thickness)
   - [x] The left waist arc centre is at the app's height, not at the right waist's height. (t4_high: left moved to y=1.4875, right unchanged at y=-0.8527)

## 4. Inversion sweep (bigger trim offsets)

Record Template 4 at boundingboxoffset 0.5 and 1.0 on 7x9 and 12x6 into a scratch folder, not the
fixtures folder. Use `record_case("template_4", W, H, params={"boundingboxoffset": B})` from
`record_frame_parity.py`. Then check each result with `fb_engine.outline_invariants.outline_violations`:

- [x] Every result gives `[]`. If one doesn't, a horn or arc has flipped to the wrong side (the F14
  problem), and the file is the evidence. (all 4 combos -- 7x9/12x6 x 0.5/1.0 -- gave `[]`, timeline healthy)

## 5. What to send back

- The three `tests/fixtures/frame-parity/template_4_*.json` files.
- The printed JSON lines from step 3, one per case.
- The step 4 results: the list of violations per case, even if all are `[]`.
- The Frame Builder log, `...\AddIns\bspline-frame-builder\frame-builder\frame-builder-debug.log`. Do this
  especially if anything failed.
- A screenshot of the step 1 build, seen from the top.

## 6. After the goldens are in (next coding session)

1. Run `python tools/gen_frame_defs.py` and then `python tools/gen_frame_defs.py --check`. This replaces the
   provisional Template 4 shape with one fitted from the new goldens: the `provisional` block disappears,
   and `waistCyLeft` / `notchLeft` / `depthLeft` are fitted. The other templates' entries must not change;
   only `sourceHash` changes.
2. Run all the tests (`npx vitest run`, and `pytest` in `frame-builder` and `b-spline-gen`). If a
   Template 4 golden was not "valid" for the offset-waist extractor (`fit.excluded`), look at why before
   trusting the fit.
3. Consider adding `template_4` to `tests/frame-3d-sweep.test.js` (it needs the goldens).

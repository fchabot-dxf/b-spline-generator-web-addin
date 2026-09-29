# Template 3 (Tapered Hourglass): the live Fusion check

Template 3 has only been tested outside Fusion so far. The app already draws it, but it uses a
**provisional** shape: Template 1's measured shape with the top pulled in. This one session in Fusion
checks that Fusion builds it, and records the measurements the app needs for its real shape.

It takes about 30 minutes. A Claude session with the Fusion bridge (`fusion_execute`) can run every step
below for you. Each step opens its own scratch document and closes it without saving, so none of your own
designs are touched.

## 0. Install the new add-in

1. Deploy the add-in the usual way: `python DEPLOY_bspline-frame-builder.py` from the
   `bspline-frame-builder` folder.
2. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder`.
3. The Frame Builder template list should now show **Template 3 - Tapered Hourglass**.

## 1. Build it by hand once (5 min)

1. Open a new design with a 7 x 9 board and build Template 3 with its defaults.
2. Check these:
   - [ ] The timeline has no red or yellow items.
   - [ ] The top edge is narrower than the bottom edge (about 5 in against 6.5 in).
   - [ ] The top is centred: the left and right top corners are the same distance from the centre.
   - [ ] The sides are straight, and the waist is narrower than the top.
   - [ ] The top and bottom edges are flat.
   - [ ] You get 4 bars (frame_top, frame_right, frame_bottom, frame_left) and the trim cut works.
3. If the build fails, send the log (see step 5). Look first for these two lines:
   - `shoulder_arc_equal`: this is the one new constraint that ties the left and right top corners
     together. "Over constrained" on this line means it has to be removed or replaced.
   - `top_edge:S` / `proj_off_BB_top`: this is the new "top edge rides on the safe-zone top line"
     constraint.

## 2. Record the goldens (the real measurements)

In Fusion, through the bridge, run the recorder on Template 3 at the same three sizes the other templates use:

```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_3", 7, 9), ("template_3", 12, 6), ("template_3", 5.51, 1.97)])
```

This writes `template_3_7x9.json`, `template_3_12x6.json` and `template_3_5.51x1.97.json` into
`tests/fixtures/frame-parity/`. It is expected that 5.51 x 1.97 builds 0 bars, because that board is too small for the frame.

## 3. The app-seeded parity check (the "f20" check)

This is what happens when you press **Send frame** from the app. The app sends its own seed positions, and
Fusion must end up with the same shape.

1. Make a case file on the computer (`TEMPLATE=template_3` picks the template; the last number is the
   Top width, as a fraction of the half-width; `-` means "leave at the app's value"):

   ```
   set TEMPLATE=template_3
   node tools\repro\f20_seed_case.mjs t3_default.json 7 9 - - -
   node tools\repro\f20_seed_case.mjs t3_top02.json   7 9 - - 0.2
   node tools\repro\f20_seed_case.mjs t3_top0.json    7 9 - - 0
   node tools\repro\f20_seed_case.mjs t3_12x6.json   12 6 - - 0.15
   ```

2. In Fusion, run `tools/repro/f20_live_parity.py` once per case (first set its `SP` / `PARITY` paths at
   the top to where the case files and `record_frame_parity.py` are). It prints a JSON line per case.
3. Pass means:
   - [ ] `maxErr` is below 0.001 (the arcs Fusion solved match the app's arcs).
   - [ ] `healthy` is true.
   - [ ] `userParams` has **no** new name. In particular there is no `topInset` or `top_inset`: only
     `widthIn` / `heightIn` and what Template 1 already has.
   - [ ] The top width is the app's width: for the right shoulder arc, `center x + radius` equals the
     app's top half-width.

## 4. Inversion sweep (bigger trim offsets)

Record Template 3 at boundingboxoffset 0.5 and 1.0 on 7x9 and 12x6 into a scratch folder, not the
fixtures folder. Use `record_case("template_3", W, H, params={"boundingboxoffset": B})` from
`record_frame_parity.py`. Then check each result with `fb_engine.outline_invariants.outline_violations`:

- [ ] Every result gives `[]`. If one doesn't, a horn or arc has flipped to the wrong side (the F14
  problem), and the file is the evidence.

## 5. What to send back

- The three `tests/fixtures/frame-parity/template_3_*.json` files.
- The printed JSON lines from step 3, one per case.
- The step 4 results: the list of violations per case, even if all are `[]`.
- The Frame Builder log, `...\AddIns\bspline-frame-builder\frame-builder\frame-builder-debug.log`. Do this
  especially if anything failed.
- A screenshot of the step 1 build, seen from the top.

## 6. After the goldens are in (next coding session)

1. Run `python tools/gen_frame_defs.py` and then `python tools/gen_frame_defs.py --check`. This replaces the
   provisional Template 3 shape with one fitted from the new goldens: the `provisional` block disappears,
   and `cornerRTop` / `cornerRBottom` / `topInset` are fitted. Template 1's and Template 2's entries must
   not change; only `sourceHash` changes.
2. Run all the tests (`npx vitest run`, and `pytest` in `frame-builder` and `b-spline-gen`). If a
   Template 3 golden was not "valid" for the narrow-top extractor (`fit.excluded`), look at why before
   trusting the fit.
3. Consider adding `template_3` to `tests/frame-3d-sweep.test.js` (it needs the goldens) and a
   Template 3 left/right symmetry check to `test_frame_parity_goldens.py`.

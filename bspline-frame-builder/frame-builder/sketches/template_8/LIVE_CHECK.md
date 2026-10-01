# Template 8 (Dipped Top + Left-Only Wave): the live Fusion check

Template 8 has only been tested outside Fusion so far (this is a "no Fusion" coding task; the live check is
deliberately a later session's job). The app already draws it, but it uses a **provisional** shape: a plain
straight right side and base, a left-side pinch like Template 1's own (0.2 of the half-width deep, centred), and
a dip like Template 5's own but shifted right (0.14 of the half-height deep, 0.4 of the half-width wide on each
side, its centre 0.15 of the half-width right of middle). This session in Fusion checks that Fusion builds it,
and records the measurements the app needs for its real shape.

A Claude session with the Fusion bridge (`fusion_execute`) can run every step below for you. Each step opens its
own scratch document and closes it without saving, so none of your own designs are touched.

## 0. Install the new add-in

1. Deploy the add-in the usual way: `python DEPLOY_bspline-frame-builder.py` from the `bspline-frame-builder`
   folder.
2. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder`.
3. The Frame Builder template list should now show **Template 8 - Dipped Top + Left-Only Wave**.

## 1. Build it by hand once (5 min)

1. Open a new design with a 7 x 9 board and build Template 8 with its defaults.
2. Check these:
   - [ ] The timeline has no red or yellow items.
   - [ ] The RIGHT side is one straight vertical line, corner to corner -- no curve or pinch at all.
   - [ ] The LEFT side has a smooth inward pinch (like Template 1's own waist), roughly centred vertically.
   - [ ] The top edge has a smooth dip, noticeably right of the centre line, with a short straight piece from
     each top corner before it starts (the right-hand stub shorter than the left-hand one).
   - [ ] All four corners are square, and the four miter lines run at 45 degrees from each corner.
   - [ ] You get 4 bars (frame_top, frame_right, frame_bottom, frame_left) and the trim cut works. frame_right
     is a plain straight bar; frame_top is one curved bar that follows the dip.
3. If the build fails, send the log (see step 5). Look first for these lines:
   - `shoulder_center_pin_L` / `hip_center_pin_L` / `waist_center_pin_L`: the LEFT pinch's own welds -- there are
     no `_R` equivalents at all for this template, by design.
   - `top_shoulder_equal`: the one tie left on the top (both shoulder arcs the same radius) -- "over constrained"
     here is the most likely failure, since the dip is no longer centred (no `top_dip_center_on_axis` exists for
     this template at all: the dip's position is left to the seeds).
   - `top_stub_weld_L` / `top_stub_weld_R` and the Tangent lines on `arc_top_*`: the dip's joints.
   - `side_R` should NOT appear in any constraint-failure line referencing a radius or a Tangent -- it is a
     plain line with no arc neighbour, welded directly between `top_edge_R:E` and `bottom_edge:S`.
   - `MITER MISS` or `INNER CORNER` warnings: the top-left miter starts at `proj_top_edge_L:S`, the top-right one
     at `proj_side_R:S` (not a horn -- there isn't one on the right).
4. With the sketch open:
   - [ ] Drag the LEFT waist pinch sideways a little. Only the left side should move; the right side and the
     dip should stay put.
   - [ ] Drag the bottom of the dip up or down a little. The whole dip should move (both shoulders with it);
     the sides should stay put.

## 2. Record the goldens (the real measurements)

In Fusion, through the bridge, run the recorder on Template 8 at the same three sizes the other templates use:

```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_8", 7, 9), ("template_8", 12, 6), ("template_8", 5.51, 1.97)])
```

This writes `template_8_7x9.json`, `template_8_12x6.json` and `template_8_5.51x1.97.json` into
`tests/fixtures/frame-parity/`. It is expected that 5.51 x 1.97 builds 0 bars, because that board is too small
for the frame.

## 3. The app-seeded parity check (the "f20" check)

This is what happens when you press **Send frame** from the app. The app sends its own seed positions, and
Fusion must end up with the same shape.

**First:** `tools/repro/f20_seed_case.mjs` and `tools/repro/f20_live_parity.py` don't know this template's own 5
params yet (Template 4 added its left-waist pair at argument positions 7/8, Template 5 its dip pair at 9/10 --
this template needs its own next positions for `waveHeight`, `waveReach`, `topDipWidth`, `topDipPosition`,
`topDipDepth`). Extend both scripts the same way those two templates' own additions did, before running this
step.

1. Make a case file on the computer (`TEMPLATE=template_8` picks the template; `-` means "leave at the app's
   value"):

   ```
   set TEMPLATE=template_8
   node tools\repro\f20_seed_case.mjs t8_default.json 7 9 - - - - - - - - - -
   node tools\repro\f20_seed_case.mjs t8_deepwave.json 7 9 - - - - - - - 0.5 - -
   node tools\repro\f20_seed_case.mjs t8_rightdip.json 7 9 - - - - - - - - - 0.3
   node tools\repro\f20_seed_case.mjs t8_12x6.json    12 6 - - - - - - - - 0.3 -0.2
   ```

2. In Fusion, run `tools/repro/f20_live_parity.py` once per case (first set its `SP` / `PARITY` paths at the
   top to where the case files and `record_frame_parity.py` are). It prints a JSON line per case.
3. Pass means:
   - [ ] `maxErr` is below 0.001 (the arcs Fusion solved match the app's arcs, the wave and the three top arcs
     included).
   - [ ] `healthy` is true.
   - [ ] `userParams` has **no** new name: only `widthIn` / `heightIn`, `frame_thickness`, `boundingboxoffset`,
     `ck_arc_shoulder_weld` and `ck_arc_hip_weld`. In particular there is no `waveHeight`, `waveReach`,
     `topDipWidth`, `topDipPosition` or `topDipDepth`.
   - [ ] The two top shoulder arcs have the same radius (the app draws them that way, even off centre).

## 4. Inversion sweep (bigger trim offsets)

Record Template 8 at boundingboxoffset 0.5 and 1.0 on 7x9 and 12x6 into a scratch folder, not the fixtures
folder. Use `record_case("template_8", W, H, params={"boundingboxoffset": B})` from `record_frame_parity.py`.
Then check each result with `fb_engine.outline_invariants.outline_violations`:

- [ ] Every result gives `[]`. If one doesn't, a stub or arc has flipped to the wrong side (the F14 problem),
  and the file is the evidence.

## 5. What to send back

- The three `tests/fixtures/frame-parity/template_8_*.json` files.
- The printed JSON lines from step 3, one per case.
- The step 4 results: the list of violations per case, even if all are `[]`.
- The Frame Builder log, `...\AddIns\bspline-frame-builder\frame-builder\frame-builder-debug.log`. Do this
  especially if anything failed.
- A screenshot of the step 1 build, seen from the top.

## 6. After the goldens are in (next coding session)

1. Run `python tools/gen_frame_defs.py` and then `python tools/gen_frame_defs.py --check`. This replaces the
   provisional Template 8 shape with one fitted from the new goldens (`fb_engine/frame_shape_fit.py`'s own
   `_dipped_left_wave` extractor, already declared and tested against synthetic data -- `fb_engine/
   test_frame_shape_fit.py`): the `provisional` block disappears, and `waveDepth` / `waveCy` / `topDipHalfWidth`
   / `topDipPosition` / `topDipDepth` are fitted. The other templates' entries must not change; only
   `sourceHash` changes.
2. Run all the tests (`npx vitest run`, and `pytest` in `frame-builder` and `b-spline-gen`). If a Template 8
   golden was not "valid" for the extractor (`fit.excluded`), look at why before trusting the fit.
3. `editor-shape-lattice-generator.js`'s own `paramsFromShapeModel` branch for `dippedLeftWave` reads the fitted
   `waveDepth` directly (no root-picking the way Template 1/4's `depth`/`notch` need) -- that was fine for the
   provisional model (its own `waveDepth` feature IS the exact value, not a noisy fit), but a REAL fit fitted
   independently from `waveNotch` may not exactly satisfy the tangency equation `d = S +/- sqrt(S^2 - notch^2)`
   the way Template 1/4's depth does. If the live-fitted shape looks subtly off (the wave not quite tangent),
   add the same root-picking Template 1/4 use, reading `waveCornerR` + `waveR` (also fitted) for `S`.
4. Consider adding `template_8` to `tests/frame-3d-sweep.test.js` (it needs the goldens).

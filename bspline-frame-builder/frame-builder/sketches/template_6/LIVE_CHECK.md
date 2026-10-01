# Template 6 (Tab Top): the live Fusion check

Template 6 has only been tested outside Fusion so far. It is the first frame with more than 4 bars and with
**inside corners**. The app already draws it, but with a **provisional** shape: a tab half as wide as the
safe zone (0.5 of the half-width on each side) and half the half-height tall. This one session in Fusion
checks that Fusion builds all 8 bars, and records the measurements the app needs for its real shape.

It takes about 30 minutes. A Claude session with the Fusion bridge (`fusion_execute`) can run every step
below for you. Each step opens its own scratch document and closes it without saving, so none of your own
designs are touched.

## 0. Install the new add-in

1. Deploy the add-in the usual way: `python DEPLOY_bspline-frame-builder.py` from the
   `bspline-frame-builder` folder.
2. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder` (and `CAM-builder`).
3. The Frame Builder template list should now show **Template 6 - Tab Top**.

## 1. Build it by hand once (5 min)

1. Open a new design with a 7 x 9 board and build Template 6 with its defaults.
2. Check these:
   - [x] The timeline has no red or yellow items. (16 timeline items, 0 unhealthy -- no over-constraint on
     the 2 left/right Equals, per the handoff's own "most likely failures" table)
   - [x] The outline is a rectangle with a narrower tab centred on top: about 3.25 in wide and 2.1 in tall.
     All 8 pieces are straight, and the shape is the same on both sides. (measured: tab 3.25 in wide,
     2.126 in tall, mirrored at x=+/-1.625)
   - [x] The inner edge (the frame thickness in from the outline) has 8 sharp corners too. At the two
     **inside** corners (where a shoulder meets the tab) the inner edge must be a sharp corner, not a
     small rounded arc. (confirmed directly: inner_proj_tab_side_R and inner_proj_shoulder_R are both
     SketchLines meeting at the exact same point (0.8746, 1.3738); same on the left)
   - [x] There are 8 miter lines, one at every corner, all at 45 degrees. (confirmed: 8 miter-* curves, one
     per bar)
   - [x] You get 8 bars: `frame_tab_top`, `frame_tab_right`, `frame_shoulder_right`, `frame_side_right`,
     `frame_base`, `frame_side_left`, `frame_shoulder_left`, `frame_tab_left`, and the trim cut works.
     (all 8 confirmed by name)
3. If the build fails, send the log (see step 6). Look first for these lines:
   - `tab_top_side_equal` / `tab_top_shoulder_equal`: the two Equal constraints that keep the tab centred
     and the shoulders level. "Over constrained" on one of them means it has to be removed.
   - `INNER CORNER inside_R` / `inside_L`: the inside corners. A "no SketchPoint within ..." warning here
     means the inner edge was not a sharp corner there (see above).
   - `MITER MISS`, and `NOT BUILT: one profile spans 2 bars`: a miter that did not split two bars.
4. With the sketch open, drag the tab's top edge sideways and the shoulder up or down a little. The tab
   should stay centred and the shoulders level. The base and the sides should not move.
   - [x] Verified via step 3's f20 seed cases instead of a manual sketch drag: `t6_wide` (tabWidth 0.7) and
     `t6_tall` (tabHeight 0.9) both solved with maxErr effectively 0 (floating-point epsilon), the tab
     staying centred and the base/sides unchanged -- a real seeded drag, not eyeballed.

## 2. Record the goldens (the real measurements)

In Fusion, through the bridge, run the recorder on Template 6 at the same three sizes the other templates use:

```
exec(open(r"<repo>\tools\repro\record_frame_parity.py").read())
main(r"<repo>\tests\fixtures\frame-parity", [("template_6", 7, 9), ("template_6", 12, 6), ("template_6", 5.51, 1.97)])
```

This writes `template_6_7x9.json`, `template_6_12x6.json` and `template_6_5.51x1.97.json` into
`tests/fixtures/frame-parity/`. It is expected that 5.51 x 1.97 builds 0 bars, because that board is too
small for the frame. The two others must list the 8 bars above.

**Result: all 3 recorded and committed, all pass.** 7x9 and 12x6 both give all 8 named bars, healthy.
5.51x1.97 correctly gives 0 bars (matching Templates 1/2/4 -- Template 6 does NOT have Template 3/5's
missing-guard problem). At 12x6 the tab comes out 1.251 in tall (unclamped, from the template's own fixed
seed fractions) -- shorter than 2x the 0.75 in frame thickness, exactly the "short tab" case this section's
own note anticipates; the app's own clamp (not exercised by this bare Fusion build) would apply on Send.

## 3. The app-seeded parity check (the "f20" check)

This is what happens when you press **Send frame** from the app. The app sends its own seed positions, and
Fusion must end up with the same shape.

1. Make a case file on the computer (`TEMPLATE=template_6` picks the template; the last two numbers are the
   Tab width, as a fraction of the half-width, and the Tab height, as a fraction of the half-height; `-`
   means "leave at the app's value"):

   ```
   set TEMPLATE=template_6
   node tools\repro\f20_seed_case.mjs t6_default.json 7 9 - - - - - - - - -
   node tools\repro\f20_seed_case.mjs t6_wide.json    7 9 - - - - - - - 0.7 -
   node tools\repro\f20_seed_case.mjs t6_tall.json    7 9 - - - - - - - - 0.9
   node tools\repro\f20_seed_case.mjs t6_12x6.json   12 6 - - - - - - - 0.4 0.6
   ```

2. In Fusion, run `tools/repro/f20_live_parity.py` once per case (first set its `SP` / `PARITY` paths at
   the top to where the case files and `record_frame_parity.py` are). It prints a JSON line per case.
3. Pass means:
   - [x] `maxErr` is below 0.001 (the 8 lines Fusion solved match the app's lines end to end). (max observed
     8.88e-16 across all 4 cases -- floating-point epsilon, effectively exact)
   - [x] `healthy` is true. (all 4 cases)
   - [x] `userParams` has **no** new name. In particular there is no `tabWidth` or `tabHeight`: only
     `widthIn` / `heightIn` and the usual frame parameters. (confirmed: widthIn, heightIn, boundingboxoffset,
     frame_thickness -- no arc-related ck_* params either, since T6 is all lines)

## 4. CAM (Manufacture)

1. On the step 1 design, run CAM Builder as usual.
2. Check these:
   - [x] MM-Frame holds the 8 bars, laid flat in one row, each turned so its long side runs along Y, with
     the usual clearance between them. Ran `cam_engine.cam_coordinator.run()` directly (not via the palette
     UI) -- confirmed by reading the Frame setup's own `.models` (all 8, by name) and each one's bounding
     box: 8 distinct, non-overlapping ~0.75in-wide X bands from x=3.5 to x=13.35, each with its Y-extent far
     larger than its X-extent (e.g. `frame_base` 0.75 in wide x 6.5 in tall) -- a single row along X, long
     side along Y, exactly as specified. (No CamLogger instance was passed, so the "laid out N pieces" log
     line itself wasn't captured this run; the direct bbox read is stronger evidence than the log line would
     have been anyway.)
   - [x] The Frame setup generates its toolpaths on all 8 bars. (Frame setup: 2 operations, non-zero, `ok:
     true` in the coordinator's own report)
3. Send a top-view screenshot of MM-Frame. The row layout is a stand-in (see the open questions in the
   work log): it may be longer than your stock.
   Screenshot: `C:/Users/danse/.bspline-status/shots/seatA/1935_H23-item4_template6_cam_mmframe.png`
   (shows the original frame outline alongside all 8 bars laid out in the row).

## 5. Inversion sweep (bigger trim offsets)

Record Template 6 at boundingboxoffset 0.5 and 1.0 on 7x9 and 12x6 into a scratch folder, not the
fixtures folder. Use `record_case("template_6", W, H, params={"boundingboxoffset": B})` from
`record_frame_parity.py`. Then check each result with `fb_engine.outline_invariants.outline_violations`:

- [x] Every result gives `[]`. If one doesn't, a piece has flipped to the wrong side (the F14 problem),
  and the file is the evidence. (all 4 combos -- 7x9/12x6 x 0.5/1.0 -- gave `[]`, timeline healthy, all 8
  bars present in every combo)

## 6. What to send back

- The three `tests/fixtures/frame-parity/template_6_*.json` files.
- The printed JSON lines from step 3, one per case.
- The step 4 screenshot and the step 5 results (the list of violations per case, even if all are `[]`).
- The Frame Builder log, `...\AddIns\bspline-frame-builder\frame-builder\frame-builder-debug.log`. Do this
  especially if anything failed.
- A screenshot of the step 1 build, seen from the top.

## 7. After the goldens are in (next coding session)

1. Run `python tools/gen_frame_defs.py` and then `python tools/gen_frame_defs.py --check`. This replaces the
   provisional Template 6 shape with one fitted from the new goldens: the `provisional` block disappears,
   and `tabHalfWidth` / `tabHeight` are fitted. The other templates' entries must not change; only
   `sourceHash` changes.
2. Run all the tests (`npx vitest run`, and `pytest` in `frame-builder` and `b-spline-gen`). If a
   Template 6 golden was not "valid" for the tab-top extractor (`fit.excluded`), look at why before
   trusting the fit.
3. Without Send frame, Fusion builds from the template's own seeds, which were made at 7 x 9: at 12 x 6 its
   tab is 1.375 in tall, shorter than 2 x the 0.75 in frame thickness. The app clamps that to 1.5 in. If the
   12 x 6 golden shows the short tab, that is expected; a fitted model will carry it, and the app will still
   clamp it.
4. Consider adding `template_6` to `tests/frame-3d-sweep.test.js`'s volume check (it needs the goldens).

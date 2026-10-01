# Template 7 (Diamond-top Hourglass) — LIVE_CHECK

Fusion/goldens checks need the Fusion bridge (not available on seat B/lane-b); the app-side (JS)
checks below were run against the real app in a headless browser (seat B can do this without
Fusion) and are already ticked with their result. Run from the `bspline-frame-builder/` folder
(`python -m http.server <port>`), palette at `/b-spline-gen/html/bspline_gen_palette.html`.

## Fusion sketch build (seat A / Fred, needs Fusion)

- [ ] **First use of `min()` inside a Fusion expression string** in this codebase
      (`sketches/template_7/phases/p02_02_loop.py`, the roof half-width `a = min(0.62*hw, 0.84*hh)`).
      Fusion's expression editor documents `min`/`max`/`sqrt`/trig as supported but nothing here has
      exercised it before. Confirm no red/broken expression on the very first build at 7x9.
- [ ] **The eave corner's inner-corner Distance is baked from DEFAULT handle proportions**
      (`p03_03_inner_corner_resolve.py`'s own docstring: `ui_data` never carries the seeded
      neck/body handle fractions, only the declared Fusion params). Exact at default. Drag each of
      the 3 handles (Neck width, Neck height, Body flare height) to a visibly different value, Send,
      and check the Fusion log for `INNER CORNER eave_R/eave_L: no SketchPoint within 0.2 cm` — if it
      fires, that miter fails to resolve at that handle setting. If it fails on a real, useful drag
      (not just an extreme corner), the fix is a new channel carrying live handle fractions into
      `ui_data` (additive, every other template already ignores unknown keys) — not a wider Tolerance.
- [ ] **No skeleton pins** (unlike T1/T8): reasoned that the neck/body arc centres are fully
      determined by their own 3-point seed + the 2 Tangent constraints (p02_04_tangency.py), with no
      independent "design height" the way T1/T8's shoulder/waist/hip needed a pin for. Unverified
      against a real Fusion solve. If the sketch comes up under- or over-constrained, start there.
- [ ] Build clean at 7x9, 6x9 (or whichever sizes Fred's own approved diagram used), all 5 miters
      resolve, no "wing" (every bar >= frame_thickness — the app-side JS check below already confirms
      this numerically for the JS preview; confirm the real Fusion-built bars too).
- [ ] Record goldens (`tools/repro/record_frame_parity.py`) at 2+ sizes, then re-run
      `python tools/gen_frame_defs.py` — this replaces the provisional shapeModel with a real fit and
      exercises `fb_engine/frame_shape_fit.py`'s own `_diamond_top_hourglass` extractor for the FIRST
      time (its own docstring: "FIRST CUT, unverified against a real golden JSON" — check the recorded
      curve dict's actual key shape, e.g. does an Arc3Point entry carry `start`/`end` alongside
      `center`/`radius`, matches what that extractor assumes).
- [ ] A/B: `tools/repro/ab/ab6.mjs`/`ablat6.mjs`/`ab3d.mjs` don't yet include template_7 in their own
      checked-template lists (per their own convention: append only after THIS checklist passes).
      Append it once the Fusion build is confirmed stable.

## App-side (JS) — run by seat B, already ticked

- [x] **`diamondTopHourglass` preset wired** (PRESETS/PARAM_ORDER/DERIVED_PARAM_DEFAULTS/
      FRAME_ONLY_PARAM_KEYS/SALT, `editor-shape-lattice-generator.js`). Fixed a real regression this
      introduced: the first attempt used a bare `neckWidth` key, which collided with Bottle's own
      `neckWidth` param (`FRAME_ONLY_PARAM_KEYS` and the manifest's own exclusion filter key by bare
      name across every preset) and silently dropped Bottle's real parameter from the Fusion manifest
      — caught by `tests/editor-sketch-manifest.test.js`'s own `manifestFromShape(bottle)` count check
      before it shipped. Renamed to `gableNeckWidth`.
- [x] **`diamondTopHourglassConstruction` + `_solveDiamondTopHourglass`** (the JS port of
      `fb_engine/t7_geometry.py`'s own closed-form neck/body arc solve) — verified NUMERICALLY IDENTICAL
      to the Python side at matching inputs (E/N/B points, rNeck/rBody, cNeck/cBody all matched to 10+
      decimal places).
- [x] **Two real arc-direction bugs found and fixed** (neither ever exercised by an earlier template):
      `_curveSegment`'s own "radius + outward(bool)" contract silently picks the wrong one of the 2
      possible circles through 2 given points as this shape's own proportions vary (fixed:
      `_curveSegmentForKnownCenter`, matches the known centre via the real pipeline, not a predicted
      sign); even once the centre is right, the SAME centre is reachable two ways (opposite
      rotation), and picking the wrong one hands the neighbour an exactly-reversed tangent (fixed:
      `_tangentPairForKnownCenters`, resolves the neck+body pair TOGETHER against their real shared
      tangent, plus the straight-side tangent next to the body arc, not independently).
- [x] **A real inset bug found and fixed**: under a non-zero stroke inset (`manifestFromShape`'s own
      default stroke width — genuinely exercised, not theoretical), the neck/body arcs' own mutual
      tangent point N shifts along the centre-to-centre line (one radius grows, the other shrinks,
      centres fixed) — an earlier version reused the un-inset N, which was off both new circles by
      exactly the inset amount and crashed every (major,dir) combination. Fixed.
- [x] **A real provisional-model bug found and fixed**: the first provisional `neckHeight`/
      `bodyFlareHeight` encoding approximated `rest ~= 2*hh`, off by ~30% at 7x9 (the roof's own `a`
      is not a small correction against `hh`) and silently shrank the drawn straight side below
      `frame_thickness` at the template's own DEFAULT proportions. Fixed with an EXACT encoding for
      portrait boards (`rest = 2*hh - 0.62*hw`, exact whenever hw < hh — always, for Fred's own usage).
- [x] **Handle ranges are DELIBERATELY NARROW**, not the theoretical [0,1] (`_diamondTopHourglassRange`
      own doc comment): a full board x handle-value sweep found the valid region is not simply
      "clamp the obvious ends" — both a too-narrow and a too-wide neck/body gap can self-intersect,
      non-monotonically, and no closed form for the 3-parameter x board-aspect-ratio coupling was
      derived. The declared box is a directly-tested-safe region around the template's own defaults
      (verified clean at its own corners/centre on 7x9, 9x12, 8x8, 7x7, 9x9). **[Generate] has its own
      independent safety net regardless** (`frame-handles.js generateValidFrameSeeds`, the real app's
      own `frame-panel.js generateFrame` already uses it unconditionally for every template — the
      SAME retry-until-valid mechanism Template 10 already relies on).
- [x] **LANDSCAPE boards are a known, flagged gap, not silently patched over**: 12x6 self-intersects
      even at the template's own default proportions; 5.51x1.97 has NO valid tangent-consistent pair
      at all within this construction. `_tangentPairForKnownCenters` degrades gracefully (picks the
      best-scoring candidate instead of throwing — a visibly imperfect preview, not a hard crash) but
      this is NOT the same as "correct". Consistent with `project_portrait_only` (Fred currently
      builds portrait boards only; a landscape fallback is accepted, not prioritized) — if Fred ever
      wants a landscape Diamond-top Hourglass, this needs real work (very likely: support BOTH
      `a = min(0.62*hw, 0.84*hh)` branches properly, not just assume the portrait one, in the range
      function and the provisional model).
- [x] **`HANDLE_SEGMENT_INDEX`/`controlledSegments` fixed**: the generic `mirrorSegmentIndex(1,9)`
      gives the WRONG pairing for this outline's own starting point (measured: 6, not 7, the actual
      mirrored neck arc) — added a declared `DIAMOND_TOP_HOURGLASS_SEGMENT_PAIRS` table
      (`editor-shape-lattice-interaction.js`), the same fix T8/T9 needed for their own topologies.
- [x] **Real app screenshot, headless Chrome** (`tools/repro/frame_profile_shots.mjs`, 7x9 default):
      `{"profileDrawn":true,"defects":0,"fit":true,"board":[7,9]}` — the actual app, not an isolated
      test, renders Template 7 cleanly at its own defaults. Shots in
      `C:/Users/danse/.bspline-status/shots/seatB/t7_frame_tab_editor.png` (the drawn silhouette: a
      clean, symmetric gable peak, concave neck pinch, convex body flare) and `..._sidebar.png` (the
      Frame panel correctly lists "7. Diamond-top Hourglass").
- [ ] **Not yet checked live**: the on-canvas drag handles' own anchor placement (3 position squares
      declared in `editor-shape-lattice-interaction.js`'s own `diamondTopHourglass` branch, FIRST CUT,
      not yet visually verified) — do they sit where a user would expect (at the neck/body points),
      and does dragging each one move the right thing? A screenshot confirmed the STATIC profile
      renders correctly; it did not exercise an actual drag gesture.
- [ ] **Not yet checked live**: the 3D preview (`core/preview/frame-mesh.js`) and the carved panel's
      own interaction with the frame outline at this template specifically (the static 2D profile is
      confirmed; the 3D mesh/clip path was not screenshotted this turn).

## Python test suite (run by this seat, no Fusion needed)

`python -m pytest -q` at the frame-builder root: 406 passed, 24 skipped (unchanged count of failures:
zero). `npx vitest run` at the repo root: 2926 passed, 155 files (unchanged count of failures: zero).
A/B (`tools/repro/ab/ab6.mjs`/`ablat6.mjs`, Python `tools/repro/ab/abpy.py`): byte-identical hashes
before/after every change this turn made, for templates 1-6, 8 (Python) and 1-6 (JS/lattice/3D).

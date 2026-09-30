# Handoff: the local session on ranchy takes over

From the cloud session (branch `claude/lucid-ride-jycpox`, last commit fd82744 + this file) to the local
Claude session on ranchy, which has Fusion 360 and the Fusion bridge. Written 2026-09-30.

**From here on, the local session owns the B-spline frame builder work.** The cloud session has stopped.
Nothing is in progress: the working tree was clean when this was written.

The cloud session could not run Fusion, so everything below marked *untested live* has only been checked
in a headless browser and with unit tests. Your first job is the live checks. After that, continue with
Fred's ideas in section 5.

---

## 1. Rules (Fred's standing rules for this repo)

- **Log every change** in `WORK-LOG-fb-app.md` (repo root).
- **Push every commit to both** `claude/lucid-ride-jycpox` and `main`. `main` deploys the web app to
  bspline-generator.pages.dev (Cloudflare Pages), so push to `main` only after tests pass.
- **Scope:** only the integrated `bspline-frame-builder/`.
- **Don't build when Fred is "just asking".** He gets annoyed by building before approval, and also by
  over-asking. Asking "is X possible / does it conflict?" means: answer, don't code.
- **Keep answers short and plain.** Fred said "Too complex" to long explanations. He mostly works from his phone.
- **Frame templates:** never hand-edit `frame-defs.json/.js`. Regenerate them with `python tools/gen_frame_defs.py`,
  and check with `--check`.
- **New templates must not change old ones.** Every template change so far was A/B-checked
  byte-identical on Templates 1..N-1 (see section 6).
- Fred's shop: an Ultimate Bee CNC with a DDCS Expert controller. He designs and posts in Fusion 360.

## 2. Frame design rules (learned from Fred this round)

The frame is **cut as separate mitered bars on the CNC and glued up**. So:

- Every corner is a clean miter. Square corners get a 45° miter; any corner angle works, since the miter
  bisects it.
- Each bar runs corner to corner at an even width.
- Accepted shapes: square corners with a short straight stub on both legs of each corner. Between corners
  an edge may pinch inward with smooth tangent arcs; the top edge may dip too. Flat top and base are
  **not** required.
- Rejected, and why:
  - vase: no real corners;
  - pillow and four-way pinch: curved edges meeting at non-square corners without stubs;
  - wave: the corners aren't 90° and the shape looked wrong to Fred;
  - pointed-top ideas: Fred said no.
- More than 4 bars is fine. Inside (270°) corners are fine.

## 3. What's built (all pushed, all live on the website)

| # | Template | Commit | Notes |
|---|---|---|---|
| 1 | Hourglass | old | measured live (goldens exist) |
| 2 | Narrow Neck | old | measured live (goldens exist) |
| 3 | Tapered Hourglass | 3b30de9 | top narrower than the base; "Top width" handle. *Untested live* |
| 4 | Offset Hourglass | 30fa2b6 | left/right pinches move independently; "Left waist position/reach" handles. *Untested live* |
| 5 | Hourglass Dipped Top | 20620b2 | top = stub + 3 arcs + stub (16 pieces); "Top dip depth/width". *Untested live* |
| 6 | Tab Top | fd82744 | battery shape, **8 bars**, 2 inside corners; "Tab width/height". *Untested live* |

- **Multiple bars (fd82744).** A template can now declare `regions.corners` and `regions.bars`, and miters and bar
  names come from those. The classic 4-bar layout stays the default.
- **CAM.** Frames without the 4 classic bar names get a minimal one-row layout in `CAM-builder/cam_engine/mm_builder.py`.
- **Provisional shapes.** Templates 3-6 use a provisional `shapeModel` (estimated, not measured) until live goldens
  are recorded. After recording, rerun `gen_frame_defs.py` so the app draws the real measured shape.
- **Lattice fix (20620b2).** `insideSpans` in `editor-lattice-boundary.js` now drops rail and tie pieces lying outside the
  contour when a scan line runs along a straight edge.

### Web-app notes done after the handover (569fec3)

- The left/right orbit drag is inverted.
- Offset from frame defaults to 0.
- A never-saved project shows an "Unsaved" label, in the header and in the project window.
- Thumbnails are centre-cropped instead of stretched. Older thumbnails stay stretched until that project is saved again.
- Sculpt is never active after a load or restore.
- The frame highlight is capped at 0.88, so it never reaches pure white.
- **Sculpt activation (Fred picked option 3):** tapping a tool in the Sculpt Top/Bottom panel turns Sculpt on, and tapping the same tool again turns it off. It also turns itself off with Esc, with a quick tap on the empty background around the board (a drag still orbits), when its panel is closed, or when the editor, Settings or Projects opens (`main/ui-bindings.js`, `isOnSculptBoard`).

### Phone layout and a shorter Shape Lattice panel (workflow items 12 and 13, done)

- **Drawing editor:** the board fits above the drawer and follows it as the drawer moves (`styles/editor.css`, `padding-bottom: var(--drawer-height)`).
- **Main page:** the 3D preview on a phone defaults to 30% of the screen (`main/mobile-resizer.js`, `styles/layout-app.css`).
- **Shape Lattice panel:**
  - On a phone, Boundary, Widths, Shape and Segments start folded and remember their state; desktop starts open (`editor/lattice-side-column.js`).
  - Touch targets are at least 36px on a phone.
  - The panel is now 1504px tall on a phone, down from 1703px.

### Frame settings layout (Fred's choice)

- **Sidebar FRAME panel:** every frame setting you see in the 3D preview: template, thickness (`frameThickness`), frame bottom, trim offset, panel lip, wood, and the fit warning.
- **Editor Frame tab:** only the shape: template, Generate/Undo and the drag handles.
- Workflow item 14 (everything in the editor) was tried and reverted: Fred said "most of these you need to see the preview". Don't move them back into the editor.

## 4. Your first job: live Fusion checks

Setup:
1. Run `git pull`.
2. Run `python DEPLOY_bspline-frame-builder.py` from `bspline-frame-builder/`.
3. In Fusion, go to Utilities > Add-Ins, then Stop and Run `bspline-frame-builder`.

Use **scratch documents only**, closed without saving. Never touch Fred's own designs.

### 4a. Templates 3-6

Each template folder has a `LIVE_CHECK.md` with ticks to fill in:
- build by hand
- record goldens with `tools/repro/record_frame_parity.py` at 7x9, 12x6 and 5.51x1.97
- the f20 seeded parity check (first set the `SP` / `PARITY` paths at the top of `tools/repro/f20_live_parity.py`)
- the inversion sweep

Most likely failures:

| Template | Watch for |
|---|---|
| 3 | `shoulder_arc_equal` over-constrained; top edge on `proj_off_BB_top` |
| 4 | an arc Equal over-constrained (most likely `hip_arc_equal`: drop it); a pinch drifting or flipping, since the pin pairs are no longer merged |
| 5 | the TL/TR inner corner: the stub's inner length is only 0.16" at 7x9 with a 0.75" frame; arc end order (counter-clockwise is assumed) |
| 6 | **the inward Offset at the 2 inside corners must be sharp, not rounded.** If rounded, the inner-corner lookup misses them, 2 miters go missing and the bars at those corners don't split. Also check the 2 left/right Equals for over-constraint |

When a live build fails and the fix is clear (like dropping one Equal), fix it in that template's `phases/*.py`.
Then rerun the tests and the A/B check.

After goldens: commit `tests/fixtures/frame-parity/template_N_*.json`, run `python tools/gen_frame_defs.py`
(the shapeModel becomes measured), run the tests, and commit.

### 4b. Older flows never tested live

1. **One Send** (B-spline and frame together):
   - It deletes the old frames and the B-Spline Sets tagged `Bspline`/`set`, then builds the B-spline, then the frame, then `importing_done`.
   - A second Send must leave no leftovers.
2. **Send with template None:** the B-spline only, with no error and no stale frame.
3. **Settings → Clear Fusion design:** it removes the sets and frames. The confirm dialog shows on top of Settings.
4. **import_failed:** a broken Send shows an error toast and doesn't hang.
5. **CAM builder:** toolpaths are generated per setup (only setups with operations), and BUILD asks to confirm first.
6. **Continue banner → Load & Send** (a project saved from the phone).
7. **Hand-drawn layers:** draw a rail, tie or node with another layer active. It must land on its own kind's layer.

Write the results in `LIVE-RESULTS-ranchy.md`: pass or fail, the exact Fusion error text, the log path and the fix commit.

## 5. What's next (Fred's backlog, in his order)

### Open questions for Fred about Template 6 (ask him, keep it short)

1. **CAM layout for 8 small parts.** One row may be longer than the stock. Should mirrored bars be paired? Should the angled pieces be nested? Which way should the grain run?
2. **Default tab size and thickness limits.** The default tab is half the width and half the height. The limits are: tab side ≥ 2 × thickness, other bars ≥ thickness, openings ≥ thickness. Are those right?
3. **Bar names:** `frame_tab_top`, `frame_tab_right`, `frame_shoulder_right`, `frame_side_right`, `frame_base`, `frame_side_left`, `frame_shoulder_left`, `frame_tab_left`. OK?

### More templates Fred sketched (not built)

- **Diamond-top Hourglass, 5 bars.**
  - Fred chose this. A 90° diamond peak (45° miters), pinched waist, round hips, flat base.
  - The 5 parts: two straight roof bars, two curvy sides and the base.
  - The side points are sharp, so the side-part tips are thin. Fred saw this and still chose 5 parts.
  - Now possible thanks to the multiple-bars work.
- **Stepped / interlocking shape, about 12 straight bars,** with many inside corners. Every part between notches must stay
  wider than the frame thickness.
- **Dipped top + left-only wave,** 4 bars: Template 5 with a pinch on the left side only. A small variation of T5/T4.
- Mockup images from this round are in the cloud scratchpad, which you can't reach. Ask Fred if you need his sketch
  photos again.

### Workflow proposals not yet picked by Fred

Items 1-5, 8 and 9 are done; item 10 (project name sent to Fusion) was dropped.

- **6. Automatic NC programs** (Fusion): one NC program per setup, with the DDCS post, named after the project.
- **7. One "Prepare CAM" button** (Fusion): it replaces Build, Add machine, Sync and Apply.
- **11. My defaults:** save the usual lattice style and stock sizes as quick buttons.
- **12. Phone layout pass:** fit the board above the drawer, and make the 3D preview on the main page smaller.
- **13. Simpler Shape Lattice panel:** fold away the rare sections and use bigger touch targets.
- **14. All frame settings in one place:** in the editor's Frame tab, with a one-line summary in the sidebar.
- **15. Inlay and lattice toolpaths** (large, Fusion): CAM builds each layer's toolpath from its bit and depth.
- **16. Job card:** a phone page at the machine with tool order, zero corner, stock size and time per setup.

## 6. How to verify changes

- **JS:** `npx vitest run` (2716 pass at fd82744).
- **Python:** in `bspline-frame-builder/frame-builder`, `b-spline-gen` and the repo root, run `python -m pytest -q`.
  - Expected: 280+2 skipped, 89, and 463+2 skipped.
  - At the root, add `--ignore=.claude` if agent worktrees exist.
- **Defs:** `python tools/gen_frame_defs.py --check` should say fresh.
- **A/B byte-identical check:** use the scripts in `tools/repro/ab/` (`ab6.mjs`, `ablat6.mjs`, `ab3d.mjs`, `abpy.py`, `abcam.py`).
  1. Make a HEAD worktree: `git worktree add ../bsg-head HEAD`.
  2. Run each script with that tree's path, then with this repo's path. `ab3d.mjs` also takes an output file as its second argument.
  3. The hashes must match for the old templates. When adding a template, append it to the lists inside the scripts only after the check.
- **Browser check:** the cloud session used headless Chromium at phone size (390x844, touch) against
  `python -m http.server` in `bspline-frame-builder/`, with the app at `/b-spline-gen/html/bspline_gen_palette.html`.
  Locally you can just open it in a browser, or use Fusion's palette.

## 7. Key places

- **Templates:** `bspline-frame-builder/frame-builder/sketches/template_N/`.
  - `phases/` holds the Fusion sketch steps, `template_data.py` the name, handles and regions, `LIVE_CHECK.md` the live checklist.
  - Auto-discovered by `tools/gen_frame_defs.py`.
- **Engine:** `frame-builder/fb_engine/` (`frame_definition.py`, `declared_profiles.py`, `frame_shape_fit.py`).
- **App editor:** `b-spline-gen/html/editor/`.
  - `editor-shape-lattice-generator.js` (PARAM_ORDER, FRAME_ONLY_PARAM_KEYS: new keys always go at the END)
  - `editor-shape-lattice-interaction.js` (handles)
  - `frame-handles.js`
  - `editor-frame-profile.js`
  - `editor-lattice-boundary.js`
- **3D preview:** `b-spline-gen/html/core/preview/frame-mesh.js`.
- **Send:**
  - `b-spline-gen/html/main/export-flow.js` (the payload carries `frame`)
  - `b-spline-gen/b-spline-gen.py` (delete, build, frame, Clear)
- **CAM:** `CAM-builder/cam-builder.py`, `CAM-builder/cam_engine/mm_builder.py`.
- **History:** `WORK-LOG-fb-app.md`. The newest entries at the bottom explain each template in detail.

# Handoff: local Fusion session on ranchy

From the cloud session (branch `claude/lucid-ride-jycpox`) to the local Claude session on ranchy,
which has the Fusion 360 bridge. Written 2026-09-30.

The cloud session **cannot run Fusion**. It has built three new frame templates plus several
Send/CAM changes that have only been tested in the browser and with Python tests. Your job is the
live Fusion side: build, measure, and report back. Fix only what's listed as yours below.

## 0. Before anything

1. `git pull origin claude/lucid-ride-jycpox` (it's also merged to `main`; the latest is 20620b2 or newer).
2. Deploy the add-in: `python DEPLOY_bspline-frame-builder.py` from `bspline-frame-builder/`.
3. In Fusion: Utilities > Add-Ins, then Stop and Run `bspline-frame-builder`.
4. Every test below uses its **own scratch document**, closed without saving. Never touch Fred's own designs.

## 1. Don't collide with the cloud session

The cloud session is **right now** changing the frame engine so it can handle more than 4 bars
(the "N-bar" work, with Template 6 - Tab Top coming). While that runs:

- **Do not edit** anything under `fb_engine/`, `b-spline-gen/html/`, `CAM-builder/`, `tools/gen_frame_defs.py`,
  `frame-defs.json/.js`, or `sketches/template_1`/`template_2`.
- **Do not run** `gen_frame_defs.py` to regenerate the defs. The cloud session does that once your goldens arrive.
- **You may add**:
  - new golden files in `tests/fixtures/frame-parity/`;
  - your results file `LIVE-RESULTS-ranchy.md` at the repo root;
  - the raw logs, in a new folder `tools/repro/live_logs/`.
- **You may fix** a template's Fusion phases (`sketches/template_3`, `template_4` or `template_5`, the `phases/*.py` and
  `template_data.py` files) only when a live build fails and the fix is clear, like dropping one over-constraining
  Equal. Keep each fix to one small commit and explain it in your results file.
- Commit and push **only to `claude/lucid-ride-jycpox`**. Don't push to `main`: `main` deploys straight to the live
  website, and the cloud session merges after re-generating the defs.

## 2. The three new templates (main job)

Each template has its own step-by-step checklist. Follow it exactly and tick the boxes:

| Template | Checklist | What's new / most likely to break |
|---|---|---|
| 3. Tapered Hourglass | `bspline-frame-builder/frame-builder/sketches/template_3/LIVE_CHECK.md` | The top edge sits on its own projected line. Watch `shoulder_arc_equal` for over-constraint. |
| 4. Offset Hourglass | `.../template_4/LIVE_CHECK.md` | The pin pairs are no longer merged; left/right pinch heights are held only by the seeds. The arc Equals may over-constrain (most likely `hip_arc_equal`: drop it if so). A pinch could drift or flip. |
| 5. Hourglass Dipped Top | `.../template_5/LIVE_CHECK.md` | The top is now stub + 3 arcs + stub (16 pieces). The inner corner stub is only 0.16" long at 7x9 with a 0.75" frame, so the TL/TR offset and `ResolveInnerCorners` are the likeliest to fail. Arc end order assumes counter-clockwise. |

Each checklist has the same sections:
- **0. Install:** covered by step 0 above.
- **1. Build by hand:** check that the timeline has no red or yellow items and there are 4 bars.
- **2. Record goldens:** use `tools/repro/record_frame_parity.py` at 7x9, 12x6 and 5.51x1.97. This writes
  `tests/fixtures/frame-parity/template_N_*.json`; commit those.
- **3. f20 seeded parity check:** first set the `SP` / `PARITY` paths at the top of `tools/repro/f20_live_parity.py`.
- **4. Inversion sweep:** bounding-box offset 0.5 and 1.0, recorded to scratch, not to fixtures.
- **5. What to send back.**

## 3. Older Fusion items never tested live

After the templates, check these. They're app → Fusion flows, driven from the palette in Fusion:

1. **One Send:** Send carries the B-spline and the frame together.
   - The previous frames and B-Spline Sets are deleted first.
   - The B-spline is built, then the frame, then `importing_done`.
   - Check: exactly one B-Spline Set (tagged attribute `Bspline`/`set`) and one frame. No leftovers after a second Send.
2. **Send with no frame template (None):** the B-spline only. No error, and no stale frame left behind.
3. **Clear Fusion design** (Settings → Clear): removes the B-Spline Sets and frames. The confirm dialog shows above the Settings panel.
4. **import_failed:** force an import error (e.g. a broken payload through the bridge). The palette should show the error toast, not hang.
5. **CAM builder:**
   - Toolpaths generate per setup, and only for setups that have operations.
   - The BUILD button asks to confirm before it generates.
6. **Continue banner → Load & Send** from the phone flow: it loads the last project and sends it.

## 4. Report back

Write `LIVE-RESULTS-ranchy.md` at the repo root. For each template and each item in section 3, give:
- **pass or fail**;
- the **exact** Fusion error text, if any;
- the log file path under `tools/repro/live_logs/`;
- any fix you made, with its commit hash.

Then commit (goldens + results + logs + any template fixes) and push to `claude/lucid-ride-jycpox`, and tell Fred it's
pushed. The cloud session will then pull, re-run `gen_frame_defs.py` so the app uses the real measured shapes instead
of the provisional ones, re-test and merge to `main`.

## 5. Context you may need

- Standing rules in this repo:
  - Log every change in `WORK-LOG-fb-app.md`.
  - Keep explanations to Fred short and plain.
  - Don't build things Fred is only asking about.
- The frame is cut from separate mitered bars and glued up. Every corner must stay a clean miter; the square
  corners with straight stubs are what make 45° miters possible.
- Fred's machine: an Ultimate Bee CNC with a DDCS Expert controller, and designs are made in Fusion 360.

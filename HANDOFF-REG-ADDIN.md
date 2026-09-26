# Handoff — regular add-in (B-spline Generator palette + SVG editor), 2026-09-26

From: advisor session on the home PC. To: Fred on the Asus, and any Claude session he starts there.
From here on, Fred owns the regular add-in. The advisor keeps only the **fb-app** branch (Frame Builder inside the app).

```
  HOME PC (advisor)                          ASUS (Fred)
  ───────────────────────────────            ──────────────────────────────
  seat C · fb-app branch                     regular add-in, on main
    F5 SIL-RESOLVE (in progress)               everything in "Your queue" below
    then FB-APP stages S2+
  seat A · UI5   ┐ finish the current task,
  seat B · T77   ┘ advisor merges, then stop
  advisor merges fb-app → main in a scratch
  worktree after the full test suite; never touches your checkout
```

## 1. Current state of main (`f556158` + this doc)

Merged and passing the full suite (1343 vitest, 228 pytest in `bspline-frame-builder/`):

| Area | What landed | Checked in Fusion? |
|---|---|---|
| UI2–UI5 item 0 | Single right-hand column, collapsible sections, lattice icon tools [Select/Rail/Tie/Node], icon colour synced to piece colour, pinned Regenerate. Select-drag in Shape Lattice now persists and stays on its constraints (T73 rail and tie ends stay on the contour). | Browser only; `tools/repro/select_drag_shape.mjs` prints ALL CHECKS PASSED |
| MOB6 | Slider scroll guard (scrolling no longer changes values) | Browser |
| SE15 / SE15b / SE15c | Lattice and Shape Lattice sent as constrained Fusion sketches: slots, no Fix, no Symmetry, no radius or length dims except `contour_width`/`contour_height` (default board − 1 in, outside of the contour; the centerline dim is `contour_width - stroke_width`) | Yes (before today) |
| SE14c / SE14d / NODE-D | Contour checkbox; "Pick shape…" removed; node size entered as a diameter | Yes / browser |
| FB-ORDER | Frame block moves before the inlay, after Clean; `widthIn`/`heightIn` are created only by Send to Fusion | Yes |
| **T75** LAT-SIZE, OVR-FUSION | Size row in both lattice panels → `contour_width`/`contour_height`. A per-piece width override gets its own hardcoded dim (no param). Colour overrides already reach Fusion. Rail-ends row hidden while the contour is shown. | **NO, needs a live check** |
| **T76** SE17 | One layer per kind (contour / rails / ties / nodes). Each is sent as its own Fusion sketch, built in that order. Cross-kind constraints go through a PROJECTED copy, because Fusion refuses direct cross-sketch constraints (measured). A hidden kind is not exported; the others keep their exact geometry. | **NO, needs a live check** |
| Add-in debug | Every Send writes the payload to `~/.bspline-frame-builder/last_send.json` (no stepVariants) | — |

## 2. In flight on the home PC (will land on main by the advisor's merge)

Don't edit these files until the merge lands, or you'll get conflicts:

| Seat | Task | Files it's touching |
|---|---|---|
| A | **UI5 items 1–4**: per-piece colour/width override in the lattice Select properties (`data-override-color` / `data-override-width`, one schema module). Regenerate clears the overrides; Undo restores them. **Item 5**: a tie whose end is on the contour loses its nodes on Select-drag (repro first, then fix at the declaration). | `editor/editor-piece-override.js` (new), `editor-lattice-pattern.js`, `editor-ui.js`, `editor.js`. Uncommitted on the home PC; only arrives once pushed. |
| B | **T77 TIE-GAP**: `ties.minSpacing` (default 0.5 in) in the Ties section of both panels. Generate never places ties closer than this and makes fewer if needed. Hand-added ties are exempt. | Lattice generator + both properties panels, on the `lane-b` branch |
| C | **F5 SIL-RESOLVE** (stays with the advisor): silhouette arcs never invert, even at high corner radius | `editor-shape-lattice-generator.js`. **Leave the silhouette solver to seat C.** |

The advisor will tell you when A and B are merged. Then do `git pull` and they are yours.

## 3. Your queue (regular add-in, not started)

1. **Live Fusion check of T75 + T76** (nobody could do it: the home PC's Fusion is suspended by your Asus session).
   Send a Shape Lattice with contour, rails, ties and nodes. Expect **4 sketches** in order contour → rails → ties → nodes.
   The rail and tie ends should stay coincident to the contour through a `stroke_width` edit (small drift is accepted).
   Hide one kind and it shouldn't be sent. Change the lattice Size and `contour_width`/`contour_height` should follow.
   Give one piece a width override and it should get a hardcoded dim. Inspect `last_send.json` when something looks off.
2. **Live check of UI5** once merged: override one piece → only that piece changes; Regenerate clears the override; Undo restores it.
3. **SE16 ✂ Cut tool** (full spec in ROADMAP.md "SE16"). Main tool rail only. Tap a line to cut it; tap the cut again to join.
   Segments keep lattice membership by DERIVATION (collinear + touching = one rail). Acceptance: the same drags give
   identical coordinates before and after cutting and colouring the segments. One open question: should cut segments
   move together (the default) or independently?
4. **Stale-param cleanup**: a declared list of params the add-in owns (including the frame params), so Send removes
   parameters it created before and no longer uses. Coordinate the frame-param names with fb-app (FB-APP-DESIGN.md on branch fb-app).
5. **UI4 item 0b**: still open, couldn't be reproduced. Needs your exact steps.
6. Anything new you find. ROADMAP.md is the plan of record; add entries in the same "Queued — NAME: … (Fred date)" form.

## 4. How to work on it

- **Tests**: `npx vitest run` at the repo root; `python -m pytest -q` in `bspline-frame-builder/`.
- **Screenshots of the styled app**: `python tools/serve_app.py` → http://127.0.0.1:8780/b-spline-gen/html/bspline_gen_palette.html
  Don't serve `html/` directly, or the CSS won't load.
- **Drag regression test**: `node tools/repro/select_drag_shape.mjs <outdir> desktop <url>`
- **Fusion add-in reload**: in Fusion, stop the `bspline-frame-builder` script, run `DEPLOY_bspline-frame-builder.py all`
  (it refuses while the add-in is live), then run it again. Restarting doesn't reload the palette's web content; delete
  the palette (or restart Fusion) or you'll be testing stale JS.
- **Fusion is single-session**: opening Fusion on one machine suspends it on the other. Fusion work happens on the Asus now.
- **Design rules** (all in ROADMAP.md / SE15-CONSTRAINED-SKETCH-DESIGN.md): never Fix; no Symmetry; only the contour
  size dims; acceptance = spawn parity; a coincident follows ONE curve, not a path; lattice overrides don't survive
  Regenerate and never get a param.
- **Lattice grid (Fred 2026-09-26)**: rails and ties live on the 0.25 in grid by nature. Count mode spreads rails
  evenly and rounds each to a grid row, so gaps may differ by one grid step (0.25 in). Intended, don't "fix" it. Only
  the contour is off-grid, so anything anchored to the contour snaps to the contour, not the grid (UI5 item 5).
- **Progress page**: https://bspline-status.pages.dev. The watcher runs on the home PC and reads that PC's local
  checkouts, so your Asus commits won't show there. It tracks seats A/B/C only.
- **Handoff loop files**: `HANDOFF.md` / `NEXT-SESSION.md` / `WORK-LOG.md` on main belong to seat A's loop until it
  stops. After that you can reuse them or ignore them.

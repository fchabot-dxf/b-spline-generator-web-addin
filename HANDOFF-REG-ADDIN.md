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
2. ✅ **DONE (Fred 2026-09-26: "frame builder looks fine")** **Live check of the Frame Builder F4 fixes** (merged 6dfdcaf): build a frame with the standalone Frame Builder; the
   log should show NO "FALLING BACK to a NON-parametric offset"; changing frame_thickness must move the frame; a
   unit value like 0.75 in resolves (no FAIL RESOLVE). If the offset lands OUTSIDE, report it (OFFSET_SIDE sign).
3. **Live check of UI5** once merged: override one piece → only that piece changes; Regenerate clears the override; Undo restores it.
4. **SE16 ✂ Cut tool** (full spec in ROADMAP.md "SE16"). Main tool rail only. Tap a line to cut it; tap the cut again to join.
   Segments keep lattice membership by DERIVATION (collinear + touching = one rail). Acceptance: the same drags give
   identical coordinates before and after cutting and colouring the segments. One open question: should cut segments
   move together (the default) or independently?
5. **Stale-param cleanup**: a declared list of params the add-in owns (including the frame params), so Send removes
   parameters it created before and no longer uses. Coordinate the frame-param names with fb-app (FB-APP-DESIGN.md on branch fb-app).
6. **RAIL-SPACING** (ROADMAP.md): Boundary becomes the FIRST panel section; Rails: Anchor [Top|Center|Bottom] + Spacing + optional Count,
   laid out from the boundary; one grid (the editor's). Old saved patterns keep their geometry.
   Do it after seat B's TIE-GAP lands (same panels).
7. **FORMULA-FIELDS** (ROADMAP.md): number fields accept + - * / ( ) and names (width, height, stroke, count);
   evaluated on Enter, stores the number. Typing a name opens an autocomplete dropdown showing each value.
8. **BOUNDARY-GUIDE** (ROADMAP.md): the lattice boundary box shows in the editor as a guide, hidden in the 3D preview. Remove the "Draw boundary"
   toggle (always drawn); the Shape Lattice Contour checkbox stays.
   In Fusion the boundary is sent as CONSTRUCTION geometry.
9. **UI4 item 0b**: still open, couldn't be reproduced. Needs your exact steps.
10. Anything new you find. ROADMAP.md is the plan of record; add entries in the same "Queued — NAME: … (Fred date)" form.

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
- **Lattice layout (Fred 2026-09-26)**: GENERATED rails are laid out from the BOUNDARY (an Anchor [Top | Center | Bottom]
  sets where the first rail sits, rails repeat from it; spacing: exact gaps, centred), not from the grid (see ROADMAP RAIL-SPACING). The grid is for drawing
  and dragging. The contour is off-grid, so an end anchored to it snaps to the contour, not the grid (UI5 item 5).
- **Progress page**: https://bspline-status.pages.dev. The watcher runs on the home PC and reads that PC's local
  checkouts, so your Asus commits won't show there. It tracks seats A/B/C only.
- **Handoff loop files**: `HANDOFF.md` / `NEXT-SESSION.md` / `WORK-LOG.md` on main belong to seat A's loop until it
  stops. After that you can reuse them or ignore them.

## 5. Starting your loop on the Asus

- `HANDOFF.md` / `.handoff/` are LOCAL to each machine (not in git), by design, so your loop and the home PC's seats never
  share a marker. On the Asus, from the repo root: `python ~/.claude/skills/multi-agent-handoff/handoff.py init` (epoch 1),
  then run the advisor/worker loop as usual with section 3 as the task list.
- The live Fusion checks (items 1-3) are Fred's own. The first worker task should be one that doesn't touch seat A's files
  (section 2) until the UI5 merge lands. FORMULA-FIELDS is a good first pick (a new shared module).
- Leave fb-app and the silhouette solver to the home PC.
- The home PC also pushes to main (merges): always `git pull --rebase` before pushing.

## 5. Wind-down (Fred 2026-09-26)
After the in-flight tasks land, the regular add-in HANDS BACK to the home-PC advisor. The Asus loops end after:
**R6** (RAIL-SPACING engine) + **R7** (lattice panel restructure: Boundary first, Anchor/Spacing/Count, remove
"Draw boundary") on main, and **L1** (BOUNDARY-GUIDE) on lane2, merged to main by the Asus advisor. Then: `handoff.py
done` on both loops, lane2 worktree removed, a hand-back note here (state + what's left: SE16 cut tool with Fred's
ruling in ROADMAP, UI4 0b, SNAP-SPLIT (Fred: leave for home), stamp-layer formula fields, Fred's live checks T75/T76/UI5/stale-params).

### 5.1 HAND-BACK NOTE (Asus advisor → home advisor, 2026-09-26)
**Final main sha at hand-back: `082b92b`** (+ this note's docs commit). Full suite on that tree, run by the Asus advisor:
**vitest 89 files / 1645 passed, pytest 302 passed.** Both Asus loops are DONE (reg-addin + lane2); lane2 worktree removed.
**Files mid-change: NONE** (both trees clean, everything pushed).

**Shipped on the Asus (all on main):** R1–R2–R5 FORMULA-FIELDS (safe parser, declared scopes: stock/sidebar sections +
both lattice panels + per-piece override width; min/max clamp) · lockfile (809f870) · R3–R4 STALE-PARAMS (registry in
parameter_schema.py, adopt registered names, delete out-of-payload + no dependentParameters) · R6 RAIL-SPACING engine
(rails.mode 'spacing': anchor/spacing/spacingCount, off-grid rails, ties exactly on rails, even count straddles) · R7 panels
(Box: Boundary→Rails→Ties→Nodes; Shape: Boundary→Contour→Rails→Ties→Nodes; lattice seed hidden, Generate re-rolls; new
patterns default spacing/center/1 in; one grid) · L1 BOUNDARY-GUIDE (dashed black editor guide, never in 3D/export, own
first "Lattice Boundary" Fusion sketch in construction geometry) · R7 item 0 = the 3 LIVE bugs the home advisor found
(stale-params logger crash, sketchManifest key, SE17 projections outside isComputeDeferred) → `9db556c`.

**Open gates / waiting on the home advisor:** LIVE re-run on Ranchy of `9db556c`+ (4 kind sketches linked by projection,
rail ends follow the contour on a stroke_width edit, stale_params written + correct). Nothing else is gated on the Asus.

**Decisions awaiting Fred:**
1. Shape Lattice panel still OPENS with the silhouette's own "Shape" (preset, shape seed, waist/corner sliders) and
   "Segments" sections, above Boundary. Fred's order named only Boundary→Contour→Rails→Ties→Nodes. Keep Shape/Segments on
   top, or move them? And hide the SHAPE seed too (Fred said "seed we can hide" — applied to the lattice seed only)?
   These sections are seat C's (SHAPE-PARAMS will rebase onto R7's panel).
2. SNAP-SPLIT (ROADMAP): separate GRID vs GEOMETRY snap for manual moves — queued, not started (Fred: leave for home).

**Still queued for the home side:** SE16 ✂ Cut tool (Fred's ruling in ROADMAP: lattice cut pieces move together, direct
edit independent) · SNAP-SPLIT · UI4 item 0b (needs Fred's steps) · stamp-layer transform formula fields (own binder,
R2 note) · Fred's live checks: T75/T76 (after the projection fix), UI5 overrides, stale-params.
**Known test note:** tests/frame-3d-sweep.test.js (F8) can time out at vitest's 5 s default on the Asus (passes with a
longer timeout) — green in the final run above.

### 5.2 Home advisor: live re-run on Ranchy (2026-09-26, main 10aab22 deployed)
Real app Send payload (tools/repro/capture_send_payload.mjs, Shape Lattice) replayed through the add-in's own
`_handle_generate` into a tagged scratch doc (closed after; Fred's doc untouched):
- **SE17 projections: 0 PROJECTION FAIL / 0 MISS** (were all failing); all 5 sketches (Lattice Boundary, contour, rails,
  ties, nodes) built with constraint_issues=0, dim_issues=0, parity maxErr <= 0.00035 in.
- **Rail ends follow the contour:** 14/14 rail centerline ends stay on the contour centerline through stroke_width
  0.25 -> 0.5 -> 0.25 in (worst 0.067 mm = the sampling resolution). T76's cross-sketch linking works live.
- **Stale params:** `stale_params` now written to last_send.json ({deleted:[], kept_referenced:[], adopted:[], failed:[]}
  on a fresh doc, as expected); no logger crash.
Gate CLOSED. Still Fred's own: UI5 overrides live, and the stale-param deletes on a real re-send (a scratch doc first).

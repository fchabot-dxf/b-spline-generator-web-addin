# NEXT (reg-addin, Asus) — R6: RAIL-SPACING engine (rails laid out from the boundary; panels UI = R7)

**Ball: worker (reg-addin) · epoch 1 · R6.** NO FUSION. R5 (bf11571) ACCEPTED (advisor re-ran 151/151 on the 4 specs).
Spec = ROADMAP "RAIL-SPACING" (read ALL of it — later rulings supersede earlier sentences). Log = WORK-LOG-reg-addin.md.
Commit subjects "R6 item N: …", push after every item.

## Scope split (why)
RAIL-SPACING restructures both lattice panels (Boundary first), and seat C's F9/SHAPE-PARAMS will also touch
properties-shape-lattice.js — the advisor is sequencing that with the home PC. So **R6 = ENGINE + DATA ONLY**; the panel
UI (Boundary-first order, Anchor/Spacing/Count fields, "Draw boundary" toggle removal) is R7. R6 may add NO visible UI;
if a field is needed to test in the browser, drive the pattern record directly.

## Rulings for R6
1. `rails.anchor` = 'start' | 'center' | 'end' (UI later: Top/Center/Bottom or Left/Center/Right by orientation).
   start/end: first rail ON that boundary edge, repeat toward the other edge; center: a rail ON the centre line,
   repeating symmetrically. Rails outside the boundary are dropped.
2. `rails.spacing` (inches, rail-to-rail) is always the step; `rails.count` OPTIONAL (N from the anchor; center = N
   centred); empty = fill the boundary.
3. **Off-grid is fine — NO rounding of spacing to grid steps** (the later "off-grid is fine / not the grid" ruling
   supersedes the older "whole number of grid steps" sentence; advisor flagged it to Fred — if he overrules, it's a
   one-line change, so keep the rounding as ONE declared option, default off).
4. The lattice GRID STEP comes from the editor grid (one grid); the old lattice-side `spacing` stops being a setting.
5. MIGRATION: a saved pattern's old `spacing` is read as its grid step and keeps its EXACT geometry (no silent re-layout).
   Declare it in the migrations path (tests/migrations.test.js pattern), not ad hoc in the generator.
6. Ties / nodes must still attach correctly to off-grid rails (survey how ties find rails today — grid rows? — and
   fix at the declaration, not per-case). Seat B's TIE-GAP (`ties.minSpacing`) must still hold.

## Hands off
fb-app; `editor-shape-lattice-generator.js` (silhouette solver — if Shape Lattice rails need it, STOP and say so);
frame files; `core/preview/frame-mesh.js`. Panels (`properties-lattice.js`, `properties-shape-lattice.js`): R7, not now.
Lane 2 (b1, worktree -lane2) is on BOUNDARY-GUIDE: editor boundary drawing, 3D skip, manifest construction flag,
sketch_manifest_builder.py — don't edit those.

## Checklist
- [ ] [R6-item-1] SURVEY (WORK-LOG, file:line): today's rail placement (every/offset/count, `_isRailRow`, `_resolveExtent`),
      how ties/nodes locate rails, where `pattern.spacing` is read, both Lattice + Shape Lattice paths.
- [ ] [R6-item-2] Declare `rails.anchor` / `rails.spacing` / optional `rails.count` in the pattern defaults + migration
      (ruling 5), and the boundary-anchored layout in the generator (rulings 1-4, 6).
- [ ] [R6-item-3] Tests: every generated gap identical; first rail exactly on the anchor (start/end edge, centre line);
      count honoured; out-of-boundary rails dropped; both orientations; box + Shape Lattice; several sizes/presets;
      old saved patterns byte-identical geometry; ties/nodes attach to off-grid rails; TIE-GAP sweep still green;
      select_drag_shape.mjs still passes.
- [ ] [R6-item-4] Fred's case proven in the pattern: anchor start → a rail exactly on the top boundary edge
      (screenshot via tools/serve_app.py after setting the pattern record, desktop).

## Gate (fast tier)
Touched/new specs + full `npx vitest run`. No Fusion.

## Finish
Commit by path, `git pull --rebase`, push main. From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R6 — <shas>"`.

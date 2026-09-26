# NEXT (reg-addin, Asus) — R5: FORMULA-FIELDS stage 3 (Lattice + Shape Lattice panels)

**Ball: worker (reg-addin) · epoch 1 · R5.** NO FUSION. R4 (be1f25b..a28c3ef) ACCEPTED (pytest 284/284, advisor re-ran).
UI5 has MERGED (home advisor, 0acc3bb): seat A's files are ours now. Log = WORK-LOG-reg-addin.md. Commit subjects
"R5 item N: …", push after every item.

## Hands off / sequencing
- fb-app, `editor-shape-lattice-generator.js` (silhouette solver), frame files (core/frame-record.js,
  editor-frame-profile.js, frame-mesh.js, main/frame-panel.js, frame-builder/).
- `properties-shape-lattice.js` + `editor-shape-lattice-interaction.js`: seat C's F9 / SHAPE-PARAMS will touch the Shape
  Lattice handles/sliders later. Keep your edit there SMALL and additive (a declaration + one attach call at build);
  no restructuring. If it has to be bigger → STOP and say so (the advisor sequences it with the home PC).

## Checklist
- [ ] [R5-item-1] SURVEY first (WORK-LOG, file:line): how both panels build their number inputs (dynamic re-render?
      Regenerate? Lattice ⇄ Shape Lattice switch? the new editor/lattice-piece-panel.js override width field?) and which
      handler each input runs on change. Pick the attach point that survives every re-render.
- [ ] [R5-item-2] DECLARE one scope per panel in the R1/R2 pattern (data, no per-field code): names read LIVE from the
      pattern record — at least width, height (lattice Size / boundary), stroke, count (+ spacing, minspacing, node, or
      others the panel obviously has). Declare which fields are formula-capable (all numeric fields in both panels
      unless there's a stated reason, incl. the per-piece override width). Board vs lattice names must be unambiguous
      (e.g. `width`/`height` = lattice Size, `boardw`/`boardh` = stock) — state the choice.
- [ ] [R5-item-3] Fred's case: "a rail exactly on the boundary" — show which field + formula does it and prove it in
      the real browser. If no field today can express it, say so (that's RAIL-SPACING's job next — don't build it here).
- [ ] [R5-item-4] Tests: each panel scope resolves live values; a formula in a lattice field commits + runs the panel's
      normal update with ONE undo snapshot; still works after Regenerate and after switching panels; range clamp holds.
      Real-browser desktop + mobile (extend tools/repro/formula_field_shots.mjs), screenshots to shots/reg-addin/.
      Also rerun `node tools/repro/select_drag_shape.mjs` to prove the lattice panels still drag-persist.

## Gate (fast tier)
Touched/new specs + full `npx vitest run` smoke. No Fusion.

## Finish
Commit by path, `git pull --rebase`, push main. From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R5 — <shas>"`.

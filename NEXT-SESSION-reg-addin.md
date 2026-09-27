# NEXT (reg-addin, Asus) — R7: lattice panel restructure (+ R6 carry-overs) — LAST task before hand-back

**Ball: worker (reg-addin) · epoch 1 · R7.** NO FUSION. R6 (22fea84) ACCEPTED. Lane2's L1 BOUNDARY-GUIDE is MERGED on main
(87ea3f1) — `git pull` first. Spec = ROADMAP "RAIL-SPACING" incl. the "RAIL-SPACING RULINGS" + "PANELS (R7)" paragraph
(Fred's Q&A). Log = WORK-LOG-reg-addin.md. Commit subjects "R7 item N: …", push after every item.
After R7 the Asus hands the regular add-in back to the home advisor (HANDOFF-REG-ADDIN.md §5) — finish clean.

## Rulings (Fred 2026-09-26)
- Panel order — Box Lattice: **Boundary → Rails → Ties → Nodes**. Shape Lattice: **Boundary → Contour → Rails → Ties →
  Nodes** (Contour is its OWN section right after Boundary — "contour isn't boundary").
- Boundary section = Size W x H ONLY. Contour section = the Contour checkbox(es) + its stroke width.
- Rails section: **Orientation** (moved here), **Anchor** [Top|Center|Bottom] (horizontal) / [Left|Center|Right]
  (vertical) → `rails.anchor` start|center|end, **Spacing** (in, rail-to-rail) → `rails.spacing`, optional **Count**
  → `rails.spacingCount` (empty = fill; show it as a placeholder).
- **Seed field HIDDEN** (not deleted from the pattern); Generate still re-rolls as today.
- Old grid-step "Spacing" select + Every/Offset + the old count-range rail fields: REMOVED from the UI. Old saved
  patterns keep their exact geometry (their stored `rails.mode` still drives them — R6's fallback).
- The "Draw boundary" toggle is already gone (L1 survey) — nothing to do; confirm in the log.

## R6 carry-overs (advisor review)
1. **NEW patterns default to `rails.mode: 'spacing'`** (anchor center, spacing 1 in) — today PATTERN_DEFAULTS still says
   `'count'`, so Fred's defaults never show. Change the default for NEW patterns only; prove an old saved pattern
   (stored mode 'count' / 'every' / no mode) is byte-identical (extend R6's regression tests).
2. **One grid (RAIL-SPACING ruling 4):** the lattice grid step comes from the EDITOR grid (GRID_DEFAULTS / toolbar),
   not the lattice-side `pattern.spacing` setting. Migration: a saved pattern's own `spacing` is still read as ITS grid
   step (geometry unchanged); new patterns take the editor's. Ties/nodes/drag all read the one resolved value.

## Hands off
fb-app; `editor-shape-lattice-generator.js`; frame files; `core/preview/frame-mesh.js`. Seat C holds SHAPE-PARAMS until
R7 is on main and will rebase onto your panel — keep the panel structure clean and declared (sections as data where
the panels already do that), no drive-by changes to the Shape Lattice handles/sliders code.

## Checklist
- [ ] [R7-item-1] Carry-over 1 (default mode 'spacing') + carry-over 2 (one grid) in the engine/defaults, with tests.
- [ ] [R7-item-2] Box Lattice panel: new section order + fields per rulings; formula fields (R5) still attached to every
      numeric field incl. the new Spacing/Count (update the declared scope: `spacing` = rail-to-rail now).
- [ ] [R7-item-3] Shape Lattice panel: same, with the separate Contour section.
- [ ] [R7-item-4] Tests (panel order, fields → pattern keys, seed hidden but Generate re-rolls, old patterns unchanged,
      formula fields attached) + real-browser desktop + mobile screenshots of BOTH panels + `select_drag_shape.mjs` +
      the rail-spacing shot (anchor Top → rail on the top edge, set via the UI this time).

## Gate
Full `npx vitest run` (frame-3d-sweep may time out at 5 s on the Asus — seat C's, known; note it) + pytest. No Fusion.

## Finish
Commit by path, `git pull --rebase`, push main. From the REPO ROOT:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "R7 — <shas>"`.

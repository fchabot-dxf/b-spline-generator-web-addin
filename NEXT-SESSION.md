# NEXT — UI5: per-piece colour + width overrides in the lattice Select tool

**Ball: worker (seat A) · epoch 2 · UI5.** NO FUSION. UI4 accepted (items 0,0c,1,2,6,7 landed; 0b could not be reproduced —
kept open until Fred gives exact steps). Spec = UI3 AMEND 3 (Fred: overrides do NOT survive Regenerate, no warning;
override width gets NO Fusion param — seat B's T75 item 3 reads your attributes). PROGRESS is automatic: start each
work-commit subject with the item's tag words (e.g. "UI5 item 2: …").

## Checklist
- [ ] [UI5-item-0] REOPENED UI4 item 0 (advisor, live main with _skipBoundaryRefillOnce deployed, FRESH headless profile):
      Shape Lattice Select-drag STILL does not persist — rail body drag moved 0.000, tie body drag 0.000 (box Lattice
      passes the same script). Run the advisor's exact repro: `node tools/repro/select_drag_shape.mjs <outdir> desktop
      https://bspline-generator.pages.dev/bspline_gen_palette` (it clicks the visible Select button titled 'tap a
      piece…', tags pieces lt_*, drags via Input.dispatchMouseEvent 8 steps x30ms). Find why your verification and this
      one disagree (which Select control? drag speed/steps? hit target point?), fix for BOTH, keep the script as a test.
- [ ] [UI5-item-1] Selecting a rail/tie/node/contour piece (lattice Select icon) shows its COLOUR + WIDTH in the properties,
      with an override control for each; clearing the override returns it to the kind's colour / lattice width.
- [ ] [UI5-item-2] Declared data schema on the piece: data-override-color / data-override-width (ONE schema module), rendered
      live (stroke colour/width); exported in SVG / Send to Fusion payload as-is. Tell seat B the exact names if you
      deviate from these.
- [ ] [UI5-item-3] Regenerate clears all overrides on that layer; Undo restores them.
- [ ] [UI5-item-4] Tests (override one piece -> only it changes; regenerate clears; undo restores; export carries attrs);
      desktop + mobile screenshots of the property panel.
Commit by path, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI5 — <shas>"`.

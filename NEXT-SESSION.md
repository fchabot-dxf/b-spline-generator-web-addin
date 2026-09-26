# NEXT — UI2: lattice panels — colour-coded sections, pinned Generate on top, hide Fill seed

**Ball: worker (seat A) · epoch 2 · UI2.** NO FUSION. HARD CONSTRAINT: do NOT edit bspline_gen_palette.html (seat B
is editing the same panel markup in lane-b for T73 — a markup edit here = a merge conflict). Do it with CSS
(styles/editor.css) + ONE small JS module that decorates the panels at init. Apply to BOTH the Lattice panel
(#editorLatticePanel) and the Shape Lattice panel (#editorShapeLatticePanel), desktop AND the mobile drawer (MOB3/5
moves panel contents into the drawer — decorate wherever the sections live).
1. Colour-coded section backgrounds (Fred picked option B from the advisor's mockup): each section block gets a soft
   tint + a 5px left bar + its title in the bar colour. Declared ONE map, section title -> kind:
   rails/"Grid & rails" -> rails colour, Ties -> ties colour, Nodes -> nodes colour, Contour/Border/Shape -> contour
   colour, everything else (Add, Colors, Widths, Seed, ...) -> neutral grey. Bar colour = the pattern's CURRENT kind
   colour (PATTERN colors rails/ties/nodes/contour — so it follows the Colors row live); tint = that colour at ~12%.
   Tag sections via a data attribute set by the decorator (data-lattice-section="rails"...), CSS does the look.
2. Generate/Regenerate (#latticeGenerate, #shapeLatticeGenerate) at the TOP of its panel and pinned (position:sticky;
   top:0; z-index above the sections; panel background behind it) so it stays visible while the panel scrolls. Use CSS
   `order` in the panel's flex column, or move the node once in the decorator — no markup edit. Detach all stays at
   the bottom.
3. Hide the Shape Lattice "Fill seed" row (#shapeLatticeSeed and its label/stepper) — Generate already picks a new fill
   seed each press. The Box Lattice Seed stays.
Verify headless (desktop 1400 + mobile 390x844): screenshot both panels scrolled to the middle — Generate visible at
top, sections tinted, colours follow a Colors-row change, Fill seed gone. Tests for the decorator map. Commit by path,
push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "UI2 — <sha>"`.

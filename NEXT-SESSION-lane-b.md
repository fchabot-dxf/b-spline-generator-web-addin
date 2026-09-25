# NEXT (lane-b) — T64: SE15 constrained sketch must use the CARVE placement (centered, Y-up) + naming

**Ball: worker (seat B) · epoch 2 · T64.** NO FUSION (advisor re-verifies). T62/T63 are merged and DEPLOYED
(add-in 7130496).

## Advisor's end-to-end Fusion test (the add-in's own PaletteHTMLEventHandler._import_all_svg_layers, fed a real
## two-layer stamp payload built from the live app: scratchpad\se15-stamp-fixture.json — use it as a fixture)
Works: layer 1 (Shape Lattice + manifest) → constrained sketch, 51 lines / 36 arcs / 16 circles (0.075") / 0 splines,
78 constraints, 77 dims, params in inches; layer 2 (plain rect, no manifest) → the usual SVG sketch. 11 s.
### Bug: the constrained sketch is NOT in carve coordinates
- Plain SVG layer (correct): rect drawn at x 2.5..4.5, y 3..4.5 on a 7x9 board → sketch bbox x −1..1, y 0..1.5 —
  i.e. bakeSvgForCarving's carveMatrix: centered on the origin (x − W/2) and Y FLIPPED (H/2 − y), ×dpi then /dpi by
  the importer.
- Constrained "Layer 1": bbox x −0.08..7.00, y −0.04..9.04 — raw board coordinates, not centered, Y not flipped →
  it would sit offset from and mirrored against the carved relief.
Fix at the ONE source: the manifest (or the builder) must apply the SAME transform as carveMatrix (reuse it — don't
re-derive; editor-coords.js carveMatrix / the same W,H) so both paths land identically. Flipping Y also reverses arc
direction/orientation — check arcs (start/end angles or sweep) and any left/right-dependent constraints stay correct
after the flip. Test: the fixture's rect-on-layer-2 bbox and a manifest-built copy of the same rect must coincide;
a hourglass built both ways (SVG vs manifest) must overlap (bbox equal within 1e-6 in).
### Naming
The constrained sketch is named "Layer 1" while the SVG path uses "Source - L<n> - <profile> (<depth>\")" and its
plane "Plane for L<n> …". Use the same naming scheme (e.g. "Source - L1 - vbit (0.25\") [constrained]").
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T64: SE15 carve placement + naming — <sha>, tests"`
and stop.

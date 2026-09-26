# NEXT (lane-b) — T74: close AMEND 3b thresholds + SE14d (remove Pick shape) + NODE-D (node size as diameter)

**Ball: worker (seat B) · epoch 4 · T74.** NO FUSION. T73 accepted pending the advisor's live Fusion run (if it fails
you get an `amend`). Three items, one commit each, in order:
1. AMEND 3b leftovers: a declared near-tangent threshold (no Coincident when a rail/tie crosses a contour segment at
   < ~10 deg — leave that end free) and a declared MIN_RAIL_PIECE (drop split pieces shorter than ~2x stroke width).
   Tests incl. a deep-waist hourglass with vertical rails.
2. SE14d (ROADMAP.md on main, "## Queued — SE14d"): remove "Pick shape…" from the Shape Lattice panel as a SWEEP
   (button, handler, panel state/strings, tests guarding only that UI — each link removed or kept with a named reason);
   KEEP the boundary machinery the generated silhouette uses; saved patterns with a picked boundary still load (decide
   + log). NOTE: seat A's UI2 (on main, merged later) mounts this panel into a side column via TOOL_PANEL_MOUNTS in
   editor/lattice-side-column.js and decorates sections by title — don't rename section titles.
3. NODE-D (ROADMAP.md "## Queued — NODE-D"): Node size entered as DIAMETER in both lattice panels (default 0.15);
   Fusion param `node_diameter` + a DIAMETER dimension per node circle (replaces node_radius + radial dims); old saved
   radius values convert once on read.
Pass back: `cd <lane-b worktree> && python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 4 — T74 — <shas>"`.

## Checklist (T74 incl. amendments) — tick `- [x]` in THIS file as you commit each item; the progress page counts them
- [x] AMEND 0: per-preset contour_width dim expression (bottle)
- [x] 1. AMEND 3b close-out: near-tangent threshold + MIN_RAIL_PIECE
- [x] 2. SE14d: remove "Pick shape…"
- [x] 3. NODE-D: node size as diameter
- [x] AMEND 1: one Contour control (show + width + colour)
- [x] AMEND 2: size = OUTSIDE of contour; centerline dims = size − stroke_width; app centerline inset stroke/2
- [x] AMEND 3: bottle body fills the box; remove body_width as a sweep
- [ ] AMEND 4: Contour section cleanup ("Shape linked" gone, settings inside, edge-rule audit)
- [ ] AMEND 5 (BUG, first): manifest only for layers that contain owned lattice pieces; mixed layer = sketch + plain SVG of the rest

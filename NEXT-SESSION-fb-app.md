# NEXT (fb-app) — F12: SHAPE-PARAMS (+ the wood-name fix)

**Ball: worker (seat C) · epoch 1 · F12.** F10 + F11 ACCEPTED (live-proven on Ranchy), being merged to main. The regular
add-in is back home (seat A on H1 SNAP-SPLIT: drag/snap paths, the toolbar; not your files). R7's Shape Lattice panel is on
main (Boundary, Contour, Rails, Ties, Nodes; lattice seed hidden): merge origin/main first (regenerate frame-defs via
tools/gen_frame_defs.py, never hand-resolve). PROGRESS automatic ("F12 item N: …"); shots -> shots\seatC\ as items land.
Fusion: ask the advisor for a window if an item needs a live check (item 1 does: short, scratch-tagged, same rules as F11).

## Checklist
- [ ] [F12-item-1] WOOD NAMES: the declared wood list must name REAL Fusion library appearances. Look up the actual
      library names live (short window: read-only listing of the Fusion Material/appearance library, no doc edits), fix the
      declared list (Ash default, Mahogany, Pine, Cherry, Maple -> the closest real appearance each, state the mapping),
      and make an unknown name an explicit error in tests (the declared list is validated against a recorded library-name
      fixture), not a silent fallback.
- [ ] [F12-item-2] SHAPE-PARAMS (ROADMAP.md): hourglass WAIST RADIUS (independent of the corner radius), hourglass TOP
      and BOTTOM corner radius separately (old cornerRadius migrates to both), bottle BODY SHOULDER radius. Each declared in
      PARAM_ORDER + BASE_RANGES + feasibleParamRanges, with a handle (computeParamHandles) and a slider in the Shape Lattice
      "Shape" section. Old patterns keep their exact shape (migration test). The F5 dense sweep stays green (simple outline,
      tangent joints). Shape Lattice only: frames do NOT get these params.
- [ ] [F12-item-3] Tests + shots (each new handle before/after drag, hourglass + bottle, desktop + mobile).
Pass back from the fb-app root: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "epoch 1 — F12 — <shas>"`.

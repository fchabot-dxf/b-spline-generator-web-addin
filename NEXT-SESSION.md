# NEXT — SE7h: lattice orientation — rails horizontal OR vertical (Fred)

**Ball: worker (seat A) · epoch 2 · SE7h.** Fred: "invert rails and ties so rails are vertical". NO FUSION (hard rule) —
browser proof only. Seat B is writing the SE12 live-expand design (docs only). Files: `editor/editor-lattice-pattern.js`,
`editor/editor-lattice.js` (classifyDrag/constrain for the hand tool), `editor/properties-lattice.js`, the
`#editorLatticePanel` markup, tests (+ WORK-LOG). One commit by path.
## Build — one declared field, transform at the edges
- `PATTERN.orientation: 'horizontal' | 'vertical'` (default 'horizontal'; existing saved patterns without it read as
  horizontal — no migration). Declare `ORIENTATIONS` once.
- Compute the pattern in the canonical frame exactly as today, then map lattice coords through ONE function
  `orient({i,j}, orientation)` (vertical = swap i/j, with the extent swapped on input) — no second copy of the
  rails/ties algorithm. Rail snap, spans, nodes, colors, margin, occupied-cell skip all ride along unchanged.
- Hand-drawn Lattice tool: `classifyDrag` reads the same orientation — vertical: a column drag = rail, a row drag = tie
  (and the tie rail-snap snaps to rail COLUMNS).
- Panel: a two-option segmented control "Rails: Horizontal | Vertical" (same `.editor-fillmode-btn` style), one undo step
  per change, and it regenerates with the CURRENT seed (orientation flip should not reshuffle — only Generate rolls).
## Verify
Tests: vertical output = horizontal output with i/j swapped on a square extent; on a 7×9 board rails run along the
9" axis when vertical; hand-tool classify flips; old pattern without the field → horizontal. Smoke screenshot (browser,
repo-root serve) of a vertical pattern. `npx vitest run` green.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE7h: lattice orientation horizontal|vertical — <sha>, vitest N, screenshot: <path>"`
and stop.

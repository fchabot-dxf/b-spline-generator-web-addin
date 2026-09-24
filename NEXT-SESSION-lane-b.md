# LANE B — T31 (SE6c): grid hover feedback — the row, column and node under the pointer light up (Fred)

**Seat B · epoch 2 · T31.** T30 (24bd177) accepted, held on lane-b until seat A passes UX-UNDO (history, snapshot
manager, sidebar binders — not yours). Fred chose hover feedback instead of any grid contrast change (invert withdrawn).
Files: `editor/editor-grid.js` (next to `updateSnapCursor`), `editor/editor-interaction.js` (hover path only), tests
(+ WORK-LOG-lane-b.md). One commit by path.
## Build (Fred approved this mockup)
```
   ·   ·   ┊   ·   ·
 ┈┈┈┈┈┈┈┈┈┈◉┈┈┈┈┈┈┈┈   ← row + column through the nearest node, and the node, highlighted
   ·   ·   ┊   ·   ·
```
- Pure: `nearestGridNode(pt, spacing)` → {i, j} (reuse `toLattice`), plus the two line extents across the board.
- One declared highlight style: light core (white, ~2 px, non-scaling) over a dark outline (~3.5 px, 60 % black), and a
  node ring the same way — readable on any terrain. Drawn in `_handleLayer` (never serialized), reused elements moved
  per pointer move (no create/destroy per frame), cleared on pointer leave, on grid hidden, and on mode change.
- Shown only when the grid is visible; in modes whose SNAP_POLICY is 'none' (erase/expand) show nothing. It complements
  the existing snap ring — if both are shown, the node ring IS the snap ring (don't draw two).
- Touch: same, during a press (with INPUT_PROFILE's marker offset).
## Verify
Tests: nearestGridNode rounding; highlight hidden when grid hidden / policy none. Smoke screenshot over a dark area.
`npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T31: grid hover feedback (row/column/node) — <sha>, vitest N, screenshot: <path>"`
and stop.

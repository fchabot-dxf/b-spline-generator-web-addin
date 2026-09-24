# LANE B — T34: SE12 Slice 0 — the bake keeps true arcs and circles under a similarity matrix

**Seat B · epoch 2 · T34.** Your SE12 design (f0f4592) is APPROVED; Slice 0 goes now — it's right regardless of Fred's two
open answers (Fusion geometry default; whether Fusion's importer keeps arcs — he has `scripts/fusion-arc-test.svg` for
that). NO FUSION. Seat A is on SE7h (lattice orientation: editor-lattice*.js, properties-lattice.js, lattice panel) —
not yours. Files: `editor/editor-transform-handles.js` (`_bakeMatrixIntoPath`, `bakeMatrixIntoElement`),
`editor/path-layout.js` (a pure `isSimilarity(m)` + `bakeArcSimilar(seg, m)` belong there), tests (+ WORK-LOG-lane-b.md).
One commit by path.
## Do exactly your design's Slice 0
Similarity test on the COMBINED per-element matrix (a·c+b·d≈0 and a²+b²≈c²+d², declared tolerance); if similar:
transform A endpoints, scale rx/ry by √(a²+b²), add the matrix rotation to x-axis-rotation, flip sweep when det<0;
circles/ellipses stay native (center transformed, radii scaled). Otherwise today's cubic fallback. H/V → L as today.
## Verify
Tests: arc through carveMatrix(7,9,96) → still an `A` with r×96 and correct endpoints; circle → `<circle>` r×96; a
side-handle (non-uniform) scaled circle → cubic fallback; reflected matrix flips sweep; round-trip of a lattice node.
`npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T34: SE12 slice 0 — arcs/circles stay exact under similarity, cubic fallback otherwise — <sha>, vitest N"`
and stop.

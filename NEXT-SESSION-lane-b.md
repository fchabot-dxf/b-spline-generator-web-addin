# LANE B — T18: build SE7b slice 1 — the pure pattern algorithm (no DOM, no editor)

**Seat B · epoch 1 · T18.** Worktree, branch `lane-b`. Design `SE7B-PATTERN-GENERATOR-DESIGN.md` (89a48b4) approved.
Files: `core/terrain.js` (one `export`), NEW `editor/editor-lattice-pattern.js`, NEW `tests/editor-lattice-pattern.test.js`
(+ WORK-LOG-lane-b.md). Seat A is on SE8b in `editor-hit.js`, `editor-expand-trace.js`, `editor-interaction.js`,
`editor.js`, `editor-io.js`, `editor-coords.js` — none of your files; import from `editor-lattice.js`, do not edit it.
One commit by path.

## Advisor rulings on the design's open questions
- **Q1 tie anchoring — make it DATA, not a decision baked into code:** `ties.anchor: 'rails' | 'free'`, default
  `'rails'` (a tie starts and ends on rail rows, spanning `spanMin..spanMax` rail GAPS); `'free'` = any lattice rows
  within `spanMin..spanMax` rows. Implement and test both — Fred's answer then flips a default, it does not rework
  the algorithm.
- **Q3 overlap after detach — in scope for slice 2** (skip cells occupied by detached lattice elements); nothing for
  slice 1 beyond making `computePattern` accept an optional `occupied: Set<"i,j,kind">` it skips.
- Q2 tooling defaults: slice 2, tuned live.

## Do slice 1 exactly as §6 says, plus the rulings
`computePattern(PATTERN, { extent })` → `{ segments:[{kind,a,b}], nodePoints:[{i,j}] }`, reusing
`toLattice/fromLattice/classifyDrag/constrain/latticeCrossings` and `lcgPoints` (exported from `core/terrain.js`).
Tests: your §6 list + both anchor modes + `occupied` skipping + same seed → identical output, different seed →
different ties (same rails).

## Verify
`npx vitest run` green (count); `node --check`; `git show --stat HEAD` → 3 files + log.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T18: SE7b slice 1 — computePattern (anchor rails|free, occupied), lcgPoints reuse — <sha>, vitest N"`
and stop.

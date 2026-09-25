# NEXT (lane-b) — T47: SE13 Slice 1 — the boundary cutting engine (pure)

**Ball: worker (seat B) · epoch 2 · T47.** NO FUSION — browser/vitest proof. T46 design reviewed and merged (c3c204f).
Build EXACTLY your §14 Slice 1. Open questions 1,3,5 are Fred's and don't touch this slice.
Advisor ruling on your Q4: KEEP the numeric path in v1 — pen/freehand boundaries are cubic paths, the most common
shape Fred will pick, so numeric line×curve is required, not optional. Rotated ellipses go through it too (no
bbox fallback).
Don't commit `reference/`.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T47: SE13 slice 1 cutting engine — <sha>, vitest N"`
and stop.

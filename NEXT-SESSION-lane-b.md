# NEXT (lane-b) — T59: SE14 — axis-locked parametric handles + tap-a-segment style bar

**Ball: worker (seat B) · epoch 2 · T59.** NO FUSION. T58 reviewed + merged (d6ce767, 925 green; screenshots viewed:
Shape Lattice tool, hourglass/bottle, fill clipped to the shape, phone drawer tab, widths link).

## Do (your disclosed deferrals — the design's "Slice 3 editing model")
1. On-canvas AXIS-LOCKED PARAMETRIC HANDLES while the Shape Lattice tool is active on a generated shape: one handle
   per preset param that has a natural on-canvas meaning (hourglass: waist reach — horizontal at the waist apex; waist
   position — vertical; corner radius — along the corner diagonal; bottle: neck width, shoulder height, body width…).
   Each handle moves ONLY along its param's axis, maps position → param (clamped to the declared range), regenerates
   the path + refills on release (commit-only, like everything else), mirrored side follows. Every reachable position
   is tangent by construction. Touch-sized under coarse pointer.
2. Tap a side segment on the canvas → a small floating straight | curve | kink bar next to it (mirrored pair changes
   together); the panel's segment dropdown stays and stays in sync.
3. Detach on hand node-edit (recompute-and-compare) — confirm it's live (was it in T58? if yes, just a regression
   test).
## Verify
CDP: drag the waist handle by real mouse events → path stays tangent (sampled tangent continuity on the live path),
param value in the panel updated, one undo step; same on 390x844 with touch events; tap a segment → bar → kink →
screenshot. VIEW every screenshot. `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T59: handles + segment bar — <sha>, vitest N, screenshots"`
and stop.

# NEXT (lane-b) — T50: Boundary fill respects the boundary shape's own STROKE width

**Ball: worker (seat B) · epoch 2 · T50.** NO FUSION for workers. T49 reviewed (807 green, screenshots viewed: each
ending rule distinct, commit-only refit proven). Not merged to main yet ONLY because seat A's in-flight MOB3 drawer
edits the same panel files — the advisor merges both after seat A passes. Keep lane-b as is; small change only.

## Finding (advisor, from your own 04-ending-*.png)
The boundary circle carries a thick stroke (~0.8"), and the fill is cut against its CENTERLINE — so rails run halfway
into the stroke (they show orange through the translucent ring). A person reads a stroked shape's inside as the stroke's
INNER edge.
## Do
Cut against the boundary offset INWARD by half its own effective stroke width: effective = the Border piece width
when Border is ON, else the shape's own stroke-width when its layer/element is visibly stroked, else 0. Declare it
(e.g. boundary.edge = 'inner-stroke' | 'centerline', default 'inner-stroke') rather than hard-coding. Ending rules then
apply from that inner edge (inset = inner edge − half the piece width, on-boundary = on the inner edge, joint node on
the inner edge). Implementation: shrink the scan crossings by the stroke half-width along the scan direction ONLY
where that's exact (lines/arcs); for curves use the local normal at the crossing — say which, keep ≤ tolerance.
Test: circle r=2 stroke 0.8 → rail endpoints at radius 1.6 (inset: 1.6 − w/2); Border on overrides with its width.
Screenshot the same circle as your 04 shots.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T50: boundary respects stroke — <sha>, vitest N, screenshot"`
and stop.

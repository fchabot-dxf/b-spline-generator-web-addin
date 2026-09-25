# NEXT (lane-b) — T53: SE14 Slice 1 — the pure silhouette generator

**Ball: worker (seat B) · epoch 2 · T53.** NO FUSION. T52 design reviewed + merged. Build EXACTLY your §10 Slice 1.
Advisor rulings on the open questions that touch this slice (Fred still to confirm 1 and 4; they don't block it):
- Q2 style vocabulary: straight / curve / kink ONLY (Fred's own words). Declare the others in the table as not-wired
  entries so they're additive later; don't wire them.
- Q5 region: the generator takes an explicit region {x,y,w,h} (declared param); the tool's default region = the
  board's inner rect. Signature fixed now so Slice 3 doesn't change it.
- Q4 waist defaults: use your first guess, declared in one table (tunable later from Fred's reaction).
- Q3 detach detection: recompute-and-compare on commit for the ONE linked element (it also catches Select-handle
  scaling, which a Node-only trigger would miss) — that's Slice 3, just keep §3 a pure fn cheap enough to call per
  commit.
Don't commit `reference/`.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T53: SE14 slice 1 generator — <sha>, vitest N"`
and stop.

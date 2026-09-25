# NEXT (lane-b) — T44: fallback notice + flat/square line ends for outlines

**Ball: worker (seat B) · epoch 2 · T44.** NO FUSION for workers — browser proof only. T43 merged (0258941); the advisor
imported its baked export into Fusion: 144 SketchArcs + 40 lines, 0 splines, 11 profiles, correct inch scale.

## 1. Tell the user when an element falls back to centerline
T43 counts elements whose kind declines an outline (they export as centerline) but only logs it. After "Send to
Fusion", show the count in the existing status/toast surface ("2 elements exported as centerline — no outline for:
<kinds>"), nothing when the count is 0. Same count visible in the preview is optional (a dashed marker is fine).

## 2. Butt and square caps (SUPPORTED_LINE_CAPS says false today)
- Line: butt = rectangle (4 lines), square = rectangle extended by w/2 at both ends. Exact.
- Open paths/polylines: caps at both ends of each open subpath by the same rule (perpendicular to the end tangent;
  for a curve end use its end tangent).
- Flip the table entries to true; the decline path stays for anything else.
- Also `stroke-linejoin`: miter (with the SVG miter-limit fallback to bevel) and bevel, alongside round — exact
  (lines only), declared as a SUPPORTED_LINE_JOINS table like caps.
## Verify
vitest per cap/join (exact corner coordinates, area checks); CDP screenshot of a polyline with each cap + join on an
Outline layer; `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T44: fallback notice + caps/joins — <sha>, vitest N, screenshots"`
and stop.

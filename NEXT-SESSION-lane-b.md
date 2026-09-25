# NEXT (lane-b) — T40: exact inner joins next to curves, then TEXT outlines

**Ball: worker (seat B) · epoch 2 · T40.** NO FUSION for workers — browser proof only. T39 reviewed + merged (660 green).

## 1. Fix T39's disclosed limitation first (it matters: Fred's resin INLAY needs the outline exact)
Inner-side trim next to a curve uses the tangent-LINE intersection → up to `half` wrong (touches the source) when a line
meets an arc near head-on. Replace with true intersections of the two OFFSET pieces: line∩line (as now), line∩circle
and circle∩circle closed form for circular A; for biarc-fitted curves intersect against the fitted arcs (they ARE
circles). Pick the intersection nearest the vertex on the correct side; if none (pieces don't meet), fall back to a
round inner join — never a loop. Restore the tight test bound (every sampled point within tolerance of w/2) on the
L+A+C case and add the head-on line→semicircle case explicitly.

## 2. Text outlines (Fred: "eventually text")
- Filled text (the usual case): outline = the glyph outlines themselves, exact from the font (opentype.js path, already
  used by the stamp pipeline — editor-geometry.js / editor-fonts.js). Emit them as a path; curves stay the font's own
  curves converted to biarcs within OUTLINE_FIT.tolerance so the output is M/L/A/Z like everything else.
- Stroked text: glyph path → pathOutlinePathD.
- OUTLINE_KINDS gets `text`; it follows the element's transform like the others.
Verify with a CDP screenshot of a word on an Outline layer + tests (glyph count, M/L/A/Z only, deviation within
tolerance against the opentype path sampled).

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T40: exact curve-adjacent joins + text outlines — <sha>, vitest N, screenshots"`
and stop.

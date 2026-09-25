# NEXT (lane-b) — T39: outlines for polylines, polygons and ANY path (lines + arcs + curves)

**Ball: worker (seat B) · epoch 2 · T39.** NO FUSION for workers — browser proof only. Seat A is on SE7i part 2
(editor-interaction.js / editor-lattice.js). T38 reviewed + merged (9e020e3, 642 green); advisor independently measured
the ellipse outline: max |dist − w/2| = 0.0007" over 1176 samples, only M/A/Z — good.

## Do the deferred piece: path assembly
One general `pathOutlinePathD(d, strokeWidth, {mode, cap, join, tolerance})` that walks ANY absolute path (normalize
relative/H/V/S/T/Q first; Q → C exactly) segment by segment:
- straight → offset line; circular A (rx==ry, similarity) → concentric A; elliptical A and C → the T38 biarc fit
  (cubicSegmentOutlinePathD's primitive / fitOffsetWithBiarcs).
- Joins decided per vertex by the signed turn: outer side = round join (true A, r = w/2); inner side = trim both
  offset pieces to their intersection (no overlap loops). Smooth (tangent-continuous) vertices need no join.
- Open subpath → left bank + end cap + right bank reversed + start cap (round caps = true A; butt/square per
  SUPPORTED_LINE_CAPS). Closed subpath (Z) → outer ring + inner ring (evenodd), inner ring collapses where the shape
  is thinner than w (drop the collapsed piece, don't emit loops) — test a thin spike.
- Filled / both modes as for shapes.
Wire OUTLINE_KINDS: `polyline`, `polygon` (→ points to a path) and `path` all through it. The existing
line/rect/circle/ellipse entries stay (exact special cases).

## Verify
- vitest: every sampled outline point within tolerance of w/2 from the source (reuse a distance sampler; this is the
  one assertion that matters), outline contains only M/L/A/Z, a zig-zag polyline with acute + obtuse turns, a closed
  polygon with a concave corner, a path mixing L + circular A + C, an S-curve, a thin spike (inner collapse).
- CDP screenshot: a freehand (pencil) curve, a polygon and a mixed path on an Outline layer — preview visible.
- `npx vitest run` green (rerun once if a whole-suite "no tests"/import flake).

## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T39: path/polyline/polygon outlines — <sha>, vitest N, screenshots: <paths>"`
and stop.

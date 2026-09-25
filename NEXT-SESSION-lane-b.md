# NEXT (lane-b) — T56: lattice density by COUNT — 6–7 rails, 8–10 ties that BRIDGE rails (Fred)

**Ball: worker (seat B) · epoch 2 · T56.** NO FUSION. T55 reviewed + merged (874 green; your render viewed —
hourglass tangent + inward waist, bottle S-shoulder: good, sent to Fred).

## Fred: "your usual lattice is much denser than what I need" → "I want 6-7 rails and 8-10 ties"
Advisor measured on the default 7x9 board (6 seeds each): rails.every=2 → 17 rails; every=5 → 7 rails (stable).
Ties by DENSITY are unusable for a target: density 0.4 → 9..17 ties, 0.3 → 3..13, 0.25 → 4..8 — and ties are STUBS
(spanMin/Max 1–3 grid cells = 0.25–0.75") that don't reach the next rail once rails are 1.25" apart.
Render: C:\Users\danse\AppData\Local\Temp\claude\c--Users-danse-APPS-b-spline-generator-web-addin\3e3f0b14-6c58-4c85-afb5-23d3fcfd5c2e\scratchpad\dens2\density-options.png

## Do (declare the intent, don't tune a probability)
- `rails.count: [6,7]` (seeded pick in range) → rails evenly distributed across the extent's rows (snapped to grid
  rows); `rails.every` stays as an alternative mode (declare `rails.mode: 'count' | 'every'`, default 'count').
- `ties.count: [8,10]` (seeded pick in range) → exactly that many ties placed on distinct columns across the rail
  gaps; each tie BRIDGES adjacent rails by default (`ties.span: { rails: 1 }` = from one rail to the next; optionally
  up to 2 gaps via a declared `maxRailGaps`), ends ON the rails (nodes at both ends as today). Density stays as the
  alternative mode (`ties.mode: 'count' | 'density'`, default 'count'). Avoid two ties in the same column+gap; spread
  them (seeded, no clustering heuristics beyond "distinct slots").
- Works in both orientations, Board mode and SE13 boundary mode (count applies to the rows/columns that exist inside
  the boundary; if fewer slots than the count, place what fits).
- Panel: Rails "count 6–7" (two small steppers or a min/max pair) replacing "every" when mode=count; Ties "count 8–10"
  likewise; a small mode toggle to get the old controls back. Defaults change for NEW layers; an existing layer's
  saved pattern keeps its own values (no silent re-density).
## Verify
vitest: 50 seeds → rails ∈ [6,7], ties ∈ [8,10], every tie's ends lie on two rails; both orientations; boundary mode
places ≤ count. Render the same 3×3 sheet as the advisor's (7x9, 3 seeds) and VIEW it; save as t56-density.png.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T56: density by count — <sha>, vitest N, render"`
and stop.

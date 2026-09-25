# NEXT (lane-b) — T48: SE13 Slice 2 — computePattern boundary mode (NO runs yet)

**Ball: worker (seat B) · epoch 2 · T48.** NO FUSION. T47 reviewed + merged (762 green). Advisor independently checked
insideSpans on an irregular cubic + concave-notch boundary vs a 4000-step dense-polyline parity oracle: 0 span-count
mismatches over 150 rows, worst endpoint error 1.1e-6 (the oracle's own resolution). Good.

## Scope ruling (Fred's Q1 pending; advisor default = your own recommendation)
Build §14 Slice 2 WITHOUT the runs/parts sub-cut: boundary mode + spans + grid stops, uniform per-kind colors exactly
like Board mode (`stepLen` null, no omit/loose/palette). Keep the data model slot for runs declared (PATTERN.boundary.runs
= null) so it's additive later; do NOT build roll generation yet. Everything else in your Slice 2 verify list stands
(rect-boundary == rect-mode byte-identical; circle chords shorten; determinism).
Don't commit `reference/`.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T48: SE13 slice 2 boundary mode — <sha>, vitest N"`
and stop.

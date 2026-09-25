# NEXT (lane-b) — T61: SE15 Slice 1 — the sketch manifest (pure, browser-proven)

**Ball: worker (seat B) · epoch 2 · T61.** NO FUSION. T60 merged. The advisor answered your Fusion-API questions by
MEASURING in Fusion — read the new "Answers" section in SE15-CONSTRAINED-SKETCH-DESIGN.md (single open line offset =
2 classic `sketch.offset` calls, user-param-driven offset dims work, ~0.1 s/piece → threshold 60, placement kept,
constrained sketch replaces the plain sketch while the stamp still runs).
Build your §8 Slice 1: the pure manifest producer + its tests (entities, constraints, parameters for a box lattice,
a Shape Lattice hourglass and bottle, widths as offsets with round caps, the >60-piece plain fallback flag).
Include a tiny dev-only exporter so the advisor can grab a real manifest JSON from the live page for the Fusion
builder test (e.g. `window.__se15Manifest(layerId)` behind a debug flag) — say how to call it.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T61: SE15 slice 1 manifest — <sha>, vitest N"`
and stop.

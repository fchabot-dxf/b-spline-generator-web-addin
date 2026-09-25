# NEXT (lane-b) — T57: spread ties across the width, then SE14 Slice 3 (the Shape Lattice tool)

**Ball: worker (seat B) · epoch 2 · T57.** NO FUSION. T56 merged (counts right in your t56-density.png).

## 1. Ties clump (advisor, your own t56-density.png)
Seed 42: all 8 ties in the LEFT half; seed 7: most on the left. Counts are right, distribution isn't. Spread them:
stratify the chosen tie count over equal-width column zones (one tie per zone, seeded position inside the zone,
rail-gap chosen seeded), zones wrap if count > zones. Declared (ties.spread: 'stratified' default | 'random').
Test: 50 seeds → no half of the board holds more than ~65% of the ties; re-render the same 3 seeds and VIEW.

## 2. Then SE14 §10 Slice 3 — the Shape Lattice TOOL, per the design + its recorded decisions
Own rail icon + TOOL_PANELS entry (drawer tab on phones); Shape section: preset [Hourglass | Bottle] + 🎲 + the
preset's own sliders; per-side-segment style (straight | curve | kink) picked from a list or by tapping; AXIS-LOCKED
PARAMETRIC HANDLES on the canvas for the preset's independent params (design "Slice 3 editing model"); Fill section =
the box Lattice's own controls (counts from T56, Widths, Colors, Ending, Border); Generate. The box `#` Lattice loses
its Boundary row; old boundary layers are handed to Shape Lattice (settings kept). Detach on hand node-edit
(recompute-and-compare). Output = ordinary path + fill.
Verify live (CDP): pick Hourglass → generate → screenshot desktop + 390x844 drawer; drag the waist handle → stays
tangent (sampled tangent-continuity check on the live path); switch a segment to kink → screenshot; hand node-edit →
detached; Outline export of the filled layer → no new decline kinds. VIEW every screenshot.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T57: tie spread + Shape Lattice tool — <sha>, vitest N, screenshots"`
and stop. If slice 3 can't finish cleanly in this turn, commit part 1 + what's solid of slice 3 and pass with a note.

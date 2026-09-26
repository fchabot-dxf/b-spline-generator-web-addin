# NEXT (lane-b) — T66: SE15 — NO Fix anywhere; relationship constraints only (advisor-measured scheme)

**Ball: worker (seat B) · epoch 2 · T66.** NO FUSION for you. T65 NOT merged: advisor's real run (fresh manifests,
scratchpad\t65\m_box.json, m_shape.json):
- box: all 19 slots now BUILD (57 lines, 38 arcs, 24 circles), bbox ±3.29 × ±4.33 ✓ — but ALL 63 relationship
  constraints FAILED "VCS_SKETCH_OVER_CONSTRAINTS": the slot centerline ends are FIXED, so Horizontal / Coincident on
  them is redundant.
- shape: bbox −13.29..21.87 × −39.39..38.30 (still broken — outline and/or placement), one tie Slot failed
  ("InternalValidationError : isSuccessful").
## Fred's rule: "never use Fix". Advisor MEASURED the replacement in Fusion (2 rails + 1 tie, all slots, NO Fix):
constraints = rails Horizontal, tie Vertical, tie start Coincident(point, rail1 centerline), tie end Coincident(point,
rail2 centerline) → ZERO failures; stroke_width 0.07→0.2 moved centerlines only 0.005" and 0.2→0.07 returned EXACTLY.
## Do
1. Remove every `isFixed` / Fix from the builder (and the anchoring logic + its tests). No Fix anywhere, ever.
2. Relationships only, on SLOT CENTERLINES: rails Horizontal (Vertical in vertical orientation), ties the perpendicular
   one, tie ends Coincident point-on-curve to their rail centerline (or point-point Coincident when on a rail END),
   nodes: circle centre Coincident to the joint point. Separate points, one constraint per relation, never redundant.
3. Shape: fix the outline — build the silhouette arcs from three transformed POINTS (addByThreePoints) as instructed in
   T65 and check the bbox equals the SVG outline's; debug why the bbox is ±13/±39 (units? a second transform? a
   segment built in board coordinates?). Find why tie1's slot failed (zero-length? coincident endpoints?) and guard it.
4. Shim: must reject Fix on the real-API level check? no — just assert the builder never sets isFixed, and model
   over-constraint (a relation between two already-coincident fixed points) as a failure so this class can't pass again.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T66: SE15 no-Fix relationships + shape outline — <sha>, tests"`
and stop.

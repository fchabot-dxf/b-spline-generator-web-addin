# NEXT (lane-b) — T65: SE15 fixes from the advisor's REAL Fusion run of T64 (slots skipped, arcs wrong)

**Ball: worker (seat B) · epoch 2 · T65.** NO FUSION for you. T64 NOT merged (it fails in Fusion). Unit tests were
green because the fake adsk shim encoded the same wrong assumptions — fix the shim to match the REAL API too.

## Advisor ran your lane-b builder on fresh manifests (box + shape) in Fusion (scratchpad\t64\t64.json, m_box.json,
## m_shape.json — use as fixtures)
1. **Every slot SKIPPED**: `'SketchLines' object has no attribute 'addCenterToCenterSlot'`. The slot methods live on
   the **Sketch** object (advisor verified by dir(): sketch.addCenterToCenterSlot, sketch.addThreePointArcSlot,
   sketch.addCenterPointArcSlot, sketch.addCenterPointSlot, sketch.addOverallSlot). Consequence: 80 (box) / 94 (shape)
   "CONSTRAINT MISS: railN not found". Box sketch had only 20 circles, 0 lines.
   Signature measured: `sketch.addCenterToCenterSlot(Point3D_cm, Point3D_cm, ValueInput('0.07 in'), True)` → returns
   a vector; the sketch then has 2 side lines + 2 end arcs + a construction centerline + 1 SketchDiameterDimension
   (set its `.parameter.expression = 'stroke_width'`). Find the slot's own curves by diffing the sketch's curve
   collections before/after the call (the return value was a generic vector in the advisor's run).
2. **Shape outline arcs WRONG after the Y flip**: shape bbox x −6.38..5.19 on a 7-wide board (should be ≈ ±3.5,
   symmetric). The 6 arcs, as built (cx, cy, r, start → end, inches):
   (3.578, 2.101, 0.848, 2.73,2.10 → 4.38,1.82) (5.189, 1.527, 0.862, 4.38,1.82 → 4.42,1.13)
   (3.669, 0.743, 0.848, 4.42,1.13 → 2.82,0.74) (−4.673, 0.743, 0.848, −3.83,0.74 → −5.52,0.76)
   (−6.384, 0.77, 0.862, −5.52,0.76 → −5.84,1.44) (−5.309, 2.101, 0.848, −5.84,1.44 → −4.46,2.10)
   → centres outside the board, left not a mirror of right, arcs not connecting to the horn lines. The ArcCenter
   start/end angles (or sweep) are not transformed consistently with the Y flip + centering. Fix: transform the arc's
   three defining POINTS (start, mid, end) through the carve map and build with addByThreePoints, instead of
   transforming angles — robust to the flip. Test: built outline bbox == SVG-path outline bbox (±1e-6), left/right
   mirror, every arc end coincides with its neighbour line end.
3. Fix the SHIM: the fake Sketch must expose the slot methods on Sketch (not SketchLines) and arcs must be checked by
   geometry (endpoint continuity), so these two bugs would have failed your tests. Mutation-check that.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T65: SE15 real-API slots + flip-safe arcs — <sha>, tests"`
and stop.

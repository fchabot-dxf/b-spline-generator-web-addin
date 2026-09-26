# NEXT (lane-b) — T68: shape CONTOUR as slots (SE15b) + app/Fusion PARITY checks

**Ball: worker (seat B) · epoch 2 · T68.** NO FUSION. T67 (3105d74) accepted for review; advisor is running it in
Fusion now. This turn = exactly the two items T67 deferred. Fred's rules still hold: NEVER Fix; joints = separate
points + explicit Coincident.
## 1. Contour as slots (Fred: "want the shape contour to be made of slots")
The manifest already emits the contour per segment (segN: Line / Arc3Point). Declare it (e.g. contour widthMode
'slot' in the manifest), then in the builder:
- contour Line → `sketch.addCenterToCenterSlot(p1, p2, ValueInput(w), True)` (arg4 True = width dimension).
- contour Arc3Point → `sketch.addThreePointArcSlot(p1, pMid, p2, ValueInput(w), True)` (advisor measured: centerline
  arc through the 3 points, sides ±w/2, end caps, a width dimension whose .parameter.expression can be set).
- Register the CENTERLINE (construction line/arc) under the seg id; :S/:E by PROXIMITY to p1/p2; :C = arc centre.
- width expression = `stroke_width` (same param as rails/ties).
- The existing seg constraints (Coincident chain, Tangent, H/V, Equal, Radial dim) act on the centerlines.
- If a Tangent between centerlines would over-constrain, report which one. Never Fix around it.
- Shim: model addThreePointArcSlot (centerline arc + 2 side arcs + 2 caps + width dim) incl. CCW normalisation.
## 2. Parity (Fred: "make sure the drawing in the addin matches the one we insert in fusion")
2a. JS test (box AND shape, default + one non-default seed, oneEnded 0 and 2): every drawn piece in the layer
    (rails, ties, nodes, contour segments) has exactly one manifest entity with identical geometry, and vice versa.
    Tolerance 1e-6 in.
2b. Python `verify_sketch_against_manifest(sketch, manifest, tol=0.002)` called at the end of build_constrained_sketch;
    summary gains `"parity": {"maxErr", "mismatches": [ids]}`. It reads slot centerline ends, circle centres, contour
    centerline ends + arc radius (order-free ends). WARNING log on mismatch. Shim test: a moved point is reported.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then from the WORKTREE root:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T68: contour slots + parity — <sha>, tests"`
and stop. If it is too big for one turn, finish item 2 FIRST (smaller), commit, then item 1, and say where you stopped.

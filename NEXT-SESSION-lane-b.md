# NEXT (lane-b) — T69: shape CONTOUR as slots (SE15b) — the ONE item, nothing else this turn

**Ball: worker (seat B) · epoch 2 · T69.** NO FUSION. T68 (9448691, parity) is being verified by the advisor in Fusion.
Fred: "want the shape contour to be made of slots". Rules: NEVER Fix; joints = separate points + explicit Coincident.
- Declare it in the manifest (contour `widthMode:'slot'`), not as a builder special case.
- contour Line → `sketch.addCenterToCenterSlot(p1, p2, ValueInput(w), True)`.
- contour Arc3Point → `sketch.addThreePointArcSlot(p1, pMid, p2, ValueInput(w), True)`. Advisor MEASURED earlier: it
  inserts a construction centerline arc through the 3 points, sides ±w/2, end caps, and a width dimension whose
  .parameter.expression can be set. The advisor will verify the rest live; build to that shape and stub it in the shim.
- Register the CENTERLINE (construction line / arc) under the seg id; :S/:E by PROXIMITY to p1/p2; :C = arc centre.
- width expression = `stroke_width`.
- Existing seg constraints (Coincident chain, Tangent, H/V, Equal, Radial) target the centerlines unchanged.
- verify_sketch_against_manifest reads contour from the centerlines.
- If you can't identify an arc slot's centerline robustly (e.g. by construction flag + passing through pMid), log it
  and skip that seg — never guess.
Pass back when done: `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T69: contour slots — <sha>, tests"`.

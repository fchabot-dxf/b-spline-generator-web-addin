# NEXT (lane-b) — T67: SE15 three fixes, all MEASURED in real Fusion by the advisor

**Ball: worker (seat B) · epoch 2 · T67.** NO FUSION for you. The advisor ran T66 (3804c93) on fresh manifests from
lane-b's own app, then re-ran with a scratch-patched builder carrying exactly these three changes:
box = 45 entities, 0 constraint fails, 0 dim fails; shape = 52 entities, 0 fails, bbox ±3.5 × ±4.54 (correct);
stroke_width 0.07→0.25→0.5 moved centerlines ≤0.024" and every slot re-widened. Without them: 34/35 constraint fails,
every slot DIM MISS, shape bbox −13..22 × −39..38.
## The three fixes (port them properly, with tests)
1. `sketch.addCenterToCenterSlot(p1, p2, value_input, True)` — the 4th arg is the CREATE-WIDTH-DIMENSION flag, NOT
   Fix. T66 set it False, so no slot got a width dimension (all "DIM MISS … rail0_width") and stroke_width drove
   nothing. The Fix in T64/T65 came from the post-hoc `isFixed = True`, which stays removed. Correct the T66 docstring
   and the shim (the shim must model arg4 as "creates a SketchDiameterDimension", and a False must yield DIM MISS).
2. Node constraints target the CIRCLE (`node0`) → "argument 2 of type SketchPoint". The manifest must emit
   `nodeN:C` (the circle centre) for every node Coincident (JS side, editor-sketch-manifest.js — the declaration is
   the fix, not a Python special-case). Test: every Coincident target that names a Circle carries `:C`.
3. Arc3Point `:S`/`:E`: Fusion's addByThreePoints always runs CCW, so `arc.startSketchPoint` can be the manifest's
   p2. Label by proximity:
       sp, ep = arc.startSketchPoint, arc.endSketchPoint
       if sp.geometry.distanceTo(p1) > ep.geometry.distanceTo(p1): sp, ep = ep, sp
   then set_id(sp → ':S', ep → ':E'). This alone fixed the shape bbox. Shim: model CCW normalisation so a CW input
   swaps start/end, and assert the coincident chain joins the right ends.
Also: the one remaining box-lattice shape failure seen mid-run (`node24:C` + `tie12:S` over-constrained) did not recur
in the final shape run; if you can see why a node could get BOTH a tie-end coincident and a rail coincident through
the same point, dedupe it (one relation per point pair).
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then from the WORKTREE root:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T67: SE15 slot dim flag + node :C + arc S/E — <sha>, tests"`
and stop.

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

## AMEND (Fred 2026-09-25: "Ties needs to be coincident to their rails")
4. Box lattice default tie span → `span: { mode: 'rails', rails: 1 }` (the declared alternative in PATTERN_DEFAULTS.ties,
   editor-lattice-pattern.js ~L272): every tie bridges exactly one pair of ADJACENT rails, both ends ON a rail — no
   stubs floating mid-span. Keep count [8,13] + stratified spread (still 7 rails / ~13 ties). 'cells' stays a declared
   alternative (not deleted). The Shape Lattice's ties too, if it has its own span default — check and align.
   Manifest: every tie end → Coincident on its rail centerline (tie-end-to-rail, :S/:E when it lands on a rail end).
   Tests: for the default pattern, EVERY tie endpoint lies on a rail (|y - railY| < 1e-9 within the rail's x-extent),
   and the manifest has exactly 2 tie-on-rail Coincidents per tie. Render the default box + shape lattice to PNG and
   VIEW it before passing (no floating ties).

## AMEND 2 (Fred: "make sure the drawing in the addin matches the one we insert in fusion") — declare PARITY as a check
Advisor measured it today: app SVG ↔ manifest = identical (box: 14/14 lines, 16/16 nodes); Fusion ↔ manifest = all
52 shape pieces within 0.00034" (read back from the real sketch). Make both links permanent:
5a. JS test (box AND shape, default patterns + one non-default seed): every drawn lattice/contour piece in the layer
    has exactly one manifest entity with the same geometry (lines: endpoints; nodes: centre; contour arcs: ends +
    radius), and vice versa — no extras, none missing. Tolerance 1e-6 in.
5b. Python `verify_sketch_against_manifest(sketch, manifest, tol=0.002)` in sketch_manifest_builder.py, called at the
    end of build_constrained_sketch; the summary gains `"parity": {"maxErr": …, "mismatches": [ids]}`. It reads back
    slot centerline ends, circle centres, contour line ends, arc ends + radius (match arc ends order-free — Fusion
    arcs are CCW). Log a WARNING when mismatches is non-empty. Shim test: a moved point is reported, an exact build
    reports none.

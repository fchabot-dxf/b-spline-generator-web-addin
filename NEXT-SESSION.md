# NEXT — SE11c: the drape is mirrored front↔back relative to the carve

**Ball: worker (seat A) · epoch 2 · SE11c.** SE11b (8a20cbe) accepted as far as it goes — the drape now renders in Fusion
(uv attribute + emissiveMap were real bugs). Main also has seat B's T27 (ab7772b, 357 tests): use
`isCarved(l) && l.showColor !== false` from `editor/layers.js` in `buildDrapeSvg` instead of re-stating the rule.
One commit by path.

## Evidence (advisor, live in Fusion, build ab7772b) — `smoke-out/se11c-flipped.png`
Red L drawn in the editor's TOP-LEFT (a horizontal stroke along the top + a vertical stroke down the left), Apply. In the
palette's 3D view the L is CARVED along the model's BACK edge (dark grooves, back/top of the view), but the red DRAPE
appears at the FRONT-LEFT corner. So the drape texture is flipped in Y relative to the heightfield (your SE11 note set
`texture.flipY = false` by reasoning, and your SE11b screenshot showed a red line without comparing it to the carve).
## Do
1. Fix the orientation at ONE place (texture flipY, or the uv v-coordinate, or the canvas draw) — whichever makes the
   drape's row 0 = the heightfield's row 0. Say which and why in WORK-LOG.
2. Add a guard that would have caught this: a pure test that the uv assigned to the vertex of heightfield cell (i, j)
   samples the drape texture at the pixel the SAME SVG point maps to (top-left SVG → the heightfield's first row).
3. Prove it in Fusion with an ASYMMETRIC mark (the advisor's L works): screenshot where the red lies exactly on the carved
   L grooves. Compare drape to carve in the screenshot, not the drape alone.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE11c: drape aligned with the carve — <what flipped> — <sha>, screenshot: <path>"`
and stop.

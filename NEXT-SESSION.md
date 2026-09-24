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

## RE-DISPATCH (Fusion is Session-Suspended — Fred's other session; prove it in the BROWSER instead)
The 3D preview code is the same in the site and the palette. Verify with data, not a screenshot:
1. Serve from the repo root, open the palette page with `scripts/smoke-editor.mjs` (add a `drape-align` mode), draw the
   advisor's L (top-left horizontal + left vertical stroke) in red via the editor API, Apply.
2. From the page's own preview objects (find the terrain mesh + its drape texture): collect the vertices whose height is
   clearly depressed by the carve (the L grooves: compare against the same mesh with the L removed, or threshold the
   stamp mask), and for each read the drape texture colour at that vertex's uv. PASS = the carved-L vertices read red
   (≥ 90 %), AND the vertices at the Y-mirrored positions do NOT. Print both percentages. Run it with flipY = false and
   = true to show which one is correct — that settles the orientation by evidence.
3. Picture (optional): `renderer.domElement.toDataURL()` called synchronously right after `renderer.render(...)` (or
   create the renderer with `preserveDrawingBuffer: true` in the smoke run only) — headless CDP screenshots of WebGL came
   out black before.
4. Commit the fix + the uv↔SVG guard test + the drape-align mode. Fusion proof follows when Fred clears the suspension.

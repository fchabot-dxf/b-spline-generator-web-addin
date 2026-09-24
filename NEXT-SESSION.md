# NEXT — SE11d: black lines drape too (Fred: "don't skip black lines")

**Ball: worker (seat A) · epoch 2 · SE11d.** SE11c (f78b32e) accepted — advisor verified live in Fusion: the red L now paints
exactly its carved grooves. Small turn. One commit by path.
## Do
The drape skipped pure black (`DRAPE_SKIP_COLORS = ['#000000']`, advisor's own guess, now overruled by Fred). Remove the
skip entirely: delete the constant and the filter in `buildDrapeSvg` (`core/preview/drape-svg.js`), and flip the tests
that asserted black is skipped to assert black IS draped (a black element on a 3D + palette layer appears in the drape
SVG). Grep every reference (list them in WORK-LOG) — nothing named DRAPE_SKIP_COLORS may remain. Keep the rule:
drape = isCarved(l) && l.showColor !== false.
## Verify
`npx vitest run` green. Optional: deploy and check a black stroke shows on the mesh (Fusion bridge is up).
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE11d: black drapes too, skip removed — <sha>, vitest N"`
and stop.

# NEXT (lane-b) — T71: T69-fix-3 (loose contour + contour_width/height) + stroke default 0.25

**Ball: worker (seat B) · EPOCH 3 (fresh session) · T71.** NO FUSION (the advisor runs Fusion). Read the worker skill,
then this file, then WORK-LOG-lane-b.md's "### T69-fix-3 — the synthesized FINAL spec" section (~line 8411): it is the
ACCEPTED spec for this task. Implement it exactly, with these advisor rulings:
- The flagged judgment call is CONFIRMED: with Symmetry gone, REVERT the mirror-Tangent dedup (restore all 8 Tangents)
  AND the shoulder Equal drop (restore Equal(seg1,seg9)). If the advisor's live run then shows a specific Tangent/Equal
  as OVER_CONSTRAINTS, it will be dropped by measurement, not by reasoning.
- Fred's constraint vocabulary (SE15-CONSTRAINED-SKETCH-DESIGN.md "LOOSE CONTOUR" + "NO FIX"): NO Fix, NO Symmetry, NO
  radius dims, NO length dims EXCEPT the contour's overall size = `contour_width` / `contour_height` (new independent
  params, default = board minus 1 in; point-to-point Distance dims on corner points — the API rejects curves).
- Stroke default 0.25 in (one declaration in PATTERN_DEFAULTS; read each `0.07` test hit's context before changing).
- App/manifest parity must stay exact (tests/parity-app-manifest.test.js), including the inset contour.
Scope: ONLY this. SE14b (contour segments selectable/colourable, investigation already in WORK-LOG) is the NEXT task.
Commit by path, push, then from the WORKTREE root:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T71: loose contour + contour_width/height + stroke 0.25 — <sha>, tests"` and stop.

# NEXT (lane-b) — T62: SE15 Slice 2 — the add-in builder (Python), advisor verifies in Fusion

**Ball: worker (seat B) · epoch 2 · T62.** NO FUSION for you — write + unit-test the Python without Fusion (mock
adsk where needed); the ADVISOR runs it in real Fusion after merge. T61 merged (manifest: hourglass+fill = 83
entities / 56 constraints / 7 params, live-verified).

## Build your §5/§8 Slice 2
- Python in the b-spline-gen add-in: `build_constrained_sketch(sketch_target, manifest, placement)` — entities
  (lines addByTwoPoints, 3-point/center arcs, circles), constraints (coincident, tangent, horizontal/vertical,
  symmetry, equal, point-on-curve for tie ends), user parameters (create or update; names from the manifest),
  width = TWO classic `sketch.offset(ObjectCollection([line]), dirPoint, dist)` calls per centerline with each
  offset dimension's `parameter.expression = '<param> / 2'` (MEASURED to work by the advisor — see SE15 "Answers"),
  round caps as arcs tangent to the offsets. Order: all geometry → constraints → dimensions/params, to avoid solver
  fights. A failed constraint is SKIPPED and reported (count + first few reasons in the log), never aborts the send.
  Above the 60-piece threshold: plain geometry (no constraints), as declared.
- Wire it into the Send-to-Fusion path per §7 (constrained sketch REPLACES that layer's plain SVG sketch; the carve
  stamp still runs; plain SVG path unchanged when the option is off). The option: a per-send toggle or the layer's
  Fusion Geometry gets a 'Constrained sketch' choice — pick the smaller change, say which.
- Reuse fb_engine where it fits (cite); fill its gaps as your design listed.
- A dev entry point the advisor can call from fusion_execute with a manifest JSON file path:
  `build_from_manifest_file(path)` → builds into a NEW sketch on the root component's XY plane and returns a summary
  dict (entities made, constraints applied/skipped, params, seconds). Document it in WORK-LOG.
Tests: python unit tests with a fake adsk shim for ordering, skip-and-report, threshold; JS side unchanged tests green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T62: SE15 add-in builder — <sha>, tests, how to call"`
and stop.

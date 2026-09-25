# NEXT (lane-b) — T63: SE15 fixes from the advisor's REAL Fusion run + wire the add-in to use the manifest

**Ball: worker (seat B) · epoch 2 · T63.** NO FUSION for you (advisor re-verifies). T62 not merged yet — it merges
with this fix.

## Advisor's real Fusion run (build_from_manifest_file on a live hourglass+lattice manifest, 75 entities / 51
## constraints; manifest saved at scratchpad\se15-real-manifest.json — use it as a fixture)
Built in 18.8 s. Entities 75/75. Manifest constraints + dimensions: 0 failures. 7 user params created. 30 width
offsets (15 centerlines × 2). Changing rail_width in Fusion DID move the rail offsets — param-driven width works.
Constraint mix in the result: Vertical 13, Horizontal 8, Coincident 16, Tangent 38, Equal 6, Offset 30; 79 dims;
59 profiles; not fully constrained (as intended).
### Bugs
1. **Parameter UNITS off by 2.54**: rail_width = 0.0276" (should 0.07"), tie_width 0.0276", node_radius 0.0295"
   (should 0.075"), half_width 1.378" (should 3.5"). Length params are created from inch numbers as if they were
   cm (e.g. ValueInput.createByReal(0.07) = 0.07 cm). Create/update length params with
   `ValueInput.createByString(f"{v} in")` (or ×2.54 into createByReal) and the 'in' unit; keep unitless params
   (waist_reach ratio etc.) unitless. Test with the fake shim asserting the ValueInput string/number.
2. **30 "CAP TANGENT SKIP … VCS_SKETCH_OVER_CONSTRAINTS"**: the cap arcs are already fully determined by the
   offsets (coincident ends + center on the centerline end), so adding tangency over-constrains. Drop the explicit
   cap-tangent step (or build caps so exactly the needed constraints are added) — the result must have ZERO skips
   on this fixture. Don't just silence the log.
3. **Not wired**: b-spline-gen.py never reads `sketchManifest` — Send to Fusion still imports only the plain SVG.
   Per SE15 §7 + the recorded default: when a layer carries `sketchManifest`, build the constrained sketch with
   `build_constrained_sketch` (same placement as _import_single_layer_svg) INSTEAD of that layer's plain SVG
   sketch; the carve stamp still runs. Log a one-line summary (entities, constraints applied/skipped, seconds).
   Make sure the add-in package includes sketch_manifest_builder.py (check release/deploy file lists, the
   sync/copy scripts, and `_ensure_fb_engine_importable` paths in the DEPLOYED layout, not just the repo layout).
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T63: SE15 units + caps + wiring — <sha>, tests"`
and stop.

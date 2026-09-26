# NEXT — ADD1: two add-in bugs found in the live Fusion run (Send to Fusion constrained sketches)

**Ball: worker (seat A) · epoch 2 · ADD1.** NO FUSION (advisor verifies live). main is at 660f417 (lane-b T64-T72
merged + MOB6). Both bugs are in b-spline-gen Python; don't touch lattice JS (seat B is on SE14b in lane-b).
## 1. Stale sketch_manifest_builder after an add-in Stop/Run (MEASURED)
After deploying new files and Stop -> Run in Fusion, `bspline_ui.build_constrained_sketch` was still the OLD module
object from Fusion's startup (signature without `sketch_name_override`), so every constrained layer failed:
"build_constrained_sketch() got an unexpected keyword argument 'sketch_name_override'". sys.modules kept
'sketch_manifest_builder' (and the fb_engine.* it imports). Fix by declaration: the add-in's run() (or its existing
reload/purge list, if there is one — find it) must purge every sibling module it owns — at least
sketch_manifest_builder and fb_engine.* — before importing, so Stop/Run always loads the installed files. One declared
list, not scattered pops. Test: a unit test that the purge list covers every module b-spline-gen.py imports from its
own folder / fb_engine.
## 2. False "Constrained sketch build failed" log (MEASURED)
_build_constrained_sketch_for_layer's summary log reads summary['offsets'][...] — the offset step was removed in T64,
so every SUCCESSFUL build raises KeyError('offsets') after the sketch is built and logs "[SE15] Constrained sketch
build failed ... 'offsets'". Log only keys the summary actually has (entities, constraints, dimensions, parameters,
parity, seconds) and include parity maxErr. Test it against build_constrained_sketch's real return shape.
Commit by path, push, then `python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "ADD1 — <sha>"`.

# NEXT — FB2 DESIGN (no code): one declared hidden-command palette scaffold for the two frame builders

**Ball: worker (seat A) · epoch 1 · FB2-design.** Output: ONE file, `FB2-PALETTE-SCAFFOLD-DESIGN.md` at the repo root.
No product code this turn. Commit by path.

## Ground truth (advisor-verified)
`frame-builder/ui/sketch_builder_ui.py` (594 lines) and `frame-builder/ui/solid_builder_ui.py` (351) define the SAME
eleven names: `_create_hidden_command`, `_ensure_hidden_commands`, `_schedule_hidden_build`, `CommandCreatedHandler`,
`PaletteHTMLEventHandler`, `HiddenBuildCommandCreatedHandler`, `HiddenBuildCommandExecuteHandler`, `_set_status`,
`_notify_status`, `_close_palette`, `run_palette`. They differ by module constants (`PALETTE_ID/NAME/HTML`, the build
command id) and by the one build call (`frame_engine.build_sketch_logic_v3` vs `solid_coordinator.build_solid_logic_v3`).
Sketch-only extras: `_schedule_schema_push` / `_push_schema_direct` + their two handler classes, `DocumentActivatedHandler`,
`_ensure_tilt_param_safe`. The parent loader tears both down through `_teardown_submodules` (`bspline-frame-builder.py`),
reading each module's `handlers` list and, for sketch, its `DocumentActivated` subscription — the design must keep that
contract or change it explicitly.

## Write the design — sections, each with file:line evidence
1. **Diff map.** For each of the eleven shared names: identical / differs only by constant / differs in logic (quote the
   differing lines). `diff -u` is your tool; summarize, don't paste it all.
2. **The declaration.** Propose `frame-builder/ui/palette_scaffold.py` exposing ONE declared shape — e.g. a
   `PaletteSpec(palette_id, name, html, build_cmd_id, build_fn, extra_commands=(), on_document_activated=None)` — and a
   `make_palette(spec)` (or a small class) that returns the run/stop surface the parent needs (`run_palette`,
   `handlers`, and whatever `_teardown_submodules` reads). Show what each of the two UI modules becomes: ideally ~40
   lines each = constants + the spec + the build function. Name every function that moves, and where.
3. **What stays sketch-only** (schema push, tilt param, doc-activated) and how it plugs into the scaffold without a
   flag that the solid side has to know about (no `if is_sketch:` inside the scaffold — that is the hand-roll in disguise).
4. **The bridge contract check.** The palette HTML sends actions (`fusionSendData`) that `PaletteHTMLEventHandler`
   dispatches. List both palettes' action strings and confirm the scaffold keeps every one wired (doorless sweep both
   directions, like the audit did).
5. **Migration plan in slices**, each one turn, each leaving both palettes working: (a) scaffold module added + sketch
   switched; (b) solid switched; (c) delete the duplicates + honesty sweep of comments. Per slice: files, predicted
   shape, the headless gate (py_compile, pyflakes, an import-time smoke with the template-maker conftest adsk stub if
   feasible), and what the advisor verifies live through the bridge (open both palettes, build one frame each,
   Stop→Start).
6. **Risks / STOP conditions**: anything whose behaviour could change (handler lifetime, palette re-open on
   document switch, the hidden-command purge order in `run_palette`).

## Do NOT
Edit any `.py`/`.html`. Don't propose "keep both, add a flag". Don't deploy.

## When done
Commit `FB2-PALETTE-SCAFFOLD-DESIGN.md` + WORK-LOG by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB2 design: <n> of 11 names identical/<m> constant-only/<k> logic-diff; PaletteSpec + make_palette proposed; 3 slices; risks listed — <sha>. Awaiting advisor blessing."`
and stop.

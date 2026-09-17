# NEXT — CAM1 DESIGN (no code): consolidate CAM Builder and CAM Studio into one palette (Fred's ruling)

**Ball: worker (seat A) · epoch 1 · CAM1-design.** Output: ONE file, `CAM1-CONSOLIDATION-DESIGN.md` at the repo root.
No product code this turn. Commit by path.

## Ground truth (from the audit A6 + advisor)
- `CAM-builder/cam-builder.py` (2315 lines) runs TWO palettes + two toolbar commands: `PALETTE_ID` "B-spline CAM"
  (`ui/html/cam_builder_palette.html`) and `STUDIO_PALETTE_ID` "CAM Studio" (`ui/html/cam_studio_palette.html`); 1713
  lines of HTML combined. Two dispatchers: builder (`:249-267`, actions `add_machine apply_toolpaths build
  get_template_assignments list_cam_templates preview set_template_assignments sync_table_attach`) and studio
  (`:436-448`, actions `generate import_setup init preview preview_clear select_x_axis select_y_axis`). Three send
  helpers → 7 events (`template_assignments templates_list build_info preview report axis_picked import_result
  init_result`). Wiring is clean both ways (A6). `cam_engine/` (4588 lines) does the real work: `setup_builder.py`,
  `mm_builder.py`, `cam_coordinator.py`, `cam_workspace.py`, `parameter_introspect.py`, `template_assignments.py`.
- Ruling: "CAM Builder vs CAM Studio → consolidate" (both have overlapping `preview` actions; Fred finds two entries
  confusing).

## Write the design — sections, each with file:line evidence
1. **What each palette actually does today**, as a user sees it: the workflow steps in order, per palette, with the
   Python handler each step hits. Where do they overlap (the two `preview` actions — same thing or different?), where
   does one feed the other (does Studio's `import_setup` consume Builder's output?), what state does each keep
   (`_state`-style globals, `template_assignments`, picked axes).
2. **One palette, declared as tabs/steps**: propose a single `CAM` palette whose HTML is the union, organised as the
   ORDER a user works in (e.g. Setup → Templates → Toolpaths → Generate), with ONE dispatcher table (action → handler)
   and ONE send helper. Show the action table after merge (no two actions with the same name meaning different things —
   rename or merge `preview`). Name every function that moves and where. Keep `cam_engine/` untouched unless a
   handler's split forces it — say if it does.
3. **Toolbar**: one command `CamBuilder_Command` "CAM"; `CamStudio_Command` retired (the parent's `stop()` loops over both
   ids — list the parent lines to change; A6 says stop() unregisters events per id).
4. **Bridge contract sweep after merge**: every JS `fusionSendData` action ↔ one dispatcher branch; every Python send ↔
   one JS listener. Same table format as FB2's design §4.
5. **Migration in slices** (each leaves a working palette; each with a headless gate + what the advisor verifies live
   through the bridge): (a) merged HTML shell + dispatcher union, Studio's palette still reachable; (b) retire the
   Studio command/palette + parent lines; (c) honesty sweep (`cam-builder.py` comments that name two palettes).
6. **Risks / STOP conditions**: modal `selectEntity` axis picks (they block the bridge — the advisor learned that
   today), long-running `generate` (timeouts), the B10 event ids, anything in `cam_engine` that assumes which palette
   called it.

## Do NOT
Edit any `.py`/`.html`. Don't propose "keep both, add a switch". Don't deploy.

## When done
Commit `CAM1-CONSOLIDATION-DESIGN.md` + WORK-LOG by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "CAM1 design: <n> steps mapped, <k> actions after merge (preview resolved as <x>), 3 slices, risks listed — <sha>. Awaiting advisor blessing."`
and stop.

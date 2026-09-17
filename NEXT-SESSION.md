# NEXT — CAM1 slice (c): honesty sweep + design-doc status (FB2c's shape)

**Ball: worker (seat A) · epoch 1 · CAM1c.** Files: `bspline-frame-builder/CAM-builder/cam-builder.py`,
`bspline-frame-builder/CAM-builder/ui/html/cam_builder_palette.html`, `CAM1-CONSOLIDATION-DESIGN.md` (status block only).
One commit by path, predicted **3 files**, comment/text-scale diffs only. No behaviour changes.

## Ground truth (advisor, deployed 90168b1)
Slice (b) is live: one "CAM" button, `CamStudio_Command` and `CamStudio_Palette` gone after Stop→Start, the old palette
file swept from the AddIns folder by DEP1's orphan sweep. Remaining wording that describes the two-palette era:
- `cam-builder.py:37` section banner "B-spline CAM palette" (it is now the whole CAM palette); `:424` "(formerly the
  standalone CAM Studio palette)" — fine as history, keep; `:451`, `:988`, `:1168`, `:1980` say "CAM Studio" as if it
  were a thing a user opens — reword to "the GENERIC tab" / "generic mode". Read the module docstring (`:1-36`) and fix
  any sentence that still says two palettes or two buttons.
- `cam_builder_palette.html:671` the Generic tab's help note starts `<strong>CAM Studio:</strong>` → `<strong>Generic mode:</strong>`.
- Header layout nit seen live: on the B-SPLINE tab the build stamp wraps to three lines next to the tabs. If a one-line
  CSS tweak (e.g. `white-space:nowrap; font-size` on the stamp span, or letting the status text truncate with
  `text-overflow`) fixes it, do it; if it needs layout work, report and leave it.
- Design doc: add a 3-line status block at the top of `CAM1-CONSOLIDATION-DESIGN.md`: implemented in CAM1a (d714591),
  CAM1b (de63098), CAM1c (<this sha>); the advisor's amendments (dock-right already true; stock-preview echo: <what you
  found in slice (a)>); the two fixes found during implementation (preview_bodies on the sending side; studio sends
  reaching the merged palette; the `response` ack; the STUDIO_PALETTE_ID NameError in generate).

## Verify
- `py_compile` + `pyflakes` (no new warnings); extract + `node --check` the palette scripts.
- Grep `CAM Studio` in cam-builder.py + the html → only the `:424` history note remains (quote it).
- Re-run the bridge sweep (15 sends ↔ 15 branches; 8 events ↔ 8 listeners) against the final tree — paste it.
- `git show --stat HEAD` → 3 files. Live look is the ADVISOR's.

## Do NOT
Change any behaviour; touch cam_engine; touch the tab bodies beyond the help-note text and the header nit.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "CAM1c: <n> stale comments corrected, help note reworded, header nit <fixed|reported>, design doc status block; bridge sweep 15/15 + 8/8 — <sha>, 3 files. CAM1 COMPLETE pending advisor live check."`
and stop.

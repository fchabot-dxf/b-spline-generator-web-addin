# NEXT — FB2 slice (b): switch the Extrude Frame (solid) palette onto the scaffold

**Ball: worker (seat A) · epoch 1 · FB2b.** File: ONLY `bspline-frame-builder/frame-builder/ui/solid_builder_ui.py`.
One commit by path, predicted **1 file** (351 → ~40-60 lines).

## Ground truth (advisor)
- FB2a + FB2a-fix are live-proven (deployed 387942e): Sketch Builder opens, creates `frame_tilt_deg`, builds a
  tilted frame (timeline 5), Stop→Start rebuilds a fresh module with the doc-activated handler cleared and re-added.
  One open question is parked for slice (c): a single document switch logged TWO "SCHEMA PUSH: scheduled" lines; the
  advisor will re-measure with a cleaner test before (c). Do not touch the sketch side in this slice.
- `solid_builder_ui.py` today: constants `PALETTE_ID/NAME/HTML`, `BUILD_SOLID_CMD_ID`; `PaletteHTMLEventHandler` with
  `selected_face` state and actions `run_build`, `pick_face`, `ping` (all wired, §4 of the design — must stay exactly
  so); `_run_solid_build_direct(data)` calls `solid_coordinator.build_solid_logic_v3(...)`; no doc-activated, no
  schema push; window 380×460, min 320×360. The parent reads `_fb_solid.handlers` and `_fb_solid.CommandCreatedHandler`
  and injects `frame_engine` (unused by solid — keep accepting it).

## Do (exactly the design's slice (b), the way FB2a did it for sketch)
1. `sys.path` line for `ui/` (same as sketch). Import `PaletteSpec, make_palette, _PaletteBridgeMixin` from
   `palette_scaffold`.
2. `PaletteHTMLEventHandler(_PaletteBridgeMixin, adsk.core.HTMLEventHandler)` keeps its `selected_face` state and its
   three actions verbatim; `run_build` calls `_palette.schedule_hidden_build(data)`.
3. `_build_fn(data, ctx)` = today's `_run_solid_build_direct` body using `ctx.set_status`/`ctx.notify_status`/
   `ctx.close_palette`/`ctx.diag_logger`.
4. `_spec = PaletteSpec(..., size=(380, 460), min_size=(320, 360), build_cmd_id=BUILD_SOLID_CMD_ID, build_fn=_build_fn,
   make_html_handler=..., extra_commands=(), on_document_activated=None, on_ready=None)`; `_palette = make_palette(_spec)`;
   re-export `run_palette`, `handlers`, `CommandCreatedHandler` the same way sketch does.
5. Delete every duplicated function/class the scaffold now provides. No `_doc_activated_handler` attribute is needed
   for solid (the parent reads it only for sketch).

## Verify (headless)
- `py_compile` + `pyflakes` (0 warnings).
- Import smoke with the adsk stub (same script as FB2a): module imports; `handlers` is a list; `run_palette` callable;
  `CommandCreatedHandler` exists; `PaletteHTMLEventHandler.notify` exists; action grep `run_build pick_face ping` → 1 each.
- `wc -l` before/after. `git show --stat HEAD` → 1 file. Live proof (open Extrude Frame, pick a face, build, auto-close,
  Stop→Start, reopen) is the ADVISOR's.

## Do NOT
Touch `sketch_builder_ui.py`, `palette_scaffold.py`, either HTML, or the parent. No `if is_solid`. Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB2b: solid_builder_ui 351→<n> lines on the scaffold; actions run_build/pick_face/ping intact; smoke OK — <sha>, 1 file. Next: FB2c."`
and stop.

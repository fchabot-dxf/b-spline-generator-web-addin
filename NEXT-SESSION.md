# NEXT — FB2 slice (a): add `palette_scaffold.py`, switch the Sketch Builder onto it (solid untouched)

**Ball: worker (seat A) · epoch 1 · FB2a.** Design BLESSED as written in `FB2-PALETTE-SCAFFOLD-DESIGN.md` with two
amendments below. Files: `bspline-frame-builder/frame-builder/ui/palette_scaffold.py` (new),
`bspline-frame-builder/frame-builder/ui/sketch_builder_ui.py` (rewritten onto the scaffold),
`bspline-frame-builder/bspline-frame-builder.py` (one line, amendment 1). One commit by path, predicted **3 files**.
`solid_builder_ui.py` stays untouched — the two styles must coexist after this slice.

## Amendments to the design (advisor)
1. **Hot-reload wipe.** A new bare module `palette_scaffold` would stay cached in `sys.modules` across Stop→Start
   (B7/A3-1 class). Extend the derivation from TM2 in `bspline-frame-builder.py` `_bootstrap`:
   `+ _bare_module_names(os.path.join(_addin_root, 'frame-builder', 'ui'))` appended to `_shared_project_names`
   (the two `*_builder_ui` names are harmless extras; they are loaded by path under other names).
2. **The loop must bind per iteration.** In the generic hidden-command loop, pass `cmd_id`/`handler_factory` as
   default arguments or via a small factory function — never a closure over the loop variable. Add one line to the
   docstring saying so, and prove it in the headless smoke (register two fake commands, assert the two handlers
   differ).

## Do (exactly the design's slice (a))
1. `palette_scaffold.py`: `PaletteSpec`, `_PaletteBridgeMixin` (`_send_palette_message`, `_send_build_info` moved
   verbatim), `make_palette(spec)` returning an object/namespace with `run_palette`, `handlers`, `set_status`,
   `notify_status`, `close_palette`, `schedule_hidden_build(data)`; the generic delete-then-recreate command loop
   (amendment 2); `on_document_activated` / `on_ready` wired only when populated; NO name check of any builder.
2. `sketch_builder_ui.py`: keep the module constants, the sketch-only material (§3 of the design: schema push +
   its two handler classes as `extra_commands`, `_ensure_tilt_param_safe`, the doc-activated callback, the sketch
   `PaletteHTMLEventHandler` subclassing the mixin, `_run_sketch_build_direct` as `build_fn(data, ctx)` reading
   `data['style_id']`), the `sys.path` line for `ui/`, and the spec + `make_palette` call re-exported as
   `run_palette` / `handlers` (and `_doc_activated_handler` if the parent reads it — check `_teardown_submodules`
   first and keep whatever it reads).
3. `bspline-frame-builder.py`: amendment 1 only.

## Verify (headless gate, as designed)
- `py_compile` + `pyflakes` on the three files (no new warnings).
- Import-time smoke with the template-maker conftest's `adsk` stub: `palette_scaffold` and the new
  `sketch_builder_ui` import; `handlers` is a list; `run_palette` callable; `PaletteHTMLEventHandler.notify` exists;
  the per-iteration binding proof (amendment 2). Paste the script + output into the WORK-LOG.
- Re-run the §4 sketch action table by grep against the new `notify` source: `update_param update_lock
  change_template request_template_list run_build ping get_templates` all still present; nothing new handled.
- `wc -l` before/after for `sketch_builder_ui.py` (expect ~594 → 200-250).
- `git show --stat HEAD` → 3 files. The live proof (open Sketch Builder through the bridge, build, auto-close,
  Stop→Start, one schema push on document switch) is the ADVISOR's.

## Do NOT
Touch `solid_builder_ui.py`, either palette HTML, `fb_engine/`, or fb_shared. No `if is_sketch`. Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB2a: palette_scaffold.py added (PaletteSpec, mixin, make_palette, per-iteration-bound command loop); sketch_builder_ui 594→<n> lines on the scaffold; ui/ added to the parent's derived wipe list — <sha>, 3 files; smoke + action table OK. Next: FB2b."`
and stop.

# NEXT — FB2 slice (c): finish the scaffold migration — honesty sweep, one small leak, consistency

**Ball: worker (seat A) · epoch 1 · FB2c.** Files: `frame-builder/ui/palette_scaffold.py`, `frame-builder/ui/sketch_builder_ui.py`,
`frame-builder/ui/solid_builder_ui.py`, `FB2-PALETTE-SCAFFOLD-DESIGN.md` (status header only). One commit by path,
predicted **4 files**, comment-scale diffs plus one 1-line code change.

## Live proof so far (advisor, deployed 7207bfe)
Sketch Builder: opens, ensures the tilt param, builds (timeline 5), doc-switch re-push works. Extrude Frame: opens,
auto-pick via a real click, extrudes 10 bodies onto the picked face, auto-hides on success. Stop→Start rebuilds fresh
modules for both; the parent's teardown clears handlers and the doc handler. Measured: exactly TWO schema pushes per
document activation regardless of how many times the palette was opened, with ONE live doc handler — Fusion fires
`documentActivated` twice per activation; pre-existing, idempotent, not a scaffold bug. Do not "fix" it.

## Do
1. **Prune the replaced doc handler from `handlers`** (`palette_scaffold.py:283-293`): when `old` is removed from
   `app.documentActivated`, also `handlers.remove(old)` (guarded) — today each re-open appends another
   `_DocActivatedHandler` to the list (3 after 3 opens; Python-side retention only).
2. **Mixin order, one convention:** sketch declares `PaletteHTMLEventHandler(adsk.core.HTMLEventHandler, _PaletteBridgeMixin)`
   and solid the reverse. Pick `(_PaletteBridgeMixin, adsk.core.HTMLEventHandler)` (mixin first is the Python idiom) and
   make both match. Behaviour-identical; say so in the commit.
3. **Honesty sweep** of all three files: every comment/docstring that still describes the pre-scaffold shape
   ("was run_palette step…", "mirrors solid_builder_ui", "the original's _style_id_ref", references to deleted
   functions `_create_hidden_command`/`_ensure_hidden_commands`/`_run_*_build_direct`/`DocumentActivatedHandler` as if
   they still existed). Quote each in the WORK-LOG with what you replaced it with. Keep the design-doc citations.
4. **Design doc status:** add a 3-line status block at the top of `FB2-PALETTE-SCAFFOLD-DESIGN.md`: implemented in
   FB2a (b7cd92e) + FB2a-fix (27bfd7c) + FB2b (dbfed18) + FB2c (<this sha>); the two advisor amendments (derived
   wipe list; per-iteration binding); the measured double-push note above. Nothing else in the doc changes.

## Verify
- `py_compile` + `pyflakes` ×3 (0 warnings). Import smoke (adsk stub) for both UI modules as in FB2a/FB2b.
- Greps: names of deleted functions → 0 hits outside the design doc; `_PaletteBridgeMixin, adsk.core.HTMLEventHandler`
  → 2 (one per UI module); `handlers.remove(old)` → 1.
- `git show --stat HEAD` → 4 files. Live proof (both palettes open + build once more, Stop→Start) is the ADVISOR's.

## Do NOT
Change any behaviour beyond item 1. Don't touch fb_engine, the HTML, or the parent loader. Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB2c: replaced doc handler pruned from handlers; mixin order unified; <n> stale comments corrected; design doc status block — <sha>, 4 files. FB2 COMPLETE pending advisor live check."`
and stop.

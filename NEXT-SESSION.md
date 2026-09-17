# NEXT — IN1: Frame Inspector `stop()` must release its selection handler (B5 / A1-2)

**Ball: worker (seat A) · epoch 1 · IN1.** File: ONLY `bspline-frame-builder/frame-inspector/fusion-inspector.py`.
One commit by path, predicted **1 file, ~+15/−3**.

## Ground truth (advisor-verified, current line numbers post-IN2)
- `:10` `_handlers = []` (module list). `run()` `:347-404`: builds `sel_handler = _SelectionChangedHandler()` at `:398`,
  `ui.activeSelectionChanged.add(sel_handler)` `:399`, appends to `_handlers` `:400`. The handler object lives only in
  that local + the list.
- `stop()` `:406-`: deletes the palette, panel controls and the command definition — **never calls
  `ui.activeSelectionChanged.remove(...)` and never clears `_handlers`** (`grep -c "\.remove("` → 0). Every Stop→Start
  adds one more live handler; N cycles fire N handlers per selection change (and each keeps its Python object alive).
- Reference pattern, same repo: `template-maker/template-maker.py` — module global `_sel_handler = None` (`:24`); in
  `run()` remove-before-add (`:722-728`); in `stop()` remove (`:806-808`) then `_handlers.clear()` + `_sel_handler = None`
  in `finally` (`:843-845`).

## Do
1. Add module global `_sel_handler = None` next to `_handlers` (`:10`).
2. In `run()`, replace `:398-400` with the template-maker pattern:
   ```python
   global _sel_handler
   try:
       if _sel_handler:
           ui.activeSelectionChanged.remove(_sel_handler)   # self-heal after an unclean prior stop
   except Exception:
       pass
   _sel_handler = _SelectionChangedHandler()
   ui.activeSelectionChanged.add(_sel_handler)
   _handlers.append(_sel_handler)
   ```
   (`global _sel_handler` must be the first statement of `run()`'s body that references it — put it at the top of `run()`.)
3. In `stop()`: add `global _sel_handler` at the top; after the command-definition delete, add
   ```python
   try:
       if _sel_handler:
           ui.activeSelectionChanged.remove(_sel_handler)
   except Exception:
       pass
   ```
   and restructure the function's `try: … except Exception: pass` into `try: … except Exception: _log(traceback.format_exc())
   finally: _handlers.clear(); _sel_handler = None` — the clear must run even if an earlier step throws.
4. Nothing else. The `_html_handler` appended at `:336` is released with the palette (`palette.deleteMe()`); leave it.

## Verify (fast tier)
- `python -m py_compile` + `python -m pyflakes` (no new warnings; "imported but unused" lines are pre-existing noise).
- `grep -n "activeSelectionChanged" fusion-inspector.py` → exactly 3 hits (remove in run, add in run, remove in stop).
- `grep -n "_handlers.clear()" fusion-inspector.py` → 1, inside `stop()`'s `finally`.
- `git show --stat HEAD` → 1 file.
- The Fusion Stop→Start proof (select something after 3 cycles → the palette updates ONCE, log shows one handler) is the
  ADVISOR's after deploy.

## Do NOT
Touch the palette HTML, fb_shared, the parent loader, or any other add-in. Don't refactor `stop()` beyond the
try/except/finally shape above.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "IN1: inspector _sel_handler global; run() removes-before-add; stop() removes + clears in finally — <sha>, 1 file; grep 3/1. Next: E7c."`
and stop.

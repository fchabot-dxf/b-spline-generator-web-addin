# NEXT — FB1: DECLARE the deferred-compute window (crash-safe) + delete a dead param helper + fix one lying comment

**Ball: worker (seat A) · epoch 1 · FB1.** Files: `bspline-frame-builder/frame-builder/fb_engine/parametric_engine.py`,
`bspline-frame-builder/frame-builder/fb_engine/build_context.py`. One commit by path, predicted **2 files**.
⚠ This touches the E8 tree. The human's Fusion undo check runs on the DEPLOYED copy (sha 6777525), which you do not
touch — so it is safe. Do not deploy.

## Ground truth (advisor-verified)
- `parametric_engine.py:_build_blocks` (:291-346) opens `sketch.isComputeDeferred = True` twice per block (:313 → :330,
  :334 → :346) with NO `try/finally`. The only handler is one layer up (`build_template` :157-179) which logs and moves
  on but never resets the flag. A step that raises inside a window leaves that Fusion sketch in deferred mode for the
  session = silent wrong geometry. (`offsets.py:77-78` is a pulse INSIDE the engine's window, not a window — leave it.
  `_process_sequence` :368-369 "Pulse" likewise — leave it.)
- `build_context.py:251-272` `create_or_update_param` — 0 callers in the repo (E8 removed the last one). Dead.
- `parametric_engine.py:123-125` comment says parameter creation "no longer" happens in `build_template` — implying one
  creation site elsewhere — while `_sync_user_parameters` (:246-289, same file, reached from `build_sketch`) AND
  `frame_engine.py:225-320` both create params. Two sites; the comment must say so.

## Do
1. **Declare the window once.** In `parametric_engine.py` (module level, near the top helpers), add:
   ```python
   from contextlib import contextmanager

   @contextmanager
   def deferred_compute(sketch):
       """Run a block with sketch.isComputeDeferred = True and ALWAYS leave the sketch live
       (isComputeDeferred = False) on exit — including when the block raises. A sketch left
       deferred after a crash silently stops solving for the rest of the session (A2-3)."""
       sketch.isComputeDeferred = True
       try:
           yield sketch
       finally:
           sketch.isComputeDeferred = False
   ```
2. Rewrite the two windows in `_build_blocks` as `with deferred_compute(sketch):` blocks. The explicit `= False` lines
   at :330 and :346 become the context exit (delete them); the explicit `= True` at :313 and :334 become the `with`.
   Keep the PULSE SOLVE log line and `log_arc_audit` call exactly where they are relative to the solve (i.e. after the
   first `with` block closes). Keep :308 (`= False` before Projections) as is.
3. Delete `create_or_update_param` from `build_context.py` (whole method + its docstring).
4. Reword `parametric_engine.py:123-125` to: "Parameter creation lives in two places: `frame_engine._create_skeletal_parameters`
   (base requirements + template DNA, before build) and `_sync_user_parameters` below (UI-driven values). Neither is
   called from here." — a true sentence, nothing more.

## Verify (fast tier)
- `python -m py_compile` both files.
- Grep: `isComputeDeferred = True` in `parametric_engine.py` → exactly 2 hits left (`deferred_compute` + the
  `_process_sequence` pulse at :369); `isComputeDeferred = False` → 3 (:308, the finally, the pulse :368).
- `grep -rn create_or_update_param bspline-frame-builder/` → 0.
- `python -m pytest bspline-frame-builder/template-maker/tests -q` → 83 (untouched code path, sanity only).
- `git show --stat HEAD` → 2 files.
- Fusion look is the ADVISOR's: a normal build must produce identical geometry (deploy + build + compare).

## Do NOT
Touch `frame_engine.py`, `offsets.py`, `_process_sequence`, the UIs, or `fb_shared`. Don't move parameter creation
(that is A2-1, pending the human's live check). Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB1: deferred_compute context manager declared + both _build_blocks windows use it; create_or_update_param deleted; comment fixed — <sha>, 2 files; grep counts True=2/False=3; pytest 83. Next: E7c."`
and stop.

# NEXT — FB2a-fix: the rewritten Sketch Builder dropped the tilt-param ensure at palette-open (E8 regression)

**Ball: worker (seat A) · epoch 1 · FB2a-fix.** File: ONLY `bspline-frame-builder/frame-builder/ui/sketch_builder_ui.py`.
One commit by path, predicted **1 file, ~+3/−1**.

## Ground truth (advisor, live Fusion 11:15, deployed f7236f9)
- Fresh design → open Sketch Builder → `frame_tilt_deg` **absent** (this morning, pre-FB2a: present). Build → log says
  `TILT: 'frame_tilt_deg' not present at build time; hosting sketches on the raw XY plane` → timeline 4 (no tilt plane).
  The tilt feature and the E8 undo guarantee are silently lost.
- Cause: `_on_ready(ctx)` (`:359`) does template pre-select + `_schedule_schema_push` only. The design (§3) said on_ready
  = "tilt-param-ensure at open + first-template pre-select + initial schema push"; the implementation dropped the
  first item (its docstring even says "was run_palette steps 5b/6" — the tilt step was 5a). `_ensure_tilt_param_safe`
  (`:325`) still exists and `_on_document_activated` (`:340`) still calls it — only the open path lost it.
- pyflakes: `:410` `global frame_engine` is declared but never assigned in that scope (the parent injects the module
  attribute directly). Drop that name from the `global` statement if the function does not assign it.

## Do
1. First line of `_on_ready`'s body: `_ensure_tilt_param_safe()   # E8 F1-C: the param must exist BEFORE any build`.
   Update its docstring to "(was run_palette steps 5a/5b/6)".
2. `:410`: remove `frame_engine` from the `global` statement if nothing in that function assigns it (keep
   `_doc_activated_handler`).

## Verify
- `py_compile` + `pyflakes` (the `:410` warning gone, no new ones).
- `grep -n "_ensure_tilt_param_safe()" sketch_builder_ui.py` → 2 call sites (on_ready + on_document_activated).
- `git show --stat HEAD` → 1 file. Live proof (fresh design → open → param present → build → tilt plane, timeline 5)
  is the ADVISOR's.

## Do NOT
Touch anything else; slice (b) waits until this is proven live.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "FB2a-fix: _on_ready calls _ensure_tilt_param_safe first; stray global dropped — <sha>, 1 file. Next: FB2b after live proof."`
and stop.

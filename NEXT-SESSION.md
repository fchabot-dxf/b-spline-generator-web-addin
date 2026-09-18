# LANE B — T2: two small hygiene fixes (DEP3 guard in release.py + a hardcoded sandbox path in a test)

**Seat B · epoch 1 · T2.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b` (just merged with main, 0 behind).
Files: `release.py`, `bspline-frame-builder/frame-builder/test_appearance_strategy.py`. One commit by path, predicted
**2 files** (+ WORK-LOG-lane-b.md). Product code this time, small and isolated — nothing seat A touches (SE1 is under
`b-spline-gen/html/`).

## 1. DEP3 — `release.py --web` must not sweep a worker's half-edited tree
`step_git_push()` (release.py:194) runs `git add -A` unconditionally. With two seats that is the index trap (advisor
skill, measured 2026-09-11): a worker's in-progress edits get swept into the release commit. **Declare the guard, not
a comment:** at module level `HANDOFF_MARKER = REPO_ROOT / "HANDOFF.md"` (match how REPO_ROOT is typed — Path or str)
and `def _worker_holds_tree() -> bool` that reads the marker (missing file → False) and returns True when its `to:`
line says `worker`. In `step_git_push`, before the `git add -A`: if `_worker_holds_tree()`, print one clear line
("HANDOFF ball is with the worker — refusing `git add -A`. Wait for the pass-back or commit by path.") and
`sys.exit(1)`. Nothing else in the step changes. No new flag to bypass it (the bypass is: don't run --web mid-turn).

## 2. Hardcoded sandbox path — `test_appearance_strategy.py:20`
`_HERE = "/sessions/ecstatic-gracious-planck/mnt/..."` is a path from another machine. Replace with
`_HERE = os.path.dirname(os.path.realpath(__file__))` (add `import os` if missing), same as your own
`test_deferred_compute.py` does. No other change to that file.

## Verify
- `python -c "import release; print(release._worker_holds_tree())"` from the worktree root → `True` while you hold
  the turn (lane-b's HANDOFF.md says `to: worker`); then the same with `HANDOFF_MARKER` pointed at a non-existent path
  (monkeypatch in the one-liner) → `False`. Note: check release.py has a `__main__` guard so importing runs nothing
  — if it doesn't, say so in WORK-LOG and verify by reading instead.
- `python -m pytest bspline-frame-builder/frame-builder -q` → green (your 3 + the appearance test).
- `git show --stat HEAD` → 2 files + work-log.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T2: DEP3 guard + sandbox path — <sha>, 2 files"`
and stop. (The advisor merges lane-b into main; you never touch main.)

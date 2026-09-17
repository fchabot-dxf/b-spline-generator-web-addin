# NEXT — DEP1: both deploys leave deleted files live — clean the web build, sweep orphans from the add-in deploy

**Ball: worker (seat A) · epoch 1 · DEP1.** Files: `bspline-frame-builder/deploy_cloudflare.py`,
`bspline-frame-builder/DEPLOY_bspline-frame-builder.py`. One commit by path, predicted **2 files**.

## Ground truth (advisor-verified)
- **Web (A7-3):** `deploy_cloudflare.py:159` sets `deploy_dist = "dist"` under `--build-only`; the cleanup loop at
  `:161-166` only removes `deploy_dist_<ts>` folders and the legacy `deploy_dist`; `os.makedirs(deploy_dist,
  exist_ok=True)` (`:170`) keeps whatever is already in `dist/`; `sys.exit(0)` at `:220` runs before the only
  `clean_dir(deploy_dist)` (`:233`). A file deleted from `b-spline-gen/html/` stays in `dist/` and therefore on the
  Pages site. `dist/` is never locked (no process holds it) → clean-then-copy is safe.
- **Add-in (A1-6):** `DEPLOY_bspline-frame-builder.py:_deploy_addin` (`:60-130`) calls `clean_dir(dest_dir)` (`:93`),
  which legitimately FAILS when Fusion holds a file open, then falls back to `copy_overlay` (`:97`) — so anything deleted
  from source survives in the AddIns folder. `copy_overlay` (`:300-339`) returns `(copied_count, skipped_paths)`; it has
  each file's dest-relative POSIX path in hand (`rel`) but does not return the copied list. DEST-only artifacts that
  MUST survive a sweep: `build-info.json` (written by the deploy itself, `:590`), `.addin-running.lock` (runtime
  heartbeat, `:221`), `*.log` (runtime logs; `.log` is already in `SKIP_SUFFIXES` so they are never copied from source),
  and `__pycache__/` (Fusion writes it).

## Do
### (1) `deploy_cloudflare.py` — one line
Right before `os.makedirs(deploy_dist, exist_ok=True)` (`:170`), add `clean_dir(deploy_dist)` with a comment:
`# dist/ is a clean build output, never an overlay (A7-3: stale files otherwise stay live on Pages)`.
Nothing else in the file.

### (2) `DEPLOY_bspline-frame-builder.py` — declare the keep-set, return the copied list, sweep
a. Next to `SKIP_FILES_EXACT` (`:225`) declare:
   ```python
   # DEST-only artifacts a post-copy orphan sweep must never delete (declared once — A1-6/DEP1).
   DEST_ONLY_KEEP_NAMES    = {"build-info.json", ".addin-running.lock"}
   DEST_ONLY_KEEP_SUFFIXES = {".log"}
   DEST_ONLY_KEEP_DIRS     = {"__pycache__"}
   ```
b. `copy_overlay`: collect every successfully copied `rel` (dest-relative POSIX) into a list and return
   `(copied_paths, skipped_paths)` — a list instead of the count. Update its docstring and the ONE caller (`:97`;
   `copied` becomes `len(copied_paths)` where it is printed).
c. Add `sweep_orphans(dst: Path, copied_paths: list[str]) -> list[str]`: walk `dst`; skip any dir named in
   `DEST_ONLY_KEEP_DIRS`; for each file whose dest-relative POSIX path is NOT in `set(copied_paths)` and whose name
   is not in `DEST_ONLY_KEEP_NAMES` and whose suffix is not in `DEST_ONLY_KEEP_SUFFIXES`: delete it (`unlink`); on
   failure print `  ORPHAN LOCKED <rel>: <err>` and keep going. Return the list of deleted rel paths. Print
   `  Removed N orphan(s):` + each path when N > 0, else nothing.
d. In `_deploy_addin`, call `sweep_orphans(dest_dir, copied_paths)` right after the skipped-paths check (`:101-108`)
   and BEFORE `extra_copy`/verify. (When `clean_dir` succeeded the sweep is a no-op; when it fell back to overlay the
   sweep is the fix.)

## Verify (fast tier — headless, no Fusion, no wrangler)
- `python -m py_compile` both; `python -m pyflakes` both (no new warnings).
- **Web:** `mkdir -p bspline-frame-builder/dist && echo stale > bspline-frame-builder/dist/STALE.txt && python
  bspline-frame-builder/deploy_cloudflare.py --build-only && test ! -e bspline-frame-builder/dist/STALE.txt && echo
  "dist clean"`.
- **Add-in sweep unit check** (inline python, temp dirs): source with `a.py`; dest pre-seeded with `a.py`, `old.py`,
  `build-info.json`, `x.log`, `__pycache__/z.pyc`; run `copy_overlay` then `sweep_orphans` → `old.py` gone, the other
  four still present, return value `['old.py']`. Paste the check + output into the WORK-LOG.
- `git status --short` must show no `dist/` noise (it is untracked/ignored — confirm with `git check-ignore -v
  bspline-frame-builder/dist`).
- `git show --stat HEAD` → 2 files.
- The real add-in deploy proof is the ADVISOR's at the next deploy (needs the human to stop the add-in).

## Do NOT
Change `clean_dir`, the E3 stop-first guard, `VERIFY_FILES`, or the wrangler-deploy branch. Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "DEP1: dist/ cleaned before build; DEST_ONLY_KEEP_* declared; copy_overlay returns copied paths; sweep_orphans wired into _deploy_addin — <sha>, 2 files; STALE.txt gone; tempdir check ['old.py']. Next: E7c."`
and stop.

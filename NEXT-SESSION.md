# NEXT — DEP1b: the `all` deploy path was missed — count, sweep, and stop shipping junk

**Ball: worker (seat A) · epoch 1 · DEP1b.** File: ONLY `bspline-frame-builder/DEPLOY_bspline-frame-builder.py`.
One commit by path, predicted **1 file**.

## Ground truth (advisor ran the real deploy after DEP1, 2026-09-17 09:52)
- `copy_overlay` has TWO callers, not one: `_deploy_addin` (`:97`, updated in DEP1) and **`deploy_local` (`:549`)** — the
  path `release.py --local` / `DEPLOY … all` actually uses. `deploy_local` still does `copied, skipped_paths = …` and
  `print(f"  Copied {copied} files.")` → it printed the entire list of ~600 paths, and it never calls `sweep_orphans`.
  (This run happened to be clean only because `clean_dir(DEST_DIR)` succeeded with the add-in stopped.)
- The copied list shows junk shipping into the AddIns folder: `.pytest_cache/**`, `bspline-frame-builder.zip`,
  `sync_stamp_bundle.py.tmp`, `b-spline-gen/comp export.png`, `b-spline-generator-web-addin.code-workspace`. None of
  these are add-in files. `SKIP_NAMES` (`:214`) / `SKIP_SUFFIXES` (`:223`) are the declared place.

## Do
1. `deploy_local` (`:549` and the print at the "Copied" line): rename to `copied_paths, skipped_paths = …`, print
   `len(copied_paths)`, and call `sweep_orphans(DEST_DIR, copied_paths)` right after the skipped-paths check, mirroring
   `_deploy_addin`.
2. Extend the declarations: `SKIP_NAMES` += `".pytest_cache"`, `"dist"`, `"node_modules"`, `".venv"`;
   `SKIP_SUFFIXES` += `".zip"`, `".tmp"`, `".code-workspace"`. Do NOT add `.png` (icons ship as png) — instead add the
   exact `"comp export.png"` to `SKIP_FILES_EXACT`.
3. Grep the file for any OTHER place that treats `copy_overlay`'s first return as a number (`copied +`, `{copied}`) → 0.

## Verify
- `py_compile` + `pyflakes` (no new warnings).
- Tempdir check: source with `a.py`, `.pytest_cache/x`, `b.zip`, `c.tmp`; dest pre-seeded with `old.py`; run the same
  `_ignore`-style filter the script builds + `copy_overlay` + `sweep_orphans` → dest has `a.py` only; return `['old.py']`;
  copied list == `['a.py']`. Paste it into the WORK-LOG.
- `grep -n "Copied " DEPLOY_bspline-frame-builder.py` → both prints use `len(...)`.
- `git show --stat HEAD` → 1 file. No deploy (the advisor deploys and reads the "Removed N orphan(s)" line next time).

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "DEP1b: deploy_local counts + sweeps; junk declared in SKIP_*; tempdir check ['old.py'] — <sha>, 1 file. Next: E7c."`
and stop.

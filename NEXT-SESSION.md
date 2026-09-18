# LANE B — T7: the last open audit items — exporter's hardcoded machine paths (declare them) + two stale docstrings

**Seat B · epoch 1 · T7.** Worktree `b-spline-generator-web-addin-lane-b`, branch `lane-b`. Files:
`bspline-frame-builder/fusion-exporter/fusion-exporter.py`, `.../fusion-exporter/exporter.py`, `.gitignore` (repo root,
only if the export folder is untracked), `bspline-frame-builder/fb_shared/entity_helpers.py`,
`.../fb_shared/expression_coords.py`, `.../frame-builder/fb_engine/parametric_engine.py` (+ WORK-LOG-lane-b.md).
Python + docs only; seat A is in `b-spline-gen/html/main/` — no overlap. One commit by path, predicted **5–6 files** + log.

## 1. STANDARDS-AUDIT §5 — two paths with Fred's username baked in (AUDIT-2026-09.md:23)
- `fusion-exporter.py:147` — `r'C:\Users\danse\APPS\import-export-template\comparative-audit\Fusion-json'` inside
  `_get_audited_projects()`.
- `exporter.py:86` — `default_output_dir = r'C:\Users\danse\APPS\b-spline-generator-web-addin\...\fusion-exporter\exported files'`
  — an export OUTPUT dir nested inside the repo (user data next to source).
**Declare, don't relocate silently.** At the top of each module, one named constant with an env override, derived
from the user's home so Fred's machine keeps working unchanged:
- `AUDIT_PROJECTS_DIR = os.environ.get('FB_AUDIT_DIR') or os.path.join(os.path.expanduser('~'), 'APPS',
  'import-export-template', 'comparative-audit', 'Fusion-json')` — same location as today for Fred, no username.
- `DEFAULT_EXPORT_DIR = os.environ.get('FB_EXPORT_DIR') or os.path.join(os.path.expanduser('~'), 'Documents',
  'bspline-frame-builder', 'exports')` — OUT of the repo. The folder picker still opens there (keep the pre-create).
  Say in the WORK-LOG that the old in-repo `exported files/` folder is left on disk untouched (Fred's data); if
  `git ls-files` shows it is NOT tracked (the advisor's check says 0 tracked files), add
  `bspline-frame-builder/fusion-exporter/exported files/` to `.gitignore` with a one-line comment so it can't be
  committed by accident.
- Both constants get a 2-line comment naming the env var. No other behaviour change.

## 2. A1-3 + A2-5 — docstrings that are false today (AUDIT-2026-09.md:33, :118)
- `fb_shared/entity_helpers.py:7-9` and `fb_shared/expression_coords.py:7` say "NO callers are switched to this
  module yet" / "no production callers switched yet". Every consumer imports them today (frame-inspector,
  template-maker core, conftest). Rewrite the sentence to the truth: shared by X, Y, Z (name them from a grep).
- `parametric_engine.py:123-125` — `build_template()`'s comment implies parameter creation is centralized in
  `frame_engine.py`; in fact `_sync_user_parameters()` in the same file still creates params. Reword to say exactly
  where params are created (both places), nothing else.

## Verify
- `python -m py_compile` on the 3 Python modules; `python -m pytest bspline-frame-builder/template-maker/tests
  bspline-frame-builder/frame-builder -q` → green (118).
- Greps: `danse` → 0 under `bspline-frame-builder/` (excluding docs/logs); `NO callers`/`no production callers` → 0;
  `FB_EXPORT_DIR`, `FB_AUDIT_DIR` → 1 each.
- `git show --stat HEAD` → within the predicted count + log.

## When done
Append WORK-LOG-lane-b.md, commit by path, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T7: exporter paths declared (FB_EXPORT_DIR/FB_AUDIT_DIR), stale docstrings fixed — <sha>, N files"`
and stop.

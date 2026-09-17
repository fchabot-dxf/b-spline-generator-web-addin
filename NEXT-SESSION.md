# NEXT — TM1: DERIVE template-maker's hot-reload wipe list from the `core/` folder + delete a dead script

**Ball: worker (seat A) · epoch 1 · TM1.** Files: `bspline-frame-builder/template-maker/template-maker.py` (edit) and
`bspline-frame-builder/template-maker/core/check_addin_sync.py` (`git rm`). One commit by path, predicted **2 files**.

## Ground truth (advisor-verified)
- `template-maker.py:82-100` — `_PROJECT_MODULES`, a hand-typed list of 17 module names. `_reload_all_project_modules`
  (:196-215) deletes exactly those names from `sys.modules` on every `run()` so Stop→Start picks up edits.
  `core/` holds 23 modules. **Five are not in the list:** `detection_log`, `dimension_hint`, `offset_hint`,
  `template_bridge`, `variable_scan` → edits to them survive Stop→Start STALE (B7's class; `detection_log` alone has
  9+ importers). The list is the bug: any hand-maintained copy of a folder listing drifts. Derive it.
- `core/check_addin_sync.py` (29 lines): 0 importers in the repo, compares against a standalone AddIns folder that the
  unified deploy no longer populates, and is non-recursive. Dead.
- `_core_dir` is defined at :71, BEFORE the list. `os` is already imported.

## Do
1. Replace the whole literal list (:80-100, including its two comment lines) with a derivation placed right after
   `_core_dir`'s `sys.path.insert` block:
   ```python
   # Every bare-name module under core/, DERIVED from the folder so the hot-reload
   # wipe list can never drift behind it (A3-1: a hand-typed list missed 5 modules).
   _PROJECT_MODULES = sorted(
       os.path.splitext(f)[0]
       for f in os.listdir(_core_dir)
       if f.endswith('.py') and f != '__init__.py'
   )
   ```
   Keep the name `_PROJECT_MODULES` (its consumer at :207 stays untouched).
2. `git rm bspline-frame-builder/template-maker/core/check_addin_sync.py`.
3. Nothing else — no changes to `_reload_all_project_modules`, no changes to the parent loader.

## Verify (fast tier)
- `python -m py_compile template-maker.py`.
- Headless proof the derived list is a superset of the old one plus the five missing names — run from
  `bspline-frame-builder/template-maker/`:
  ```
  python -c "import os; core=os.path.join(os.getcwd(),'core'); names=sorted(os.path.splitext(f)[0] for f in os.listdir(core) if f.endswith('.py') and f!='__init__.py'); old={'entity_util','phase_parser','role_points','cc_proxy','fb_attributes','ownership_gate','relation_hints','coincidence_clusters','template_code','template_naming','template_payload','template_payload_builder','template_variable_block','rename_selection','detect_projections','template_generator','deferred_rebuild'}; missing={'detection_log','dimension_hint','offset_hint','template_bridge','variable_scan'}; print(len(names), old<=set(names), missing<=set(names), 'check_addin_sync' in names)"
  ```
  Expected: `22 True True False`.
- `python -m pytest bspline-frame-builder/template-maker/tests -q` → 83.
- `git show --stat HEAD` → 2 files (1 modified, 1 deleted).
- Fusion Stop→Start proof (edit `detection_log.py`, Stop→Start, see the edit) is the ADVISOR's after deploy.

## Do NOT
Touch `bspline-frame-builder.py` (parent list is a separate item), `core/*` other than the deletion, tests, or deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "TM1: _PROJECT_MODULES derived from core/ (22 names, superset proven), check_addin_sync.py deleted — <sha>, 2 files; pytest 83. Next: E7c."`
and stop.

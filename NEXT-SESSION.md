# NEXT — TM2: derive the parent loader's shared-name wipe list from the folders it protects (same fix as TM1)

**Ball: worker (seat A) · epoch 1 · TM2.** File: ONLY `bspline-frame-builder/bspline-frame-builder.py`. One commit by
path, predicted **1 file**.

## Ground truth (advisor-verified)
- `bspline-frame-builder.py:196-207` `_shared_project_names` is a hand-typed list of 15 bare module names, wiped before
  each sub-add-in load (`:209`, `:216`, `:223`) so a bare name cached by one sub cannot bind into the next.
  `template-maker/core/` has **22** modules; the list has 14 of them — **8 missing**: `detection_log`, `dimension_hint`,
  `offset_hint`, `template_bridge`, `template_naming`, `template_payload_builder`, `template_variable_block`,
  `variable_scan` (`detection_log` is imported bare by 13 sites). The 15th name, `exporter`, is fusion-exporter's own
  module (`fusion-exporter/exporter.py`). CAM-builder imports nothing bare (audit A6); frame-inspector uses fb_shared
  only (IN2). So the list's job is exactly: *every bare module name under `template-maker/core/` plus fusion-exporter's
  siblings*. TM1 already derives template-maker's own list from its folder (`template-maker.py:80-86`).
- `_addin_root` (the add-in folder) is defined near the top of the file; the sub-add-in folders hang off it.

## Do
1. Replace the literal list with a derivation, keeping the name and the explanatory comment above it (trim the C4/F8
   note to one line):
   ```python
   def _bare_module_names(folder):
       """Every importable bare module name in ``folder`` (``*.py`` minus ``__init__``) — DERIVED so the wipe
       list can never drift behind the folder it protects (TM1/TM2; a hand-typed list missed 8 names)."""
       try:
           return sorted(os.path.splitext(f)[0] for f in os.listdir(folder)
                         if f.endswith('.py') and f != '__init__.py')
       except Exception:
           return []

   _shared_project_names = (
       _bare_module_names(os.path.join(_addin_root, 'template-maker', 'core'))
       + [n for n in _bare_module_names(os.path.join(_addin_root, 'fusion-exporter'))
          if n != 'fusion-exporter']     # the entry file is loaded by path, never by bare name
   )
   ```
   (`os` is already imported. If `_addin_root` is not the right variable name for the add-in folder, use the one the
   file already uses for `_res_paths()` — read `:389-395`.)
2. Nothing else — the three `_force_wipe(_shared_project_names)` calls and the `cam_engine`/`cam_utils` wipe stay.

## Verify
- `py_compile`; `pyflakes` (no new warnings).
- Headless proof from `bspline-frame-builder/`: evaluate the same expression against the real folders and print the
  result — it must contain all 22 template-maker core names AND `exporter`, and no name ending in `.py` or containing a
  hyphen. Paste it into the WORK-LOG.
- `git show --stat HEAD` → 1 file. Fusion Stop→Start of the whole add-in is the ADVISOR's (through the bridge).

## Do NOT
Touch template-maker, fusion-exporter, or the earlier `_force_wipe([...])` list at :144 (those are the sub-add-ins'
top-level module names, a different list). Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "TM2: _shared_project_names derived from template-maker/core + fusion-exporter (<n> names, all 22 + exporter present) — <sha>, 1 file. Next: FB2 design."`
and stop.

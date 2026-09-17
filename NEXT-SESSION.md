# NEXT — HY3: three small hygiene items left over from the audit (all L, all anchored)

**Ball: worker (seat A) · epoch 1 · HY3.** Files: `bspline-frame-builder/bspline-frame-builder.py`,
`bspline-frame-builder/CAM-builder/cam-builder.py`, `bspline-frame-builder/stamp-editor/stamp-editor.py`.
One commit by path, predicted **3 files**.

## Items (advisor-verified anchors, current tree)
1. **`bspline-frame-builder.py:116`** `_normalize_module_path` — 0 callers since HY2 deleted the cluster that used it
   (grep: only the `def`). Delete the whole function.
2. **`CAM-builder/cam-builder.py` `stop()` (:2211-2298) — B10.** `run()`'s `_register_refresh_event` registers three
   CustomEvents (`REFRESH_EVENT_ID` :2041, `TPGEN_EVENT_ID` :2054, `AXISPICK_EVENT_ID` :2066); `stop()` unregisters only
   `REFRESH_EVENT_ID` (:2284). Add `app.unregisterCustomEvent(TPGEN_EVENT_ID)` and `app.unregisterCustomEvent(AXISPICK_EVENT_ID)`
   next to :2284, each in its own `try/except Exception: pass` exactly like the existing one, and null the matching
   module globals (`_tpgen_event`, `_axispick_event`) the way `_refresh_event` is handled there (read :2280-2290 first
   and mirror it precisely). Do NOT touch `_register_refresh_event`'s own pre-unregisters (:2037/:2051/:2063).
3. **`stamp-editor/stamp-editor.py:4-5, 7`** — the header says "Sibling add-in to step-editor" and "Architecture mirrors
   step-editor.py and b-spline-gen.py". No step-editor add-in exists (absorbed by this one). Reword to: line 4-5 →
   "Loaded as a sub-module of the unified bspline-frame-builder.py entry point."; line 7 → "Architecture mirrors
   b-spline-gen.py:". Nothing else in the header.

## Verify
- `py_compile` ×3; `pyflakes` ×3 (no new warnings).
- Greps: `_normalize_module_path` → 0; `unregisterCustomEvent` in cam-builder.py → 6 (3 in register + 3 in stop);
  `step-editor` in stamp-editor.py header (lines 1-12) → 0.
- `git show --stat HEAD` → 3 files.
- Fusion Stop→Start of CAM-builder is the ADVISOR's (through the bridge).

## Do NOT
Touch anything else in the three files. Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "HY3: _normalize_module_path deleted; CAM stop() releases all 3 events; stamp-editor header true — <sha>, 3 files; greps 0/6/0. Next: CW1."`
and stop.

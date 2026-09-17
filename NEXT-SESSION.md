# NEXT — HY2: hygiene batch from the audit (all L) — 8 small, independent, fully-anchored edits

**Ball: worker (seat A) · epoch 1 · HY2.** One commit by path, predicted **8 files**. Land each item COMPLETELY; if one
is blocked by its STOP rule, skip it, finish the rest, and name the skip in the commit message. No behaviour changes.

## Items (every anchor advisor-verified 2026-09-17 on the current tree)
1. **`bspline-frame-builder/bspline-frame-builder.py:123-170`** — delete the 4 dead functions
   `_find_related_addin_modules` (:123), `_invoke_addin_action` (:148), `_stop_related_addins` (:163),
   `_run_related_addins` (:167). They only call each other; 0 external callers (grep). Then fix the comment at `:398`
   that names `_find_related_addin_modules` — reword so it no longer refers to a deleted function.
2. **`bspline-frame-builder/fb_shared/entity_helpers.py:5-9`** — the docstring says "NO callers are switched to this
   module yet (S1 is additive)". False since July. Reword: "Canonical shared helpers (C4 S1-S5 complete): consumed by
   frame-inspector, template-maker/core and the tests." Keep the `[GATE]`/`[FLAG]` notes but change "pending advisor
   review" to "ratified — callers switched (S3-S5)".
3. **`bspline-frame-builder/fb_shared/expression_coords.py:7`** — same: replace "ADDITIVE: no production callers switched
   yet." with "Canonical (C4 S2-S5 complete); consumed by frame-inspector and template-maker/core."
4. **`bspline-frame-builder/DEPLOY_bspline-frame-builder.py:143-144`** — in `deploy_template_maker.verify_files` delete the
   two entries `"entity_helpers.py"` and `"expression_coords.py"` (no such files under template-maker/; they print a
   spurious WARNING on every legacy deploy).
5. **`bspline-frame-builder/fusion-exporter/fusion-exporter.py:124` + the loop at `:147`** — `panels_to_clean =
   ['FusionIOPanel']` names a panel id nothing creates (run() uses `bsplinePanel_<tab>`; the parent's sweep removes it).
   Delete the `panels_to_clean` list and the `for p_id in panels_to_clean:` block it feeds (the whole dead cleanup,
   nothing else in `stop()`).
6. **`bspline-frame-builder/stamp-editor/stamp-editor.py`** — (a) `:157-158` delete the `if action == 'reset_ui':` branch
   (0 JS senders; grep `reset_ui` under `stamp-editor/html/` → 0). (b) `:13-15` replace the "v1 SCAFFOLD … land in
   subsequent passes" header with one true sentence: "Stamp Editor add-in: toolbar button + palette, face-pick capture,
   live face count, preview mesh, STEP emission (`commit`)." (c) `:855` `global _captured_faces` is unused in that scope
   (pyflakes) — delete that one `global` line ONLY if the function never assigns `_captured_faces`; else leave.
7. **`bspline-frame-builder/stamp-editor/html/core/runtime.js:4-6`** — the comment claims it "mirrors step-editor's
   runtime"; no such add-in exists in the repo. Replace those three lines with: " * The Fusion ↔ JS wire shape shared
   by Fred's add-ins; no sibling mirrors it today."
8. **`bspline-frame-builder/frame-builder/fb_engine/parametric_engine.py`** — pyflakes: unused locals `ui_state` (:126),
   `built_count` (:176 and :309), `sketch_prefix` (:209). **STOP rule per line:** delete the assignment ONLY if its
   right-hand side is a plain read / literal / arithmetic with no call that could have a side effect; if it calls a
   method (e.g. anything on `ctx`, `self`, Fusion objects) leave the line and name it in the commit message.

## Verify (fast tier)
- `python -m py_compile` on every edited `.py`; `python -m pyflakes` on them → no NEW warnings, and the 4-5 listed
  ones gone (or named as kept).
- Greps → 0: `_find_related_addin_modules|_invoke_addin_action|_stop_related_addins|_run_related_addins`,
  `FusionIOPanel`, `reset_ui`, `no production callers`, `NO callers are`, `Mirrors step-editor`.
- `node --check bspline-frame-builder/stamp-editor/html/core/runtime.js`.
- `python -m pytest bspline-frame-builder/template-maker/tests -q` → 83.
- `git show --stat HEAD` → 8 files (7 if item 6c or 8 is fully skipped — say which).

## Do NOT
Touch anything not named above. No refactors, no "while I'm here". Don't deploy.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "HY2: <n>/8 items landed (<skips>), <sha>, <k> files; greps 0; pyflakes clean; pytest 83. Next: E7c."`
and stop.

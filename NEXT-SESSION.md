# NEXT — E7a Frame Inspector dead-code sweep (headless) — precedes E7b readability [F]

**Ball: worker · epoch 1 · E7a.** Advisor review of the inspector found dead code that would only get in
the way of the readability work: a Python module pair that is imported but never called, a JS renderer
that reads a payload key Python never sends, a duplicated JS function, and a deploy-verify entry naming a
file deleted in July. Sweep them out FIRST so E7b edits a truthful file. **Removal is a chain — every link
below is either removed or kept with a named reason. Nothing else changes.**

## Ground truth (advisor-verified 2026-09-17)
- `frame-inspector/fusion-inspector.py:23` `from payload_builder import build_payload` — `build_payload`
  has **zero** other occurrences in that file (grep confirmed). The live payload is built inline at
  `fusion-inspector.py:499-556` (`p_data` with keys `count, mainFeature, coord, coord_expr, linked,
  linked_expr, listLabel, meta, type`). So `payload_builder.py` + its only importer-of `selection_items.py`
  are dead; no other file imports either (repo grep).
- `frame-inspector/inspector_palette.html:119-145` `renderItemList(...)` — never called (grep: only its
  definition); it reads `data.items`, a key the live payload does not have. The live renderer is
  `renderLinkedList` (:155). Also `reportError` is defined TWICE (:111 and :147); the second is identical
  and shadows the first — keep :111, delete :147-153.
- `bspline-frame-builder.py:256` `_shared_project_names` contains `'payload_builder'` — the wipe entry for
  a module that will no longer exist.
- `DEPLOY_bspline-frame-builder.py:154-163` `deploy_fusion_inspector.verify_files` lists
  `selection_items.py`, `payload_builder.py`, AND `entity_helpers.py` — the last has not existed in
  `frame-inspector/` since C4-S3 (Jul 12); it prints a WARNING on every deploy today.
- Deploy is an OVERLAY copy (`copy_overlay`, :97): deleting a source file does NOT delete its copy in the
  AddIns folder. The advisor handles the AddIns residue at the next deploy — you do not touch AddIns.

## Do — one commit, BY PATH (`git commit <paths> -F -`, never `git add -A`)
1. `fusion-inspector.py`: delete line 23. **STOP** if `grep -n build_payload` shows any hit besides :23.
2. `git rm frame-inspector/payload_builder.py frame-inspector/selection_items.py`.
3. `inspector_palette.html`: delete the whole `renderItemList` function (:119-145) and the second
   `reportError` (:147-153). Nothing else in the file.
4. `bspline-frame-builder.py:256`: remove `'payload_builder'` from the list (keep `'entity_util'`).
5. `DEPLOY_bspline-frame-builder.py`: remove the three entries `selection_items.py`, `entity_helpers.py`,
   `payload_builder.py` from `deploy_fusion_inspector.verify_files`.
6. Docs (mark, don't rewrite): under `BUGS_OPEN.md` B7 (:252) and `FIX-BACKLOG.md` F4 (:72) append one
   line each: `**RESOLVED 2026-09-17 (E7a): module was dead — deleted, not wiped.**` Do NOT edit
   ARCHITECTURE.md / STANDARDS-AUDIT.md (historical audits; the advisor tracks them).

## Verify (fast tier) — the sweep is only done when its inverse also holds
- `python -m py_compile` on `fusion-inspector.py`, `bspline-frame-builder.py`, `DEPLOY_bspline-frame-builder.py`.
- Sweep grep (must be **0 hits** outside WORK-LOG.md / BUGS_OPEN.md / FIX-BACKLOG.md / ARCHITECTURE.md /
  STANDARDS-AUDIT.md): `grep -rnE "payload_builder|selection_items|build_payload\b|renderItemList" --include=*.py --include=*.html --include=*.js bspline-frame-builder/` — note `build_payload_items` in template-maker is a DIFFERENT symbol and must NOT match (hence `\b`); if your grep tool reports a file as binary, re-run with `-a`.
- `grep -c "function reportError" inspector_palette.html` → 1.
- Predicted commit shape: 5 modified + 2 deleted = **7 files**. Read `git show --stat HEAD`; if it differs, say so.

## Do NOT
Don't touch `fb_shared/`, `frame-builder/`, `sketch_builder_ui.py`, `parametric_engine.py` (E8 tree under
human test). Don't add collapsible sections or copy buttons yet — that is E7b, next turn. Don't deploy.
Don't run the full pytest suite (no test imports these modules; if you doubt it, grep tests/ and say so).

## Queued after this (advisor's plan, for context only — do not start)
**E7b readability [F]:** (a) collapsible sections by toggling the `collapsed` class the shared stylesheet
already declares (`styles/base.css:1081-1090`) on `.cad-accordion-header` + its sibling
`.cad-dialog-content` — no new CSS; (b) DECLARE `meta` as a structured object in Python (`type, bridge,
plan, startId, endId, bulge`) instead of a pipe-joined string the JS would have to re-parse, and render it
as label/value rows; (c) per-row copy on the Details list, routed through the existing `_pendingCopy`
poll-tick pump (`inspector_palette.html:239-288`) — never a direct `fusionSendData` from a click.

## When done
Append WORK-LOG, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "E7a: inspector dead-code sweep — <sha>, 7 files (dead import + 2 modules + dead JS + wipe entry + 3 stale verify entries + 2 doc marks). Sweep grep 0 hits. Next: E7b."`
and stop.

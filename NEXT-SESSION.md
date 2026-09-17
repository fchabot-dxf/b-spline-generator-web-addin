# NEXT — DEC1: delete the step-editor cloud pair (Fred's ruling) — a removal sweep, every link accounted for

**Ball: worker (seat A) · epoch 1 · DEC1.** One commit by path, predicted **8 files (6 deleted, 2 edited)** + comment
edits in 2 more (see item 3) → **10 files**.

## Ground truth (advisor-verified)
- `cloud/step-editor-worker/` (5 files: `.gitignore`, `package.json`, `README.md`, `src/index.js`, `wrangler.toml` with
  `id = "REPLACE_AFTER_KV_CREATE"`) — finished code, never provisioned. `cloud/step-editor-pages/README.md` — the only
  file there. The add-in they served (`bspline-frame-builder/step-editor/`) never existed in this repo (absorbed by
  stamp-editor). Ruling: **delete both**; git history keeps them.
- References outside the folders: `ARCHITECTURE.md:42-43` (cloud diagram lines) and `:271-279` (two bullets). Nothing in
  deploy scripts, `release.py`, or `cloud/preset-worker`.
- Comments that still name a "step-editor" add-in as if it existed (honesty, same chain): `stamp-editor/stamp-editor.py`
  `:27` ("Mirror of step-editor's log-path strategy"), `:114` ("IDs MUST match step-editor / fusion-inspector"), `:132`
  ("same shape as step-editor's bridge"), `:792` ("the b-spline-gen / step-editor bridge"), `:1210` ("same quirk
  step-editor handles"); `CAM-builder/cam-builder.py:240` ("mirrors step-editor.py").

## Do
1. `git rm -r cloud/step-editor-worker cloud/step-editor-pages`.
2. `ARCHITECTURE.md`: in the cloud diagram (`:42-43`) replace the two step-editor lines with one line
   `· (step-editor cloud pair deleted 2026-09-17 — never provisioned; its add-in was absorbed by stamp-editor)`; replace
   the two bullets at `:271-279` with one sentence saying the same and naming the deleting commit as "DEC1".
3. The six comments: replace "step-editor" with "b-spline-gen" where the sentence is about the bridge/log/ID pattern
   (that IS the file they mirror — stamp-editor's docstring already says "Architecture mirrors b-spline-gen.py" since
   HY3); at `:1210` and `cam-builder.py:240` reword to "same quirk b-spline-gen handles" / "mirrors b-spline-gen.py".
4. Sweep: `grep -rn "step-editor" --include=*.py --include=*.js --include=*.md --include=*.toml .` (excluding WORK-LOG*,
   AUDIT-2026-09.md, ROADMAP.md, FB2-PALETTE-SCAFFOLD-DESIGN.md, node_modules, .venv*) → only ARCHITECTURE.md's
   "deleted" sentence and `sync_stamp_bundle.py`'s historical note (leave that one: it explains where the bundle came from).

## Verify
`py_compile` stamp-editor.py + cam-builder.py; the sweep grep as above; `git show --stat HEAD` → 10 files, 6 deletions.
No deploy, no wrangler.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "DEC1: step-editor cloud pair deleted (6 files), ARCHITECTURE updated, 6 stale step-editor comments corrected — <sha>, 10 files; sweep clean. Next: PM2."`
and stop.

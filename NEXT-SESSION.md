# NEXT — H1 repo hygiene: junk files out, stray work committed, gitignore DECLARED — headless

**Ball: worker · epoch 1 · H1.** E8 (undo fix) is committed AND now deployed to the AddIns folder
(advisor ran `release.py --local` 2026-09-17, build-info sha 6777525); its Fusion check is on the human.
This turn is pure hygiene — no application code, no design docs, no file moves.

## Do — land each item COMPLETELY, in this order, commit BY PATH (`git commit <paths> -F -`, never `git add`)

### (1) Commit the stray Nest Hub bus-tracker work already sitting in the shared worker (own commit)
Files: `cloud/preset-worker/wrangler.toml` (BUS_DATA KV binding), `cloud/preset-worker/src/index.js`
(the `/bus` hook), `cloud/preset-worker/src/bus-route.js` (new). Steps:
- `node --check cloud/preset-worker/src/bus-route.js` and `node --check cloud/preset-worker/src/index.js`.
  **STOP if either fails** — do not commit, report the error, continue with (2).
- Commit exactly those 3 paths. Message: `feat(worker): /bus routes + BUS_DATA KV for the Nest Hub bus
  tracker (uncommitted since Sep 14)`. Predicted shape: 3 files. Read `git show --stat HEAD` and confirm.

### (2) Delete junk — untracked → plain delete; tracked → `git rm`
Untracked (delete): root `_crop.png _fus_bottomright.png _fus_course05.png _fus_layout.png _fus_stage08.png
_fus_stage12.png _fus_topleft.png _shot.png _skp_view.png` · root `debug_log.txt debug_log.txt.err
deploy_log.txt pages_deploy_log.txt pages_deploy_log.txt.err wrangler_deploy_log.txt diff_check.txt
diff_current.txt diff_state.txt` · `cloud/preset-worker/src/index.js.bak2` ·
`bspline-frame-builder/frame-inspector/fusion-inspector-debug.log` (6.4 MB).
Tracked (`git rm`): `pytest_run_output.txt` · `git_original_bspline_index_head.txt` (0 refs) ·
`SESSION_CONTEXT_2026-05-23.md` (0 refs, superseded by ARCHITECTURE.md + WORK-LOG).
**Leave alone:** `SKILL.md`, `fusion360-api.skill`, `fusion-mcp-*.json`, `install-fusion-mcp-*.ps1`,
`wrangler.cmd`, `desktop.ini` — referenced or shared with other repos (human ruling).

### (3) DECLARE the ignore rules so this class never comes back (append to `.gitignore`, one block)
```
# session artifacts — screenshots, run logs, diff dumps, editor backups (H1)
/_*.png
*_log.txt
*_log.txt.err
*-debug.log
*.bak
*.bak[0-9]
/diff_*.txt
/pytest_run_output.txt
```
Verify: `git status --short` shows NO `??` entries afterwards except none; `git check-ignore -v _shot.png
debug_log.txt` resolves to the new block.

### (4) One commit for (2)+(3): `chore(hygiene): remove session junk + declare ignore rules (H1, FIX-BACKLOG F12)`.
Predicted shape: 3 deletions + `.gitignore` = 4 files. Confirm with `git show --stat HEAD`.

## Do NOT
- Don't touch any `.py`/`.js`/`.html` under `bspline-frame-builder/` (E8 is deployed and awaiting a human
  Fusion check — the tree under test must stay still). Don't move the `*-DESIGN.md` docs into a folder.
  Don't run the full pytest/vitest suite (no code changed). Don't `git add -A` / `git add .` — ever.

## Verify (fast tier)
`node --check` ×2 · `git status --short` clean · both `git show --stat` shapes match the predictions above.

## When done
Append WORK-LOG, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "H1: bus-route committed (<sha>, 3 files) + junk removed/ignored (<sha>, 4 files); status clean. Next: E7 Frame Inspector readability."`
and stop.

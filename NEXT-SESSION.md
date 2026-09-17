# NEXT — BG1: b-spline-gen — delete two dead modules, DECLARE one persistence serializer, clear handlers, drop a dead send

**Ball: worker (seat A) · epoch 1 · BG1.** Files (all under `bspline-frame-builder/b-spline-gen/`): `html/main/preset-manager.js`
(git rm) · `html/main/cloud-preset-manager.js` (git rm) · `html/core/state.js` (add the declared serializer) ·
`html/core/history.js` · `html/main/cloud-project-manager.js` · `html/core/fusion-bridge.js` · `html/main/export-flow.js` ·
`b-spline-gen.py`. One commit by path, predicted **8 files (2 deleted)**.

## Ground truth (advisor-verified 2026-09-17)
- `main/preset-manager.js` (121 L) and `main/cloud-preset-manager.js` (162 L): 0 importers anywhere under `html/`
  (only mention = cloud-project-manager's header saying it replaces both). Dead.
- Every live site that persists `P` first strips `.stampLayers[*].mask` (a `Float32Array` that `JSON.stringify` turns
  into a `{"0":…}` object): `core/state.js:253-254` (`saveLastSession`), `main/cloud-project-manager.js:64-65`
  (`buildSnapshot`). **Except** `core/history.js:24-41` `takeSnapshot`, which does `JSON.parse(JSON.stringify(P))` raw at
  `:28` AND again for `layerConfigs` at `:33` — on every undo step. Same hand-rolled shape, three times, one of them wrong.
- `b-spline-gen.py:40` `handlers = []` is never cleared; every sibling add-in clears in `stop()`'s `finally`.
- `core/fusion-bridge.js:41-51` `sendFusionPreview` sends action `'preview'`. `b-spline-gen.py` has NO such branch and
  `git log -S"action == 'preview'"` shows it never had one. Only caller: `main/export-flow.js:92` (import at `:21`).
  The live preview path is `sendFusionMeshPreview` → `'preview_mesh'` (:765). Dead send since birth.

## Do
1. `git rm html/main/preset-manager.js html/main/cloud-preset-manager.js`. Then grep `splineGenPresets|splineGenProjectsMigrated`
   — the localStorage migration in cloud-project-manager.js that reads the OLD store may now be the only reader of those keys;
   leave it (it is the one-time import path) but say so in the commit message.
2. **Declare the serializer once**, in `core/state.js` next to `saveLastSession`:
   ```js
   /** P as it must be persisted or snapshotted: masks stripped (Float32Array does not survive JSON). One truth —
    *  saveLastSession, history.takeSnapshot and the Project Manager all go through here. */
   export function persistableP(p = P) {
     return { ...p, stampLayers: (p.stampLayers || []).map((L) => ({ ...L, mask: null })) };
   }
   ```
   and make `saveLastSession` (:253-254) use it instead of its inline map.
3. `core/history.js:takeSnapshot`: `P: JSON.parse(JSON.stringify(persistableP()))` and
   `layerConfigs: JSON.parse(JSON.stringify(persistableP().stampLayers))` — import `persistableP` from `./state.js`.
   Nothing else in the function changes. (Restore-side `applySnapshot` already regenerates masks; do not touch it.)
4. `main/cloud-project-manager.js:buildSnapshot` (:63-66): replace the two `cleanLayers`/`cleanP` lines with
   `const cleanP = persistableP();` (import it); keep the `points` → physical conversion and `thumbnail` as they are.
5. Delete `sendFusionPreview` from `core/fusion-bridge.js` (:38-51 incl. its docblock); delete the import name at
   `export-flow.js:21` and the call at `:92` (the `if (isFusionMode) …` line). Grep `sendFusionPreview|'preview'` → 0
   (note `'preview_mesh'` must remain; use a closing-quote-bounded grep).
6. `b-spline-gen.py` `stop()` (:1592-1634): wrap in `try/except/finally` like its siblings (`stamp-editor.py:1432`)
   with `handlers.clear()` in the `finally`. If `stop()` already has a `try/except`, add only the `finally`.

## Verify (fast tier)
- `node --check` on every edited `.js`; `python -m py_compile b-spline-gen.py`.
- `npx vitest run` → 29 (core/state.js and main/app-init.js are under test; this is the byte-identity gate for
  `saveLastSession`).
- Greps: `persistableP` → 4 files (state, history, cloud-project-manager, + the export); `mask: null` inline maps →
  only inside `persistableP`; `sendFusionPreview` → 0; `preset-manager.js` → only the header comment (reword it: "Replaced
  preset-manager.js / cloud-preset-manager.js, both deleted in BG1").
- `git show --stat HEAD` → 8 files.
- Browser/Fusion look is the ADVISOR's (undo across a stamped layer; save/load a project).

## Do NOT
Touch `applySnapshot`, `editor/`, the palette HTML, B9/B11 call sites (BG2), or the `preview_mesh` path.

## When done
Append WORK-LOG, commit, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "BG1: 2 dead modules deleted; persistableP declared in state.js and used by saveLastSession/takeSnapshot/buildSnapshot; sendFusionPreview chain removed; b-spline-gen.py stop() clears handlers — <sha>, 8 files; vitest 29; greps clean. Next: E7c."`
and stop.

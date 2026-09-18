# NEXT — SE4c: slice (c) — migration as data, persistence cleanup, snapshot no longer touches stamp content

**Ball: worker (seat A) · epoch 1 · SE4c.** Design §5 slice (c). Files: `core/state.js`, `core/history.js`,
`main/app-init.js`, `main/snapshot-manager.js`, `main/stamp/layer.js`, `main/stamp/_shared.js`, tests
(`editor-reopen`, `history-snapshot`, `persistable-p`, + a migration test) (+ WORK-LOG). One commit by path,
predicted **9–10 files**. SE4a/b are merged and deployed (advisor live-proving now). Seat B idle.

## Product decision, made by the advisor (reversible, recorded in ROADMAP)
The palette's global undo/redo is for the **heightfield** (sculpt, seed, filters). The drawing has the editor's own
undo stack. So: `applySnapshot` STOPS touching stamp content entirely — no `stampSvgText`, no `hasStampSvg` gate on
content; it may still refresh masks from the (unchanged) editor after restoring P, if the rebuild needs it.
Do NOT implement "restore P.editorSvg from the snapshot"; if Fred wants that it is SE4d.

## Do exactly slice (c)
1. `core/state.js`: `DEFAULT.stampLayers[i]` drops `.svg` / `.mask`; `persistableP` drops the mask-stripping map
   (keep the function — it is the declared serializer, now identity on layers; say so in its docstring).
2. `core/history.js`: remove the `stampSvgText` parameter; `layerConfigs` stops carrying content once the shape does.
3. `main/snapshot-manager.js`: delete the `stampSvgText` branch and the `hasStampSvg` gate per the decision above.
4. **Migration, declared as data:** a `MIGRATIONS` array in `main/app-init.js` (or `core/state.js` if the loader lives
   there), each entry `{ id, when(P), apply(P) }`, run once right after `loadLastSession()` and once after a cloud
   project load (find the one place both paths converge, or call it from both). First entry `legacy-stamp-svg`: when
   `!P.editorSvg` and some `P.stampLayers[i].svg` is set → synthesize a one-layer editor document from the FIRST
   such svg (wrap its children with `data-layer` = that layer's index as string, carry `data-editor-layers` for it),
   assign `P.editorSvg`, delete the legacy fields. Multi-layer legacy saves: migrate EVERY layer that has `.svg`
   into its own `data-layer` group (the design's risk note) — one loop, not a `.find()`.
5. `editorRestoreSvg()`'s fallback → folded into the migration (the function returns `P.editorSvg || null`).
6. `main/stamp/layer.js` / `_shared.js`: narrow the `.svg` display fallbacks and `activeLayer()`'s fallback shape.
7. `initApp`'s `.svg`-based remask gate → content check via editor layers.

## Verify
- `npx vitest run` → green; new `tests/migrations.test.js`: an old-shaped save (`stampLayers[0].svg` set,
  `editorSvg` null) → after migration `editorSvg` is populated once and the legacy field is gone; a two-layer legacy
  save → both land in the document under their own `data-layer`; running migrations twice is a no-op.
- Greps under `html/`: `\.stampLayers\[.*\]\.svg\|\.stampLayers\[.*\]\.mask` → 0; `stampSvgText` → 0;
  `MIGRATIONS` → definition + the runner.
- Re-run `tests/editor-reopen.test.js` and `tests/stamp-mask-clear.test.js` (STOP conditions) — unchanged green.
- Live proof (an old saved project still shows its drawing; undo after sculpt leaves the drawing alone) is the
  ADVISOR's.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE4c: shape + persistence cleanup, MIGRATIONS declared, snapshot content-free — <sha>, N files, vitest N"`
and stop.

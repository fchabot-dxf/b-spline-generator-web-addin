# NEXT — SE3a: SVG editor Cancel must revert, and an emptied layer must lose its mask (one declared invariant)

**Ball: worker (seat A) · epoch 1 · SE3a.** Scope: `bspline-frame-builder/b-spline-gen/html/main/app-init.js`,
`main/stamp/svg-source.js`, `main/stamp-mask-manager.js` (+ a vitest). One commit by path, predicted **3–4 files**.
SE2 (80da844) is merged and deployed (39baa37); the advisor is live-testing it while you work. lane-b's T3 is merged
(BUGS_OPEN.md now lists this as **B12**; seat B is on SE3b, the STYLE-control CSS — palette :1263-1275 + base.css —
stay out of those).

## Ground truth (advisor, live 2026-09-18 08:30 + code)
Two symptoms, one cause. (1) Draw a stroke, press **Cancel** → the stroke stays carved in the 3D preview.
(2) **Clear** → **Apply** with an empty canvas → the old carve is STILL there.
- `onChange` (app-init.js:81-95) writes `P.editorSvg` (+ the legacy mirror via `setStampLayerSvg`) and remasks after
  EVERY edit, so by the time Cancel runs the edits are already the live state.
- The Cancel branch of `onCommit` (app-init.js:118-127) restores `P.stampLayers[idx].svg / .mask / enabled` from
  `SvgEditorSnapshot` — the legacy store — and never touches `P.editorSvg` or the editor document. Worse, the
  snapshot is taken from `ctx.activeLayer()` (svg-source.js:91-97), which in the unified model is an EDITOR layer
  with no `.svg`, so `SvgEditorSnapshot.svg` is `undefined`.
- Masks rasterize from the LIVE editor layers (`updateStampMasks`, stamp-mask-manager.js:40-76, `getLayerSvg`), with
  a legacy fallback. It builds a work list of layers that HAVE content and **returns early when the list is empty**
  — a layer that lost its content keeps its old `_mask` / `P.stampLayers[i].mask` forever. That is symptom (2), and
  it is also why a "correct" Cancel restore would still show the groove.

## Build — declare the snapshot as the one thing onChange writes; declare the mask invariant
1. **Snapshot = `{ active, editorSvg }`.** Replace `SvgEditorSnapshot`'s shape (app-init.js:15) with exactly that.
   Capture (svg-source.js, on open): `SvgEditorSnapshot = { active: true, editorSvg: P.editorSvg ?? null }` — the
   document BEFORE the session. Drop `layerIdx/svg/mask/enabled`; grep for every reader and remove each (they are
   all in the Cancel branch).
2. **Cancel = restore the document, reload the editor, remask.** In the Cancel branch: `P.editorSvg =
   SvgEditorSnapshot.editorSvg;` then mirror it the same way onChange does (`setStampLayerSvg(P.activeLayerIdx, …)` —
   keep the mirror consistent, do not invent a second convention), `saveLastSession()`, then reload the editor
   document with the SAME call the opener uses: `window.svgEditor.open(editorRestoreSvg(), P.widthIn, P.heightIn)`
   (the modal is hidden by then; `open()` works on a hidden container — say in WORK-LOG that you checked), then
   `refreshAllStampMasks(...)`. Apply branch unchanged.
3. **Mask invariant in `updateStampMasks`:** after the work list is built, every editor layer NOT in the work list gets
   `layer._mask = null` and, when a `P.stampLayers[idx]` mirror exists at that index, `.mask = null` too; the early
   `if (work.length === 0) return …` stays, but AFTER that clearing, and it must still trigger the preview rebuild
   (check `refreshAllStampMasks` → `scheduleRebuild` runs regardless of the return value; if it does not, make it).
   Write it as one small loop with one comment naming the invariant: "a layer with no content has no mask".
   `applyStampLayers` (the compositor) must treat `null` mask as "no pass" — verify it does (it did before layers had
   content, so it should).

## Verify
- vitest: extend `tests/b6-hidden-layer-save.test.js`'s mocking style or add `tests/stamp-mask-clear.test.js`: mock
  `window.svgEditor` with two layers, one with content, one empty but carrying a stale `_mask`; after
  `updateStampMasks` the empty layer's `_mask` is `null`. If the module's imports make it un-mockable in node, say
  so and test the extracted invariant function instead (export it).
- `npx vitest run` → 42 + new, green. `node --check` every touched module.
- Greps: `SvgEditorSnapshot.` readers → only `.active` and `.editorSvg`; `layerIdx` → 0 in main/.
- Live proof is the ADVISOR's: stroke → Cancel → no groove; Clear → Apply → no groove; normal Apply still carves.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE3a: snapshot={active,editorSvg}, Cancel reloads doc, mask-clear invariant — <sha>, N files, vitest N"`
and stop.

# NEXT — SE4a: slice (a) of your own design — one-store reads for the compositor and export-flow; Browse imports into the editor

**Ball: worker (seat A) · epoch 1 · SE4a.** Design: `SE4-MIRROR-RETIREMENT-DESIGN.md` §5 slice (a), approved as
written. Files: `main/stamp/svg-source.js`, `main/export-flow.js`, `core/engine/rebuild.js` (+ a test, + WORK-LOG).
One commit by path, predicted **3–4 files**. main now also carries lane-b's T7 (exporter paths). Seat B is on T8
(ghost selection: `editor/editor-io.js` open(), `editor/tools/action-tools.js`, `editor/editor-ui.js`) — stay out of
`editor/` this turn.

## Do exactly slice (a)
1. `_importSvgIntoEditor` → exported `importSvgIntoLayer(editor, svgText)` (rename or keep; one declared entry).
   Delete Browse's legacy-fallback write to `setStampLayerSvg` ONLY after you confirm the editor is initialized by
   the time `#btnStampChoose` is clickable (say where `initEditor` runs relative to the panel wiring). If you cannot
   prove it, keep the fallback and name the reason in WORK-LOG — do not guess.
2. `main/export-flow.js` `isCarvingLayer` / `hasShippableSvg` / `activeStampLayers` / `exportableStampLayers`:
   rewrite against `editor._layers[i]` (`_mask` for carving, `getLayerSvg(editor, id)` for shippable content),
   tooling still from `P.stampLayers[i]` (depth/enabled). Ship this as the riskiest change of the slice: a NEW
   `tests/export-flow.test.js` asserting (i) a layer with editor content but a `null` mirror `.svg` — the post-undo
   state from finding #1 — still counts as carving/exportable; (ii) a hidden or empty layer does not.
3. `_collectStampPasses` (rebuild.js:214): drop the `|| P.stampLayers[idx].mask` half. Leave the legacy
   pass-building block for slice (b).

## Verify
- `npx vitest run` → 52 + new, green; `node --check` touched modules.
- Greps: `stampLayers\[.*\]\.svg` in `main/export-flow.js` → 0; `_mask ||` in rebuild.js → 0; `importSvgIntoLayer(`
  → definition + Browse caller.
- Live proof (draw → Ctrl+Z on the palette → Send to Fusion still includes the drawing; Browse an SVG file → it
  lands in the editor) is the ADVISOR's.

## When done
Append WORK-LOG, commit by path, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE4a: export-flow + compositor on one store, Browse imports into the editor — <sha>, N files, vitest N"`
and stop.

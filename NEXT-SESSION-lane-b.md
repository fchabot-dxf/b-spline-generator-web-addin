# NEXT (lane-b) — T45: opening a project must load its drawing into the live editor (Fred)

**Ball: worker (seat B) · epoch 2 · T45.** NO FUSION for workers — browser proof only. T44 reviewed + merged (705987d,
704 green). Advisor also fixed Send to Fusion dropping sketches when no layer carved (5f9f7f0).

## Fred: "on open, a loaded project doesn't have the SVG until I open the editor and Apply Stencils"
Root cause (advisor, main/snapshot-manager.js): `applySnapshot` is BOTH global undo/redo AND cloud-project load
(cloud-project-manager.js `_loadFrom`). It sets `P.editorSvg` but deliberately never loads it into the live
`window.svgEditor` (SE4c: "undo is for the heightfield, the drawing has its own undo") — correct for undo, WRONG for
project load. `updateStampMasks` then rasterizes the OLD editor content, the drape shows the old drawing, and Send to
Fusion / exports read the old layers — until the editor is opened (which reads P.editorSvg) and Applied.

## Do
1. Declare the difference instead of inferring it: `applySnapshot(snap, preview, { source: 'undo' | 'load' })` (or a
   separate `loadProject` step) — 'load' ALSO replaces the live editor's document with `P.editorSvg` (the same open path
   the editor uses when it's opened — editor-io.js open/restore, layer roster, per-layer pattern/fusionGeometry,
   migrations), clears the editor's own undo stack, then refreshes masks, drape, outline preview and the sidebar layer
   list. 'undo' stays exactly as today. Every caller passes its source (grep them all: cloud load, local session load,
   undo/redo, anything else) — no default that silently picks one.
2. Check the startup path too (app-init loadLastSession / refreshAllStampMasks at boot) and the Fusion palette reload:
   after a fresh palette open with a saved session, the 3D shows the artwork without opening the editor.
3. Loading project B after project A must not leave any of A's drawing, masks, layers or outline preview.
## Verify
- vitest: load → live editor content == project's editorSvg, layers roster matches, editor undo empty; undo → editor
  untouched (today's behaviour).
- CDP: save two different projects via the real API mock or localStorage session path, load A then B without ever
  opening the editor → the mask/drape and `exportableStampLayers()` reflect B; screenshot the 3D.
- `npx vitest run` green.
## When done
Append WORK-LOG-lane-b.md, commit by path, push, then (from the WORKTREE root):
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "T45: project load loads the drawing — <sha>, vitest N, screenshots"`
and stop.

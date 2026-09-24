# NEXT — SE11: drape each layer's colored vectors onto the 3D relief (the "3D + palette" combination)

**Ball: worker (seat A) · epoch 2 · SE11.** SE9 accepted + merged with seat B's SE7p (main ef86c37, 312 tests).
Seat B is building T26/SE10 (sidebar layer browser, shared `renderLayerList`, and the per-layer fields you READ):
`visible` (👁 master), `carve` (the "3D" toggle), `showColor` (palette toggle). Their defaults while seat B lands them:
treat missing as `visible:true, carve:true, showColor:true`. Seat B's files: `editor/layers.js`, `main/stamp/layer.js`,
`main/stamp-mask-manager.js`, `core/engine/rebuild.js`, `main/export-flow.js`, the palette's VECTOR STAMPING region,
`styles/*` — do NOT touch them. Yours: `core/preview/*` (Three.js), a new pure module for the drape texture, the hook
that refreshes it, tests (+ WORK-LOG). One commit by path.

## Rule (Fred, final — ROADMAP "Layer toggles FINAL" + "👁 is the master")
A layer's vectors are painted onto the mesh when `visible && carve && showColor`. Each element in its own SE9 color.
**Uncolored elements (pure black #000000) are NOT painted** — advisor's default so the relief isn't covered in black
lines for layers nobody colored (flagged to Fred; declare it as one constant `DRAPE_SKIP_COLORS = ['#000000']`).
Nothing is painted when no layer qualifies — the model then looks exactly as today.
## Build
1. Pure part: `buildDrapeSvg(editorLayers, sketchSvg)` → an SVG string of just the qualifying elements (colors kept),
   board-sized viewBox — reuse the editor's serializer (`serializeEditor`/`getLayerSvg`), don't write another.
2. Render it to a canvas texture (same rasterize path the stamp uses, but keeping RGBA) at a resolution tied to the
   mesh's grid, and apply it to the model's TOP surface with planar UV (x/width, y/height — the top is a heightfield
   seen from above). Read `core/preview/*` first to find the top-surface mesh and its existing material; the drape is a
   texture on it (or a second material layer), not new geometry. Check orientation (the SC2/SC3 Y-flip history —
   `carveMatrix` comments) so a line drawn top-left appears top-left on the model.
3. Refresh on the editor's 'commit' change and on layer-field changes (seat B will emit a layers-changed notify — until
   then hook `_notifyChange('commit')`), not per drag frame.
## Verify
Tests for `buildDrapeSvg` (rule truth table incl. black skipped, hidden layer excluded, carve off excluded). Smoke
(serve from the REPO ROOT): Generate, color rails red / ties yellow / nodes navy, screenshot the 3D preview — colored
lines follow the relief, in the right orientation. `npx vitest run` green.
## When done
Append WORK-LOG, commit by path, push, then:
`python ~/.claude/skills/multi-agent-handoff/handoff.py pass --to advisor --note "SE11: colored drape on the relief — <sha>, N files, vitest N, screenshot: <path>"`
and stop.

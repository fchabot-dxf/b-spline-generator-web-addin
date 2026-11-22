# HEIGHT-PAINTER — a Photoshop-like height editor, with shape and brush presets

Design only. Branch `height-painter-design` (from `main` @ `53b583f5`), 2026-11-22.

## 1. What Fred asked for

"A Photoshop-like editor, with brushes with hardness", "precise gradients", "with presets for shapes etc.", as a tab next to
the SVG editor. References (Instagram, 2026-11-22): heraldic beasts and a ceramic tree-and-bird wall (inflated silhouettes with
incised lines), a moth in a stone niche (pocket, chamfered head, rib bands), turned wooden totems (domes, rings, flutes), a
hair/ear piece (directional texture strokes), plaster flowers on stems (fan flower, ribbed bulb, stem with buds).
Concept renders (prototypes, not app code): scratchpad `gen/botanical-*.png`, `gen/relief-vocabulary.png`.

## 2. What the app already has (read 2026-11-22)

- **Sculpt top / bottom** (core/sculpt.js): a brush with a radius and a strength only, ONE fixed smooth falloff (sculpt.js:15-19),
  painting `preDelta` / `postDelta` on the BOARD's display grid (so its detail depends on the Display Resolution).
- **SVG stamps**: outline -> signed distance field (core/stamp/sdf.js) -> profile (core/stamp/profiles: vbit, ballnose, flat,
  adaptive) -> a stamp pass (core/engine/apply-stamp-layers.js).
- **STL stamp** (core/stl/*): a pass of kind 'stl' with Max / Add, Raised / Carved, Z offset, Follow / Level, before / after
  thicken, Fit to carve depth, an over-stock warning; stored as a self-contained record in `P.stlLayers`.
- **Editor tabs** are declared in main/editor-tabs.js `EDITOR_TABS` (Wood frame, Draw, Lattice, Photo, Brick).
- **Storage quota** is a measured hazard (core/photo/codec.js item 74a: a 5.5 MB photo in `P` broke the session save).

## 3. The model

- A **height document**: a rectangle placed on the board (default: the whole board), with its own resolution in pixels per
  inch, independent of the board's Display Resolution. Values are **heights in inches (Float32)**, never 8-bit grey: 256 grey
  levels on a 1.5 in carve depth would step 0.006 in (visible banding in a CNC finish).
- **Layers**, top to bottom, each with opacity, a blend mode (normal, add, max, min, subtract) and an optional mask:
  - **paint**: a float raster (brush strokes, gradients, fills);
  - **shape**: a preset with live sliders (dome, pillow, fan flower ...), stored as its recipe; "Flatten" turns it into paint;
  - **outline**: an SVG shape from the Draw tab + a profile (pillow, flat + fillet, chamfer, turned, the existing V-bit /
    ballnose / flat), stored as its recipe.
- The flattened document becomes **one stamp pass, kind 'height'**, joining the app at the same single point as the STL pass
  (core/engine/rebuild.js `_collectStampPasses`), with the STL's per-layer options reused: Raised / Carved, Max / Add, Z offset,
  Follow / Level, before / after thicken, Fit to carve depth, the over-stock warning.

## 4. Tools

| Tool | Settings |
|---|---|
| Brush | size (in), **hardness** (0 = all soft falloff, 1 = hard edge), opacity, flow, spacing, **pen pressure** -> size and/or opacity (Pointer Events: Surface pen, Apple Pencil, finger) |
| Brush modes | raise, lower, **set to height** (exact level), smooth (blur), sharpen |
| Eraser | toward the layer below / transparent |
| Gradient | linear, radial, along a path; **exact heights at each stop**; falloff curve (linear, ease, custom) |
| Fill | a region (selection) to an exact height |
| Selection | rectangle, ellipse, lasso, **from an SVG shape**, feathered; tools paint only inside it |
| Eyedropper | picks a height; a readout of the height under the cursor at all times |
| Levels / curves | remap a layer's heights through a curve |
| Transform | move, scale, rotate a layer or a selection |

## 5. Presets

- **Shape presets** (shape layers, live sliders, handles to place / size / turn): dome, pillow, chamfered plaque, turned +
  fluted form, rib bands, ring, star, rosette; botanical: fan flower, ribbed bulb, stem with buds (section 1).
- **Brush presets**: soft round, hard round, flat set-height, smooth, ridge line (raised vein / incised groove), texture strokes.
- **User presets**: save any brush or tuned shape; one declared table per kind (AGENTS.md rule 2).

## 6. The view

A lit, shaded 2D view while painting (light direction adjustable; grey-scale and contour toggles), the 3D board view as today,
and an on-canvas outline of the board / frame so a painting sits where it will carve.

## 7. Storage, performance, undo

- **Recipes** for shape and outline layers (tiny). **Paint** layers: Float32 -> Float16 + deflate (CompressionStream) with the
  project. Estimate: a 7 x 9 in document at 100 px/in = 630,000 px -> 1.26 MB raw per paint layer, typically far less
  compressed; a size readout and the same warning-only policy as the STL total (no hard stop without Fred's yes).
- Brush dabs on the CPU over small tiles (only the touched area recomputes); the shaded view on WebGL through the existing
  three.js. Phone first: 390 px, touch targets >= 28 px, the loading card for long work.
- Undo per stroke, storing only the changed tiles (the STL undo lesson: never copy the whole document per step).

## 8. Saved boards must not change (rule 3)

Purely additive: a new record list (absent = off), a new pass kind, no default changed, a hash pin test with the key absent.

## 9. Slices

1. **Paint core**: one paint layer over the board; brush (size, hardness, opacity, flow, spacing, pressure) with raise /
   lower / set / smooth; eraser; height readout; shaded view; output as the 'height' stamp pass; saved with the project.
2. **Precision tools**: gradient (exact stops + curve), fill, selections (incl. from an SVG shape), several layers + blend modes.
3. **Shape presets**: dome, pillow, chamfer plaque, rings, flutes, then the botanical three; Flatten.
4. **Polish**: levels / curves, brush presets + user presets, texture strokes, transform.

## 10. Fred's answers (2026-11-22, one at a time)

1. **Resolution: 100 px/in** (0.01 in per pixel).
2. **A placeable patch**, like an STL: each height document is its own rectangle (default: the whole board), moved, sized,
   turned and reusable; several per board.
3. **Sculpt top stays** as it is (the quick in-3D tweak); the painter is for designed pieces. Saved boards untouched.
4. **Slice 1 first** (section 9: the paint core), then precision tools, shape presets, polish.
5. **Height patches follow the terrain like SVG layers; no rigid option** ("No rigid"): a patch's values are added on the
   terrain under each point; a height record has no `surface` field and never takes the STL's Level branch.

Advisor amendments (2026-11-22, from Fred): (a) Photoshop opacity semantics ("opacity 50% and value % are similar until
they cross over each other"): one stroke reaches at most opacity x the effect; a second, separate stroke starts from what is
there. 0 = transparent (eraser and unpainted pixels). (b) "Tabs content carry over visually": the patches are drawn ON the
shared editor canvas, not a separate view.

## 11. Build status (slice 1, branch `height-painter`, worker K)

Built (tests: `tests/height-*.test.js`, 6 files):
- `core/height/raster.js`: Float32 inches <-> Float16 -> deflate-raw (CompressionStream) -> base64, content hash `h`,
  decode cache (LRU 8). A 7 x 9 in blank patch stores in < 20 KB; two painted strokes measured 39 KB.
- `core/height/brush.js`: falloff (hardness), stroke-level coverage buffer capped by opacity (x pressure), flow,
  spacing, raise / lower / set / smooth / erase, cancel, touched box only.
- `core/height/layer.js`: `P.heightLayers` records (declared defaults, normalise, `newHeightLayer` = whole board at
  100 px/in), `heightPass` (kind 'height', signed height as body, depth +/-1, covered = inside AND painted), after the STL
  passes in `_collectStampPasses`; `afterBack` split and the STL Add / Max / Carved / Z offset branches shared through
  `RECORD_PASS_KINDS`. Always follows the terrain (answer 5).
- History: `core/history.js` `UNDO_BLOB_STORES` (STL mesh + height raster, each kept once by hash; snapshots hold
  `{ ref: h }`); the editor's undo part `heightLayers` (the copy-on-write list by reference).
- The Height tab (`main/height-panel.js`, `editor/editor-height-tool.js`): EDITOR_TABS entry, `heightBrush` mode,
  HEIGHT_CONTROLS (panel + rail), patches as shaded SVG images in the editor's own coordinates (full + on top in the
  Height tab, faded 0.4 + under the drawing elsewhere), brush ring, height readout, one commit per stroke.
- Smoke probe: `tools/repro/height_painter_shots.mjs` (real pointer strokes, desktop and 390 px; no page exceptions).

- Custom falloff (Fred 2026-11-22, worker N): `BRUSH_FALLOFFS.custom` reads the brush's `customCurve` (points [t, value], default [[0,1],[1,0]]) through `curveFromPoints` (monotone cubic Hermite, may rise: a ring); the declared `'curve'` control in `HEIGHT_CONTROLS` (an inline SVG widget: drag, tap to add, double-click / 600 ms long-press to remove, one write per drag end; shown only while Falloff = Custom via the table's generic `showWhen`). Switching to Custom seeds the curve from the previous profile (`alsoSet`). Test: `tests/height-brush-custom-curve.test.js`.

Not done / open (for the advisor):
- The 3D follows on Apply / the 3D toggle (Fred's "no 3D while editing"), not after each stroke.
- No `height` rows in `EDITOR_TAB_FOCUS` / `EDITOR_TAB_SELECTABLE` / `IN_EDITOR_3D`: each is pinned by an exact-equality
  main test; adding the rows means updating those pins (advisor's call). The other tabs' content is therefore not dimmed in
  the Height tab yet; the patches' own fade elsewhere uses `INACTIVE_LAYER_OPACITY` directly.
- Cancel keeps painted strokes (the Photo tab's precedent); undo stores the whole encoded raster per stroke (not tiles).
- Live stroke redraw re-encodes a <= 512 px PNG per animation frame: not measured on a phone yet.

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

Slice 2 (precision tools), branch `height-painter-2`, worker S. Tests: `tests/height-{patch-layers,selection,gradient,fill,
import,export}.test.js` (+ helper `tests/height-png16.js`); probe `tools/repro/height_painter2_shots.mjs`.
- **Layers** (`core/height/compose.js`): a patch may hold `layers`, BOTTOM first, each `{ id, name, kind: 'paint'|'image',
  visible, opacity, blend: normal|add|max|min|subtract, raster, mapping? }`, all on the patch's pixel grid; the composite
  (pass + shaded view) is bottom-up, a layer's 0 pixel transparent. A slice-1 record (one `raster`) reads as ONE paint layer
  (id 'base', normal, opacity 1) without being rewritten; its composite IS its decoded raster (pinned to goldens measured on
  main @ 18af1d97: raster h `14ie5wjnld2`, decoded `3492ef1f64ccf34c`, pass `53f34cf095f48f75`). Painting a slice-1
  record's one layer keeps its slice-1 shape; any layer action (add, opacity, blend, ...) makes it layered. Undo:
  `UNDO_BLOB_STORES` heightLayers gains `inner: 'layers'` (each layer raster kept once by hash, the same store).
- **Selections** (`core/height/selection.js`): a per-patch Float32 mask (session state; never saved, not in undo):
  rectangle / ellipse (pixel centres in the box), lasso (even-odd), from a Draw-tab layer (getLayerSvg + the layer's own
  transform, FILLED, rendered by `core/stamp/render-svg.js` into the patch's pixel frame through the patch's inverse
  placement matrix; the anti-aliased alpha is the mask -- `computeSDF` thresholds alpha, so it is not used), feather (a
  separable Gaussian, inches -> pixels per axis), invert, clear; marching-ants outline (marching squares at 0.5). Brush,
  gradient and fill multiply their effect by it (a pixel at 0 is never written).
- **Gradient** (`core/height/gradient.js`): linear / radial, typed exact stops, height = end + (start - end) x curve(t),
  curve = a BRUSH_FALLOFFS profile or the custom curve (the curve widget now serves any 'curve' control); past the stops they
  hold; opacity; normal / add / max; previewed per frame, ONE commit on release.
- **Fill** (`core/height/fill.js`): the selection (or the layer) toward an exact height by the opacity; a tap or the button.
- **Import** (`core/height/import.js`): 8-bit PNG / JPG / WebP via createImageBitmap (no colour conversion); 16-bit PNG via
  fast-png **6.2.0** (`https://cdn.jsdelivr.net/npm/fast-png@6.2.0/+esm`, MIT; its deps pinned by jsDelivr: iobuffer 5.3.2,
  pako 2.1.0); EXR via three **r128** EXRLoader + fflate (`.../three@0.128.0/examples/js/loaders/EXRLoader.js`,
  `.../libs/fflate.min.js`), R channel normalised (lo = min(0, min)). All loaded on first use only. An image layer stores the
  grey as **`u16-deflate-b64`** (q / 65535: a 16-bit file's levels kept exactly; Float16 would round them to 1/2048 near
  white) resampled to the patch grid (area mean down, linear up; stretched to the patch, or a new patch sized to the image's
  aspect, the largest that fits the board). Live mapping `{ zero: black|mid, whiteIn, darkIn }` (default black, 0.25 in);
  an exported name (`name_<lo>-<hi>in.png`) sets it.
- **Export** (`core/height/export.js`): the composite as a 16-bit grey PNG (fast-png encode), range always holding 0 and
  widened outward to 4 decimals; lo = 0 -> black = 0, else mid-grey = 0 (a 0 pixel then reads back as +1 level, not
  transparent). Export -> import is within one 16-bit level.
- Panel: `HEIGHT_TOOLS` (brush, rect / ellipse / lasso select, gradient, fill: the rail's `data-height-tool` buttons, one
  'heightBrush' gesture mode dispatching to `GESTURES[tool]`), `HEIGHT_TOOL_CONTROLS` + `HEIGHT_TOOL_GROUPS` (same shape and
  renderer / setter as HEIGHT_CONTROLS, kept separate because the slice-1 table's id list is pinned by tests/height-tab),
  `GROUP_HEADS` (the layer list, the selection buttons, Fill, Import / Export). Loading cards: `heightImport`,
  `heightExport` (core/loading-signal.js).
- Measured in Chrome (probe above): a `.cad-select` without its wrap covers the whole editor canvas (it is `position:
  absolute` 100%); a browser `File` has its own `.bytes()` METHOD (read files through `arrayBuffer`).

Not done / open (for the advisor):
- Slice 2: layer opacity / blend / mapping sliders commit one step per release, not per drag tick (as the patch sliders);
  a layer has no rename UI yet; a selection is not part of undo (session state, as briefed); the image layer is stretched
  to an existing patch (no crop / fit option); phone (390 px) not re-shot for slice 2.
- The 3D follows on Apply / the 3D toggle (Fred's "no 3D while editing"), not after each stroke.
- No `height` rows in `EDITOR_TAB_FOCUS` / `EDITOR_TAB_SELECTABLE` / `IN_EDITOR_3D`: each is pinned by an exact-equality
  main test; adding the rows means updating those pins (advisor's call). The other tabs' content is therefore not dimmed in
  the Height tab yet; the patches' own fade elsewhere uses `INACTIVE_LAYER_OPACITY` directly.
- Cancel keeps painted strokes (the Photo tab's precedent); undo stores the whole encoded raster per stroke (not tiles).
- Live stroke redraw re-encodes a <= 512 px PNG per animation frame: not measured on a phone yet.

## 12. Slice 3: the Move tool and brush tip shapes (branch `height-painter-3`, worker W)

Fred 2026-11-22: "even if height map is pixel we can still have a select or move tool, and a marquee tool, rect and lasso
tool" (the marquees are slice 2) and "a brush shape tool too, square, circle, bevel brush, angle adjustment". Tests:
`tests/height-move.test.js`, `tests/height-brush-tip.test.js`, `tests/height-brush-tip-pin.test.js`; probe
`tools/repro/height_painter3_shots.mjs` (desktop 1400 x 900 mouse + keys, phone 390 x 844 touch).

**Move** (`core/height/move.js` + the HEIGHT_TOOLS entry `move`, its GESTURES row, the HEIGHT_TOOL_GROUPS `move` note).
Photoshop semantics:
- With a selection, a drag LIFTS the selected pixels of the active layer into a floating piece (`liftPiece`: the piece keeps
  the values, its alpha is the mask -- a feathered edge included; the hole left is the layer x (1 - mask), so a fully
  selected pixel leaves 0 = transparent). The piece is previewed per animation frame (`placePiece` into the working copy);
  the release keeps it floating; the marching ants ride with it.
- Enter, the on-canvas **Drop** button, a tool switch or any other action (a fill, a selection change, a layer / patch
  action or field, import / export, leaving the tab) DROPS it: `placePiece` = the hole, then each piece pixel over what is
  there by its alpha (normal blend: under (1 - a) + value a; a 0 piece pixel is transparent and never covers), ONE commit =
  ONE undo step (the raster through the history blob store, as every slice-2 commit). The selection is moved with it
  (`shiftMask`). A piece dropped where it was lifted stores nothing (no step).
- Esc or **Cancel** puts the layer and the selection back exactly; nothing is stored. Esc is read in the capture phase, so it
  cancels the piece without also sending the editor back to Select (main/global-events.js's Esc still does when nothing
  floats). An editor undo / a load while floating cancels it.
- No selection: the drag moves the whole active layer; pixels pushed off the patch are lost on the drop (while floating
  they come back if dragged back).
- Alt+drag on a selection moves the marquee only (no pixel changes, no step).
- Arrows nudge 1 px, Shift+arrows 10 px (`MOVE_NUDGE_PX`), along the patch's own pixel axis nearest to the screen direction
  (a turned patch moves along its pixels).
- Offsets are WHOLE patch pixels: a move never resamples, every value moved is the exact value lifted.
- Touch: a one-finger drag; while a piece floats a Drop / Cancel pair (32 px tall) sits at the bottom of the canvas (shown on
  every device: it is also the mouse way to drop / cancel).
- An image layer is refused, as for the other painting tools (its grey values are not heights; add a paint layer above).

**Brush tips** (`core/height/brush.js` `BRUSH_TIPS`, the brush keys `tip`, `roundness`, `angle`, `followStroke`; the
controls are rows of HEIGHT_TOOL_CONTROLS with target 'brush', in a 'Brush tip' group declared `follows: 'brush'`, because
the slice-1 HEIGHT_CONTROLS id list is pinned by tests/height-tab):
- `round` (the slice-1 dab), `square` (Chebyshev in the tip frame), `chisel` (a flat blade: the falloff across its thickness
  only, full strength along it, square ends). `roundness` 0.05..1 squashes the tip across (half-size R x roundness);
  `angle` 0..180 degrees counter-clockwise on the BOARD (createStroke's `rotationDeg` takes the patch's own turn out);
  `followStroke` = the angle is taken from the drag direction (the first dab waits for that direction; a tap lays its one
  dab at the set angle via `finish()`).
- Falloff / hardness run on the tip's own distance: square + Linear = a crisp chamfer, square + Plateau = a flat-topped
  square. The touched box covers the turned footprint (a square's corners reach R x sqrt 2).
- **Bevel**: square tip, Linear falloff, hardness 0.3 -- now a tile of the brush picker (12b).
- Picking the chisel while the roundness is still 1 starts it at 0.25 (the tip's declared `seedRoundness`, the custom
  curve's alsoSet precedent; a UI seed, never a rule).
- The on-canvas cursor (`#heightBrushRing`, now a path) is the tip's real footprint: an ellipse or a rectangle, turned by
  the angle (+ the pointer's travel direction with followStroke). Hidden while the Move tool is armed.
- Saved boards / brushes unchanged (rule 3): the brush is session UI state (no brush presets are stored yet); a brush
  without the tip keys reads as round / 1 / 0 / off, and a round tip of roundness 1 runs the slice-1 code path. Pinned by
  `tests/height-brush-tip-pin.test.js`: eight createStroke cases' sha256 + dab counts + boxes and the panel path's stored
  raster h, measured on main @ ea366455 before the tip code.

- The editor's own Apply drops a floating piece and its Cancel throws it away (`MOVE_SETTLE_BUTTONS`, on pointerdown so it
  runs before their click handlers).

Open (for the advisor / Fred): Move has no scale / rotate (section 4's Transform, slice 4); the Move tool has no keyboard
shortcut letter.

### 12b. The brush picker and the Eraser (slice 3b)

Fred 2026-11-22: "I was more expecting a simple brush tool with the different brushes inside of it in the right panel, with
the falloff and the different chisel and bevel tools or profiles" (by "bevel" he first meant the chisel tip; the Bevel
square stays its own profile), and "In the height map tab, we need an eraser too". Tests: `tests/height-brush-picker.test.js`;
probe `tools/repro/height_painter3b_shots.mjs`.

- **One Brush tool** on the rail (`HEIGHT_TOOLS`): the per-mode rail buttons are gone; the modes are the `mode` row at the
  top of the panel's Brush section (raise / lower / set / smooth). **Alt** while painting with the Brush flips raise <->
  lower for that stroke (`BRUSH_ALT_MODE`; set / smooth unchanged); the section's one-line note says so.
- **Eraser**: its own `HEIGHT_TOOLS` row next to the Brush, `brush: { mode: 'erase' }` -- the SAME brush (picker and
  settings; one `_brush`, never a copy) with the erase math (toward transparent 0). The Brush section shows for both
  (`usesBrush`), without the mode / amount / target rows for the Eraser (their declared showWhen).
- **Brush picker** (`BRUSH_PRESETS` in core/height/brush.js, one table): the tiles are the app's one picker
  (main/icon-select.js `mountIconGrid`, PICKER_TILE size; icons only, the name on the chip and as the tooltip), at the top
  of the Brush section. Each tile's icon is drawn from its own preset: the tip's footprint (an arrow when it turns with the
  stroke) over the falloff profile. A preset sets tip, roundness, angle, followStroke, falloff, hardness and buildUp; the
  size, opacity, flow, spacing, amount and target stay. Custom keeps the brush's own curve (edited below).
- **Modified**: an edit after a pick leaves NO tile highlighted and the note under the picker reads "Modified (from
  <last pick>)"; picking a tile again restores it (`brushPresetOf`: the preset whose every key the brush matches).
- **The active tool's section comes first** (advisor 2026-11-22): each `HEIGHT_TOOLS` row declares `leads` (Brush and
  Eraser: brush, tip; the selection tools: select; Move: move, select; Gradient: gradient; Fill: fill); the panel body is a
  flex column and `orderPanelGroups` gives those groups the first CSS `order`, the rest keep their built order. No element
  is moved (listeners, ids and the picker's mount stay as built).
- **Tip settings** (tip, roundness, angle, turn with the stroke) show only for a non-round tip (the `tip` group's declared
  showWhen); a non-round tip comes from the picker.
- **buildUp** (a new brush key; absent = true = slice 1): with build-up each dab adds to the stroke's coverage, so along a
  stroke any falloff saturates toward the opacity (measured: a chisel stroke's sides read as high as its middle); off, a
  pixel keeps the HIGHEST single dab's coverage, so the stroke's cross-section is the brush profile. The two plain rounds
  keep build-up (they paint as before; the session's first brush, BRUSH_DEFAULTS, is Soft round); every profile preset
  turns it off. A 'Build up' check in the Brush section.

| Preset | tip | roundness | angle | turn with stroke | falloff | hardness | buildUp |
|---|---|---|---|---|---|---|---|
| Soft round | round | 1 | 0 | no | smooth | 0.5 | on |
| Hard round | round | 1 | 0 | no | smooth | 0.9 | on |
| Dome | round | 1 | 0 | no | dome | 0 | off |
| Spike | round | 1 | 0 | no | spike | 0 | off |
| Plateau | round | 1 | 0 | no | plateau | 0.2 | off |
| Square | square | 1 | 0 | no | plateau | 0.5 | off |
| Bevel | square | 1 | 0 | no | linear | 0.3 | off |
| Chisel | chisel | 0.25 | 0 | yes | linear | 0 | off |
| Custom | round | 1 | 0 | no | custom (its own curve) | 0 | off |

The Chisel is a flat blade ALONG the stroke with straight (linear) sides: Raise draws a crisp V ridge, Lower (or Alt) a V
groove.

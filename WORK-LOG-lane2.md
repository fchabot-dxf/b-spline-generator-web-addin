# WORK-LOG — lane2 (Asus, second worker)

Append-only. Newest entry at the bottom.

## 2026-09-26 — turn 1 — L1: BOUNDARY-GUIDE

Paths are under `bspline-frame-builder/b-spline-gen/` (`html/` for the web app).

### L1 item 1: SURVEY

**The "lattice boundary box"** is the Size W x H rectangle (T75 LAT-SIZE):
`sizedBoardRegion(region, pattern.size)`, `html/editor/editor-lattice-boundary.js:122-127`. A null axis
auto-defaults to the board minus the 1 in margin. The same function bounds the fill in BOTH tools:
- Box Lattice (`extent.mode 'board'`): `_resolveExtent` (`editor-lattice-pattern.js:1865`) and the manifest's
  `resolveBoardExtent` (`editor-sketch-manifest.js:839-848`), snapped to lattice cells.
- Shape Lattice: `_shapeContourRegion` (`properties-shape-lattice.js:149-151`) and the manifest's `contourRegion`
  (`editor-sketch-manifest.js:1081`).

**Built / drawn in the editor: NOT drawn anywhere today.** `sizedBoardRegion` returns numbers only; no element
represents the box. (The Shape Lattice CONTOUR silhouette is real geometry in `#sketch-layer`, with
`data-contour-seg`/`data-boundary-ref`, `properties-shape-lattice.js:273-295`. That is a separate thing and stays.)

**How the editor keeps guides out of export/3D today: by LAYER, not by a flag.** `html/editor/init.js:16-32`
creates sibling groups `bg-layer`, `grid-layer`, `sketch-layer`, `outlinePreview`, `handle-layer`,
`highlight-layer`. Every reader walks `sketchLayer` only, so the siblings are excluded by construction:
- the board border (dashed red rect) is in `bg-layer`, `editor-io.js:1017-1032`, redrawn by `sync3DBackground`;
- the F6 frame profile is `#frame-profile` in `bg-layer`, `editor-frame-profile.js:98-114`, "never exported";
- the SE12 outline preview has its own sibling group, `init.js:21-28` (comment: "no filtering code needed anywhere else").

**3D preview / stamp:** every path starts from the sketch layer only.
- Stamp mask: `main/stamp-mask-manager.js:56-57` -> `getLayerSvg` -> `_parseLayerContent` (`editor-io.js:144-202`,
  filter at 189-195: `data-layer`, `display=none`, lattice ownership) -> `rasterizeSvg`.
- Drape: `refreshDrape` (`main/app-init.js:456-465`) -> `editor.save()` (sketch layer) -> `buildDrapeSvg`
  (`core/preview/drape-svg.js:63-70`, `showsColor` filter).

**SVG export:** `saveWithTextCopies` -> `_serializeVisibleLayers` (`editor-io.js:59-69`, sketch layer, `isExported`
layers). `save`/`saveForRasterization` (529-543, 640-678) write the whole sketch layer. Send's SVG part
`_fusionLayerSvg` (`main/export-flow.js:117-126`) goes through `_parseLayerContent`. None of them sees a sibling group.

**Fusion manifest:** `buildSketchManifest` (`editor-sketch-manifest.js`, ends ~1135) emits `Slot`/`Line`/`Circle`/
`ArcCenter*`. No box entity today: Shape Lattice's `contour_width`/`contour_height` are Distance dims between the
contour's own extreme Lines (786-800); Box Lattice exports nothing for Size (1082-1091). `splitManifestByKind`
(1195+) buckets entities by id prefix (`_kindOfEntityId`, 1152-1159: rail/tie/node/seg); an unknown prefix is
SILENTLY DROPPED (1223-1226). No `construction` field anywhere in JS (T71 removed the T70 mirror axis).
`sketch_manifest_builder.py`: `_create_line_entity` (133-147) ALREADY honours `ent["isConstruction"]` (the T70
precedent), Line only. `_create_geometry` (465-504) dispatches by type; Circle/arcs/slots never read the flag.

**The "Draw boundary" toggle: already gone.** No `drawBoundary`/`showBoundary` anywhere. T74 AMEND 1 retired
`boundary.border.enabled` (the Border clone's "draw boundary" checkbox); its only live trace is the one-time
migration `border-to-contour-width` (`main/app-init.js:270-312`), which folds it into the Shape Lattice
`contour.show` ("Contour" checkbox, `#shapeLatticeContourShow`, which the spec keeps). So L2's "toggle removal" has
nothing left to remove in the UI. **Flag for the advisor:** L2 may shrink to "nothing" (or to deleting the
migration once old saves no longer matter, which I would NOT do: the migration is what keeps old saves readable).

### Design chosen for items 2-3 (declare, one role, every reader reads it)

- ONE pure declaration in `editor-lattice-boundary.js` (the neutral module both the app and the manifest producer
  already import): `latticeBoundaryGuide(pattern, region)` -> `{ id, role: GUIDE_ROLE, rect }`, `GUIDE_ROLE='guide'`.
- Editor renderer (`editor/editor-guides.js`, new): draws every record with `role === 'guide'` into its OWN sibling
  group `#guide-layer` (pointer-events none), dashed, `data-role="guide"`. The role decides the layer, and the layer
  is what export/stamp/drape already skip, so the 3D and export code get ZERO new lines. That is stricter than "3D
  skips it by the role": 3D cannot see it at all. Drawn for every GENERATED pattern (owned pieces exist, the same
  test `_fusionLayerManifest` uses) whose layers are visible; redrawn on commit (Generate, Size edits, undo/redo),
  `setModelMetrics` (board size) and `editorLayersChanged` (visibility, active layer).
- Manifest: the same record becomes 4 `Line` entities (`bnd0..3`) + corner Coincidents + H/V, with
  `isConstruction: role === 'guide'`. **Field name: `isConstruction`, not `construction`** (the dispatch said
  `construction: true`, the ROADMAP said "e.g."): the builder and the T70 manifest already declared
  `isConstruction`, and a second key for the same thing would be a divergent alias. Kind: `bnd` -> `rails` in
  `_kindOfEntityId`, because the rails sketch exists in BOTH tools (Box Lattice has no contour sketch) and the box
  bounds the fill. No dims on the box (the spec asks only that it be usable for dims; Shape Lattice's own
  `contour_width`/`contour_height` stay on the contour).
- Builder: `isConstruction` becomes GENERIC. The Line-only branch moves to one post-create step in
  `_create_geometry`, for any entity type.

### L1 items 2-4: built as designed above (`6825c8c`, `0018d0f`, `3ed999f`, merge `1d4b90b`)

- **item 2** (`6825c8c`): `GUIDE_ROLE` + `latticeBoundaryGuide(pattern, region)` in `editor-lattice-boundary.js`;
  new `editor/editor-guides.js` (`editorGuides` = which patterns get a box, `refreshGuides` = draw,
  `installGuides` = the `editorLayersChanged` listener); 3 lines in `editor.js` (commit hook, `setModelMetrics`,
  install). **No 3D, export or `core/preview` code touched** (amendment 1 satisfied by construction).
  "Generated" = the pattern's layers hold lattice-owned pieces. A layer with a default pattern that nobody
  generated (every active layer gets one lazily) shows no box.
- **item 3** (`0018d0f`): `manifestFromGuide` emits `bnd0..3` (closed: 4 corner Coincidents + 2 H + 2 V; no dims,
  no Fix) with `isConstruction` from the role, always (both tools, contour on or off). `_kindOfEntityId`: `bnd` ->
  rails. Builder: the flag is applied once in `_create_geometry` for any entity type; the T70 test now goes
  through `_create_geometry` (the contract moved there, rather than keeping a duplicate Line-only branch).
  Two JS tests had their own copy of the id-prefix rule and were updated (split test helper, export-flow
  "rails layer holds only rails").
- **item 4** (`3ed999f`): `tools/repro/boundary_guide_shots.mjs` (serve on **8781**, CDP **9343/9344**, so it
  can't collide with worker 1). Both tools, desktop + mobile, ALL CHECKS PASSED, before AND after the merge.
  "Export unchanged" is proven the strict way: `save()` (persist + drape input), `saveForRasterization()` (stamp
  input) and `saveWithTextCopies()` (download) are byte-identical with and without `#guide-layer` in the page.
  Shots in `C:\Users\danse\.bspline-status\shots\lane2\` (`{box,shape}-{desktop,mobile}-{1-editor-guide,
  2-editor-size-edit,3-3d-preview}.png`); I looked at them: dashed box in the editor, none in 3D.
- **Found on the way (existing behaviour, not changed):** picking a Shape Lattice preset already generates the
  whole lattice (rails/ties/nodes/contour) before Generate is pressed, so the box appears at preset pick.
- Mutation-checked: removing the visibility filter, the "generated" filter, or the builder's generic
  `isConstruction` line each fails its tests.

**Gate** (merged tree): vitest 85/86 files, 1581/1582. The ONE failure is `tests/frame-3d-sweep.test.js`
timing out at vitest's default 5 s. It passes (8/8) with `--testTimeout=120000` (~7 s), imports only frame modules
(`frame-mesh.js`, `frame-record.js`, `editor-frame-profile.js`), none of which I touched. It's seat C's F8 sweep,
new from the merge, slower than the default on the Asus. Frame files are hands-off, so it's flagged, not fixed
(a per-test timeout in that file would fix it). pytest 287/287 (was 284 +3 new). Browser check green, both surfaces.

**Flags for the advisor:**
1. **L2 has almost nothing left:** the "Draw boundary" toggle was already retired by T74 AMEND 1 (see item 1). The
   one remaining trace is the old-save migration, which should stay.
2. **Field name:** `isConstruction`, not `construction` (reasons above).
3. **The box goes in the rails sketch.** Hiding the Rails layer drops it from Fusion with the rails. In the editor
   the box stays while ANY of the pattern's layers is visible.
4. **The guide is faint** (0.01 in stroke, same as the board border) against the textured background. It's one
   constant (`GUIDE_STROKE` in `editor-guides.js`) if Fred wants it bolder.
5. **Not dimensioned in Fusion:** the box is a free rectangle (closed, H/V). Tying it to `contour_width`/
   `contour_height` would be a follow-up.
6. **Processes:** the 8781 app server was started for item 4 and is stopped before this pass.

### L1 AMEND (Fred's rulings, absorbed before the pass)

**(a) Editor guide = dashed BLACK.** `GUIDE_STROKE.color = '#000000'` (`editor-guides.js`). Asserted in the unit
test and in the browser script (`r.stroke === '#000000'`); in the shots it now reads clearly (flag 4 above is moot).

**(b) Fusion: "follow the protocol we have with Frame Builder".** Surveyed FB (read-only):
- `frame-builder/sketches/template_1/template_data.py:23` declares sketch 1 = **"Bounding Box"**, its own sketch,
  first in the template, before "Shape Outline" / "Frame Enclosure".
- `frame-builder/fb_engine/geometry.py:62-72` creates any geometry type, then applies `geom["IsConstruction"]`
  **generically** (one post-create step, not per type).

**What I mirrored:**
1. **Own first sketch.** The boundary is now its own kind, `boundary`, and its own sketch, **"Lattice Boundary"**.
   `SKETCH_BUILD_ORDER = ['boundary', ...LATTICE_FUSION_BUILD_ORDER]` in `editor-sketch-manifest.js`, so it is
   `buildOrder` 0, built before contour/rails/ties/nodes. `LATTICE_FUSION_BUILD_ORDER` itself is UNCHANGED: it
   is also the editor's kind-LAYER roster (a test pins it to `LATTICE_KIND_LAYER_DEFAULTS`), and a guide has no
   editor layer. `_kindOfEntityId`: `bnd` -> `boundary` (replaces the earlier bnd -> rails).
2. **Generic construction flag.** Already in place from item 3: `sketch_manifest_builder._create_geometry` applies
   `isConstruction` after creating ANY entity type. That is FB's `geometry.py` pattern. Key name `isConstruction`
   (the JSON-manifest casing; FB's template dicts use `IsConstruction`).
3. **Transport.** The boundary has no editor layer, so `export-flow.js` `_boundarySketchManifests` appends ONE
   manifest-only payload entry per SENT kind-split pattern (`svg: ''`, `sketchName: 'Lattice Boundary'`, same
   `patternId`). Python's existing grouping (`_ordered_svg_layer_import_plan`: `patternId` + `buildOrder`) already
   puts it first on the pattern's shared plane and build context. One Python change: `_svg_layer_import_plan`
   uses a declared `sketchName` when the entry carries one.
4. **Later kinds relate to it** through the existing projection path: `splitManifestByKind` turns any cross-kind
   constraint into a projection of the earlier-built sketch, and the boundary is now earliest. No constraint crosses
   today (the box has no dims and nothing snaps to it), so the path is available but unused.
- A pre-SE17 single-layer pattern (no `pattern.layers`) still gets the 4 construction Lines inside its one
  combined sketch. There's no kind split to separate them from.

**Tests:** split tests now see `boundary` as its own kind (`buildOrder` 0, 4 construction Lines, 8 closure
constraints, same `patternId`); export-flow: one "Lattice Boundary" manifest per pattern (two kind-layers of one
pattern -> one), none when nothing is sent. The kind-split fixture got `id: 'p'` (real patterns always have one,
`generatePattern` sets it; its owned pieces already said `data-lattice-gen: 'p'`). pytest: the "Lattice Boundary"
entry, listed LAST in the payload, builds FIRST under its own name. **Gate:** vitest 1582/1583 (the same
`frame-3d-sweep` 5 s timeout, seat C's, flagged above), pytest 288/288, browser ALL CHECKS PASSED desktop + mobile.

# SMITHSONIAN-BROWSER: browse the Smithsonian's open 3D collection from the STL panel

Design only. Branch `smithsonian-browser` (from `main` @ `5d168f33`), 2026-11-22. Builds on STL-RELIEF (STL-RELIEF-DESIGN.md):
a model picked here becomes an ordinary STL layer (`P.stlLayers[i]`), stamped, placed and stored exactly like an imported STL.

## 1. What Fred asked for

"Lets start with smithsonian": browse a free 3D library from inside the app, pick a model, and stamp it. Smithsonian first;
Kenney / Quaternius / Three D Scans later (they have no search API: a mirrored catalog, a separate design).

## 2. The API, measured live (2026-11-22, curl from this PC)

- **Endpoint:** `GET https://3d-api.si.edu/api/v1.0/content/file/search` (the Smithsonian's 3D file API, documented at
  3d-api.si.edu/api-docs as version 1.0, "alpha"). Params: `q`, `model_url`, `file_type` (jpg / glb / ply / zip),
  `file_quality` (Thumb / Low / Medium / High / ...), `model_type`, `owning_unit`, `start`, `rows` (0..1000).
- **No API key.** `Access-Control-Allow-Origin: *` on the search AND on the files (3d-api.si.edu/content/document/...), and
  byte ranges work. So the browser calls it DIRECTLY: no worker, no key to hide.
- **One row per FILE**, about 17 per model (thumbnails, Low / Medium / High GLBs, USDZ, zips). The ONE-ROW-PER-MODEL query is
  **`file_type=glb&file_quality=Low`**: 3,523 models, each row = title, `model_url` and the Low GLB's own uri (so a pick needs
  no second call). (Searching the JPG thumbnails instead was measured and rejected: only 2,142 models, 2,069 of them
  Natural History mammals -- the museum filter would have been empty for every other museum.)
- **Per museum (owning_unit), Low GLBs:** NMNHMAMMALS 2,139 · NMNHINV 944 · NMNHPALEO 221 · NMAH 39 · NMAAHC 37 · NASM 15 ·
  NPG 14 · CHNDM 12 · SAAM 10 · SAO 10 · DPO 8 · NMAfA 8 · NMNHEDUCATION 4 · NMNHFISHES 4 · NMNHHERPS 3 · OFEO-SG 2 · FSG 0.
- **Thumbnails:** `<the GLB's folder>/scene-image-thumb.jpg` (~10 KB) -- 14 of 16 sampled across museums; the 2 others
  (Wright Flyer, Davenport motor) have no JPG at all (`model_url=<id>&file_type=jpg` -> 0 rows, recorded) -> a title tile.
- Recorded live responses: `tests/fixtures/smithsonian/*.json` (whole collection page 1, "skull" page 2, NPG, "leaf", a
  model with no JPG).
- **The model file:** `model_url=<id>&file_type=glb&file_quality=Low` gives one GLB: ~150k triangles, Draco-compressed,
  1024 px texture, **~0.8 MB** (Hayes bust: 815,012 bytes). Thumb GLB: 20k triangles, ~150 KB. Every Web3D GLB measured is
  Draco-compressed (18,887 of 21,457 GLBs), so a Draco decoder is needed.
- **The raw GLBs are NOT upright** (advisor, measured 2026-11-22): the Hayes bust's Low GLB has no node transform and its
  longest side is X (281 x 211 x 148 mm), so it inserted lying sideways. The upright pose lives in the model's **Voyager scene**,
  `<the GLB's folder>/scene.svx.json` (~9 KB, CORS *; recorded: `tests/fixtures/smithsonian/scene-hayes.svx.json`, 9,477 bytes):
  `models: [{ units, translation [x,y,z], rotation [qx,qy,qz,qw], boundingBox, derivatives: [{ usage: 'Web3D', quality: 'Thumb' |
  'Low' | 'Medium' | ..., assets: [{ uri (relative to the folder), byteSize, numFaces }] }] }]` (translation / rotation may be
  absent = identity). One entry per PART of the model, each with its own pose. Rotating, then translating a part's points
  stands it upright (+Y up) facing the Voyager camera (+Z); the recorded Hayes pose turns its raw box (longest X) into a box
  tallest along Y, centred near the origin.
- **The textures are half of each GLB** (measured): images = Low 407,029 of 815,012 bytes, Thumb 76,025 of 156,668. Fred: "I
  don't want the texture". The file server answers byte ranges (206 + `Access-Control-Allow-Origin: *`, also from Fusion's
  palette), so only the geometry's bytes are downloaded.
- **Licence:** the 3D site's licence pages refuse automated reads (403), so not quoted here. Evidence: the CC0 listing shows
  ~3,400-3,580 models and the API serves the Open Access files. Fred does not sell his carvings, and the app downloads a model
  into HIS browser on demand (nothing is re-hosted). **To confirm in a browser before merge:** 3d.si.edu/cc0 wording.

## 3. How it works

```
STL panel  "Browse Smithsonian"  -> search box + thumbnail grid (one tile per model, paged)
   tap a tile -> Insert -> loading card 'stl' -> scene.svx.json (every part + its pose)
   -> each part's Low GLB, GEOMETRY ONLY (byte ranges) -> GLTFLoader + DRACOLoader (Three r128) -> soup -> its pose
   -> the parts joined -> the existing import path (createStlLayer: weld, store at Stored detail, health, fit) -> a new STL layer
```

- **One download for every path** (`core/stl/smithsonian.js downloadSmithsonianModelSoup`): Insert, the Stored-detail
  re-download and Turn in 3D. FIRST the model's Voyager scene (`sceneUrlOf`, `parseVoyagerScene`, `fetchVoyagerScene`): each
  model entry's Web3D Low GLB (Turn in 3D: its Web3D Thumb; an entry without one: its Low, "loading the full model"), read,
  put in its pose (`core/stl/gltf.js transformSoup`: the quaternion, then the translation), the parts concatenated. The scene
  REPLACES the parts lookup as the primary path. A scene that is missing, unreadable or lists no part: the parts lookup and
  the tile's GLB as before (below), with no pose.
- **Geometry only, no texture is ever decoded:** `stripGlbTextures(buf)` rebuilds a GLB whose JSON has no images / textures /
  samplers / materials (primitives lose `material`; the texture / material extensions leave `extensionsUsed` /
  `extensionsRequired`, declared `GLB_TEXTURE_EXTENSIONS`) and whose BIN chunk holds ONLY the bufferViews still referenced
  (accessors, sparse accessors, `KHR_draco_mesh_compression`), their bytes unchanged, re-packed (each at its original offset
  modulo 4) with the offsets and indices rewritten. `loadGlbScene` strips EVERY GLB before `loader.parse` (a local .glb file
  too). `fetchGlbGeometry(url)` downloads only those bytes: `Range: bytes=0-19` (the header + the JSON chunk's length), the
  JSON chunk (+ the BIN chunk's header), then the kept bufferViews' ranges (merged when closer than 64 KB,
  `GLB_RANGE_MERGE_GAP`), assembled into the same stripped GLB. A 200 answer (no range support): that full answer is stripped.
  Any other answer or anything inconsistent (a wrong length, a wrong Content-Range when readable, a view past the BIN chunk):
  a full download + `stripGlbTextures`. Every Smithsonian GLB download goes through it.

- **Search:** `q` + `owning_unit` (optional) + `file_type=glb&file_quality=Low&rows=24&start=k`. Tiles show the thumbnail
  (`scene-image-thumb.jpg` beside the GLB; on a load error the tile shows the title alone), the title as name.
- **Pick, the FALLBACK when there is no scene:** every Low GLB of the model: one lookup `model_url=<id>&file_type=glb&file_quality=Low&rows=50` (a bust and its base
  are two rows of ONE model; the grid keeps one tile per model), each part downloaded and read, the soups joined into ONE layer.
  A failed lookup falls back to the row's own GLB uri. The 'Turn in 3D' fallback and the Stored-detail re-download do the same.
- **GLB to soup** (new, `core/stl/gltf.js`): walk every mesh in the scene, apply its world matrix, append its triangles
  (indexed or not). **Face up, the identity** (advisor decision 2026-11-22, measured: the earlier Y-up -> Z-up turn stood a
  bust UP, so the top-down stamp was a 2.6 in column = the top of the head): for a relief the model LIES FACE UP, glTF's front
  (+Z) out of the board, its up (+Y) toward the top of the board, as its picture shows it. `GLTF_TO_BOARD` stays a declared
  constant (now (x, y, z) -> (x, y, z)); the Rotate sliders turn it any way. The API's `gltf_orientation_compliant` flag says
  the files follow glTF's axes. Units: metres, but `fitUnitIn` fits every new STL to half the board anyway, so the unit does
  not matter.
- **Turn in 3D** opens as the picture: a front view, the camera on +Z looking down -Z, up = +Y, framed on the soup's bounds.
- **Status line:** counts the models SHOWN ('N models shown', plus ' · more available' while more pages exist): the API's
  rowCount counts files, not models ('1–14 of 14' with 12 tiles misled).
- **Phone (<= 600 px):** the picture and the 3D canvas are at most 40vh tall (object-fit: contain), the grid stays in sight.
- **Loaders:** `GLTFLoader.js` and `DRACOLoader.js` from three@0.128.0's `examples/js` (the same r128 as `three.min.js`,
  pinned), loaded ON FIRST USE only (no cost for a board that never browses). The Draco decoder (WASM) from the same pinned
  package's `examples/js/libs/draco/gltf/`.
- **The record** keeps where it came from: `source: { provider: 'smithsonian', modelUrl, title, uri }` (a new optional field;
  absent on every existing record = no change). The panel shows the title and a link to the model's page.
- **Import parity:** the GLB path ends in the SAME function the STL file path uses (one mechanism: AGENTS.md rule 2).
  The panel's file button also learns `.glb` (the loader is there anyway).
- **Errors:** offline / API down / a model without a Low GLB -> a message in the panel's status line, nothing changes.
- **Fusion palette:** it already loads three.js from cdnjs, so network access is there; to check once in Fusion.

## 4. Declared, not hand-built

- Opened from `panel-stl` (a "Browse Smithsonian" button; no new sidebar panel) as a **full-screen sheet** built on the
  app's own dialog classes (`cad-modal-overlay` / `-window` / `-header` / `-body`, as the editor's full-screen modal and
  pull-changelist.js use them). Tile size from `PICKER_TILE`. The museum picker is a native `<select>` (no popover).
- One declared table `SMITHSONIAN_SOURCE` (endpoint, the thumb / model filters, page size, the parts-lookup rows; the
  loader URLs and the glTF -> board turn are declared beside it in core/stl/gltf.js): a later library (Kenney, Quaternius) is another entry, not another mechanism.
- Loading stage: the existing `stl` stage (label "reading the STL" -> "fetching the model" for this source).

## 5. Saved boards must not change (rule 3)

Purely additive: a new optional `source` field, no default changed, no pass changed. A board without a Smithsonian STL is
byte-identical (the stl-layers-absent golden covers the passes).

## 6. Tests (fail first, real shapes)

1. The search parser on a RECORDED live response (`tests/fixtures/si-search-*.json`, saved from the API): tiles = one per
   model, title, thumbnail, model id; paging maths.
2. The tile's thumbnail URL is derived from the GLB uri; a thumbnail that fails to load leaves a title tile (no broken image).
3. GLB -> soup on a small real GLB fixture (non-Draco, made from a known mesh): triangle count, the face-up identity
   (a standing model's depth becomes the relief height), world matrices applied.
4. The import parity: the soup goes through the same createStlLayer path (a spy), `source` stored, the layer active.
5. Panel: the browser renders, a search fills tiles, a tile tap adds an STL layer (fetch stubbed with the recorded
   responses), errors show in the status line, DEFAULT untouched (copy-on-write).
6. Browser check (headless Chrome, real network): search "skull", tap the first tile, the stamp lands; Draco decodes.

## 7. Fred's answers (2026-11-22, one at a time)

1. **A full-screen sheet** (not inside the panel).
2. **The whole collection, paged**, straight away (24 per page, "More results"); typing narrows it.
3. **A museum picker** beside the search: "All museums" (default) + the units that have models (FSG, 0 models, left out),
   with readable names in one declared table.
4. **Preview: a large picture at once, 'Turn in 3D' for a rotatable view; Insert adds it.** Tapping a tile SELECTS it (no
   insert) and fills a preview pane (desktop: beside the grid; <= 600 px: above it): `<glb folder>/scene-image-medium.jpg`
   (~123 KB; on error the thumbnail, then the title alone), the title, 'Turn in 3D' and 'Insert'. 'Turn in 3D' looks up the
   model's 20k-triangle Thumb GLB (`model_url=<id>&file_type=glb&file_quality=Thumb`, the first GLB row; none -> the Low GLB,
   "loading the full model (~0.8 MB)"), reads it as the board's Z-up soup and shows it in a small THREE r128 view (its own
   renderer, a plain material + a light, drag to turn: no OrbitControls, no new CDN script). Selecting another tile or
   closing the sheet disposes the view (renderer + context, geometry, material, canvas, listeners).
5. **Stored detail is a slider; a Smithsonian model re-downloads to go back up after a reload.** "Stored in the project"
   is a slider (min 500, step 500, applied on release) + the number box. Its top: the in-memory original's triangle count;
   after a reload a record with `source.uri` keeps its `origTris` (moving up downloads the model again behind the 'stl'
   loading card and keeps it as the original); any other STL the stored count (down only, as before).

## 8. The Shape filter over a mirrored catalog (Fred 2026-11-22)

- **Fred's answer:** the flat catalog is just a FILTER (no sorting), with a RATIO; "a rod would be good too". So the sheet has a
  **Shape** picker (a native `<select>`): **Any shape** (default) · **Flat** · **Rod** · **Flat or rod**, and, when it is not Any,
  a **Ratio** slider + number box (0.05..1, step 0.01, default 0.30) that re-filters live (debounced, no network). With the box
  sides sorted `d = [small, mid, large]`: **Flat = small / mid <= ratio** (a plate: thin against BOTH other sides), **Rod = mid /
  large <= ratio** (long and thin). It combines with the search words (every word somewhere in the title, any case) and the museum.
- **Any = the live API exactly as before.** Not Any = the mirrored catalog, fetched ONCE per sheet on first use (status line
  'Loading the catalog…'; a failed load is tried again next time), filtered in the page and paged 24 at a time with More results,
  the same 'N models shown · more available' line. Its tiles are built by the same `tileFromGlb` the API search uses, so the
  preview, Turn in 3D and Insert work unchanged. A model with no box (9 of 3,482) only shows under Any.
- **The catalog format is SOURCE-NEUTRAL** (`core/stl/catalog.js`; a later library writes the same fields and names itself):
  `{ v: 1, source: '<source id>', built: 'YYYY-MM-DD', base: '<common uri prefix>', models: [{ id, t: title, u: owning unit,
  g: <the GLB uri without base>, d: [small, mid, large] | null }] }`. Declared: `CATALOG_SHAPES`, `CATALOG_FILTER` (the defaults),
  `SMITHSONIAN_SOURCE.catalogPath`.
- **The file:** `b-spline-gen/html/data/stl-catalog-smithsonian.json` (beside `photo-patterns.json`, fetched relative to the app
  root; the Pages build copies every `.json` under `html/`), 3,482 models, 3,473 with a box (817,858 bytes, 198,055 gzipped).
  Built by `tools/build_stl_catalog.py` (one Range request per GLB for the header + JSON chunk, the POSITION accessors' min / max;
  polite pauses, a plain client name; `--limit N` to test, `--from-json OLD` to convert an earlier crawl). The shipped file is the
  advisor's 2026-11-22 crawl converted with `--from-json` (every uri reproduced from base + g). At 0.30: 154 flat, 356 rods.
- **Known limit:** d is the GLB's RAW axis-aligned box (before the Voyager pose), so a plate stored tilted reads thicker than it
  is (the NPG "Theodore Roosevelt" bronze relief: 416 x 492 x 606, not flat).

## 9. SMK, the second library, and ALL LIBRARIES at once (SMK-LIBRARY, Fred 2026-11-22)

- **Fred:** "Smk for the win" (only no-key, no-login libraries), then "searching searches all libs at once and simply tells me
  which libs they're from along their sizes etc".
- **The SMK API, measured live 2026-11-22 (plain curl; recorded: `tests/fixtures/smk/search-all-p1.json` = rows 24, and
  `item-relief-kas2906-8.json` = `api/v1/art/?object_number=KAS2906/8`):** `GET api.smk.dk/api/v1/art/search/?keys=<words | *>&
  filters=[has_3d_file:true]&offset&rows&lang=en` -> `{ found: 373, items }`, no key, CORS *. The 3D file reference is
  **`files_3D: [{ url, mime_type, file_size }]`** (`file_size` missing on some rows). `rights`: 371 of 373 = the Public Domain
  Mark (the 2 others: smk.dk's own terms, left out). A second filter `[object_names:Relief]` narrows (41); two object_names
  filters are ANDed (0), so a Type of several names runs one search per name. Images: IIIF on iip-thumb.smk.dk (CORS *).
  Download: `api/v1/download-3d/<file>.stl`, no auth, CORS *, ranges OK (`Content-Range: bytes 0-0/20005084`). 367 of 373
  list a `_small` STL (10-20 MB; one is `_small8`); without one, the smallest STL listed. **Z-up, standing, 130 mm tall**
  (KAS2906/8, a relief, measured: 49 x 21 x 130 mm, thin along Y).
- **Declared, one mechanism:** `core/stl/smk.js` `SMK_SOURCE` (+ `SMK_TYPES`: All types / Relief = Relief + Tympanum + Stele /
  Bust = Bust + Herma / Head / Statue = Statue + Statuette + Group of statues + Group of statuettes + Torso + Kore / Other =
  Sculpture in the round + Sculpture related to architecture; every name on the 373 models is in exactly one type, a later new
  name shows under All types only). `core/stl/libraries.js`: `STL_LIBRARIES = [SMITHSONIAN_SOURCE, SMK_SOURCE]`, `ALL_LIBRARIES`
  and `LIBRARY_OPS` (per library: its searches, a page, the file a tile downloads, the download, the record's `source`). A tile
  is the SAME shape for both; an SMK tile also says `format: 'stl'`, `stlUrl`, `sizeBytes`, `dims`, `licence`. (A Smithsonian
  tile was NOT given `format: 'glb'`: main's test pins its exact shape; the library -- `SMITHSONIAN_SOURCE.format` -- says it,
  and the sheet hands `onPick(tile, library)`.)
- **The sheet:** a Library `<select>` heads the row, **All libraries by default** (the panel's '🏛 Browse 3D libraries…' opens
  `STL_LIBRARIES`; opened with one source the sheet is the Smithsonian sheet as before). Every search is a list of FEEDS (a
  library, or one object_name of an SMK Type) fetched in parallel (`Promise.allSettled`), merged **round-robin** into the one
  grid; More results asks each feed that has more for its next page. A library that fails is one note line ('SMK: could not
  reach api.smk.dk (…)'), the others still show. Filters: the words go to every library; the museum (Smithsonian) and the Type
  (SMK) show only when that one library is picked (their values are kept while hidden); with All the Shape shows too, and a
  library with no shape data is left out of a Shape search with a note ('SMK: no shape data …').
- **Tiles say where they are from and how big:** a badge ('Smithsonian' / 'SMK') and the listed download size ('20 MB';
  the Smithsonian API lists none) or a catalog tile's shape word ('flat' / 'rod'). The selected tile's pane: the library and the
  licence, the download size (not listed: ONE 1-byte Range request for the selected tile, 400 ms after it is selected so
  tapping through tiles sends nothing), the object's own size from SMK's listing (W × H × D cm), the credit.
- **Insert (SMK):** the `_small` STL (behind the 'stl' loading card; the panel status line shows 'Downloading <name>: 4.2 of
  20 MB…') -> parseStl -> `addStlFromSoup(soup, title, { source: { provider: 'smk', id, title, uri }, orient: 'layFlat' })`:
  the library's orientation rule, the Lay flat rotation (the same `layFlatRotationOf` the Lay flat button uses), in the SAME
  write and undo step. Live: KAS2906/8 laid with its thin side up (|R[2][thin]| 0.999), the figure up the board. The Smithsonian
  keeps its Voyager pose (`orient: 'voyager'`, nothing at insert). The Stored-detail re-download reads the record's library
  (`provider`) and downloads its `uri` again.
- **Turn in 3D (SMK):** the model IS the STL: the pane says 'Turn in 3D downloads the model (~20 MB).' and it loads on press
  only (progress in MB in the pane note). Shown UPRIGHT as stored: the Z-up soup turned -90° about X (`SMK_SOURCE.previewTurn`)
  for the view's front camera (+Y up, the model's -Y side to the camera).
- **Licence:** PDM only (the 2 others are dropped; `parseSmkSearch` counts them). Credit: 'SMK — National Gallery of Denmark,
  public domain (PDM). Models load from api.smk.dk.'
- **Known:** in headless Chrome (an honest HeadlessChrome user agent, never changed) the Smithsonian API answers WITHOUT its
  CORS header (Chrome: `MissingAllowOriginHeader`) while curl gets `Access-Control-Allow-Origin: *` with or without an Origin:
  the sheet then shows SMK alone with 'Smithsonian: Could not reach 3d-api.si.edu (Failed to fetch).' SMK answered the same
  browser normally.

## 10. The sheet's UX pass (3D-LIBRARIES worker O, Fred 2026-11-22: "And the 2D image view? How do we see the next results? Can it be better")

- **2D | 3D pill** in the pane (the main view's own `view-mode-toggle` look). 2D = the picture (default); `#stlLibTurn` is the 3D
  half (its label is now '3D'; the main test that asserted 'Turn in 3D' was changed, advisor-approved). The first 3D press loads
  as before (same download, same notes, e.g. SMK's '~20 MB'); back to 2D re-attaches the picture and KEEPS the 3D view hidden
  (not disposed), so 3D again is instant with no second download. Selecting another tile or closing disposes it.
  The picture is detached (not hidden) while 3D shows, so `#stlLibPane img` is null then, as the older test requires.
- **Lightbox:** tapping the picture opens a full-screen `cad-modal-overlay stl-lib-lightbox` over the sheet: wheel zoom about the
  cursor, pinch (two pointers), double-tap (zoom in / out), drag pan, a 36 px close button, Esc (closes the lightbox first, then
  the sheet). Zoom is 1x..8x (`LIGHTBOX`, one declared object). Closing returns to the sheet, same selection.
- **Endless scroll:** an IntersectionObserver on `#stlLibSentinel` (after the grid, 300 px margin) loads the next page exactly as
  'More results' (same per-library paging and dedupe); one load at a time (`pending`); after each page the sentinel is observed
  again (a short page that leaves it in view loads the next). Where IntersectionObserver is missing, 'More results' remains.
- **Totals** sit beside the status line in `#stlLibTotals` ('Smithsonian 3,523 · SMK 373', All libraries; a library with no
  known total shows nothing). They are a separate element so the status line's own text (asserted by main tests) is unchanged.
- **Keyboard** (no field or select focused): arrows move the selection (left/right = previous/next, up/down = the tile one row
  above/below, from the tiles' positions), scrolled into view; Enter inserts; Esc as above.
- **Desktop tiles:** > 600 px wide, `--stl-lib-tile-desktop` (136 px, declared once in layout-app.css) sizes the grid:
  1400 x 900 shows 7 columns x 3 full rows = 21 tiles beside the pane (measured). The phone keeps `PICKER_TILE.tilePx` (80 px).

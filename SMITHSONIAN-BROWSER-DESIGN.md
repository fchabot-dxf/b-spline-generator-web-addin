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

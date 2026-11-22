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
- **Licence:** the 3D site's licence pages refuse automated reads (403), so not quoted here. Evidence: the CC0 listing shows
  ~3,400-3,580 models and the API serves the Open Access files. Fred does not sell his carvings, and the app downloads a model
  into HIS browser on demand (nothing is re-hosted). **To confirm in a browser before merge:** 3d.si.edu/cc0 wording.

## 3. How it works

```
STL panel  "Browse Smithsonian"  -> search box + thumbnail grid (one tile per model, paged)
   tap a tile -> loading card 'stl' -> fetch the Low GLB -> GLTFLoader + DRACOLoader (Three r128) -> triangle soup
   -> the existing import path (createStlLayer: weld, store at Stored detail, health, fit) -> a new STL layer, active
```

- **Search:** `q` + `owning_unit` (optional) + `file_type=glb&file_quality=Low&rows=24&start=k`. Tiles show the thumbnail
  (`scene-image-thumb.jpg` beside the GLB; on a load error the tile shows the title alone), the title as name.
- **Pick:** the row's own GLB uri: the download (with a progress line in the loading card).
- **GLB to soup** (new, `core/stl/gltf.js`): walk every mesh in the scene, apply its world matrix, append its triangles
  (indexed or not). glTF is **Y-up**, the board is **Z-up**: rotate +90 degrees about X (a declared constant; the API's
  `gltf_orientation_compliant` flag says the files follow glTF's axes). Units: metres, but `fitUnitIn` fits every new STL
  to half the board anyway, so the unit does not matter.
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
- One declared table `SMITHSONIAN_SOURCE` (endpoint, the thumb / model filters, page size, the loader URLs, the Y-up -> Z-up
  turn): a later library (Kenney, Quaternius) is another entry, not another mechanism.
- Loading stage: the existing `stl` stage (label "reading the STL" -> "fetching the model" for this source).

## 5. Saved boards must not change (rule 3)

Purely additive: a new optional `source` field, no default changed, no pass changed. A board without a Smithsonian STL is
byte-identical (the stl-layers-absent golden covers the passes).

## 6. Tests (fail first, real shapes)

1. The search parser on a RECORDED live response (`tests/fixtures/si-search-*.json`, saved from the API): tiles = one per
   model, title, thumbnail, model id; paging maths.
2. The tile's thumbnail URL is derived from the GLB uri; a thumbnail that fails to load leaves a title tile (no broken image).
3. GLB -> soup on a small real GLB fixture (non-Draco, made from a known mesh): triangle count, the Y-up -> Z-up turn
   (a known apex lands up), world matrices applied.
4. The import parity: the soup goes through the same createStlLayer path (a spy), `source` stored, the layer active.
5. Panel: the browser renders, a search fills tiles, a tile tap adds an STL layer (fetch stubbed with the recorded
   responses), errors show in the status line, DEFAULT untouched (copy-on-write).
6. Browser check (headless Chrome, real network): search "skull", tap the first tile, the stamp lands; Draco decodes.

## 7. Fred's answers (2026-11-22, one at a time)

1. **A full-screen sheet** (not inside the panel).
2. **The whole collection, paged**, straight away (24 per page, "More results"); typing narrows it.
3. **A museum picker** beside the search: "All museums" (default) + the units that have models (FSG, 0 models, left out),
   with readable names in one declared table.

# STL-RELIEF — an STL "3D stamp": place, scale, rotate and stamp an STL into the B-spline surface

Design only. No product code changed. Written on branch `stl-relief-design` (from `main` @ `d1001e84`), 2026-11-21.
Read from source: `core/engine/rebuild.js`, `core/engine/apply-stamp-layers.js`, `core/photo/{codec,state}.js`,
`core/stamp/{index,transform}.js`, `main/{sidebar-tabs,section-themes}.js`, `main/editor-tabs.js`.
**Not read yet** (must be read before code): `_collectStampPasses` (rebuild.js ~315-420), the project save/load path
(`cloud-project-manager.js`, `snapshot-manager.js`), a `MIGRATIONS` entry's format (`main/app-init.js:232`), the
drape colouring (`core/preview/{terrain-mesh,drape-svg}.js`), the sculpt controller's picking.

## 1. What Fred asked for

The existing web app, plus an **STL insert**: load an STL, **position (X, Y, Z), scale, rotate** it on the surface, and
**stamp it into the B-spline** (the same way an SVG stamp is stamped). Its **own sidebar panel with its own widget**.
**Colour coding** on the STL surface and its **intersection with the B-spline preview**. The STL is **stored with the
project**, at a size the user can adjust. STLs need **not be closed**. Later (not slice 1): layer sliders (opacity,
blend), more brush modes, mesh clean-up, mesh-to-B-rep.

Ruled out by Fred: stamp-editor (needs an existing Fusion face), and a separate standalone app.

## 2. How it fits the existing pipeline

`rebuild.js buildHeights`: `generateHeightmap` -> `+ preDelta` (sculpt) -> `applyStampLayers(heights, passes)`.
A pass is a mask (body + fillet channels) times a depth, **added** to the heights. `STAMP_PASS_KIND` already has
`art` and `bricks`; an STL layer is a third kind, `stl`.

```
STL (stored copy) --place/scale/rotate/Z--> CPU z-buffer depth render at (nx, nz)
   --> relative height 0..1 (+ optional compression, blur, fillet) --> pass { kind:'stl', mask, depth, blend, zOffset }
   --> applyStampLayers (one new branch: blend max / add; Z offset) --> heights --> thicken --> STEP
```

The only genuinely new shared-code change is the blend/Z branch in `applyStampLayers`. Everything downstream (thicken,
`stepWriter`, preview, export) is untouched.

### 2.1 Findings from reading `rebuild.js` and `apply-stamp-layers.js` (2026-11-21)

- **Pass shape** `applyStampLayers` needs: `{ id, enabled, svg (any truthy marker, '1'), mask, depth, profile, suppression,
  smoothing, edgeFilletRadius, filletPower, kind }`; `mask` = `{ body, fillet, isStamped?, metrics? }`, every array exactly
  `nx*nz` long (else the pass is skipped, line 96-97). Core line 145: `heights[k] += body[k]*depth + fillet[k]*filletAmplitude`
  (signed depth: negative carves), after an optional suppression blend toward a smoothed copy of the terrain.
- **Unmatched id is safe**: `editorFor(pass)` returns null for an id with no editor layer and the code falls back to the
  pass's own fields (the brick passes' `${id}#bricks` ids already rely on it). An STL pass uses its own unique id.
- **Pass source**: `_collectStampPasses()` (exported for tests) builds passes only from `window.svgEditor._layers`, each
  gated by `isCarved`. STL passes are **appended after that loop**, from `P.stlLayers`. They run after every editor
  layer's art and bricks, i.e. always on top.
- **STL counts as art** (`isArt = kind !== 'bricks'`), so a Flat brick fits its plane under an STL's contribution, as under an
  SVG carve. No change needed there.
- **Coverage**: an uncovered point and "covered, at the lowest height" are both 0 in `body`. The `isStamped` array carries
  coverage (line 137-138 uses it), so the STL pass sets it.
- **The one new branch** (line 145): a pass with `blend: 'max'` does `heights[k] += max(0, zOffset + body*depth)` over
  `isStamped` points only. A pass with no `blend` (every existing pass) takes today's add line unchanged.
- **Order only matters** for Add+Max mixed, for a layer with suppression > 0 (it scales what came before it), and for Flat
  bricks (already ordered by design). Add+Add and Max+Max commute. Hence "STL always on top" is enough for slice 1.
- **CPU z-buffer, not a Three.js render**: pure array math like `photo/ops.js`, testable in plain vitest (happy-dom has no
  real canvas), deterministic on every device, and the compact mesh decodes synchronously from `P`. The GPU is used only
  for the display ghost and the colour-coding shader (slice 2). Cached by (mesh, transform, nx, nz); behind the loading
  card on a phone.

## 3. The panel

Declared, not hand-built (AGENTS.md rule 2):

- `main/sidebar-tabs.js`: section id `panel-stl` in the Surface branch, in the "2D editor" group or beside `panel-stamp`.
- `main/section-themes.js`: `SECTION_THEMES.stl = { hue: ~75 }` (unused hues: see file) and a `SECTION_ICONS.stl` glyph.
- Pickers via `mountIconSelect` / `mountIconGrid`. Phone first: 390 px, touch targets >= 28 px, a loading card before
  parse / simplify / depth render.

Controls (per STL layer):

| Group | Control |
|---|---|
| File | choose STL, name, **Stored detail** (triangles, ~MB), "Re-import for more detail" |
| Place | X, Y, **Z** position (in) · "snap base to surface" |
| Scale | X/Y (uniform + lock) and **Z** scale |
| Rotate | X, Y, Z (degrees) |
| Stamp | depth, compression, edge softness (fillet/blur), raise vs carve, blend (default **Max**) |
| Health | read-only mesh report: open edges, holes, floating pieces (detection only) |
| View | ghost on/off, colour legend |

Z position: negative sinks the object into the surface (only the part above it shows); this is the embed case and the
reason the default blend is **Max** (a new layer type, so no saved board is affected).

## 4. The widget (in the 3D view)

- A ghost of the STL on the real board, with move / rotate / scale handles (Three.js r128 `TransformControls`, or the
  repo's own picking as in `sculpt-controller.js` — to be checked). Sliders stay as the exact numeric fallback.
- **Colour coding** (declared table, one place): above the surface = shows in the relief; below = buried; a thin
  **intersection line** where the STL meets the surface; overhang/undercut (lost in a top-down stamp); open edge / hole
  (mesh health). Done in a small shader sampling the surface height as a texture; no CPU work while dragging.
- The ghost uses a decimated copy for display; the stamp uses the stored copy.

## 5. Storage (decided by Fred: stored with the project)

- Persisted as a compact, **versioned** record in `P` (its own list, e.g. `P.stlLayers`, like the photo/decal layers):
  `{ v:1, name, origTris, storedTris, mesh:{ quantized indexed positions + indices, base64 }, transform, stamp:{...} }`.
- **Quota is a measured hazard here** (item 74a in `photo/codec.js`: a 5.5 MB upload hit the storage quota and a reload
  lost the board). A binary STL is ~50 B/triangle, so 100k triangles ~ 5 MB. Hence a stored simplified copy.
- **Stored detail** is a per-layer setting. While the app is open the original stays in memory, so the slider can go up
  or down; after a reload only the stored copy exists (lower only; "Re-import" to go higher).
- The cap applies **at import / when the user moves the slider, never on load**. A loaded board is not re-simplified or
  rewritten (rule 3). Default ~50k triangles (~0.5 MB), a declared constant. A size **warning** is shown; a hard stop
  would be a clamp and needs Fred's yes (rule 5).

## 6. Non-closed STLs

Fine. The stamp needs only the surface seen from above; the solid comes from the height field. Depth render draws both
sides. Holes in the top surface show as pits: **detected and reported, not auto-repaired** (a repair rule needs Fred's
yes). Closedness only matters later, if mesh clean-up (manifold-3d) is added for trim/shell of the mesh itself.

## 7. Saved boards must not change (rule 3)

- Absent `P.stlLayers` = off. A board without it lays, carves and looks byte-identical.
- A hash-pin test with the key absent, written **before** the feature, must pass before and after.
- Whether a `MIGRATIONS` entry is needed for a purely additive key: to be confirmed after reading an entry's format.
- Rebuild digests: a new `P` key is hashed automatically (safe). With the CPU rasterizer the mesh decodes synchronously from
  `P`, so there is no async input outside `P` (unlike Photo's `isPhotoReady`). If a depth-map cache is kept outside `P`,
  its key must feed **both** `rebuildInputDigest` and `heightsInputDigest`, or the 3D goes stale. `HEIGHTS_INERT_KEYS`
  stays untouched (a heights input must not be listed there).
- `ENGINE_OPTIONS` completeness test (every `generateBricks` key) — check it is not affected.

## 8. Tests (each must FAIL before the change, real app shapes)

1. Absent-field pin: a board with no STL layer hashes identically before/after.
2. Depth render of a known mesh (a pyramid, a tilted plane) at a known transform gives known heights (translate / scale /
   rotate / Z each move the result the expected amount).
3. Open mesh (a hole) renders without throwing; the health report counts the hole.
4. Blend Max vs Add on a known surface: sunk object shows only above the surface.
5. Stored copy round-trips: save -> load gives the same triangles and the same heights; load does not re-simplify.
6. Rebuild digest changes when the STL decodes (no stale heights).
7. Panel is declared in `SIDEBAR_TABS`/`SECTION_THEMES` (existing completeness tests cover it).
8. Full `npx vitest run`; the brick-matrix groups the change touches; every `*_FULL` sweep if `applyStampLayers` changes.

## 9. Slices

0. Read the unread items above; pin tests.
1. STL parse (binary + ASCII), storage record, depth render, pass `kind:'stl'` with the blend/Z branch; panel with sliders
   (place, scale, rotate, Z, depth, blend); ghost in the 3D view. **First usable slice.**
2. In-viewport gizmo; colour coding + intersection line; mesh-health report; Stored-detail slider.
3. Compression (bas-relief tone map), fillet/blur parity with SVG stamps, opacity/blend on all layers.
4. Brush modes on the existing sculpt panel; 2D editor tab for the heightmap.
5. Later/experimental: manifold-3d clean-up/trim/shell; T-spline and mesh-to-B-rep (see 10).

## 10. To-do / risks

- **T-spline test in Fusion** (Fred's note): can the API create or locally subdivide T-spline bodies; how does the app's
  STEP look as a body at fine grid sizes. Needs the Fusion bridge and a scratch doc; clean up afterwards. Not a blocker.
- The depth render is top-down only: undercuts are lost (expected for relief).
- Large STL on phone: parse + simplify + render behind the loading card; display copy decimated.
- A plain B-spline grid is tensor-product: one regular grid for the whole board. Local refinement would need patches.
- Concurrent agents work in this repo: pull and check `git status` before branching; never push `main`; name the
  merge-gate tier on handoff (`tier: groups ...` or `tier: full`).

## 11. Fred's answers (2026-11-21)

1. **Scope: only an STL stamp into the existing B-spline tool.** "There's already a lot of post processing after that."
   So no new solid / shell / trim / mesh-repair / mesh-to-B-rep work, no CNC-vs-print output decisions: thicken, STEP
   and the rest stay exactly as they are. Section 9 slice 5 (manifold-3d, T-splines, mesh-to-B-rep) is **out of scope**
   unless Fred asks again; the T-spline Fusion test stays on his to-do list as research only.
2. **Several STLs per board, as a list** (`P.stlLayers` is an array from day one; each has its own place / scale / Z /
   stamp settings and its own stored mesh).
3. **Floating Z: allowed, with a warning** (colour coding marks it). No clamp, no skirt.
4. **Sliders first, gizmo next.** Slice 1 = parse + store + depth render + `stl` pass + panel sliders + ghost; the
   in-viewport gizmo and colour coding are slice 2.

Consequence for storage: with several STLs in a project, the quota matters more. Each layer shows its own stored size,
and the panel shows the project's STL total (warning only, no hard stop).

5. **Before or after thicken is the only ordering question.** No general "stack of panels" (considered and dropped by
   Fred: the only order that matters to him is before/after thicken, and a stack would mean refactoring `rebuild.js`).
   Each STL layer carries `placement: 'withSurface' | 'afterBack'`, declared in the record from day one.
   - `withSurface` (slice 1, the default): the STL is part of the heights, like SVG stamps; thicken derives the back from
     them. With the job timeline's Back lock on, the back is the frozen snapshot (`rebuild.js` `backHeights`, already
     built), so a later STL does not move a cut back.
   - `afterBack` (later slice, shared thicken code, own tests and the full sweeps): the STL adds to the top only; the back
     stays from the pre-STL heights. Needs a read of how thicken builds the side walls first.
   Correction to section 10 / the earlier notes: the "back derives from the final stamped heights" gap is partly closed
   already by the Back lock snapshot.

6. **Self-contained record, no stack.** Fred: the app's parameters are scattered (global `stamp*` keys in `P`, per-layer
   tooling on editor layers, masks built outside `P`, sculpt as delta arrays, brick/photo/frame settings of their own), so a
   "stack of panels" would not be clean. Every STL setting lives in its own `P.stlLayers[i]` record and the STL reads none
   of the scattered keys; it joins the app at exactly one point (a pass appended in `_collectStampPasses`, one blend/Z branch
   in `applyStampLayers`). A limited stack for ordering is not needed: the editor's Layers panel already orders SVG layers,
   and an optional per-STL position (absent = after everything) can be added later without changing saved boards.
7. **STL passes run after the editor layers** (always on top) in slice 1.

## 12. Nothing open: the small choices are per-STL parameters (Fred, 2026-11-21)

Fred: the earlier "still open" items are not decisions, they are settings the user adjusts. Each is a field of the
`P.stlLayers[i]` record with a declared default, so nothing needs deciding before building:

| Param | Default | Notes |
|---|---|---|
| `placement` | `withSurface` | `afterBack` is a later slice; the Back lock already covers the cut-back case |
| `storedDetail` (triangles) | ~50k | the Stored detail slider (section 5); warning only, no hard stop |
| `compress` (depth compression) | 0 (off, linear) | a slider; the curve shape (log / tanh) can be added later as another param |
| `blend` | `max` | `add` also offered |
| `zOffset`, `scale`, `rotation`, `position`, `depth`, `softness`, `raise/carve` | declared in section 3 | |

The defaults are constants in one declared table; changing one later does not touch saved boards, because a saved layer
stores its own value (an absent field reads as the declared default).

## 13. Build status (2026-11-21, branch stl-relief-design, nothing pushed)

Commits: 0f528275 (pin) .. 2e6e8c69. Gate on the final tree: full vitest 541 files / 7469 tests green; real headless Chrome (desktop
and 390 px) imports an asymmetric STL through the panel's own file input; the highest cell of the real surface and the ghost's
apex are at the same scene (x, y); sinking, Carved and restoring Z behave; the record survives a reload; no console errors.
Tier for the handoff: **tier: full** (applyStampLayers changed; every *_FULL sweep applies).

**Built:** P.stlLayers (declared, absent = off, golden hash pinned); STL parse (binary incl. padded, ASCII); welded, versioned,
quantised stored mesh with adjustable Stored detail (down and up while the original is loaded); mesh health measured on the
original (reported only); CPU z-buffer in the scene frame (row j at y = -H/2 + j*dy: LARGER row = up, buildHeightField's own);
the stamp pass (Max / Add, Raised / Carved, Z offset, compress, edge softness) and the one blend/Z branch in applyStampLayers;
the panel (declared in SIDEBAR_TABS, SECTION_THEMES, loading stage 'stl'; copy-on-write; no clamps); the ghost with colour coding
on the pre-stamp surface; a stored mesh in the digests by its content hash.

**Decisions made by the advisor while reviewing (tell Fred):**
- "Depth" (zScale) multiplies the board-vertical height AFTER the rotation, so it stretches what stands up out of the board.
- Carved + Add: -(zOffset + height); Raised unchanged.
- Triangle de-duplication kept in decimate (numeric keys), skipped above 131072 clusters.
- The Stored-detail box ignores a value that is not a number >= 1 (no floor, no clamp).

**Built since (2026-11-22, commits 1fa50c84 .. fab039b6):** the in-viewport gizmo (drag the ghost = X/Y, a vertical arrow = Z,
a ring = turn about Z; only the ghost moves during a drag, ONE commit on release = one undo step + one rebuild; Escape / blur /
second finger cancel; inactive while the STL step is locked, the ghost hidden or sculpt on; a link in the existing pointer chain
after sculpt, before orbit; sizes and pick tolerances in one declared table, STL_GIZMO); the intersection LINE (marching
triangles at rel = 0, drawn in the 'meets' colour); one 'STL stamps' job-timeline step (after Bricks, Back depends on it, the
section lock survives a panel re-render); bug fixes: a truncated stored mesh is refused and named (owner-approved check), an
import finishing during a project load is dropped with a message, compress NaN, the timeline strip refreshes on STL add/remove.
Gate: full vitest 545 files / 7521 tests green; real Chrome: body drag moves X/Y only, arrow drag Z only, Escape and a no-move
click write nothing, a drag off the ghost still orbits, the stamp-only peak sits under the ghost apex, no console errors.

**Built since (2026-11-22, commit ef9e32be):** placement `afterBack`, shown as Stamp > Thicken: "Before thicken" (default,
`withSurface`) / "After thicken". rebuild.js buildHeights stamps the afterBack STL passes LAST and keeps the heights before them
(`backBase`); build-thicken-data.js takes it as `backFrom` and builds the back side (normals, safe map, offset) from it, while the
top side (z bounds, thin / intersect analysis, colours) reads the final heights. A frozen Back lock still wins. No afterBack STL =
today's single call, the same arrays (hash pins in tests/stl-after-back.test.js measured before the change). Gate: full vitest 546
files / 7530 tests green; real Chrome: After thicken leaves the back equal to the STL-off board's (z sum 11133.6335 both) while
the top carries the STL; Before thicken moves the back; no console errors. The Back step's `dependsOn: 'stl'` stays (Back is
snapshotOnLock, its marks are never shown).

**Built since (2026-11-22, Fred: "Follow the terrain" or "Level", branch smithsonian-browser, worker H):** a per-STL option,
Place > "On the terrain": record field `surface: 'follow' | 'level'` (core/stl/layer.js STL_SURFACES, default 'follow'; absent =
follow = the stamp byte-identical to before, hash pins in tests/stl-level-drape.test.js measured before the change). stlPass adds
`surface` and, for Level, `pivot` = the record's position in fractional grid coordinates (fi = (x + W/2) / dx, fj = (y + H/2) / dy,
a larger row = up). applyStampLayers has ONE new branch, for an STL pass with surface 'level' only: base = the bilinear clean
terrain at the pivot, objectH = zOffset + body * |depth| over the covered points:
- Raised + Max: h = max(h, base + objectH)
- Raised + Add: h = base + objectH
- Carved + Max: h = min(h, base - objectH)
- Carved + Add: h = base - objectH

The Level ghost stays rigid at the terrain under its pivot (as every ghost was), and its colours and meet line read each vertex
against the LOCAL terrain: rel = (baseZ + Z + mesh z) - surfaceAt(x, y), so a part over a rise reads buried.
**The draped FOLLOW ghost (each vertex at surfaceAt(x, y) + rel) is NOT built:** it moves two tests on main that pin the rigid
ghost on a non-flat surface (tests/stl-engine-fixes.test.js A1 "the ghost's base height follows the same frame: sampled at its
centre on a surface that rises UP the view" and A11 "a real rebuild hands the preview ghosts sitting on its cleanHeights",
measured by an A/B on 2026-11-22). Waiting on the advisor / Fred: changing those expectations is their call.

**Built since (2026-11-22, Fred's decisions 1, 2 and 6, branch stl-fit-undo, worker J):**
- **Over-stock warning (detection only).** rebuild.js buildHeights, from the heights and passes it already has (no second
  build): per enabled STL, its covered points (isStamped) where the FINAL heights leave the stock, with the sculpt check's own
  bounds (core/sculpt.js checkPreBounds: over = z > P.carveZ, under = z < 0), and the worst overshoot each way
  (core/stl/stock.js stlStockReport; one pass over the points per STL). The panel shows the active STL's one line under Size,
  e.g. "⚠ This STL rises 0.60 in above the stock top (Carve Depth 1.50 in) at 49 points." Nothing is changed, blocked or clamped.
- **Fit to carve depth** (Size): sets the active STL's Depth (zScale) and nothing else, one write + one undo step (the zScale
  control's copy-on-write path). The one rule is core/stl/stock.js fitStlDepth: per covered point, surface(s) = base + sign (Z +
  body H s) (base = the clean terrain under the point for Follow, the bilinear level base under the pivot for Level; Max takes the
  terrain or the surface, whichever is further out), s = the smallest Depth that puts a point AT the bound (Raised: the top,
  Carved: the bottom). It aims 0.00001 in inside the bound (STL_FIT_MARGIN_IN: Float32 heights aimed exactly at it can round a
  hair past and trip the exact warning). No room (the terrain under it, or its Z offset, already reaches the bound): nothing
  changes and the status line says why. The terrain is lastResult.cleanHeights: other stamps under the STL are not counted.
- **The option** P.stlFitOnInsert (DEFAULT false; absent = off; in REBUILD_INERT_KEYS: no build reads it), the checkbox "Fit new
  STLs to the carve depth" at the top of the panel (its id is the key: bindControls binds it the generic way). On: a newly added
  STL (file or library) is fitted once, in the add's own write and undo step, on the surface already built (the clean terrain
  does not depend on the STL); with no surface for the board's grid yet, after the next build.
- **Undo stores the instruction, not the model.** core/history.js keeps each STL mesh ONCE in a content-addressed store (mesh.h
  -> the mesh object); a snapshot holds `{ ref: h }` in its place and undo / redo hand the restore the SAME mesh objects
  (unifiedUndo / unifiedRedo rehydrate before applySnapshot, the only consumer of a snapshot's P). Measured: 40 position-only
  steps hold one mesh; a snapshot is under a quarter of the mesh text. A mesh without h (an old record), or an h naming different
  text (the old collision-prone hash), stays inline. _undoComparable compares meshes by h. Entries no snapshot references are
  dropped when the history drops snapshots. Saved files / sessions / cloud saves are untouched (persistableP: the full mesh).

**Built since (2026-11-22, Fred: yes, worker J): "Lay flat" + quick turns** (Rotate group, STL_ACTIONS, the panel's declared
button list). The Smithsonian pose stays the default at insert: these act only when pressed, one write + one undo step each.
core/stl/orient.js, in rotationMatrix's own convention (R = Rz Ry Rx), every angle wrapped to [-180, 180):
- Lay flat REPLACES the rotation: the principal axes of the decoded stored mesh's SURFACE (exact per-triangle second moments,
  area-weighted); smallest variance -> +Z, largest -> +X, Y = Z x X (det +1). Signs: up = the side the surface reaches further out
  to (area-weighted third moment of the triangle centroids >= 0: a plaque's bump faces up); symmetric: the mesh's own +Z side up;
  +X towards the mesh's own +X; ties: the largest component positive.
- -90 / +90 about the BOARD's X, Y, Z (beside each slider): new = R(axis, d) * R(rotation), Euler angles re-extracted; gimbal
  lock (Y = +-90) is resolved with X = 0 and the whole turn in Z.

**Still not built:** opacity/blend on the other layers and a Layers-panel row for STLs (both outside Fred's "STL stamp only"
scope, section 11.1 / 11.6).

**Gizmo decisions, answered by Fred 2026-11-22 (one question at a time):**
1. Tiny wobbles: **ignored** -- a press that stays within STL_GIZMO.slopPx (3 px mouse, 8 px touch / coarse) moves and commits
   nothing; past it the drag counts from the press point. BUILT.
2. A drag that starts ON the ghost **moves it** (orbit = start off the ghost): kept as built.
3. The ring's commit **wraps rotZ to [-180, 180)** (same orientation). BUILT. A typed value is still stored as typed; a saved
   board is never rewritten.
4. The ghost **slides flat during a drag** and settles on release: kept as built.
Gate: full vitest 546 files / 7533 tests green; real Chrome: a 2 px wobble writes nothing, a 60 px drag moves it, a ring turn
from 170 lands at -158.34 (wrapped) and 138.34, no console errors.

**Known limits:** undo history holds each mesh ONCE (the mesh store above; it held a copy per step, about 0.6 MB per STL at
the default detail, 40 steps, before 2026-11-22); records saved before the hash fix keep the old (collision
prone) hash; core/preview/terrain-mesh.js buildLiveBrushColours uses y = H/2 - j*dy, the opposite of buildHeightField in the same
file. Checked 2026-11-22: NOT a bug -- it flips both the cell and the brush centre, and only their distance is used, so the
highlight lands on the cells the sculpt tool picks (cj = (y + H/2)/dy).


**STL cards (STL-PANEL worker P, Fred 2026-11-22: "STL params are too many for the panel").** Each STL in the list is a CARD: a header
row (enable box, the name = tap to open / close it and make it the active STL, a warning icon when the last build's stock report
says it leaves the stock (title = the message), a row trash = removeStlLayer, one undo step, opens nothing, and a chevron). Only the
OPEN card holds the settings: the ONE `#stlActive` block is moved into it by syncStlPanel (never copied, so every id and handler is
unchanged); one card open at a time. The settings fold in the declared STL_GROUPS (Place open by default; Size, Rotate, Stamp, Detail
closed; Detail = Stored detail, the stored-size / source / mesh-health notes, Re-import), reusing the app's `.panel-sub` + `.collapsed`
fold; the fold state is a per-viewer convenience (localStorage `bspline.stl.groupOpen`), never P. Adding an STL or a gizmo pick
(pickStlLayer, which also scrolls the card into view) opens that card; removing the open STL opens nothing; a loaded project shows
every card closed. Add / Browse, the status and error lines, the fit-on-insert box and the total line stay at the panel level.


## 14. Crop + falloff + Recent (STL-CROP worker R, Fred 2026-11-22, branch stl-crop, nothing pushed)

**Fred's decisions:** A. Crop is a REAL cut ("I don't need to keep the original"): only the kept part is stored (the Stored detail is
spent on it), the cut faces are capped flat; a library model can be downloaded again to re-crop. B. The box is FRACTIONS of the
model's own bounding box, per axis [min, max], in the frame of the mesh that is stored (before the record's rotation), so a box set
on the browser's light preview applies to the full model Insert downloads. C. Two places, ONE mechanism. D. A crop-edge falloff,
a live stamp setting. E. Recent models.

**The mechanism: core/stl/crop.js `cropMesh(mesh, box) -> { mesh, capped, openLoops }`.** `box = { x: [min, max], y, z }` (absent
axis / end = 0 / 1; a plane at 0 or 1 cuts nothing; the full box returns the SAME mesh object). The planes cut one after another:
Sutherland-Hodgman per triangle, the crossing point shared per edge (the result stays welded), a vertex within 1e-7 x the longest
side of a plane is snapped onto it; that plane's cut segments (ends merged within 1e-6 x the side) are chained into loops; each
closed loop is capped: nested loops make a polygon with holes (inside an odd number of loops = a hole of the smallest loop around
it), each hole bridged to its outer loop from its rightmost point to the nearest outer point it can see, then ear-clipped by the
app's ONE ear-clipper and wound to face out of the kept part. A closed mesh stays closed and consistently wound (tests: a cube to
[0.25, 0.75]^3 = a closed half-size cube, volume 1/8; a sphere cut on 3 axes; a hollow sphere = a ring cap). An open mesh leaves
chains that do not close: counted in `openLoops`, never capped, never an error; the panel shows "2 cut edges could not be capped
(the model is open there)". Measured: 358,800 triangles cut on 6 planes in 182 ms (node); the real SMK St. Peter (399,996
triangles) cut to its top 40 % on Insert in about 0.5 s in Chrome.
- The ear-clipper and pointInPolygon moved VERBATIM from core/preview/frame-mesh.js to **core/polygon.js** (no imports);
  frame-mesh.js imports and re-exports them, so the frame trim is unchanged and the crop does not pull the frame preview's modules
  into the heights stage.

**The library sheet (main/stl-library-sheet.js):** a '✂ Crop' button beside the 2D | 3D pill. Pressed: the 3D view loads (as 3D
does) and shows the box: the kept part solid (the model clipped to the box by 6 THREE clipping planes), the cut-away part faint
(the same geometry clipped to outside the box), the box's edges in blue (main/stl-preview-3d.js `setCropBox`, built on first use
only); under the buttons the SIX sliders (X / Y / Z min / max, %) and Reset. The view's soup may be turned for its camera
(SMK's `previewTurn`): the stored frame's box is the view box turned back (exact for quarter turns), and the crop box is drawn
turned the same way, so "Z min 60 %" on a standing SMK relief keeps its top 40 %. Insert with Crop on and a box that cuts calls
`onPick(tile, lib, { crop })` (no crop: `onPick(tile, lib)` exactly as before) and the panel cuts the DOWNLOADED model to it
BEFORE createStlLayer (which now also takes a ready `mesh`). The record gets `crop: { box, bounds (the uncropped model's box),
capped, openLoops }`. A cropped SMK model is laid flat by the WHOLE model's shape (its uncropped pose), not by the kept part's.

**The STL panel (main/stl-panel.js): a 'Crop' group (STL_GROUPS, after Detail)** in each card: the same six sliders
(main/stl-crop-controls.js `renderCropSliders`, one renderer for both places), '✂ Apply crop', 'Reset' (shown only while a box is set
and not applied: Undo takes an Apply back) and a note ("Cropped: X 0-100 %, Y 0-100 %, Z 60-100 % of the original."). Moving a
slider writes nothing: the box is UI state (`_cropPending`), the ghost previews it (`ghostState.cropPreview`: the triangles whose
centre is outside the box are drawn faint as a child of the ghost; core/stl/ghost.js `cutIndices`). Apply = ONE write, ONE undo
step: cut from the in-memory original when present, else from the record's library re-download (its earlier crop applied first),
else from the stored mesh; store the kept part at the layer's Stored detail; keep it as the original; the record's `crop.box` is
re-expressed against the UNCROPPED model's box (a second crop of the kept top half of a top half = z [0.75, 1]); the layer keeps
its place on the board (the kept part's centre shift, scaled and turned like the layer, is added to position x / y; its base rests
again). The Stored-detail re-download cuts the downloaded model by `crop.box` too.

**The falloff (a live stamp setting, record field `cropFalloff`, core/stl/crop.js STL_CROP_FALLOFF_DEFAULTS):** `{ widthIn: 0 (off),
profile: 'smooth', customCurve: null, edges: { left, right, front, back, bottom } (all true) }`. Applied in core/stl/layer.js passBody
after compress, before the softness blur; the body cache key carries it ONLY when it is on, so an absent / width 0 / no-edge
falloff is byte-identical to before (pinned in tests/stl-crop-falloff.test.js). For each enabled side edge of the stamped footprint
(the PLACED mesh's board-XY box: left = -X, right = +X, front = -Y, back = +Y) the weight is the height brush's own curve,
`brushFalloff(t, 1, 0, profile, curveFromPoints(customCurve))` (core/height/brush.js, read-only), t = 1 - distance inside / widthIn
kept in 0..1; 'bottom' uses the point's height above the model's lowest point as the distance (a figure rises out of the board);
the weights multiply. Panel: Falloff width (in), the profile choice (the brush's six built-in labels; 'Custom' waits for the
shared curve widget: main/height-panel.js does not export one and belongs to another worker), five edge boxes
(STL_CROP_EDGE_BOXES, from STL_CROP_EDGES). The record's `customCurve` already works in the pass (tested).

**Recent (core/stl/recent.js):** the FIRST choice of the Library picker, listed only when something is in it (All libraries stays
the default). Library models: per device (localStorage `bspline.stl.recent`, every read / write in try / catch; never P), newest
first, the latest 30 kept (a display list), each `{ libraryId, modelId, title, thumbUrl, previewUrl, tile (the library's tile: its
file url(s)), crop, insertedAt }`; re-inserting moves the entry to the top. Selecting one shows the usual pane with Crop on and the
remembered box; Insert re-downloads through the library's own path and re-applies the crop (tested: the same stored mesh hash).
Own STL files: listed while their original is in memory this session (not persisted), as the declared LOCAL_LIBRARY whose
LIBRARY_OPS.local 'download' is the in-memory mesh (no network); re-adding one replaces its entry.

**Not built / known:** handles on the crop box (sliders first, Fred's precedent); the pane cannot say how many cut edges stay open
before Insert (the preview is not cut; the panel status line says it after Insert); the ghost's faint part is drawn by whole
triangles (centroid inside the box), the real cut is exact; a Smithsonian model whose small preview has fewer parts than the full
download would be cropped against the full model's box.

**Browser check (2026-11-22, headless Chrome, desktop 1400 x 900 and 390 px):** SMK, Type Relief, KAS2906/8 (Plaster Cast of St.
Peter): Crop, Z min 60 %, Insert: origTris 172,688 of the full 399,996 (stored 49,958 at the default 50k detail; uncropped 49,915),
1 cap, 0 open loops, the stored mesh closed (0 open edges); Recent listed first, its tile back with Crop on and Z min 60; the
falloff (0.5 in, Dome, left + right) written as `{ widthIn: 0.5, profile: 'dome', edges: { front: false, back: false, bottom: false } }`;
no console errors.

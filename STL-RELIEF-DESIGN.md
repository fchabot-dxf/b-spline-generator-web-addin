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

**Still not built:** placement `afterBack` (field declared, `withSurface` only); opacity/blend on the other layers; a
Layers-panel row for STLs.

**Gizmo decisions for Fred (left as they are, nothing added):** no tap slop (a 1 px jitter on a tap commits a tiny move; a
threshold would be a new guard); a drag that starts ON the ghost moves it instead of orbiting (orbit by starting off the ghost,
or hide / lock it); rotation is not wrapped to +-180 (the box shows the true value); the ghost moves rigidly during a drag and
re-seats on the surface after the rebuild (a small hop on a curved board).

**Known limits:** undo history holds a copy
of each mesh (about 0.6 MB per STL at the default detail, 40 steps); records saved before the hash fix keep the old (collision
prone) hash; core/preview/terrain-mesh.js buildLiveBrushColours uses y = H/2 - j*dy, the opposite of buildHeightField in the same
file. Checked 2026-11-22: NOT a bug -- it flips both the cell and the brush centre, and only their distance is used, so the
highlight lands on the cells the sculpt tool picks (cj = (y + H/2)/dy).


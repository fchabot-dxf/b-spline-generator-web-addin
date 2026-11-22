# TERRAIN-FLAT: Terrain Shape / Terrain Texture, a Flat switch in each

Fred's decisions, 2026-11-22. Branch `terrain-flat` (worker Q).

## 1. Two panels, renamed and reorganised (labels only)

The section ids stay `skeleton` / `filter` (`panel-skeleton` / `panel-filter`, the job-timeline steps, saved state). Every
control keeps its id, P key, range and behaviour.

| Panel | Was | Controls, in order |
|---|---|---|
| ⛰️ TERRAIN SHAPE (the big forms) | 🦴 SKELETON | Flat (no hills) *(new)*, Surface height (in) *(new)*, Region Scale, Peak Shape, Density, Clustering, Map: Map Zoom + Pan X / Pan Y (was Offset X/Y (screens)), Symmetry + Offset X/Y, Flat Border, Smoothing Intensity / Radius / Respects Symmetry |
| 🎨 TERRAIN TEXTURE (the grain) | 🎨 FILTER | Flat (no texture) (the existing `#isolateSkeleton`, relabelled), Noise Type, Fine Scale, Detail Coverage, Empty Zone Detail, Detail Respects Symmetry, Edit Filter |

## 2. A Flat switch per layer

- **Flat (no hills)**: `P.shapeFlat` (DEFAULT false) + `P.surfaceHeightIn` (DEFAULT 0, inches). The slider travels
  0..carveZ. A typed value is stored as typed, with no clamp.
- **Flat (no texture)**: `P.isolateSkeleton`. Its meaning has not changed.

Formula (`core/terrain.js generateHeightmap`; LOW = 0.22, the valley share of the fine value):

```
shapeFlat off (absent = every saved board):  h = lerp(fine * LOW, PEAK_BASE + fine * PEAK_RNG, coarse)   -- unchanged
shapeFlat on:                                height = surfaceHeightIn + max(0, g * edgeFade) * carveZ
                                             g = isolateSkeleton ? 0 : fine * LOW
```

- The texture rises from the surface at its valley amplitude, so the grain spans at most LOW * carveZ.
- **Flat Border (edgeFade)** fades only the grain toward the surface height. The board edge is exactly the surface height.
- **Pass 3 smoothing** smooths the result. A constant field box-filters to itself bit for bit, so an exactly flat board
  stays exactly flat.
- **Both Flat switches on**: every height is exactly `surfaceHeightIn`, stored as float32 (`Math.fround`). This holds
  before any stamp or sculpt.
- Saved boards do not change: a board without `shapeFlat` lays byte-identically. `tests/terrain-flat.test.js` pins 3 real
  parameter sets × {absent, false, false + surface 0.4}, measured on 18af1d97. No migration is needed, because absent
  reads as the DEFAULT (false). Both keys are heights inputs, so they are in both digests.

While Flat (no hills) is on, the Shape rows it no longer reads are greyed but still shown and editable. Those rows are
`main/terrain-shape-flat.js SHAPE_FLAT_ROWS` with the photo section's greyed style:
- Region Scale
- Peak Shape
- Density
- Clustering

This list was measured: on the real heightmap, each Shape key was moved alone, and these were the only keys that changed
nothing. Map Zoom, Pan, Symmetry and its offsets, Flat Border and Smoothing still shape the grain, so they stay live. The
Surface height row greys while the switch is off.

## 3. Job-timeline locks: unchanged for every moved control

The lock is computed by the app's own rule, `core/ui-utils.js setSectionReadOnly` (the nearest `[data-job-lock]` wins).
The table compares 18af1d97's markup with the new markup:

| Control (+ its slider) | Step before | Step after | How |
|---|---|---|---|
| Region Scale (macroScale) | filter | filter | own `data-job-lock="filter"` wrapper in Shape |
| Map Zoom (mapZoom) | filter | filter | own `data-job-lock="filter"` wrapper in Shape |
| Pan X / Y (seedOffsetX/Y) | seed | seed | its `data-job-lock="seed"` div, moved whole |
| Peak Shape, Density, Clustering, Symmetry, Offset X/Y, Flat Border, Smoothing ×3 | skeleton | skeleton | the Shape panel body |
| Flat (no texture), Noise Type, Fine Scale, Detail Coverage, Empty Zone Detail, Detail Respects Symmetry, Edit Filter reset | filter | filter | the Texture panel body |
| Flat (no hills), Surface height *(new)* | (none) | skeleton | the Shape panel body |

The Seed step now opens `panel-skeleton`, where its Pan X / Y sit.

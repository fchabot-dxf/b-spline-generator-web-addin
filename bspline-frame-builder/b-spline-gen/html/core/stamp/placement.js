/**
 * core/stamp/placement.js -- the ONE "Thicken" placement table every stamp source reads (Fred 2026-11-23: vector layers and
 * bricks get the placement STLs and height patches already had -- "in case I want to carve instead of raise").
 *
 *   'withSurface' ("Before thicken", the default = every board saved before the field existed): the stamp is part of the
 *                 heights the back is thickened from -- the back follows it.
 *   'afterBack'   ("After thicken"): the stamp is added to the TOP only; the back is thickened from the heights without it
 *                 (core/engine/rebuild.js buildHeights backBase -> core/engine/build-thicken-data.js backFrom).
 *
 * Where it is stored: an STL / height patch record's `placement` (core/stl/layer.js, core/height/layer.js), an editor
 * layer's `placement` (its art pass; saved with the layer, editor/editor-io.js), P.brickSettings.placement (the brick
 * passes). An absent / unknown value reads as 'withSurface' (placementOf); nothing here writes a record (AGENTS.md rule 3).
 * The vector / brick choice has no panel control yet (the panel-card design comes separately).
 */
export const STAMP_PLACEMENTS = Object.freeze(['withSurface', 'afterBack']);
export const STAMP_PLACEMENT_DEFAULT = 'withSurface';

/** A stored placement value as the engine reads it: 'afterBack' or 'withSurface' (absent / unknown). */
export const placementOf = (v) => (STAMP_PLACEMENTS.includes(v) ? v : STAMP_PLACEMENT_DEFAULT);

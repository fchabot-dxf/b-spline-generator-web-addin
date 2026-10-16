/**
 * Brick COLOUR ROLES (Fred 2026-10-14 plan, seat A): paint only -- a role picks a piece's colour in the 2D view, the 3D
 * drape and the SVG download, never its geometry or its height (the carve, the height mask and Send's bytes stay
 * identical: the role is an editor-only attribute, layers.js BRICK_EDITOR_ONLY_ATTRS).
 *
 * A piece's role comes from the engine's OWN tags, never from its looks:
 *   motif   a frame / arch piece with a raised or recessed relief (band-motif.js tags `relief`; the arch's hood keeps
 *           its motif's) -- a WALL's relief (a recessed inner panel) is the field's, not a motif
 *   stone   an arch's stone part (keystone, springer, sill block)
 *   accent  a piece the accent pattern marked (the engine's cut mark, brick-accents.js)
 *   field   everything else
 *   grout   the joint (its own shape node, not a brick)
 * A tag the engine does not give yet (a quoin block) reads as field until it does -- add it here, nowhere else.
 */
export const BRICK_COLOUR_ROLES = Object.freeze(['field', 'motif', 'accent', 'stone', 'grout']);
export const BRICK_ROLE_ATTR = 'data-brick-role';
export const STONE_PARTS = Object.freeze(['keystone', 'springer', 'sillBlock']);
export const MOTIF_RELIEFS = Object.freeze(['raised', 'recessed']);

/** The role of one laid piece of element `kind` ('wall' | 'frame' | 'brush'). */
export function brickRoleOf(brick, kind) {
  if (!brick) return 'field';
  if (STONE_PARTS.includes(brick.part)) return 'stone';
  if (kind !== 'wall' && MOTIF_RELIEFS.includes(brick.relief)) return 'motif';
  if (brick.accentMarked === true) return 'accent';
  return 'field';
}

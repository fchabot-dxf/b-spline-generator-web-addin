/**
 * core/pull-map.js -- PULL_MAP (job-timeline-adjacent Pull from Fusion, step (b); seat D 2026-10-16; advisor 45,
 * Fred): Fusion param -> app setting, declared once. core/pull-changelist.js reads this table to diff a Pull
 * response's `boardParams` (b-spline-gen.py _handle_pull_sketch, board-prefix already stripped) against the app's
 * own current values -- one declared table, not scattered per-field logic, same shape as main/send-targets.js's
 * own SEND_TARGETS.
 *
 * v1 = board size + node diameter + rail/tie/stroke width + frame settings (Fred's must-work list, 2026-10-16).
 * lattice_spacing (the grid step) and rail_spacing (rail-to-rail) are NOT pulled -- Fred: rails move freely in
 * Fusion now, no driving param; their new positions come back as GEOMETRY, locked, not a PULL_MAP row (a separate
 * mechanism -- see the rails-lock slice of this same step).
 *
 *   fusionParam -- the base Fusion param name. 'rail_width'/'tie_width' also match a Fusion design's 'stroke_width'
 *                  (rails+ties linked, Send's own default) -- core/pull-changelist.js's normalizeLayerParams folds
 *                  stroke_width into both before this table is read, so this table itself stays a flat 1:1 map.
 *   scope       -- 'board' (P itself) | 'layer' (one lattice layer's own pattern) | 'frame' (P.frame)
 *   appPath     -- a dot path INTO that scope's object (core/pull-changelist.js's own getPath/setPath)
 *   label, unit -- the change-list row's own text
 */
export const PULL_MAP = Object.freeze([
  Object.freeze({ fusionParam: 'widthIn', scope: 'board', appPath: 'widthIn', label: 'Width', unit: 'in' }),
  Object.freeze({ fusionParam: 'heightIn', scope: 'board', appPath: 'heightIn', label: 'Height', unit: 'in' }),

  Object.freeze({ fusionParam: 'node_diameter', scope: 'layer', appPath: 'widths.nodeDiameter', label: 'Node diameter', unit: 'in' }),
  Object.freeze({ fusionParam: 'rail_width', scope: 'layer', appPath: 'widths.rails', label: 'Rail width', unit: 'in' }),
  Object.freeze({ fusionParam: 'tie_width', scope: 'layer', appPath: 'widths.ties', label: 'Tie width', unit: 'in' }),

  Object.freeze({ fusionParam: 'frame_thickness', scope: 'frame', appPath: 'params.frame_thickness', label: 'Frame thickness', unit: 'in' }),
  Object.freeze({ fusionParam: 'boundingboxoffset', scope: 'frame', appPath: 'params.boundingboxoffset', label: 'Trim offset', unit: 'in' }),
  Object.freeze({ fusionParam: 'panel_lip', scope: 'frame', appPath: 'panelLip', label: 'Panel lip', unit: 'in' }),
  Object.freeze({ fusionParam: 'frame_height_offset', scope: 'frame', appPath: 'frameBottomZ', label: 'Frame height offset', unit: 'in' }),
]);

/** The STROKE_WIDTH-linked pair: when Fusion holds BOTH rail_width and tie_width, that's two independent PULL_MAP
 *  rows already; when it holds stroke_width instead (rails+ties linked), core/pull-changelist.js's
 *  normalizeLayerParams folds it into both before diffing -- declared here so that fold isn't a hand-rolled
 *  one-off inside the diff function. */
export const LINKED_WIDTH_PAIR = Object.freeze(['rail_width', 'tie_width']);

def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline (Template 12 - Hourglass - Tapered sides).

    Same 12 pieces, ids, order and topology as Template 1's p02_03_loop; only the TOP differs: the top horns lean
    by taperAngle degrees from vertical instead of running straight up (F30 item 3, Fred's own taper copies), so
    the top edge is narrower than the base and the shoulder arc's own horn-facing end moves to the new tangent
    point. The shoulder arc's CENTRE and the waist/hip below it are untouched (editor-shape-lattice-generator.js's
    own `_taperedCorner`, Branch A: the default 8 deg taper never needs to inset the shoulder circle -- see its
    own doc comment).

    Template 1 pins both horns Vertical and both top_edge ends to the safe-zone top corners. Template 12 instead:
      - keeps horn_BR/horn_BL (and bottom_edge) EXACTLY Template 1's own mechanism (Vertical, corner-pinned);
      - drops horn_TR/horn_TL from the Vertical targets (a slanted line has no such constraint) and, like
        Template 3's own top (which reuses Template 2's pattern), rides top_edge on the safe-zone top line via
        Horizontal + Coincident(top_edge:S, proj_off_BB_top) instead of pinning both ends to the two top corners
        -- its width (and the horns' own slant) comes from the seeds below, left/right tied by p02_11's own Equal
        on the two shoulder arcs.

    Seeds: the 7x9 board's own SAFE ZONE (6.5x8.5 at the default 0.25in border) solve of the app's provisional
    Template 12 shape at its own default taperAngle (8 deg) -- paramsFromShapeModel('hourglass', Template 1's
    shapeModel, the safe zone) through hourglassConstruction -- with each absolute value then expressed as a
    fraction of the RAW board size (fb_engine/seed_basis.py's own "seed board" convention: a literal f means
    f * widthIn, chosen so that AT THE DEFAULT boundingboxoffset it equals the safe-zone-based value; Template
    3's own p02_02_anatomy doc comment has the same worked example -- getting this wrong the first time around
    produced a visibly wrong, drifted shape live in Fusion, caught by inspecting the solved arc centres).
    The waist/hip arcs below are IDENTICAL to a plain Template 1 solve at this same board (untouched by taper),
    cross-checked against Template 3's own shipped hip/waist anatomy pins (p02_02_anatomy.py), which share the
    same T1 fit and the same "untouched by its own feature" relationship.
    """
    seq = [
        # 1. Rails. Top: narrower (tapered), rides on the safe-zone top line (below). Bottom: Template 1's corner-anchored rail.
        {'ID': 'top_edge', 'Type': 'Line', 'Points': [['-widthIn * 0.405324', 'heightIn * 0.472222'], ['widthIn * 0.405324', 'heightIn * 0.472222']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Horns. Top: slanted (taperAngle from vertical) -- from the narrow top edge's own ends down to the
        # shoulder arc's new (tapered) tangent point. Bottom: Template 1's own vertical horns, unchanged (the
        # :E end is the hip arc's own tangent point -- the safe-zone edge, widthIn * 0.464286, T2's own identical
        # bottom-corner fraction, NOT the loose widthIn/2 the :S end still uses).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn * 0.405324', 'heightIn * 0.472222'], ['widthIn * 0.463419', 'heightIn * 0.150714']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn * 0.405324', 'heightIn * 0.472222'], ['-widthIn * 0.463419', 'heightIn * 0.150714']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_BR', 'horn_BL']},

        # 3. Corner topology.
        # TOP (F30 item 3, Template 3/2's own pattern): the top edge horizontal, its start ON the projected
        # safe-zone top line (not a fixed corner) -- its width (and the horns' own slant) is left to the seeds.
        {'Type': 'Horizontal', 'Targets': ['top_edge']},
        {'Type': 'Coincident', 'Targets': ['top_edge:S', 'proj_off_BB_top']},
        # BOTTOM: exactly Template 1's (both ends on the projected safe-zone corners).
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},

        # 4. Arc seeds, [Start, on-arc midpoint, End] in the same point order as Template 1's (Fusion's Arc3Point
        # takes three points ON the arc). Right side X-mirrors the left.
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.394553', 'heightIn * 0.073473'], ['widthIn * 0.448415', 'heightIn * 0.101615'], ['widthIn * 0.463419', 'heightIn * 0.150714']], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn * 0.06925', 'Name': 'seed_rad_shoulder_R'},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.394553', 'heightIn * 0.073473'], ['widthIn * 0.318452', '-heightIn * 0.000304'], ['widthIn * 0.394553', '-heightIn * 0.074081']], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R', 'Expression': 'heightIn * 0.075575', 'Name': 'seed_rad_waist_R'},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.464286', '-heightIn * 0.141685'], ['widthIn * 0.444698', '-heightIn * 0.098349'], ['widthIn * 0.394553', '-heightIn * 0.074081']], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R', 'Expression': 'heightIn * 0.06925', 'Name': 'seed_rad_hip_R'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.394553', '-heightIn * 0.074081'], ['-widthIn * 0.444698', '-heightIn * 0.098349'], ['-widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': 'heightIn * 0.06925', 'Name': 'seed_rad_hip_L'},
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.394553', '-heightIn * 0.074081'], ['-widthIn * 0.318452', '-heightIn * 0.000304'], ['-widthIn * 0.394553', 'heightIn * 0.073473']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': 'heightIn * 0.075575', 'Name': 'seed_rad_waist_L'},
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.463419', 'heightIn * 0.150714'], ['-widthIn * 0.448415', 'heightIn * 0.101615'], ['-widthIn * 0.394553', 'heightIn * 0.073473']], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn * 0.06925', 'Name': 'seed_rad_shoulder_L'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }

def get_block(ui_data=None):
    """
    Silhouette Loop: 16-segment clockwise frame outline (Template 5 -
    Hourglass Dipped Top).

    Template 1's 12 pieces, ids and topology, except the TOP: its one flat
    top_edge becomes five pieces, clockwise from the top-left corner,
      top_edge_L          straight stub from the TL corner (horizontal)
      arc_top_shoulder_L  convex shoulder arc, tangent to the stub
      arc_top_dip         concave dip arc (its centre on the Y axis, p02_06)
      arc_top_shoulder_R  convex shoulder arc
      top_edge_R          straight stub into the TR corner (horizontal)
    built like a side waist (shoulder, waist, hip): arcs chained (p02_04),
    tangent to each other (p02_07) and to the stubs (p02_08). The corners
    stay square: each stub starts ON its projected safe-zone corner, with
    the horn on the other leg, so the four mitered bars keep clean 45 deg
    miters. The base and the sides are Template 1's, seeds included.

    DOF of the top (the corners fixed): 2 lines + 3 arcs = 23; the two corner
    Coincidents (4), two Horizontals (2), four joint Coincidents (8) and four
    Tangents (4) leave 5 (each stub's length, the three radii). The dip
    centre on the Y axis (p02_06) and Equal on the two shoulders (p02_11)
    make it symmetric (then the stubs come out equal too), leaving 3
    free values -- the stub length, the shoulder radius and the dip radius --
    set by the seeds, as Template 1 leaves its radii to its seeds. No
    constraint repeats another (the Horizontals hold the free stub ends, the
    top corners are only pinned once each).

    Seeds (T5 top): the 7x9 solve of the app's provisional Template 5 shape
    (a 0.14 hh deep dip, 0.72 hw half wide, all three arcs one radius:
    frame-defs shapeModel), as widthIn / heightIn fractions, so the seeded
    top is already tangent and closed at the seed board. The stubs' corner
    ends keep Template 1's loose 0.001 nudge off the projected corners.

    Geometry seeds use pure widthIn / heightIn expressions only.
    The BB rails and horn-corner endpoints sit at the BB edge minus
    a 0.001 nudge; the actual safe-zone inset is applied later by
    the Coincident constraints to ``proj_off_corner_*`` (which come
    from the offset-BB phase in sketch 1). The seed is just an
    approximate starting position for the solver - the constraint
    pulls it to the exact projected corner.

    Loose seeds (0.001 off-target at corner endpoints) avoid Fusion
    auto-coincidence before the explicit Coincident constraints chain
    each piece into the closed loop. The 0.001 nudge is baked into
    the expression rather than added as a separate term.

    Loop direction: clockwise.
      Right side flows top -> bottom (shoulder -> waist -> hip).
      Left  side flows bottom -> top (hip -> waist -> shoulder).

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    Downstream (welds, encl_projs, encl_welds, encl_offset, miters)
    chains end-of-N to start-of-N+1 around the closed loop.
    """
    seq = [
        # 1. Rails. Top (T5): the two straight stubs of the dipped top, each from its corner (loose-seeded 0.001
        # off-target there, as Template 1's top_edge) to where its shoulder arc starts. Bottom: Template 1's.
        {'ID': 'top_edge_L', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], ['-widthIn * 0.334286', 'heightIn * 0.472222']], 'StartID': 'top_edge_L:S', 'EndID': 'top_edge_L:E'},
        {'ID': 'top_edge_R', 'Type': 'Line', 'Points': [['widthIn * 0.334286', 'heightIn * 0.472222'], ['widthIn/2 - 0.001', 'heightIn/2 - 0.001']], 'StartID': 'top_edge_R:S', 'EndID': 'top_edge_R:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns (loose-seeded 0.001 off-target at the BB-corner end).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', 'heightIn/2 - 0.001'], ['widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. Corner topology: anchor BB-rail endpoints to projected corners, then horns to BB-rail endpoints.
        # T5: each top stub has ONE end on its corner (TL = top_edge_L:S, TR = top_edge_R:E) and lies flat.
        {'Type': 'Coincident', 'Targets': ['top_edge_L:S', 'proj_off_corner_TL']},
        {'Type': 'Coincident', 'Targets': ['top_edge_R:E', 'proj_off_corner_TR']},
        {'Type': 'Horizontal', 'Targets': ['top_edge_L', 'top_edge_R']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge_L:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge_R:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},

        # 4. Arc seeds. Points are [Start, Bulge, End] in arc-traversal
        # order - Bulge is the real arc midpoint (a point ON the arc),
        # NOT the center of curvature. Coordinates come from the inspector
        # output in S -> B -> E -> C order; the first three feed directly
        # into Fusion's addByThreePoints. The center (C) is implicit in
        # the geometry (the unique circle through S, B, E) and not stored
        # here. Right side X-mirrors the left; because B is on the arc
        # (not on the opposite side from where it bulges), simple X
        # negation produces an outward-bulging arc on both sides.
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.476432', 'heightIn * 0.15042'], ['widthIn * 0.452856', 'heightIn * 0.099912'], ['widthIn * 0.395939', 'heightIn * 0.078992']], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_R'},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.395939', '-heightIn * 0.071429'], ['widthIn * 0.315446', '0'], ['widthIn * 0.395939', 'heightIn * 0.071429']], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_R'},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.395939', '-heightIn * 0.079718'], ['widthIn * 0.452856', '-heightIn * 0.100638'], ['widthIn * 0.476432', '-heightIn * 0.151146']], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_R'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.395939', '-heightIn * 0.079718'], ['-widthIn * 0.452856', '-heightIn * 0.100638'], ['-widthIn * 0.476432', '-heightIn * 0.151146']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_L'},
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.395939', '-heightIn * 0.071429'], ['-widthIn * 0.315446', '0'], ['-widthIn * 0.395939', 'heightIn * 0.071429']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_L'},
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.476432', 'heightIn * 0.15042'], ['-widthIn * 0.452856', 'heightIn * 0.099912'], ['-widthIn * 0.395939', 'heightIn * 0.078992']], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_L'},

        # 5. T5: the dipped top's three arcs, left to right ([start, on-arc midpoint, end], Fusion's Arc3Point takes
        # three points ON the arc; Fusion orders every arc counter-clockwise itself: arc_top_shoulder_L:S is its
        # DIP end, arc_top_dip:S its left end, arc_top_shoulder_R:S its STUB end, see p02_04 / p02_05). One seed
        # radius each (heightIn * 0.272158 = 2.449 in at 9 in, the shared radius of the 7x9 solve), deleted in
        # p02_09 like Template 1's. The dip's midpoint sits 0.001 off the Y axis (Template 1's anti-auto-
        # coincidence nudge): its centre is put ON the axis explicitly (p02_06).
        {'ID': 'arc_top_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.334286', 'heightIn * 0.472222'], ['-widthIn * 0.248055', 'heightIn * 0.463829'], ['-widthIn * 0.167143', 'heightIn * 0.439167']], 'StartID': 'arc_top_shoulder_L:S', 'EndID': 'arc_top_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_top_shoulder_L', 'Expression': 'heightIn * 0.272158', 'Name': 'seed_rad_top_shoulder_L'},
        {'ID': 'arc_top_dip', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.167143', 'heightIn * 0.439167'], ['0.001', 'heightIn * 0.406111'], ['widthIn * 0.167143', 'heightIn * 0.439167']], 'StartID': 'arc_top_dip:S', 'EndID': 'arc_top_dip:E'},
        {'Type': 'Radius', 'Target': 'arc_top_dip', 'Expression': 'heightIn * 0.272158', 'Name': 'seed_rad_top_dip'},
        {'ID': 'arc_top_shoulder_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.167143', 'heightIn * 0.439167'], ['widthIn * 0.248055', 'heightIn * 0.463829'], ['widthIn * 0.334286', 'heightIn * 0.472222']], 'StartID': 'arc_top_shoulder_R:S', 'EndID': 'arc_top_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_top_shoulder_R', 'Expression': 'heightIn * 0.272158', 'Name': 'seed_rad_top_shoulder_R'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }

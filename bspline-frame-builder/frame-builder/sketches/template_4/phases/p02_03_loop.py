def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline (Template 4 -
    Offset Hourglass).

    Same 12 pieces, ids, order, topology and constraints as Template 1's
    p02_03_loop (the top and base full width, all four corners pinned to the
    projected safe-zone corners); only the SEEDS differ: the left waist
    pinch sits high and the right one low. The pinch heights are held by
    their own skeleton pins (p02_02: no L/R merge), the radii tied L/R by
    p02_11 (Equal on the arc pairs).

    Seeds (T4): the horn ends and the six arcs are the 7x9 solve of the
    app's provisional Template 4 shape (the Template 1 model, the right
    waist centre 0.2 hh down and the left one 0.2 hh up; frame-defs
    shapeModel), written as widthIn / heightIn fractions, so the seeded
    loop is already tangent and closed at the seed board. The rails and
    the horns' corner ends keep Template 1's loose 0.001 nudge (below).

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
        # 1. Bounding-box rails (anchored to projected BB corners; loose-seeded 0.001 off-target).
        {'ID': 'top_edge', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], ['widthIn/2 - 0.001', 'heightIn/2 - 0.001']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns (loose-seeded 0.001 off-target at the BB-corner end).
        # T4: each horn's arc end at its own side's height (right pinch low, left pinch high).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', 'heightIn/2 - 0.001'], ['widthIn * 0.464286', 'heightIn * 0.046632']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn * 0.464286', '-heightIn * 0.236129']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], ['-widthIn * 0.464286', 'heightIn * 0.235521']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn * 0.464286', '-heightIn * 0.04724']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. Corner topology: anchor BB-rail endpoints to projected corners, then horns to BB-rail endpoints.
        {'Type': 'Coincident', 'Targets': ['top_edge:S', 'proj_off_corner_TL']},
        {'Type': 'Coincident', 'Targets': ['top_edge:E', 'proj_off_corner_TR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},

        # 4. Arc seeds (T4: the offset 7x9 solve, see above; the right and left sides no longer mirror).
        # Points are [Start, Bulge, End] in arc-traversal
        # order - Bulge is the real arc midpoint (a point ON the arc),
        # NOT the center of curvature. Coordinates come from the inspector
        # output in S -> B -> E -> C order; the first three feed directly
        # into Fusion's addByThreePoints. The center (C) is implicit in
        # the geometry (the unique circle through S, B, E) and not stored
        # here. Right side X-mirrors the left; because B is on the arc
        # (not on the opposite side from where it bulges), simple X
        # negation produces an outward-bulging arc on both sides.
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.464286', 'heightIn * 0.046632'], ['widthIn * 0.444698', 'heightIn * 0.003297'], ['widthIn * 0.394553', '-heightIn * 0.020971']], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_R'},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.394553', '-heightIn * 0.168526'], ['widthIn * 0.318452', '-heightIn * 0.094749'], ['widthIn * 0.394553', '-heightIn * 0.020971']], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_R'},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.394553', '-heightIn * 0.168526'], ['widthIn * 0.444698', '-heightIn * 0.192794'], ['widthIn * 0.464286', '-heightIn * 0.236129']], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_R'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.394553', 'heightIn * 0.020363'], ['-widthIn * 0.444698', '-heightIn * 0.003905'], ['-widthIn * 0.464286', '-heightIn * 0.04724']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_L'},
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.394553', 'heightIn * 0.020363'], ['-widthIn * 0.318452', 'heightIn * 0.09414'], ['-widthIn * 0.394553', 'heightIn * 0.167918']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_L'},
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.464286', 'heightIn * 0.235521'], ['-widthIn * 0.444698', 'heightIn * 0.192186'], ['-widthIn * 0.394553', 'heightIn * 0.167918']], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_L'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }

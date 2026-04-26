def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline.

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
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', 'heightIn/2 - 0.001'], ['widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn/2 - 0.001'], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

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
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }

def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline (Template 3 -
    Tapered Hourglass).

    Same 12 pieces, ids, order and topology as Template 1's p02_03_loop;
    only the TOP differs: the top edge is narrower than the base.

    Template 1 pins both top_edge ends to the safe-zone top corners
    (proj_off_corner_TL / TR), which forces the top exactly as wide as the
    bottom. Template 3 instead uses Template 2's proven narrow-top pattern:
      Horizontal(top_edge) + Coincident(top_edge:S, proj_off_BB_top)
    so the top edge rides on the safe zone's top line and its width is set
    by the seeds (and, from the app, by the Frame tab's "Top width" handle,
    which moves these same seeds: FRAME_SEED_MAP). Left/right symmetry of
    the top comes from p02_11 (Equal on the two shoulder arcs). The bottom
    corners are pinned exactly as in Template 1.

    Seeds: the 7x9 solve of the app's provisional Template 3 shape (the
    Template 1 model with the top horns ~0.23 hw in; frame-defs
    shapeModel), written as widthIn / heightIn fractions, so the seeded
    loop is already tangent and closed at the seed board. The bottom
    rail and bottom-horn corner ends keep Template 1's loose 0.001 nudge
    off the projected corners (no auto-coincidence before the explicit
    Coincident). The top rail sits just under the safe-zone top line
    (heightIn * 0.47 vs 0.472222 at 9 in), like Template 2's top seed,
    for the same reason.

    Loop direction: clockwise.
      Right side flows top -> bottom (shoulder -> waist -> hip).
      Left  side flows bottom -> top (hip -> waist -> shoulder).

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    seq = [
        # 1. Rails. Top: narrow, rides on the safe-zone top line (below). Bottom: Template 1's corner-anchored rail.
        {'ID': 'top_edge', 'Type': 'Line', 'Points': [['-widthIn * 0.358984', 'heightIn * 0.47'], ['widthIn * 0.358984', 'heightIn * 0.47']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns. Top horns start at the narrow top edge's ends; bottom horns at the nudged corners.
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn * 0.358984', 'heightIn * 0.47'], ['widthIn * 0.358984', 'heightIn * 0.089903']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn * 0.358984', 'heightIn * 0.47'], ['-widthIn * 0.358984', 'heightIn * 0.089903']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. Corner topology.
        # TOP (T3): Template 2's pattern -- the top edge horizontal, its start ON the projected safe-zone top line.
        # Its width is left to the seeds; p02_11 ties left to right.
        {'Type': 'Horizontal', 'Targets': ['top_edge']},
        {'Type': 'Coincident', 'Targets': ['top_edge:S', 'proj_off_BB_top']},
        # BOTTOM: exactly Template 1's (both ends on the projected safe-zone corners).
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},

        # 4. Arc seeds, [Start, on-arc midpoint, End] in the same point order as Template 1's
        # (Fusion's Arc3Point takes three points ON the arc). Right side X-mirrors the left.
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.358984', 'heightIn * 0.089903'], ['widthIn * 0.353999', 'heightIn * 0.067057'], ['widthIn * 0.339603', 'heightIn * 0.046769']], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_R'},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.394553', '-heightIn * 0.074081'], ['widthIn * 0.324012', '-heightIn * 0.025502'], ['widthIn * 0.339603', 'heightIn * 0.046769']], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_R'},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.394553', '-heightIn * 0.074081'], ['widthIn * 0.444698', '-heightIn * 0.098349'], ['widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_R'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.394553', '-heightIn * 0.074081'], ['-widthIn * 0.444698', '-heightIn * 0.098349'], ['-widthIn * 0.464286', '-heightIn * 0.141685']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_L'},
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.394553', '-heightIn * 0.074081'], ['-widthIn * 0.324012', '-heightIn * 0.025502'], ['-widthIn * 0.339603', 'heightIn * 0.046769']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_L'},
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.358984', 'heightIn * 0.089903'], ['-widthIn * 0.353999', 'heightIn * 0.067057'], ['-widthIn * 0.339603', 'heightIn * 0.046769']], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_L'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }

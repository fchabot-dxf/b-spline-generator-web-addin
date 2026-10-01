def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline (Template 10 - Arched Hourglass).

    Template 1's own 12 pieces and topology, except the TOP: the one flat top_edge becomes ONE ARC spanning the
    full width (chord = the top horns' own x, same span Template 1's flat top already had), its apex touching
    the safe zone's own top line, its own two ends pulled DOWN into the board -- eating into the top horns' own
    length, never adding height above them (the advisor's own correction, confirmed against Fred's sketch and
    the 7x9 preview he approved: "looks perfect"). Unlike Template 5's dip (stub, shoulder arc, dip arc, shoulder
    arc, stub -- 5 pieces, both ends staying square ON the real board corners), this is the SIMPLEST possible top:
    one piece, no stub, because the corner itself moves -- there is no longer a square 90 deg corner at the
    board's own top-left/top-right at all, only wherever the horn meets the arch, at a TRUE, VARYING bisector
    angle (not 45 deg, Fred's own explicit ask).

    The arch's own two ends are NOT anchored to the projected board corners (unlike every other hourglass-family
    template's top_edge): a circle through two FIXED, symmetric chord ends that is ALSO tangent to a line above
    them has, for any one chord height, exactly ONE radius that satisfies both (the sagitta formula) -- so laying
    out the arc as [Symmetric about the Y axis] + [Tangent to the safe zone's own top line] leaves EXACTLY ONE
    free value: how far down the chord sits (the "rise"), the one seeded handle (archRise, editor-shape-lattice-
    generator.js hourglassConstruction's own `arch`). No Radius expression is needed (unlike the side arcs'
    own temporary seed-then-remove dance): this pair of constraints already pins the radius uniquely for any
    chord height, by construction, so the ARC seed itself only needs to be in the right NEIGHBOURHOOD, not exact.

    The two top horns (horn_TR/horn_TL) keep Template 1's own BOTTOM end (welded to their own shoulder arc,
    p02_05/p02_08, untouched) but their TOP end is now coincident with the arch's own chord end instead of a
    projected board corner -- its own x comes for free from the UNCHANGED shoulder-tangent chain (horn_TR stays
    Vertical, and its own bottom end's x is already fixed by that chain), so no new anchor is needed for it either.

    Base and the sides are Template 1's own, seeds included; see Template 1's copy of this phase for that
    rationale (the DOF reasoning here only concerns the TOP's own net un-reduced count: before this phase's own
    extra constraints the loop/arc seeding adds 2 DOF -- the chord height and the arc's own radius -- and
    Symmetry + Tangent remove exactly 1 of them (Symmetry ties the two ends together AND fixes the centre's own
    x at 0; Tangent then fixes the radius for whatever chord height remains), leaving exactly `archRise`.

    Seeds (T10 top): the 7x9 solve of the app's provisional Template 10 shape (archRise = 0.35 hw = 1.1375 in,
    giving a chord at 3.1125 in and a radius of ~5.21 in -- frame-defs shapeModel), as widthIn / heightIn
    expressions, so the seeded top is already close to tangent and closed at the seed board.

    Loop direction: clockwise.
      Right side flows top -> bottom (shoulder -> waist -> hip).
      Left  side flows bottom -> top (hip -> waist -> shoulder).

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    seq = [
        # 1. Rails. Top (T10): ONE arc, its own two ends ALREADY at the seeded chord height (not the board
        # corner), its own on-arc midpoint seeded near the safe zone's own top line (the apex). Bottom:
        # Template 1's own flat base, unchanged.
        {'ID': 'top_edge', 'Type': 'Arc3Point', 'Points': [
            ['-widthIn * 0.464286', 'heightIn * 0.345833'],
            ['0.001', 'heightIn * 0.472222 - 0.001'],
            ['widthIn * 0.464286', 'heightIn * 0.345833'],
        ], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns. TR/TL seeded at the chord height (not the board corner) at their own TOP end; BR/BL
        # unchanged (loose-seeded 0.001 off-target at the BB-corner end, Template 1's own convention).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', 'heightIn * 0.345833'], ['widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn * 0.345833'], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. Corner topology. BR/BL unchanged (anchored to the real board corners). TR/TL: NOT anchored to the
        # board corner -- tied to the arch's own chord end instead, whose height is free (the Tangent below pins
        # its radius, Symmetry its own x = 0 at the centre and ties the two ends together).
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        {'Type': 'Tangent', 'Targets': ['top_edge', 'proj_off_BB_top']},
        {'Type': 'Symmetry', 'Targets': ['top_edge:S', 'top_edge:E', 'Y_AXIS']},

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

def get_block(ui_data=None):
    """
    Silhouette Loop: 15-segment clockwise frame outline (T7 DIAMOND-TOP
    HOURGLASS, reference sketch template_sketches_2026-09-30.jpg). IDENTICAL
    to Template 1 below the shoulders (bottom_edge, the 4 horns, the 6
    anatomical arcs) -- only the flat `top_edge` is replaced by a short
    horizontal LEDGE on each side, then two straight roof lines meeting at a
    peak point on the Y axis, 45 deg miters, a 90 deg apex (Fred: "a 90 deg
    diamond peak ... a short horizontal ledge where each roof bar meets the
    side").

    THE PEAK IS PINNED TO THE SAFE ZONE'S OWN TOP EDGE (Fred, 2026-09-30,
    after a live app screenshot showed the roof bars above the board: "the
    frame's outer profile must equal the board outline, so the diamond apex
    sits ON the top edge of the board"). The FIRST build of this template
    left the peak's own absolute height completely unconstrained (nothing
    tied `roof_R:S` to the safe zone at all -- the 45-45-90 pair only fixed
    the RELATIVE rise/run, not where in Y it sat -- so Fusion's solver just
    settled near the SEED point, which had been seeded deliberately high).
    Fixed here with `safe_top_level`: a horizontal construction line from the
    safe zone's own TR corner (`proj_off_corner_TR`, already projected by
    p02_01_projs.py but never previously consumed by this template) in to
    the Y axis -- its own endpoint IS (0, the safe zone's own top edge), so
    making the peak coincident with it pins the peak's absolute height by
    construction, not by seed luck.

    THE 90 DEG APEX, without a new constraint type: this engine's own
    constraint vocabulary (fb_engine/constraints.py) has no "Angle" --
    only Coincident/Collinear/Horizontal/Vertical/Tangent/Parallel/Equal/
    Symmetry. A 45-45-90 right triangle needs no angle constraint at all:
    equal LEG LENGTHS already force 45 deg base angles. So two small
    CONSTRUCTION lines pin the peak's own RISE relative to the ledge:
      peak_level_R: horizontal, from roof_R:E (where the roof meets its own
        ledge) in to the Y axis.
      peak_rise_R:  vertical, from that same Y-axis point up to the peak
        (now itself pinned by `safe_top_level`, see above).
      Equal(peak_level_R, peak_rise_R) -- forces rise = run, i.e. each
        roof line sits at exactly 45 deg off vertical, giving a 90 deg
        apex. This leaves roof_R:E's own exact position along that 45 deg
        line to the solver/seed (same underconstrained-along-one-line
        situation Template 1's own skeleton pins already accept elsewhere
        in this engine) -- what the LEDGE's own width actually is, in a
        fresh unsynced sketch, is a seed-quality question, not a topology
        one; [Send frame] overwrites every seed here with the app's own
        resolved coordinates once connected regardless.
    Only the RIGHT side needs this pair: once the peak's own (0, peak_y)
    position is fixed, roof_L is already fully determined by its own two
    endpoints (the peak, and ledge_L:E -- the X-mirror of roof_R:E by T1's
    own existing L/R symmetry) -- a line between two already-fixed points
    has no free angle left to separately constrain.

    THE LEDGE is a plain horizontal stub, WELDED to the curvy side (same
    bar as the horn/arcs, not its own mitered bar -- see template_data.py's
    own FRAME_BARS doc comment): `ledge_R` runs roof_R:E (near the roof) to
    horn_TR:S (near the horn, the SAME point the roof used to connect to
    directly before the ledge existed).

    Corner naming (the "start of next curve" rule, matching Template 6's
    own corners/bars convention -- see template_data.py):
      peak       -> roof_R:S    (the apex; roof_R:S == roof_L:E, merged)
      shoulder_R -> ledge_R:S   (roof meets its own ledge)
      BR         -> bottom_edge:S   (unchanged from T1)
      BL         -> horn_BL:S       (unchanged from T1)
      shoulder_L -> roof_L:S    (the mirror ledge meets its own roof)

    Loop direction: clockwise, starting at the peak.
      roof_R (peak -> shoulder_R) -> ledge_R -> horn_TR -> shoulder -> waist
      -> hip -> horn_BR -> bottom_edge -> horn_BL -> hip -> waist -> shoulder
      -> horn_TL -> ledge_L -> roof_L (shoulder_L -> peak).
    StartID / EndID convention preserved for downstream phases (welds,
    encl_projs, encl_welds, encl_offset, miters): :S = start of segment
    in loop direction, :E = end.
    """
    seq = [
        # 1. Bounding-box rail (bottom only -- the top is the ledge/roof/peak below).
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns (loose-seeded 0.001 off-target at the BB-corner end) -- the TOP two are seeded
        # SHORTER than Template 1's own (their :S end no longer reaches the safe zone's own top edge -- the
        # ledge/roof occupy that strip instead), the bottom two IDENTICAL to Template 1.
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', 'heightIn * 0.325'], ['widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', 'heightIn * 0.325'], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. LEDGE + ROOF + PEAK (T7's own geometry). Seeded roughly (a ~0.35 x hw ledge, rise ~= run for the
        # remaining roof run -- see the module doc comment) -- purely a starting guess, the constraints below
        # pull the PEAK to the safe zone's own top edge exactly, and the ROOF to a real 90 deg apex exactly,
        # regardless of where the ledge/horn finally settle.
        {'ID': 'roof_R', 'Type': 'Line', 'Points': [['0.001', 'heightIn/2 + widthIn * 0.325'], ['widthIn * 0.325', 'heightIn * 0.325 - 0.001']], 'StartID': 'roof_R:S', 'EndID': 'roof_R:E'},
        {'ID': 'ledge_R', 'Type': 'Line', 'Points': [['widthIn * 0.325 + 0.001', 'heightIn * 0.325'], ['widthIn/2 - 0.002', 'heightIn * 0.325']], 'StartID': 'ledge_R:S', 'EndID': 'ledge_R:E'},
        {'ID': 'ledge_L', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.002', 'heightIn * 0.325'], ['-widthIn * 0.325 - 0.001', 'heightIn * 0.325']], 'StartID': 'ledge_L:S', 'EndID': 'ledge_L:E'},
        {'ID': 'roof_L', 'Type': 'Line', 'Points': [['-widthIn * 0.325', 'heightIn * 0.325 - 0.001'], ['-0.001', 'heightIn/2 + widthIn * 0.325']], 'StartID': 'roof_L:S', 'EndID': 'roof_L:E'},
        {'Type': 'Horizontal', 'Targets': ['ledge_R', 'ledge_L']},

        # 3a. Pin the PEAK to the safe zone's own top edge (see the module doc comment: `safe_top_level`).
        {'ID': 'safe_top_level', 'Type': 'Line', 'Points': [['widthIn/2 - 0.003', 'heightIn/2 - 0.002'], ['0.004', 'heightIn/2 - 0.002']], 'StartID': 'safe_top_level:S', 'EndID': 'safe_top_level:E', 'IsConstruction': True},
        {'Type': 'Horizontal', 'Targets': ['safe_top_level']},
        {'Type': 'Coincident', 'Targets': ['safe_top_level:S', 'proj_off_corner_TR']},
        {'Type': 'Coincident', 'Targets': ['safe_top_level:E', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['roof_R:S', 'safe_top_level:E'], 'Name': 'peak_on_safe_top'},

        # 3b. The 45-45-90 construction pair (right side only -- see docstring), now measured from the roof's
        # own end (where it meets the ledge) up to the peak.
        {'ID': 'peak_level_R', 'Type': 'Line', 'Points': [['widthIn * 0.325 - 0.001', 'heightIn * 0.325 - 0.001'], ['0.002', 'heightIn * 0.325 - 0.001']], 'StartID': 'peak_level_R:S', 'EndID': 'peak_level_R:E', 'IsConstruction': True},
        {'ID': 'peak_rise_R', 'Type': 'Line', 'Points': [['0.003', 'heightIn * 0.325 - 0.001'], ['0.001', 'heightIn/2 + widthIn * 0.325']], 'StartID': 'peak_rise_R:S', 'EndID': 'peak_rise_R:E', 'IsConstruction': True},
        {'Type': 'Horizontal', 'Targets': ['peak_level_R']},
        {'Type': 'Vertical', 'Targets': ['peak_rise_R']},
        {'Type': 'Coincident', 'Targets': ['peak_level_R:S', 'roof_R:E']},
        {'Type': 'Coincident', 'Targets': ['peak_level_R:E', 'Y_AXIS']},
        {'Type': 'Coincident', 'Targets': ['peak_rise_R:S', 'peak_level_R:E']},
        {'Type': 'Coincident', 'Targets': ['peak_rise_R:E', 'roof_R:S']},
        {'Type': 'Equal', 'Targets': ['peak_level_R', 'peak_rise_R'], 'Name': 'peak_45_equal'},

        # 4. Corner topology: anchor the bottom rail to its projected corners, the bottom horns to the bottom
        # rail, the ledges to their own roof and horn, and the roofs to the peak.
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},
        {'Type': 'Coincident', 'Targets': ['ledge_R:S', 'roof_R:E']},
        {'Type': 'Coincident', 'Targets': ['ledge_R:E', 'horn_TR:S']},
        {'Type': 'Coincident', 'Targets': ['ledge_L:S', 'horn_TL:S']},
        {'Type': 'Coincident', 'Targets': ['ledge_L:E', 'roof_L:S']},
        {'Type': 'Coincident', 'Targets': ['roof_R:S', 'roof_L:E'], 'Name': 'peak_merge'},

        # 5. Arc seeds -- IDENTICAL to Template 1 (Points are [Start, Bulge,
        # End] in arc-traversal order; Bulge is a point ON the arc).
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

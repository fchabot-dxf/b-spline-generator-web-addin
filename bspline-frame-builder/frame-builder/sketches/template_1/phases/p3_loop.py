def get_block(ui_data=None):
    """
    Phase 3: Silhouette Loop.
    Geometric seeds for the 12-segment clockwise frame.
    """
    outer_x = "widthIn/2 - boundingboxoffset"
    top_y   = "heightIn/2 - boundingboxoffset"
    bot_y   = "-(heightIn/2 - boundingboxoffset)"
    # Arc seeds use heightIn-only fractions derived from heightIn=9in / widthIn=7in reference frame.
    # All X and Y positions are expressed as heightIn * k so seeds scale correctly regardless of widthIn.

    seq = [
        # CLOSING EDGES — seeded near corners; explicit Coincidents below pin them exactly
        {'ID': 'top_edge',    'Type': 'Line', 'Points': [[f'-({outer_x}) + 0.001', f'({top_y}) - 0.001'], [f'({outer_x}) - 0.001', f'({top_y}) - 0.001']], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[f'({outer_x}) - 0.001', f'({bot_y}) + 0.001'], [f'-({outer_x}) + 0.001', f'({bot_y}) + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # HORNS (Vertical Anchors)
        # All horns: :S seeded near projected corner (snapped below via Coincident),
        #            :E seeded as a fraction of heightIn toward the center axis.
        # horn_TR and horn_BL were already correct; horn_BR and horn_TL are swapped vs old code.
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [[outer_x,          f'({top_y}) - 0.001'],  [outer_x,          'heightIn * 0.25']],  'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [[outer_x,          f'({bot_y}) + 0.001'],  [outer_x,          '-heightIn * 0.25']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [[f'-({outer_x})',  f'({top_y}) - 0.001'],  [f'-({outer_x})',  'heightIn * 0.25']],  'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [[f'-({outer_x})',  f'({bot_y}) + 0.001'],  [f'-({outer_x})',  '-heightIn * 0.25']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},
        {'Type': 'Vertical',   'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},
        # Explicit corner lock: snap each horn start to its projected offset corner
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'proj_off_corner_TR']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'proj_off_corner_TL']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'proj_off_corner_BL']},

        # ARC SEEDS — all coordinates expressed as heightIn * k fractions.
        # Derived from reference frame: heightIn=9in (22.86cm), widthIn=7in.
        # Observed sketch positions divided by 22.86 give the fractions below.
        # :S/:E orientation follows the clockwise chain (top→bottom on R, bottom→top on L).
        # A Radius dimension of heightIn/7 is applied immediately after each arc.

        # RIGHT side — flows top to bottom
        # arc_shoulder_R: horn tip (upper) → shoulder junction (lower)
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point',
         'Points': [['heightIn * 0.39',  'heightIn * 0.23'],   # :S near horn_TR:E
                    ['heightIn * 0.35',  'heightIn * 0.17'],   # mid, bows outward/up
                    ['heightIn * 0.30',  'heightIn * 0.13']],  # :E shoulder junction
         'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn/7', 'Name': 'dim_seed_rad_shoulder_R'},

        # arc_waist_R: shoulder junction (upper) → hip junction (lower), bows outward
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point',
         'Points': [['heightIn * 0.27',  'heightIn * 0.10'],   # :S shoulder junction
                    ['heightIn * 0.5',   '0'],                  # mid, bows far outward
                    ['heightIn * 0.28',  '-heightIn * 0.13']], # :E hip junction
         'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R',    'Expression': 'heightIn/7', 'Name': 'dim_seed_rad_waist_R'},

        # arc_hip_R: hip junction (upper) → horn tip (lower)
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point',
         'Points': [['heightIn * 0.32',  '-heightIn * 0.15'],  # :S hip junction
                    ['heightIn * 0.38',  '-heightIn * 0.21'],  # mid
                    ['heightIn * 0.40',  '-heightIn * 0.30']], # :E near horn_BR:E
         'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R',      'Expression': 'heightIn/7', 'Name': 'dim_seed_rad_hip_R'},

        # LEFT side — flows bottom to top (mirror: negate X)
        # arc_hip_L: horn tip (lower) → hip junction (upper)
        {'ID': 'arc_hip_L', 'Type': 'Arc3Point',
         'Points': [['-heightIn * 0.40', '-heightIn * 0.30'],  # :S near horn_BL:E
                    ['-heightIn * 0.38', '-heightIn * 0.21'],  # mid
                    ['-heightIn * 0.32', '-heightIn * 0.15']], # :E hip junction
         'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L',      'Expression': 'heightIn/7', 'Name': 'dim_seed_rad_hip_L'},

        # arc_waist_L: hip junction (lower) → shoulder junction (upper), bows outward
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point',
         'Points': [['-heightIn * 0.28', '-heightIn * 0.13'],  # :S hip junction
                    ['-heightIn * 0.5',  '0'],                  # mid, bows far outward
                    ['-heightIn * 0.27', 'heightIn * 0.10']],  # :E shoulder junction
         'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L',    'Expression': 'heightIn/7', 'Name': 'dim_seed_rad_waist_L'},

        # arc_shoulder_L: shoulder junction (lower) → horn tip (upper)
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point',
         'Points': [['-heightIn * 0.30', 'heightIn * 0.13'],   # :S shoulder junction
                    ['-heightIn * 0.35', 'heightIn * 0.17'],   # mid
                    ['-heightIn * 0.39', 'heightIn * 0.23']],  # :E near horn_TL:E
         'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/7', 'Name': 'dim_seed_rad_shoulder_L'},

        # EDGE CORNER CHAIN — pin top/bottom edges to projected offset corners
        {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_corner_TL']},
        {'Type': 'Coincident', 'Targets': ['top_edge:E',    'proj_off_corner_TR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
    ]

    return {
        "Name": "Silhouette",
        "BuildSequence": seq
    }

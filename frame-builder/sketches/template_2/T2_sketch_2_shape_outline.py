def get_sketch():
    outer_x = "widthIn/2 - boundingboxoffset"
    top_y   = "heightIn/2 - boundingboxoffset"
    bot_y   = "-(heightIn/2 - boundingboxoffset)"
    shldr_y = "TopGap"
    hip_y   = "-BottomGap"

    # 12 outline segments used by the Offset step
    outline_ids = [
        'top_edge', 'horn_TR', 'arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'horn_BR',
        'bottom_edge', 'horn_BL', 'arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL'
    ]
    inner_ids = [f'frame_inner_{eid}' for eid in outline_ids]

    return {
        'Name': '2_shape-outline',

        # ── Projections ─────────────────────────────────────────────────────
        'BoundingBoxProjections': [
            {'SourceSketch': '1_bounding-box', 'SourceID': 'off_corner_TL', 'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'off_corner_TR', 'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'off_corner_BL', 'TargetID': 'proj_off_corner_BL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'off_corner_BR', 'TargetID': 'proj_off_corner_BR'},
        ],

        # ── Phase 1: Pre-Geometry ────────────────────────────────────────────
        # Skeleton construction lines + closing frame edges/horns.
        'PreGeometry': [
            # Skeleton pins (construction)
            {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'IsConstruction': True,
             'Points': [[0, 'TopGap'], ['ShoulderSpan/2', 'TopGap']],
             'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
            {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'IsConstruction': True,
             'Points': [[0, 'TopGap'], ['-ShoulderSpan/2', 'TopGap']],
             'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
            {'ID': 'skel_waist_pin_R', 'Type': 'Line', 'IsConstruction': True,
             'Points': [[0, 0], ['WaistSpan/2', 0]],
             'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
            {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'IsConstruction': True,
             'Points': [[0, 0], ['-WaistSpan/2', 0]],
             'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
            {'ID': 'skel_hip_pin_R', 'Type': 'Line', 'IsConstruction': True,
             'Points': [[0, '-BottomGap'], ['HipSpan/2', '-BottomGap']],
             'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
            {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'IsConstruction': True,
             'Points': [[0, '-BottomGap'], ['-HipSpan/2', '-BottomGap']],
             'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},

            # Closing edges
            {'ID': 'top_edge',    'Type': 'Line',
             'Points': [[f'-({outer_x})', top_y], [outer_x, top_y]],
             'StartID': 'top_edge:S',    'EndID': 'top_edge:E'},
            {'ID': 'bottom_edge', 'Type': 'Line',
             'Points': [[outer_x, bot_y], [f'-({outer_x})', bot_y]],
             'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},
            # R horns
            {'ID': 'horn_TR', 'Type': 'Line',
             'Points': [[outer_x, top_y], [outer_x, shldr_y]],
             'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
            {'ID': 'horn_BR', 'Type': 'Line',
             'Points': [[outer_x, hip_y], [outer_x, bot_y]],
             'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
            # L horns
            {'ID': 'horn_TL', 'Type': 'Line',
             'Points': [[f'-({outer_x})', shldr_y], [f'-({outer_x})', top_y]],
             'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
            {'ID': 'horn_BL', 'Type': 'Line',
             'Points': [[f'-({outer_x})', bot_y], [f'-({outer_x})', hip_y]],
             'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},
        ],

        # ── Phase 2: Pre-Constraints ─────────────────────────────────────────
        'PreConstraints': [
            # Skeleton pin symmetry
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},
            # All pins share Y-axis as root
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_L:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_L:S',    'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_L:S',      'Y_AXIS']},
            # L/R pin roots are coincident (mirror symmetry)
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'skel_waist_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'skel_hip_pin_L:S']},
            # Origin Lock: hard-pin waist root to ORIGIN (toggle: en_OriginLock)
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN'],
             'EnabledParam': 'en_OriginLock'},
            # Equal length on symmetric pairs
            {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
            {'Type': 'Equal', 'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L']},
            {'Type': 'Equal', 'Targets': ['skel_hip_pin_R',      'skel_hip_pin_L']},

            # Frame edge/horn constraints
            {'Type': 'Horizontal', 'Targets': ['top_edge']},
            {'Type': 'Horizontal', 'Targets': ['bottom_edge']},
            {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_corner_TL'], 'RetryDrop': True},
            {'Type': 'Coincident', 'Targets': ['top_edge:E',    'proj_off_corner_TR'], 'RetryDrop': True},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR'], 'RetryDrop': True},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL'], 'RetryDrop': True},
            {'Type': 'Vertical', 'Targets': ['horn_TR']},
            {'Type': 'Vertical', 'Targets': ['horn_BR']},
            {'Type': 'Vertical', 'Targets': ['horn_TL']},
            {'Type': 'Vertical', 'Targets': ['horn_BL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E',    'horn_TR:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BR:E',     'bottom_edge:S']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'horn_BL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_TL:E',     'top_edge:S']},
        ],

        # ── Phase 4: Main Geometry ───────────────────────────────────────────
        # Shoulder and hip arcs only (waist arcs in PostGeometry).
        'Geometry': [
            {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point',
             'Points': [[6.166, 2.193], [7.71, 4.29], [8.255, 6.845]],
             'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E', 'CenterID': 'arc_shoulder_R:C'},
            {'ID': 'arc_hip_R', 'Type': 'Arc3Point',
             'Points': [[8.255, -4.694], [7.82, -3.09], [6.624, -1.929]],
             'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C'},
            {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point',
             'Points': [[-8.255, 6.845], [-7.71, 4.29], [-6.166, 2.193]],
             'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E', 'CenterID': 'arc_shoulder_L:C'},
            {'ID': 'arc_hip_L', 'Type': 'Arc3Point',
             'Points': [[-6.624, -1.929], [-7.82, -3.09], [-8.255, -4.694]],
             'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C'},
        ],

        # ── Phase 5: Constraints ─────────────────────────────────────────────
        # Horn <-> shoulder/hip arc joins + tangencies.
        # Safe here — arcs are freshly placed with free DOF.
        'Constraints': [
            {'Type': 'Coincident', 'Targets': ['horn_TR:E',       'arc_shoulder_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:S',     'horn_BR:S']},
            {'Type': 'Tangent',    'Targets': ['horn_TR',          'arc_shoulder_R']},
            {'Type': 'Tangent',    'Targets': ['arc_hip_R',        'horn_BR']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:S', 'horn_TL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BL:E',        'arc_hip_L:E']},
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_L',   'horn_TL']},
            {'Type': 'Tangent',    'Targets': ['horn_BL',          'arc_hip_L']},
        ],

        # ── Phase 6: Post-Geometry ───────────────────────────────────────────
        # Waist arcs + surround rect added here so all 6 arc IDs exist
        # before TangentConstraints and PostConstraints fire.
        'PostGeometry': [
            {'ID': 'arc_waist_R', 'Type': 'Arc3Point',
             'Points': [[6.166, 2.193], [5.33, 0.01], [6.624, -1.929]],
             'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C'},
            {'ID': 'arc_waist_L', 'Type': 'Arc3Point',
             'Points': [[-6.624, -1.929], [-5.33, 0.01], [-6.166, 2.193]],
             'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E', 'CenterID': 'arc_waist_L:C'},
            {'ID': 'surround_rect', 'Type': 'RectangleCenter',
             'Center': [0, 0], 'Size': ['widthIn * 1.25', 'heightIn * 1.25'],
             'LineIDs': ['surround_T', 'surround_R', 'surround_B', 'surround_L']},
        ],

        # ── Phase 7.5: Temp Dimensions ───────────────────────────────────────
        # Unconditional guidance seeds. Give the solver a good starting state
        # before tangency fires. Applied then deleted after PostConstraints settles.
        'TempDimensions': [
            {'Name': 'tmp_ShoulderSpan', 'Type': 'HorizontalDistance',
             'Source': 'skel_shoulder_pin_L:E', 'Target': 'skel_shoulder_pin_R:E',
             'Expression': 'ShoulderSpan', 'TextPoint': [0, -15]},
            {'Name': 'tmp_HipSpan', 'Type': 'HorizontalDistance',
             'Source': 'skel_hip_pin_L:E', 'Target': 'skel_hip_pin_R:E',
             'Expression': 'HipSpan', 'TextPoint': [0, 15]},
        ],

        # ── Phase 7.55: Pre-Tangent Dimensions ───────────────────────────────
        # Permanent vertical-gap dims applied with a solver settle BEFORE
        # arc-arc tangency fires, giving arcs their correct Y positions.
        'PreTangentDimensions': [
            {'Name': 'TopGap', 'Type': 'VerticalDistance',
             'Source': 'skel_waist_pin_R:S', 'Target': 'skel_shoulder_pin_R:S',
             'Expression': 'TopGap', 'Orientation': 'Vertical',
             'EnabledParam': 'en_TopGap', 'TextPoint': [15, -8]},
            {'Name': 'BottomGap', 'Type': 'VerticalDistance',
             'Source': 'skel_waist_pin_R:S', 'Target': 'skel_hip_pin_R:S',
             'Expression': 'BottomGap', 'Orientation': 'Vertical',
             'EnabledParam': 'en_BottomGap', 'TextPoint': [15, 8]},
        ],

        # ── Phase 8: Tangent Constraints ─────────────────────────────────────
        # Arc-arc tangencies fire BEFORE PostConstraints pins arc centers.
        # Each arc center retains >=1 free DOF here so the VCS accepts them.
        # Uses Source/Target keys (builder resolves via _resolve_target).
        'TangentConstraints': [
            {'Source': 'arc_shoulder_R', 'Target': 'arc_waist_R'},
            {'Source': 'arc_waist_R',    'Target': 'arc_hip_R'},
            {'Source': 'arc_shoulder_L', 'Target': 'arc_waist_L'},
            {'Source': 'arc_waist_L',    'Target': 'arc_hip_L'},
        ],

        # ── Phase 9: Post-Constraints ─────────────────────────────────────────
        # Cross-pins + arc endpoint joins + surround anchor.
        # Runs AFTER TangentConstraints — arc centers lose free DOF here.
        'PostConstraints': [
            # Cross-pin: arc center -> OPPOSITE-role skeleton endpoint (inverted)
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:C', 'skel_hip_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_hip_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:C',    'skel_waist_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_L:C',    'skel_waist_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:C',      'skel_shoulder_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_shoulder_pin_L:E']},
            # Arc-arc endpoint joins (chain the 3-arc side profile)
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:S', 'arc_waist_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:E',    'arc_hip_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'arc_waist_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:S',      'arc_waist_L:S']},
            # Surround rect anchor + orientation
            {'Type': 'Coincident', 'Targets': ['surround_rect:C', 'ORIGIN']},
            # Horizontal/Vertical are now implicit from the RectangleCenter builder
        ],

        # ── Phase 10: Dimensions ──────────────────────────────────────────────
        # TopGap and BottomGap live in PreTangentDimensions, not here.
        'Dimensions': [
            {'Name': 'ShoulderSpan', 'Type': 'HorizontalDistance',
             'Source': 'skel_shoulder_pin_L:E', 'Target': 'skel_shoulder_pin_R:E',
             'Expression': 'ShoulderSpan', 'Orientation': 'Horizontal',
             'EnabledParam': 'en_ShoulderSpan', 'TextPoint': [0, -15]},
            {'Name': 'WaistSpan', 'Type': 'HorizontalDistance',
             'Source': 'skel_waist_pin_L:E', 'Target': 'skel_waist_pin_R:E',
             'Expression': 'WaistSpan', 'Orientation': 'Horizontal',
             'EnabledParam': 'en_WaistSpan', 'TextPoint': [0, 2]},
            {'Name': 'HipSpan', 'Type': 'HorizontalDistance',
             'Source': 'skel_hip_pin_L:E', 'Target': 'skel_hip_pin_R:E',
             'Expression': 'HipSpan', 'Orientation': 'Horizontal',
             'EnabledParam': 'en_HipSpan', 'TextPoint': [0, 15]},
            # VerticalOffset: soft seed for waist Y.
            # Active only when en_VerticalOffset ON and en_OriginLock OFF.
            {'Name': 'VerticalOffset', 'Type': 'VerticalDistance',
             'Source': 'ORIGIN', 'Target': 'skel_waist_pin_R:S',
             'Expression': 'VerticalOffset', 'Orientation': 'Vertical',
             'EnabledParam': 'en_VerticalOffset', 'BlockedParam': 'en_OriginLock',
             'TextPoint': [-15, 0]},
            {'Name': 'dim_surround_w', 'Target': 'surround_T',
             'Expression': 'widthIn * 1.25', 'TextPoint': [0, 30]},
            {'Name': 'dim_surround_h', 'Target': 'surround_R',
             'Expression': 'heightIn * 1.25', 'TextPoint': [30, 0]},
        ],

        # ── Steps ─────────────────────────────────────────────────────────────
        'Steps': [
            {
                'Type':         'Offset',
                'SourceID':     outline_ids,
                'DistanceExpr': '-Skel_Frame_Offset',
                'Direction':    [0, 0, 0],
                'TargetIDs':    inner_ids,
                'CornerIDs': {
                    'TL': 'inner_corner_TL',
                    'TR': 'inner_corner_TR',
                    'BL': 'inner_corner_BL',
                    'BR': 'inner_corner_BR',
                }
            },
            # Miter lines: outer frame corners -> inner offset corners
            {'Type': 'Line', 'StartID': 'top_edge:S', 'EndID': 'inner_corner_TL', 'ID': 'miter_TL'},
            {'Type': 'Line', 'StartID': 'top_edge:E', 'EndID': 'inner_corner_TR', 'ID': 'miter_TR'},
            {'Type': 'Line', 'StartID': 'horn_BL:S',  'EndID': 'inner_corner_BL', 'ID': 'miter_BL'},
            {'Type': 'Line', 'StartID': 'horn_BR:E',  'EndID': 'inner_corner_BR', 'ID': 'miter_BR'},
        ],
    }

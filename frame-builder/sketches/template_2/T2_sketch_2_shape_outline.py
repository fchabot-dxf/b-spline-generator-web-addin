def get_sketch():
    outer_x = "widthIn/2 - boundingboxoffset"
    top_y   = "heightIn/2 - boundingboxoffset"
    bot_y   = "-(heightIn/2 - boundingboxoffset)"
    shldr_y = "TopGap"
    hip_y   = "-BottomGap"

    # Define the 12 segments of the outline for the offset step
    outline_ids = [
        'top_edge', 'horn_TR', 'arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'horn_BR',
        'bottom_edge', 'horn_BL', 'arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL'
    ]
    inner_ids = [f'frame_inner_{eid}' for eid in outline_ids]

    return {
        'Name': '2_shape-outline',

        'BoundingBoxProjections': [
            {'SourceSketch': '1_bounding-box', 'SourceID': 'offset_BB_corner_TL', 'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'offset_BB_corner_TR', 'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'offset_BB_corner_BL', 'TargetID': 'proj_off_corner_BL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'offset_BB_corner_BR', 'TargetID': 'proj_off_corner_BR'},
        ],

        'PreGeometry': [
            # Skeleton Shoulder pins
            {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 'TopGap'], ['ShoulderSpan/2', 'TopGap']], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
            {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 'TopGap'], ['-ShoulderSpan/2', 'TopGap']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
            # Skeleton Waist pins
            {'ID': 'skel_waist_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 0], ['WaistSpan/2', 0]], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
            {'ID': 'skel_waist_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 0], ['-WaistSpan/2', 0]], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
            # Skeleton Hip pins
            {'ID': 'skel_hip_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, '-BottomGap'], ['HipSpan/2', '-BottomGap']], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
            {'ID': 'skel_hip_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, '-BottomGap'], ['-HipSpan/2', '-BottomGap']], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},
            
            # Closing edges
            {'ID': 'top_edge', 'Type': 'Line', 'Points': [[f'-({outer_x})', top_y], [outer_x, top_y]], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
            {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[outer_x, bot_y], [f'-({outer_x})', bot_y]], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},
            # R horns
            {'ID': 'horn_TR', 'Type': 'Line', 'Points': [[outer_x, top_y], [outer_x, shldr_y]], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
            {'ID': 'horn_BR', 'Type': 'Line', 'Points': [[outer_x, hip_y], [outer_x, bot_y]], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
            # L horns
            {'ID': 'horn_TL', 'Type': 'Line', 'Points': [[f'-({outer_x})', shldr_y], [f'-({outer_x})', top_y]], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
            {'ID': 'horn_BL', 'Type': 'Line', 'Points': [[f'-({outer_x})', bot_y], [f'-({outer_x})', hip_y]], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},
        ],

        'PreConstraints': [
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_L:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_L:S',    'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_L:S',      'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'skel_waist_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'skel_hip_pin_L:S']},
            
            # --- Skeleton Stabilizers ---
            # 1. Centering (Always stay on the spine)
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'Y_AXIS']},
            # 2. Vertical Anchor (Origin Snapshot or Dimension Driver)
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN'], 'EnabledParam': 'en_VerticalOffset'},
            
            {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
            {'Type': 'Equal', 'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L']},
            {'Type': 'Equal', 'Targets': ['skel_hip_pin_R',      'skel_hip_pin_L']},

            # Shape Outline Edge/Horn Constraints
            {'Type': 'Horizontal', 'Targets': ['top_edge']},
            {'Type': 'Horizontal', 'Targets': ['bottom_edge']},
            {'Type': 'Coincident', 'Targets': ['top_edge:S', 'proj_off_corner_TL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E', 'proj_off_corner_TR']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
            {'Type': 'Vertical', 'Targets': ['horn_TR']},
            {'Type': 'Vertical', 'Targets': ['horn_BR']},
            {'Type': 'Vertical', 'Targets': ['horn_TL']},
            {'Type': 'Vertical', 'Targets': ['horn_BL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E', 'horn_TR:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BR:E', 'bottom_edge:S']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'horn_BL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_TL:E', 'top_edge:S']},
        ],

        'Geometry': [
            {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [[6.166, 2.193], [7.71, 4.29], [8.255, 6.845]], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E', 'CenterID': 'arc_shoulder_R:C'},
            {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [[8.255, -4.694], [7.82, -3.09], [6.624, -1.929]], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C'},
            {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [[-8.255, 6.845], [-7.71, 4.29], [-6.166, 2.193]], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E', 'CenterID': 'arc_shoulder_L:C'},
            {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [[-6.624, -1.929], [-7.82, -3.09], [-8.255, -4.694]], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C'},
        ],

        'Constraints': [
            {'Type': 'Coincident', 'Targets': ['horn_TR:E',      'arc_shoulder_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:S',    'horn_BR:S']},
            {'Type': 'Tangent',    'Targets': ['horn_TR',         'arc_shoulder_R']},
            {'Type': 'Tangent',    'Targets': ['arc_hip_R',       'horn_BR']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:S', 'horn_TL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BL:E',        'arc_hip_L:E']},
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_L',   'horn_TL']},
            {'Type': 'Tangent',    'Targets': ['horn_BL',           'arc_hip_L']},
        ],

        'PostGeometry': [
            {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [[6.166, 2.193], [5.33, 0.01], [6.624, -1.929]], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C'},
            {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [[-6.624, -1.929], [-5.33, 0.01], [-6.166, 2.193]], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E', 'CenterID': 'arc_waist_L:C'},
            {'ID': 'surround_rect', 'Type': 'RectangleCenter', 'Center': [0, 0], 'Size': ['widthIn * 1.25', 'heightIn * 1.25'], 'LineIDs': ['surround_T', 'surround_R', 'surround_B', 'surround_L']},
        ],

        'PostConstraints': [
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:C', 'skel_hip_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_hip_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:C',    'skel_waist_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_L:C',    'skel_waist_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:C',      'skel_shoulder_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_shoulder_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:S', 'arc_waist_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:E',    'arc_hip_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'arc_waist_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:S',      'arc_waist_L:S']},
            {'Type': 'Tangent', 'Targets': ['arc_shoulder_R', 'arc_waist_R']},
            {'Type': 'Tangent', 'Targets': ['arc_waist_R',    'arc_hip_R'], 'RetryDrop': ['WaistSpan', 'HipSpan', 'BottomGap']},
            {'Type': 'Tangent', 'Targets': ['arc_shoulder_L', 'arc_waist_L']},
            {'Type': 'Tangent', 'Targets': ['arc_waist_L',    'arc_hip_L'], 'RetryDrop': ['WaistSpan', 'HipSpan', 'BottomGap']},
            {'Type': 'Horizontal', 'Targets': ['surround_T']},
            {'Type': 'Vertical',   'Targets': ['surround_R']},
            {'Type': 'Horizontal', 'Targets': ['surround_B']},
            {'Type': 'Vertical',   'Targets': ['surround_L']},

            # 3. Symmetry & Anchor
            {'Type': 'Coincident', 'Targets': ['surround_rect:C', 'ORIGIN']},
        ],

        'Dimensions': [
            {'Name': 'ShoulderSpan', 'Type': 'HorizontalDistance', 'Source': 'skel_shoulder_pin_L:E', 'Target': 'skel_shoulder_pin_R:E', 'Expression': 'ShoulderSpan', 'Orientation': 'Horizontal', 'EnabledParam': 'en_ShoulderSpan', 'TextPoint': [0, -15]},
            {'Name': 'WaistSpan', 'Type': 'HorizontalDistance', 'Source': 'skel_waist_pin_L:E', 'Target': 'skel_waist_pin_R:E', 'Expression': 'WaistSpan', 'Orientation': 'Horizontal', 'EnabledParam': 'en_WaistSpan', 'TextPoint': [0, 2]},
            {'Name': 'HipSpan', 'Type': 'HorizontalDistance', 'Source': 'skel_hip_pin_L:E', 'Target': 'skel_hip_pin_R:E', 'Expression': 'HipSpan', 'Orientation': 'Horizontal', 'EnabledParam': 'en_HipSpan', 'TextPoint': [0, 15]},
            {'Name': 'TopGap', 'Type': 'VerticalDistance', 'Source': 'skel_waist_pin_R:S', 'Target': 'skel_shoulder_pin_R:S', 'Expression': 'TopGap', 'Orientation': 'Vertical', 'EnabledParam': 'en_TopGap', 'TextPoint': [15, -8]},
            {'Name': 'BottomGap', 'Type': 'VerticalDistance', 'Source': 'skel_waist_pin_R:S', 'Target': 'skel_hip_pin_R:S', 'Expression': 'BottomGap', 'Orientation': 'Vertical', 'EnabledParam': 'en_BottomGap', 'BlockedParam': 'en_TopGap', 'TextPoint': [15, 8]},
            {'Name': 'VerticalOffset', 'Type': 'VerticalDistance', 'Source': 'ORIGIN', 'Target': 'skel_waist_pin_R:S', 'Expression': 'VerticalOffset', 'Orientation': 'Vertical', 'EnabledParam': 'en_Fix_VerticalOffset', 'BlockedParam': 'en_VerticalOffset', 'TextPoint': [-15, 0]},
            {'Name': 'dim_surround_w', 'Target': 'surround_T', 'Expression': 'widthIn * 1.25', 'TextPoint': [0, 30]},
            {'Name': 'dim_surround_h', 'Target': 'surround_R', 'Expression': 'heightIn * 1.25', 'TextPoint': [30, 0]},
        ],

        'Steps': [
            {
                'Type':         'Offset',
                'SourceID':     outline_ids,
                'DistanceExpr': '-Skel_Frame_Offset',
                'Direction':    [0, 0, 0],
                'TargetIDs':    inner_ids,
                'CornerIDs':    {
                    'TL': 'inner_corner_TL',
                    'TR': 'inner_corner_TR',
                    'BL': 'inner_corner_BL',
                    'BR': 'inner_corner_BR'
                }
            },
            # Miter Lines (Connecting Outer Frame Corners to Inner Frame Corners using Seed & Lock)
            # 1. TL
            {'Type': 'Line',       'ID': 'miter_TL', 'Points': [[f'-({outer_x}) - 0.1', f'({top_y}) + 0.1'], [f'-({outer_x}) + 0.1', f'({top_y}) - 0.1']], 'StartID': 'miter_TL:S', 'EndID': 'miter_TL:E'},
            {'Type': 'Coincident', 'Targets': ['miter_TL:S', 'top_edge:S']},
            {'Type': 'Coincident', 'Targets': ['miter_TL:E', 'inner_corner_TL']},
            
            # 2. TR
            {'Type': 'Line',       'ID': 'miter_TR', 'Points': [[f'({outer_x}) + 0.1', f'({top_y}) + 0.1'], [f'({outer_x}) - 0.1', f'({top_y}) - 0.1']], 'StartID': 'miter_TR:S', 'EndID': 'miter_TR:E'},
            {'Type': 'Coincident', 'Targets': ['miter_TR:S', 'top_edge:E']},
            {'Type': 'Coincident', 'Targets': ['miter_TR:E', 'inner_corner_TR']},
            
            # 3. BL
            {'Type': 'Line',       'ID': 'miter_BL', 'Points': [[f'-({outer_x}) - 0.1', f'({bot_y}) - 0.1'], [f'-({outer_x}) + 0.1', f'({bot_y}) + 0.1']], 'StartID': 'miter_BL:S', 'EndID': 'miter_BL:E'},
            {'Type': 'Coincident', 'Targets': ['miter_BL:S', 'horn_BL:S']},
            {'Type': 'Coincident', 'Targets': ['miter_BL:E', 'inner_corner_BL']},
            
            # 4. BR
            {'Type': 'Line',       'ID': 'miter_BR', 'Points': [[f'({outer_x}) + 0.1', f'({bot_y}) - 0.1'], [f'({outer_x}) - 0.1', f'({bot_y}) + 0.1']], 'StartID': 'miter_BR:S', 'EndID': 'miter_BR:E'},
            {'Type': 'Coincident', 'Targets': ['miter_BR:S', 'horn_BR:E']},
            {'Type': 'Coincident', 'Targets': ['miter_BR:E', 'inner_corner_BR']},
        ],
    }
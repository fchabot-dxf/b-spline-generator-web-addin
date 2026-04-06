def get_sketch(geometry):
    """
    Logic for Sketch 2: Shape Outline.
    Consolidated version: handles Skeleton Pins, S-Curve segments, and Frame Offset.
    Includes 4 solid miter lines for profile splitting.
    """
    # Filter the geometry for the outline (Semantic Renaming)
    id_map = {
        'G_05': 'top_edge',
        'G_10': 'bottom_edge',
        'horn_LU': 'horn_TL',
        'horn_RU': 'horn_TR',
        'horn_RL': 'horn_BR',
        'horn_LL': 'horn_BL'
    }
    
    outline_ids = {
        'top_edge', 'bottom_edge', 'horn_TR', 'horn_BR', 'horn_BL', 'horn_TL',
        'arc_shoulder_R', 'arc_shoulder_L', 'arc_hip_R', 'arc_hip_L',
        'arc_waist_R', 'arc_waist_L'
    }
    
    outline_geometry = []
    for g in geometry:
        # Apply semantic renaming
        gid = id_map.get(g['ID'], g['ID'])
        if gid in outline_ids:
            g = dict(g)
            g['ID'] = gid
            if g['Type'] == 'Line':
                g['StartID'] = f"{gid}:S"
                g['EndID'] = f"{gid}:E"
            outline_geometry.append(g)

    # Filters for phased build
    outer_arc_ids = {'arc_shoulder_R', 'arc_shoulder_L', 'arc_hip_R', 'arc_hip_L'}
    outer_arcs = [g for g in outline_geometry if g['ID'] in outer_arc_ids]
    waist_arcs = [g for g in outline_geometry if g['ID'] in ('arc_waist_R', 'arc_waist_L')]
    
    # Define IDs for the offset step
    ordered_ids = [
        'top_edge', 'horn_TR', 'arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'horn_BR',
        'bottom_edge', 'horn_BL', 'arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL'
    ]
    inner_ids = [f'frame_inner_{eid}' for eid in ordered_ids]

    return {
        'Name': '2_shape-outline',

        'BoundingBoxProjections': [
            {"SourceSketch": "1_bounding-box", "SourceID": "BB_corner_TL", "TargetID": "proj_off_corner_TL"},
            {"SourceSketch": "1_bounding-box", "SourceID": "BB_corner_TR", "TargetID": "proj_off_corner_TR"},
            {"SourceSketch": "1_bounding-box", "SourceID": "BB_corner_BL", "TargetID": "proj_off_corner_BL"},
            {"SourceSketch": "1_bounding-box", "SourceID": "BB_corner_BR", "TargetID": "proj_off_corner_BR"}
        ],

        'PreGeometry': [
            # Skeleton Pins
            {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, '-heightIn/5'], ['widthIn/3', '-heightIn/5']], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
            {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0, '-heightIn/5'], ['-widthIn/3', '-heightIn/5']], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
            {'ID': 'skel_waist_pin_R',    'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 0], ['widthIn/2.2', 0]], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
            {'ID': 'skel_waist_pin_L',    'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 0], ['-widthIn/2.2', 0]], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
            {'ID': 'skel_hip_pin_R',      'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 'heightIn/5'], ['widthIn/3', 'heightIn/5']], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
            {'ID': 'skel_hip_pin_L',      'Type': 'Line', 'IsConstruction': True, 'Points': [[0, 'heightIn/5'], ['-widthIn/3', 'heightIn/5']], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},
            
            # Surround Rectangle (1.25x scale)
            {
                'ID': 'surround_rect', 
                'Type': 'RectangleCenter', 
                'IsConstruction': False, 
                'Center': [0, 0], 
                'Size': ['widthIn * 1.25', 'heightIn * 1.25'],
                'LineIDs': ['surround_top', 'surround_right', 'surround_bottom', 'surround_left']
            },

            # Form Geometry (Lines only)
            *[g for g in outline_geometry if g['Type'] != 'Arc3Point']
        ],

        'PreConstraints': [
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_waist_pin_L']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_R']},
            {'Type': 'Horizontal', 'Targets': ['skel_hip_pin_L']},
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'ORIGIN']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'Y_AXIS']},
            {'Type': 'Equal',      'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
            {'Type': 'Equal',      'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L']},
            {'Type': 'Equal',      'Targets': ['skel_hip_pin_R',      'skel_hip_pin_L']},

            # Surround Rectangle Anchoring
            {'Type': 'Coincident', 'Targets': ['surround_rect:C', 'ORIGIN']},
            {'Type': 'Horizontal', 'Targets': ['surround_top']},
            {'Type': 'Vertical',   'Targets': ['surround_left']},

            # Shape Outline Anchoring
            {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_corner_TL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E',    'proj_off_corner_TR']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
            {'Type': 'Vertical',   'Targets': ['horn_TR']},
            {'Type': 'Vertical',   'Targets': ['horn_BR']},
            {'Type': 'Vertical',   'Targets': ['horn_BL']},
            {'Type': 'Vertical',   'Targets': ['horn_TL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E',    'horn_TR:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BR:E',    'bottom_edge:S']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'horn_BL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_TL:E',    'top_edge:S']},
        ],

        'Geometry': outer_arcs,

        'Constraints': [
            {'Type': 'Coincident', 'Targets': ['horn_TR:E',      'arc_shoulder_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:E',    'horn_BR:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BL:E',      'arc_hip_L:S']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'horn_TL:S']},
            {'Type': 'Tangent',    'Targets': ['horn_TR',         'arc_shoulder_R']},
            {'Type': 'Tangent',    'Targets': ['arc_hip_R',       'horn_BR']},
            {'Type': 'Tangent',    'Targets': ['horn_BL',         'arc_hip_L']},
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_L',   'horn_TL']},
        ],

        'PostGeometry': waist_arcs,

        'PostConstraints': [
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:C', 'skel_hip_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_hip_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:C',    'skel_waist_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_L:C',    'skel_waist_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:C',      'skel_shoulder_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_shoulder_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:E',    'arc_hip_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:E',      'arc_waist_L:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_L:E',    'arc_shoulder_L:S']},
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_R', 'arc_waist_R']},
            {'Type': 'Tangent',    'Targets': ['arc_waist_R',    'arc_hip_R']},
            {'Type': 'Tangent',    'Targets': ['arc_hip_L',      'arc_waist_L']},
            {'Type': 'Tangent',    'Targets': ['arc_waist_L',    'arc_shoulder_L']},
        ],

        'Dimensions': [
            {'Name': 'WaistSpan',    'Target': 'skel_waist_pin_R',    'Expression': 'WaistSpan',    'Type': 'Distance', 'EnabledParam': 'en_WaistSpan'},
            {'Name': 'ShoulderSpan', 'Target': 'skel_shoulder_pin_R', 'Expression': 'ShoulderSpan', 'Type': 'Distance', 'EnabledParam': 'en_ShoulderSpan'},
            {'Name': 'HipSpan',      'Target': 'skel_hip_pin_R',      'Expression': 'HipSpan',      'Type': 'Distance', 'EnabledParam': 'en_HipSpan'},
            {'Name': 'TopGap',       'Type': 'VerticalDistance', 'Source': 'skel_waist_pin_R:S', 'Target': 'skel_shoulder_pin_R:S', 'Expression': 'TopGap',    'EnabledParam': 'en_TopGap'},
            {'Name': 'BottomGap',    'Type': 'VerticalDistance', 'Source': 'skel_waist_pin_R:S', 'Target': 'skel_hip_pin_R:S',      'Expression': 'BottomGap', 'EnabledParam': 'en_BottomGap'},
        ],

        'Steps': [
            {
                'Type':         'Offset',
                'SourceID':     ordered_ids,
                'DistanceExpr': 'Skel_Frame_Offset',
                'TargetIDs':    inner_ids,
                'CornerIDs':    {
                    'TL': 'inner_corner_TL',
                    'TR': 'inner_corner_TR',
                    'BL': 'inner_corner_BL',
                    'BR': 'inner_corner_BR'
                }
            }
        ],

        'Miters': [
            {'Source': 'horn_TL:E',      'Target': 'inner_corner_TL', 'IsConstruction': False},
            {'Source': 'horn_TR:S',      'Target': 'inner_corner_TR', 'IsConstruction': False},
            {'Source': 'horn_BR:E',      'Target': 'inner_corner_BR', 'IsConstruction': False},
            {'Source': 'bottom_edge:E',  'Target': 'inner_corner_BL', 'IsConstruction': False}
        ]
    }

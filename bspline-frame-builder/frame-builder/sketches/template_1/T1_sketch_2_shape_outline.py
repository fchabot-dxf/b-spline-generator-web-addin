def get_sketch(geometry=None):
    """
    Logic for Sketch 2 (Template 1): Shape Outline.
    Standardized clone of T3 — same variables, same IDs, same phased build pattern.
    """
    outer_x = "widthIn/2 - boundingboxoffset"
    top_y   = "heightIn/2 - boundingboxoffset"
    bot_y   = "-(heightIn/2 - boundingboxoffset)"
    shldr_y = "WaistOffset + TopGap"
    hip_y   = "WaistOffset - BottomGap"
    waist_y = "WaistOffset"

    # Define the 12 segments of the outline for the offset step
    outline_ids = [
        'top_edge', 'horn_TR', 'arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'horn_BR',
        'bottom_edge', 'horn_BL', 'arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL'
    ]
    inner_ids = [f'frame_inner_{eid}' for eid in outline_ids]

    return {
        'Name': '2_shape-outline',

        'BoundingBoxProjections': [
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_TL', 'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_TR', 'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_BL', 'TargetID': 'proj_off_corner_BL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_BR', 'TargetID': 'proj_off_corner_BR'},
        ],

        'PreGeometry': [
            # Skeleton Pins: SEMANTICALLY SYNCED
            {'ID': 'skel_shoulder_pin_R', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, shldr_y], ['ShoulderSpan/2', shldr_y]], 'StartID': 'skel_shoulder_pin_R:S', 'EndID': 'skel_shoulder_pin_R:E'},
            {'ID': 'skel_shoulder_pin_L', 'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, shldr_y], ['-ShoulderSpan/2', shldr_y]], 'StartID': 'skel_shoulder_pin_L:S', 'EndID': 'skel_shoulder_pin_L:E'},
            {'ID': 'skel_waist_pin_R',    'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, waist_y], ['WaistSpan/2', waist_y]], 'StartID': 'skel_waist_pin_R:S', 'EndID': 'skel_waist_pin_R:E'},
            {'ID': 'skel_waist_pin_L',    'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, waist_y], ['-WaistSpan/2', waist_y]], 'StartID': 'skel_waist_pin_L:S', 'EndID': 'skel_waist_pin_L:E'},
            {'ID': 'skel_hip_pin_R',      'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, hip_y], ['HipSpan/2', hip_y]], 'StartID': 'skel_hip_pin_R:S', 'EndID': 'skel_hip_pin_R:E'},
            {'ID': 'skel_hip_pin_L',      'Type': 'Line', 'IsConstruction': True, 'Points': [[0.001, hip_y], ['-HipSpan/2', hip_y]], 'StartID': 'skel_hip_pin_L:S', 'EndID': 'skel_hip_pin_L:E'},

            # Surround Rectangle (1.25x scale)
            {
                'ID': 'surround_rect',
                'Type': 'RectangleCenter',
                'IsConstruction': False,
                'Center': [0, 0],
                'Size': ['widthIn * 1.25', 'heightIn * 1.25'],
                'LineIDs': ['surround_top', 'surround_right', 'surround_bottom', 'surround_left']
            },

            # Closing edges
            {'ID': 'top_edge',    'Type': 'Line', 'Points': [[f'-({outer_x})', top_y], [outer_x, top_y]],   'StartID': 'top_edge:S',    'EndID': 'top_edge:E'},
            {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[outer_x, bot_y], [f'-({outer_x})', bot_y]],   'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},
            # Horns
            {'ID': 'horn_TR', 'Type': 'Line', 'Points': [[outer_x, top_y],          [outer_x, shldr_y]],           'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
            {'ID': 'horn_BR', 'Type': 'Line', 'Points': [[outer_x, hip_y],           [outer_x, bot_y]],             'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
            {'ID': 'horn_TL', 'Type': 'Line', 'Points': [[f'-({outer_x})', shldr_y], [f'-({outer_x})', top_y]],    'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
            {'ID': 'horn_BL', 'Type': 'Line', 'Points': [[f'-({outer_x})', bot_y],   [f'-({outer_x})', hip_y]],    'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},
        ],

        'PreConstraints': [
            # Anchor hubs to centerline
            # SKELETAL FUSION: Merge pairs through a shared point before locking to vertical axis
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'skel_shoulder_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'skel_waist_pin_L:S']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'skel_hip_pin_L:S']},
            
            # VERTICAL PIN: Lock the shared hubs to the centerline
            {'Type': 'Coincident', 'Targets': ['skel_shoulder_pin_R:S', 'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S',    'Y_AXIS']},
            {'Type': 'Coincident', 'Targets': ['skel_hip_pin_R:S',      'Y_AXIS']},

            # Adaptive Waist Anchoring: Automatic Coinc at 0, Dimension otherwise
            {'Type': 'VerticalDimension', 'Target': 'skel_waist_pin_R:S', 'Expression': 'WaistOffset', 'Name': 'dim_waist_offset'}
            if geometry is not None and geometry.get('WaistOffset', 0) != 0
            else {'Type': 'Coincident', 'Targets': ['skel_waist_pin_R:S', 'ORIGIN']},

            # HORIZONTAL & EQUAL LOCKS: Pin behavior and symmetry
            {'Type': 'Horizontal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L', 'skel_waist_pin_R', 'skel_waist_pin_L', 'skel_hip_pin_R', 'skel_hip_pin_L']},
            {'Type': 'Equal',      'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L']},
            {'Type': 'Equal',      'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L']},
            {'Type': 'Equal',      'Targets': ['skel_hip_pin_R',      'skel_hip_pin_L']},

            # Shape Outline Anchoring
            {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_corner_TL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E',    'proj_off_corner_TR']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
            {'Type': 'Coincident', 'Targets': ['top_edge:E',    'horn_TR:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BR:E',     'bottom_edge:S']},
            {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'horn_BL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_TL:E',     'top_edge:S']},
        ],

        'Geometry': [
            # Seed points: Proportional Mid-Point logic (stays inside boundary)
            {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [['ShoulderSpan/2', shldr_y], [f'({outer_x} + ShoulderSpan/2)/2', f'({shldr_y} + {top_y})/2'], [outer_x, f'({shldr_y}) + 0.001']], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E', 'CenterID': 'arc_shoulder_R:C'},
            {'ID': 'arc_hip_R',      'Type': 'Arc3Point', 'Points': [[outer_x, f'({hip_y}) - 0.001'], [f'({outer_x} + HipSpan/2)/2', f'({hip_y} + {bot_y})/2'], ['HipSpan/2', hip_y]], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E', 'CenterID': 'arc_hip_R:C'},
            {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [[f'-({outer_x})', f'({shldr_y}) + 0.001'], [f'-({outer_x} + ShoulderSpan/2)/2', f'({shldr_y} + {top_y})/2'], ['-(ShoulderSpan/2)', shldr_y]], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E', 'CenterID': 'arc_shoulder_L:C'},
            {'ID': 'arc_hip_L',      'Type': 'Arc3Point', 'Points': [['-(HipSpan/2)', hip_y], [f'-({outer_x} + HipSpan/2)/2', f'({hip_y} + {bot_y})/2'], [f'-({outer_x})', f'({hip_y}) - 0.001']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E', 'CenterID': 'arc_hip_L:C'},
        ],

        'Constraints': [
            {'Type': 'Coincident', 'Targets': ['horn_TR:E',       'arc_shoulder_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:S',     'horn_BR:S']},
            {'Type': 'Tangent',    'Targets': ['horn_TR',          'arc_shoulder_R']},
            {'Type': 'Tangent',    'Targets': ['arc_hip_R',        'horn_BR']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:S', 'horn_TL:S']},
            {'Type': 'Coincident', 'Targets': ['horn_BL:E',        'arc_hip_L:E']},
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_L',   'horn_TL']},
            {'Type': 'Tangent',    'Targets': ['horn_BL',          'arc_hip_L']},
            # Horn locks
            {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},
        ],

        'PostGeometry': [
            # Waist arc seeds: Proportional bulge (safe distance from outer_x)
            {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [['ShoulderSpan/2 + 0.001', shldr_y], [f'WaistSpan/2 + ({outer_x} - WaistSpan/2)*0.3', waist_y], ['HipSpan/2 + 0.001', hip_y]], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E', 'CenterID': 'arc_waist_R:C'},
            {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-(HipSpan/2 + 0.001)', hip_y], [f'-(WaistSpan/2 + ({outer_x} - WaistSpan/2)*0.3)', waist_y], ['-(ShoulderSpan/2 + 0.001)', shldr_y]], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E', 'CenterID': 'arc_waist_L:C'},
        ],

        'PostConstraints': [
            # The GLUE: Anchor arcs to skeletal pins
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:C', 'skel_shoulder_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_shoulder_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:C',    'skel_waist_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_L:C',    'skel_waist_pin_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_R:C',      'skel_hip_pin_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_hip_pin_L:E']},

            # The CHAIN: Stitch arcs together
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:S', 'arc_waist_R:S']},
            {'Type': 'Coincident', 'Targets': ['arc_waist_R:E',    'arc_hip_R:E']},
            {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'arc_waist_L:E']},
            {'Type': 'Coincident', 'Targets': ['arc_hip_L:S',      'arc_waist_L:S']},

            # The SMOOTHNESS: Tangential continuity
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_R', 'arc_waist_R']},
            {'Type': 'Tangent',    'Targets': ['arc_waist_R',    'arc_hip_R']},
            {'Type': 'Tangent',    'Targets': ['arc_shoulder_L', 'arc_waist_L']},
            {'Type': 'Tangent',    'Targets': ['arc_waist_L',    'arc_hip_L']},

            # The SYNC: Align Horn tips to Skeleton Pins (Shared Y)
            {'Type': 'Horizontal', 'Targets': ['horn_TR:E', 'skel_shoulder_pin_R:E']},
            {'Type': 'Horizontal', 'Targets': ['horn_BR:S', 'skel_hip_pin_R:E']},
            {'Type': 'Horizontal', 'Targets': ['horn_TL:S', 'skel_shoulder_pin_L:E']},
            {'Type': 'Horizontal', 'Targets': ['horn_BL:E', 'skel_hip_pin_L:E']},
        ],

        'Dimensions': [
            {'Name': 'ShoulderSpan', 'Type': 'HorizontalDistance', 'Source': 'skel_shoulder_pin_L:E', 'Target': 'skel_shoulder_pin_R:E', 'Expression': 'ShoulderSpan', 'EnabledParam': 'en_ShoulderSpan'},
            {'Name': 'WaistSpan',    'Type': 'HorizontalDistance', 'Source': 'skel_waist_pin_L:E',    'Target': 'skel_waist_pin_R:E',    'Expression': 'WaistSpan',    'EnabledParam': 'en_WaistSpan'},
            {'Name': 'HipSpan',      'Type': 'HorizontalDistance', 'Source': 'skel_hip_pin_L:E',      'Target': 'skel_hip_pin_R:E',      'Expression': 'HipSpan',      'EnabledParam': 'en_HipSpan'},
            {'Name': 'TopGap',       'Type': 'VerticalDistance',   'Source': 'skel_shoulder_pin_R:S', 'Target': 'skel_waist_pin_R:S',    'Expression': 'TopGap',       'EnabledParam': 'en_TopGap'},
            {'Name': 'BottomGap',    'Type': 'VerticalDistance',   'Source': 'skel_waist_pin_R:S',    'Target': 'skel_hip_pin_R:S',      'Expression': 'BottomGap',    'EnabledParam': 'en_BottomGap'},
        ],

        'VolatileDimensions': [
            # SOFT RADIUS SEEDS
            {'Name': 'arc_shoulder_R_rad', 'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'ShoulderRadius'},
            {'Name': 'arc_shoulder_L_rad', 'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'ShoulderRadius'},
            {'Name': 'arc_hip_R_rad',      'Type': 'Radius', 'Target': 'arc_hip_R',      'Expression': 'HipRadius'},
            {'Name': 'arc_hip_L_rad',      'Type': 'Radius', 'Target': 'arc_hip_L',      'Expression': 'HipRadius'},
            {'Name': 'arc_waist_R_rad',    'Type': 'Radius', 'Target': 'arc_waist_R',    'Expression': 'WaistRadius'},
            {'Name': 'arc_waist_L_rad',    'Type': 'Radius', 'Target': 'arc_waist_L',    'Expression': 'WaistRadius'},
        ],

        'Steps': [
            {
                'Type':         'Offset',
                'SourceID':     outline_ids,
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
            {'Source': 'horn_TL:E',     'Target': 'inner_corner_TL', 'IsConstruction': False},
            {'Source': 'horn_TR:S',     'Target': 'inner_corner_TR', 'IsConstruction': False},
            {'Source': 'horn_BR:E',     'Target': 'inner_corner_BR', 'IsConstruction': False},
            {'Source': 'bottom_edge:E', 'Target': 'inner_corner_BL', 'IsConstruction': False},
        ]
    }

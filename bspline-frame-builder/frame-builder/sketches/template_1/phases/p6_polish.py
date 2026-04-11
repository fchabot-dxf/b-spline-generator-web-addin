def get_block(ui_data=None):
    """
    Phase 6: Final Polish.
    Parametric drivers, offset synthesis, and miter completion.
    """
    outline_ids = [
        'top_edge', 'horn_TR', 'arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'horn_BR',
        'bottom_edge', 'horn_BL', 'arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL'
    ]
    inner_ids = [f'frame_inner_{eid}' for eid in outline_ids]

    return {
        "Name": "Polish",
        "Dimensions": [
            {'Name': 'ShoulderSpan', 'Type': 'HorizontalDistance', 'Targets': ['skel_shoulder_pin_L:E', 'skel_shoulder_pin_R:E'], 'Expression': 'ShoulderSpan', 'EnabledParam': 'en_ShoulderSpan'},
            {'Name': 'WaistSpan',    'Type': 'HorizontalDistance', 'Targets': ['skel_waist_pin_L:E',    'skel_waist_pin_R:E'],    'Expression': 'WaistSpan',    'EnabledParam': 'en_WaistSpan'},
            {'Name': 'HipSpan',      'Type': 'HorizontalDistance', 'Targets': ['skel_hip_pin_L:E',      'skel_hip_pin_R:E'],      'Expression': 'HipSpan',      'EnabledParam': 'en_HipSpan'},
            {'Name': 'TopGap',       'Type': 'VerticalDistance',   'Targets': ['skel_shoulder_pin_R:S', 'skel_waist_pin_R:S'],    'Expression': 'TopGap',       'EnabledParam': 'en_TopGap'},
            {'Name': 'BottomGap',    'Type': 'VerticalDistance',   'Targets': ['skel_waist_pin_R:S',    'skel_hip_pin_R:S'],      'Expression': 'BottomGap',    'EnabledParam': 'en_BottomGap'},
        ],
        "VolatileDimensions": [
            {'Name': 'arc_shoulder_R_rad', 'Type': 'Radius', 'Targets': ['arc_shoulder_R'], 'Expression': 'ShoulderRadius'},
            {'Name': 'arc_shoulder_L_rad', 'Type': 'Radius', 'Targets': ['arc_shoulder_L'], 'Expression': 'ShoulderRadius'},
            {'Name': 'arc_hip_R_rad',      'Type': 'Radius', 'Targets': ['arc_hip_R'],      'Expression': 'HipRadius'},
            {'Name': 'arc_hip_L_rad',      'Type': 'Radius', 'Targets': ['arc_hip_L'],      'Expression': 'HipRadius'},
            {'Name': 'arc_waist_R_rad',    'Type': 'Radius', 'Targets': ['arc_waist_R'],    'Expression': 'WaistRadius'},
            {'Name': 'arc_waist_L_rad',    'Type': 'Radius', 'Targets': ['arc_waist_L'],    'Expression': 'WaistRadius'},
        ],
        "Steps": [
            {
                "Type":         "Offset",
                "SourceID":     outline_ids,
                "DistanceExpr": "Skel_Frame_Offset",
                "TargetIDs":    inner_ids,
                "CornerIDs":    {'TL': 'inner_corner_TL', 'TR': 'inner_corner_TR', 'BL': 'inner_corner_BL', 'BR': 'inner_corner_BR'}
            }
        ],
        "Miters": [
            {'Source': 'horn_TL:E',     'Target': 'inner_corner_TL', 'IsConstruction': False},
            {'Source': 'horn_TR:S',     'Target': 'inner_corner_TR', 'IsConstruction': False},
            {'Source': 'horn_BR:E',     'Target': 'inner_corner_BR', 'IsConstruction': False},
            {'Source': 'bottom_edge:E', 'Target': 'inner_corner_BL', 'IsConstruction': False},
        ]
    }

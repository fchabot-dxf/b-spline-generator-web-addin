def get_block(ui_data=None):
    """
    Phase 7b: Enclosure Expansion.
    Generates the inner frame loop via Offset and completes the corner Miters.
    Uses corrected Template 2 miter logic for maximum accuracy.
    """
    outline_ids = [
        'top_edge', 'horn_TR', 'arc_shoulder_R', 'arc_waist_R', 'arc_hip_R', 'horn_BR',
        'bottom_edge', 'horn_BL', 'arc_hip_L', 'arc_waist_L', 'arc_shoulder_L', 'horn_TL'
    ]
    inner_ids = [f'frame_inner_{eid}' for eid in outline_ids]

    return {
        "Name": "Expansion",
        "Steps": [
            {
                "Type":         "Offset",
                "SourceID":     outline_ids,
                "DistanceExpr": "frame_thickness",
                "TargetIDs":    inner_ids,
                "CornerIDs":    {'TL': 'inner_corner_TL', 'TR': 'inner_corner_TR', 'BL': 'inner_corner_BL', 'BR': 'inner_corner_BR'}
            }
        ],
        "Miters": [
            {'Source': 'horn_TL:S',     'Target': 'inner_corner_TL', 'IsConstruction': False},
            {'Source': 'horn_TR:S',     'Target': 'inner_corner_TR', 'IsConstruction': False},
            {'Source': 'horn_BR:S',     'Target': 'inner_corner_BR', 'IsConstruction': False},
            {'Source': 'bottom_edge:E', 'Target': 'inner_corner_BL', 'IsConstruction': False},
        ]
    }

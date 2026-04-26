def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve.

    Locates inner-enclosure corner SketchPoints by position and tags
    them under the miter target IDs. See template_1's copy for the
    full rationale.
    """
    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness',
                'Tolerance': 0.05,
                'Corners': {
                    'TL': {'OuterID': 'proj_top_edge:S',    'InnerID': 'inner_proj_top_edge:S',    'Direction': ( 1, -1)},
                    'TR': {'OuterID': 'proj_horn_TR:S',     'InnerID': 'inner_proj_horn_TR:S',     'Direction': (-1, -1)},
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL': {'OuterID': 'proj_horn_BL:S',     'InnerID': 'inner_proj_horn_BL:S',     'Direction': ( 1,  1)},
                },
            }
        ]
    }

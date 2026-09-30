def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 6 - Tab Top): 8 corners.

    Same resolver as every template (fb_engine/inner_corners.py): each
    inner corner is the outer corner pulled in by frame_thickness along an
    axis-aligned (dx, dy), then the nearest SketchPoint is tagged. The
    outline is all axis-aligned lines, so the rule holds at the two INSIDE
    (reflex) corners too: there the inner corner is t in from both the
    shoulder and the tab side, i.e. diagonally below-inside the reflex
    vertex (inside R: (-1, -1), inside L: (+1, -1)).

    Must match template_data.FRAME_CORNERS (test_frame_defs.py checks it).
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
                    'tab_TL':     {'OuterID': 'proj_tab_top:S',     'InnerID': 'inner_proj_tab_top:S',     'Direction': ( 1, -1)},
                    'tab_TR':     {'OuterID': 'proj_tab_side_R:S',  'InnerID': 'inner_proj_tab_side_R:S',  'Direction': (-1, -1)},
                    'inside_R':   {'OuterID': 'proj_shoulder_R:S',  'InnerID': 'inner_proj_shoulder_R:S',  'Direction': (-1, -1)},
                    'shoulder_R': {'OuterID': 'proj_side_R:S',      'InnerID': 'inner_proj_side_R:S',      'Direction': (-1, -1)},
                    'BR':         {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL':         {'OuterID': 'proj_side_L:S',      'InnerID': 'inner_proj_side_L:S',      'Direction': ( 1,  1)},
                    'shoulder_L': {'OuterID': 'proj_shoulder_L:S',  'InnerID': 'inner_proj_shoulder_L:S',  'Direction': ( 1, -1)},
                    'inside_L':   {'OuterID': 'proj_tab_side_L:S',  'InnerID': 'inner_proj_tab_side_L:S',  'Direction': ( 1, -1)},
                },
            }
        ]
    }

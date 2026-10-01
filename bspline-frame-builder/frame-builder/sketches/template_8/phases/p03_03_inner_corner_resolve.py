def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 8 - Dipped Top + Left-Only Wave).

    Locates the 4 inner-enclosure corner SketchPoints by position and registers them under the names the miter
    phase expects, bypassing the offset's curve-tagging fragility at high frame_thickness (as every other
    template - see fb_engine/inner_corners.py).

    The 4 inner corners are formed by intersection of straight-line offsets (top_edge_L / side_R / bottom_edge /
    horn_BL) - lines whose inward offsets are simply translated copies, so they never collapse or merge under any
    frame_thickness, even where the LEFT side's arcs (shoulder/waist/hip) merge into a single phantom curve.

    Direction convention: (dx_sign, dy_sign) inward axis-aligned signs applied to each outer corner. Magnitude
    per axis = frame_thickness.
      TL: outer at top-left, inward is (+x, -y) -> ( 1, -1)
      TR: outer at top-right, inward is (-x, -y) -> (-1, -1)
      BR: outer at bottom-right, inward is (-x, +y) -> (-1,  1)
      BL: outer at bottom-left, inward is (+x, +y) -> ( 1,  1)
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
                    'TL': {'OuterID': 'proj_top_edge_L:S',  'InnerID': 'inner_proj_top_edge_L:S',  'Direction': ( 1, -1)},
                    'TR': {'OuterID': 'proj_side_R:S',      'InnerID': 'inner_proj_side_R:S',      'Direction': (-1, -1)},
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL': {'OuterID': 'proj_horn_BL:S',     'InnerID': 'inner_proj_horn_BL:S',     'Direction': ( 1,  1)},
                },
            }
        ]
    }

def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve.

    Locates the 4 inner-enclosure corner SketchPoints by position and
    registers them under the names the miter phase expects, bypassing
    the offset's curve-tagging fragility at high frame_thickness.

    Each outer corner is pulled inward by frame_thickness in the
    appropriate axis-aligned direction, then we find the nearest
    existing SketchPoint in the enclosure sketch and tag it.

    The 4 inner corners are formed by intersection of straight-line
    offsets (top_edge, bottom_edge, horn_TR, horn_BL) - lines whose
    inward offsets are simply translated copies, so they never collapse
    or merge under any frame_thickness. The corner SketchPoints exist
    as valid geometry even when the side arcs (shoulder/waist/hip)
    merge into a single phantom curve.

    See fb_engine/inner_corners.py for the resolver implementation.

    Direction convention: (dx_sign, dy_sign) inward axis-aligned signs
    applied to each outer corner. Magnitude per axis = frame_thickness.
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
                    'TL': {'OuterID': 'proj_top_edge:S',    'InnerID': 'inner_proj_top_edge:S',    'Direction': ( 1, -1)},
                    'TR': {'OuterID': 'proj_horn_TR:S',     'InnerID': 'inner_proj_horn_TR:S',     'Direction': (-1, -1)},
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL': {'OuterID': 'proj_horn_BL:S',     'InnerID': 'inner_proj_horn_BL:S',     'Direction': ( 1,  1)},
                },
            }
        ]
    }

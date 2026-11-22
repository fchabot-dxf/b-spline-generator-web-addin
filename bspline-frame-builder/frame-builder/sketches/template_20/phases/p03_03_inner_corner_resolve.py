def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 20 - Trapezoid): 4 corners.

    None of the 4 is a 90-degree corner in general (each side leans by its own
    seeded inset), so every corner declares Line1FarID / Line2FarID (the far end
    of the piece starting there, the far end of the piece arriving):
    fb_engine/inner_corners.py then computes the TRUE offset-line intersection
    (T84 item 9, Template 13's own fix), so each miter bisects its own corner's
    actual angle. `Direction` stays the declared fallback (exact only at 90
    degrees: a 0% inset's vertical side).

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
                    'TL': {'OuterID': 'proj_top_edge:S',    'InnerID': 'inner_proj_top_edge:S',    'Direction': ( 1, -1),
                           'Line1FarID': 'proj_top_edge:E',    'Line2FarID': 'proj_side_L:S'},
                    'TR': {'OuterID': 'proj_side_R:S',      'InnerID': 'inner_proj_side_R:S',      'Direction': (-1, -1),
                           'Line1FarID': 'proj_side_R:E',      'Line2FarID': 'proj_top_edge:S'},
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1),
                           'Line1FarID': 'proj_bottom_edge:E', 'Line2FarID': 'proj_side_R:S'},
                    'BL': {'OuterID': 'proj_side_L:S',      'InnerID': 'inner_proj_side_L:S',      'Direction': ( 1,  1),
                           'Line1FarID': 'proj_side_L:E',      'Line2FarID': 'proj_bottom_edge:S'},
                },
            }
        ]
    }

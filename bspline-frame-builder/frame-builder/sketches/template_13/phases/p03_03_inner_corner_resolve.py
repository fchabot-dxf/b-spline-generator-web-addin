def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve.

    Locates inner-enclosure corner SketchPoints by position and tags
    them under the miter target IDs. See template_1's copy for the
    full rationale.

    T84 item 9: TL/TR are NOT 90-degree corners (horn_TL/horn_TR are slanted lines meeting the
    narrow top_edge at 82 degrees, measured) -- the plain Direction*Distance approximation was off
    by ~0.11 in there, the real cause of neckWidth:min's own live Fusion build failure. Declares
    Line1FarID/Line2FarID so inner_corner_step computes the TRUE offset-line intersection instead
    (fb_engine.t11_geometry.line_line_inner_corner). BR/BL are genuine 90-degree corners (horn_BR/BL
    are Vertical, bottom_edge is horizontal by construction) -- left on the plain approximation,
    which is already exact there; no need to touch what isn't broken.
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
                           'Line1FarID': 'proj_top_edge:E', 'Line2FarID': 'proj_horn_TL:E'},
                    'TR': {'OuterID': 'proj_horn_TR:S',     'InnerID': 'inner_proj_horn_TR:S',     'Direction': (-1, -1),
                           'Line1FarID': 'proj_horn_TR:E',  'Line2FarID': 'proj_top_edge:S'},
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL': {'OuterID': 'proj_horn_BL:S',     'InnerID': 'inner_proj_horn_BL:S',     'Direction': ( 1,  1)},
                },
            }
        ]
    }

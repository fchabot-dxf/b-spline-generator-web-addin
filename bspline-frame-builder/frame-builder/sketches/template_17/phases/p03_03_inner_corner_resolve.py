def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 17 - Tulip): 6 corners, a MIX of two corner shapes.

    BR/BL: base (a straight line) meets a lower bulge (an arc) -- exactly like 2 of Template 16's
    own 6 corners, same `ResolveLineCircleCorner` (fb_engine/inner_corners.py), same Concave=False
    (the lower bulges' own centre sits on the material's interior side, confirmed numerically --
    see Template 16's own copy of this phase for the measurement).

    topR/waistR/waistL/topL: the OTHER 4 corners are arc-meets-arc (the arch meets a concave upper
    side, or a concave upper side meets a convex lower bulge) -- neither piece there is a straight
    line, so `ResolveLineCircleCorner` cannot resolve them. T84 item 3 adds
    `ResolveCircleCircleCorner` (fb_engine/inner_corners.py's own `circle_circle_corner_step`,
    built on `fb_engine.t7_roof_eave.circle_circle_corner`) for exactly this shape: each pair's two
    circles are intersected directly, each carrying its OWN Concave flag (False for the convex
    arch/lower bulges, True for the concave upper sides -- confirmed numerically the same way
    Template 16's own corners were: the upper arcs' own centre sits on the material's EXTERIOR
    side, the opposite of the convex pieces).

    Each corner's outer id picks WHICHEVER of its two meeting pieces' own `:S`/`:E` actually lands
    there (p02_02_loop.py's own docstring table -- IDENTICAL to Template 16's own table, since the
    concave upper arcs happen to agree with the suffixes the straight lines they replaced already
    had): this phase always resolves under the SAME owner piece Template 16 used (arch or the
    relevant lower bulge, never the upper arc), so p03_04_encl_miters.py's own Source/Target pairs
    are literally identical to Template 16's.
    """
    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveLineCircleCorner',
                'FrameThickness': 'frame_thickness',
                'Tolerance': 0.2,
                'Corners': {
                    # BR: base (far=BL, near=BR) meets lower_R. lower_R's own PHYSICAL BR end is
                    # its `:S` (swapped, p02_02_loop.py's own table).
                    'BR': {'LineFarID': 'proj_base:E', 'LineNearID': 'proj_base:S',
                           'ArcID': 'proj_lower_R', 'InnerID': 'inner_proj_lower_R:S', 'Concave': False},
                    # BL: base (far=BR, near=BL) meets lower_L. lower_L's own PHYSICAL BL end is
                    # its `:E` (swapped).
                    'BL': {'LineFarID': 'proj_base:S', 'LineNearID': 'proj_base:E',
                           'ArcID': 'proj_lower_L', 'InnerID': 'inner_proj_lower_L:E', 'Concave': False},
                },
            },
            {
                'Type': 'ResolveCircleCircleCorner',
                'FrameThickness': 'frame_thickness',
                'Tolerance': 0.2,
                'Corners': {
                    # topR: arch meets upper_R. Both physically land :S here (p02_02_loop.py's own
                    # table) -- resolved under arch's own name, same owner Template 16 used.
                    'topR': {'Arc1ID': 'proj_arch', 'Arc2ID': 'proj_upper_R', 'OuterID': 'proj_arch:S',
                             'InnerID': 'inner_proj_arch:S', 'Concave1': False, 'Concave2': True},
                    # waistR: lower_R meets upper_R. Both physically land :E here -- resolved
                    # under lower_R's own name, same owner Template 16 used.
                    'waistR': {'Arc1ID': 'proj_lower_R', 'Arc2ID': 'proj_upper_R', 'OuterID': 'proj_lower_R:E',
                               'InnerID': 'inner_proj_lower_R:E', 'Concave1': False, 'Concave2': True},
                    # waistL: lower_L meets upper_L. Both physically land :S here -- resolved
                    # under lower_L's own name.
                    'waistL': {'Arc1ID': 'proj_lower_L', 'Arc2ID': 'proj_upper_L', 'OuterID': 'proj_lower_L:S',
                               'InnerID': 'inner_proj_lower_L:S', 'Concave1': False, 'Concave2': True},
                    # topL: arch meets upper_L. Both physically land :E here -- resolved under
                    # arch's own name.
                    'topL': {'Arc1ID': 'proj_arch', 'Arc2ID': 'proj_upper_L', 'OuterID': 'proj_arch:E',
                             'InnerID': 'inner_proj_arch:E', 'Concave1': False, 'Concave2': True},
                },
            },
        ]
    }

def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 16 - Arched Funnel): 6 corners, ALL line-meets-circle.

    Unlike Template 7/11 (a mix of square base corners, a fixed-angle peak, and line-circle eave
    cusps), every one of T16's 6 corners is a LINE meeting a CIRCLE: each of the 3 arcs (arch,
    lower_R, lower_L) has a straight line on BOTH sides of it (upper_R/upper_L/base), since this
    template has no tangent chain at all -- every joint is an independent miter
    (fb_engine/t16_geometry.py's own module docstring). So this template needs only ONE resolver,
    `ResolveLineCircleCorner` (fb_engine/inner_corners.py, H23 item 38's own general
    line-meets-circle primitive, fb_engine.t7_roof_eave.line_circle_corner -- genuinely reusable
    despite living in a file named for T7, not a new mechanism for this template), computed LIVE
    from the real built geometry (the line's own endpoints, the circle's own centre/radius read
    straight off the real arc) instead of a Distance/Direction baked ahead of time.

    `concave` (line_circle_corner's own docstring): True when the circle's own centre sits on the
    material's EXTERIOR side (a dent/cove), False when it sits on the material's INTERIOR side (a
    normal outward bulge). All three of this template's arcs bulge OUTWARD, away from the board's
    own centreline, so all three have their centre on the material's INTERIOR side -- CONFIRMED
    numerically (2026-10-03), not assumed: at 7x9, arch_centre=(0, 1.29) sits well below its own
    chord (y=3.14, apex at y=4.5), i.e. on the same side as the board's own centre; lower_R_centre
    sits well to the LEFT of its own outward-bulging chord, same reasoning. `Concave: False`
    at every one of this template's 6 corners.

    Each corner's outer id picks WHICHEVER of its two meeting pieces' own `:S`/`:E` actually lands
    there (p02_02_loop.py's own docstring table -- 3 of these 6 corners are only reachable via an
    arc's `:E`, never its `:S`, because of Fusion's CCW-arc convention): this phase always
    resolves under the ARC's own name (never the line's), matching Template 7's own
    `ResolveLineCircleCorner` convention (its own eave corners resolve under `arc_neck_*`, not
    `roof_*`).
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
                    # topR: upper_R (far=waistR, near=topR) meets arch. arch:S is ALSO topR here
                    # (no :E needed for this particular corner -- see p02_02_loop.py's own table).
                    'topR': {'LineFarID': 'proj_upper_R:E', 'LineNearID': 'proj_upper_R:S',
                              'ArcID': 'proj_arch', 'InnerID': 'inner_proj_arch:S', 'Concave': False},
                    # waistR: upper_R (far=topR, near=waistR) meets lower_R. lower_R's own PHYSICAL
                    # waistR end is its `:E` (swapped, p02_02_loop.py's own table).
                    'waistR': {'LineFarID': 'proj_upper_R:S', 'LineNearID': 'proj_upper_R:E',
                               'ArcID': 'proj_lower_R', 'InnerID': 'inner_proj_lower_R:E', 'Concave': False},
                    # BR: base (far=BL, near=BR) meets lower_R. lower_R's own PHYSICAL BR end is
                    # its `:S` (swapped).
                    'BR': {'LineFarID': 'proj_base:E', 'LineNearID': 'proj_base:S',
                           'ArcID': 'proj_lower_R', 'InnerID': 'inner_proj_lower_R:S', 'Concave': False},
                    # BL: base (far=BR, near=BL) meets lower_L. lower_L's own PHYSICAL BL end is
                    # its `:E` (swapped).
                    'BL': {'LineFarID': 'proj_base:S', 'LineNearID': 'proj_base:E',
                           'ArcID': 'proj_lower_L', 'InnerID': 'inner_proj_lower_L:E', 'Concave': False},
                    # waistL: upper_L (far=topL, near=waistL) meets lower_L. lower_L's own
                    # PHYSICAL waistL end is its `:S` (swapped).
                    'waistL': {'LineFarID': 'proj_upper_L:E', 'LineNearID': 'proj_upper_L:S',
                               'ArcID': 'proj_lower_L', 'InnerID': 'inner_proj_lower_L:S', 'Concave': False},
                    # topL: upper_L (far=waistL, near=topL) meets arch. arch's own PHYSICAL topL
                    # end is its `:E` (swapped).
                    'topL': {'LineFarID': 'proj_upper_L:S', 'LineNearID': 'proj_upper_L:E',
                             'ArcID': 'proj_arch', 'InnerID': 'inner_proj_arch:E', 'Concave': False},
                },
            },
        ]
    }

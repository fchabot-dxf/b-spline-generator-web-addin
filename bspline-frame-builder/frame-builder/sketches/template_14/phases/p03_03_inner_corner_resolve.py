def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 14 - Sand Timer): 6 corners, a MIX of two corner shapes.

    topR/BR/BL/topL: a straight line (top or base) meets an outward-bulging arc -- exactly like 4
    of Template 16's own 6 corners, `ResolveLineCircleCorner` (fb_engine/inner_corners.py),
    Concave=False (every one of this template's 4 side arcs bulges OUTWARD, away from the board's
    own centreline, so each one's own centre sits on the material's INTERIOR side -- CONFIRMED
    numerically, 2026-10-03: at 6.5x8.5 (safe-zone), upper_r_centre=(-2.98, 4.54) sits well to the
    LEFT of its own outward-bulging chord (topR=(3.25,4.25) -> pinchR=(1.3,0)), same reasoning as
    Template 16's own lower bulges).

    pinchR/pinchL: the two side arcs of ONE side meet each other directly -- upper_R meets lower_R
    (and the mirror, lower_L meets upper_L) -- neither piece there is a straight line, so
    `ResolveLineCircleCorner` cannot resolve them. `ResolveCircleCircleCorner`
    (fb_engine/inner_corners.py's own `circle_circle_corner_step`, built on
    `fb_engine.t7_roof_eave.circle_circle_corner`, T84 item 3) resolves these: each pair's two
    circles are intersected directly. BOTH circles carry Concave=False here (both arcs bulge the
    SAME direction -- outward -- unlike Template 17's own circle-circle corners, which mix a convex
    arc with a concave one). CONFIRMED numerically, not assumed: resolving pinchR's own two circles
    with Concave1=Concave2=False lands the inner point on the board's own y=0 symmetry line very
    close to the centreline (x~0.11 at 6.5x8.5, frame_thickness=0.75) -- exactly the result the
    up/down mirror symmetry of upper_R/lower_R about y=0 REQUIRES (upper_r_centre and lower_r_centre
    are themselves exact y-mirrors of each other), which the other 3 flag combinations fail (two are
    off the symmetry line entirely, the fourth lands OUTSIDE the outer pinch point -- geometrically
    impossible for an inward offset). This is also exactly the "miters colliding" guard the dispatch
    calls out: a frame_thickness large enough relative to a narrow pinch pushes this inner point
    toward (or past) the centreline -- caught generically by frame-no-hooked-miters.test.js's own
    H23 item 39 sweep once this template is registered, no template-specific code needed here.

    Each corner's outer id picks WHICHEVER of its two meeting pieces' own `:S`/`:E` actually lands
    there (p02_02_loop.py's own docstring table).
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
                    # topR: top (far=topL, near=topR) meets upper_R. upper_R's own PHYSICAL topR
                    # end is its `:E` (swapped, p02_02_loop.py's own table).
                    'topR': {'LineFarID': 'proj_top:S', 'LineNearID': 'proj_top:E',
                             'ArcID': 'proj_upper_R', 'InnerID': 'inner_proj_upper_R:E', 'Concave': False},
                    # BR: base (far=BL, near=BR) meets lower_R. lower_R's own PHYSICAL BR end is
                    # its `:S` (swapped).
                    'BR': {'LineFarID': 'proj_base:E', 'LineNearID': 'proj_base:S',
                           'ArcID': 'proj_lower_R', 'InnerID': 'inner_proj_lower_R:S', 'Concave': False},
                    # BL: base (far=BR, near=BL) meets lower_L. lower_L's own PHYSICAL BL end is
                    # its `:E` (swapped).
                    'BL': {'LineFarID': 'proj_base:S', 'LineNearID': 'proj_base:E',
                           'ArcID': 'proj_lower_L', 'InnerID': 'inner_proj_lower_L:E', 'Concave': False},
                    # topL: top (far=topR, near=topL) meets upper_L. upper_L's own PHYSICAL topL
                    # end is its `:S` (swapped).
                    'topL': {'LineFarID': 'proj_top:E', 'LineNearID': 'proj_top:S',
                             'ArcID': 'proj_upper_L', 'InnerID': 'inner_proj_upper_L:S', 'Concave': False},
                },
            },
            {
                'Type': 'ResolveCircleCircleCorner',
                'FrameThickness': 'frame_thickness',
                'Tolerance': 0.2,
                'Corners': {
                    # pinchR: upper_R meets lower_R. upper_R's own PHYSICAL pinchR end is its `:S`
                    # (swapped); lower_R's own PHYSICAL pinchR end is its `:E` (swapped) -- resolved
                    # under upper_R's own name.
                    'pinchR': {'Arc1ID': 'proj_upper_R', 'Arc2ID': 'proj_lower_R', 'OuterID': 'proj_upper_R:S',
                               'InnerID': 'inner_proj_upper_R:S', 'Concave1': False, 'Concave2': False},
                    # pinchL: lower_L meets upper_L. lower_L's own PHYSICAL pinchL end is its `:S`
                    # (swapped); upper_L's own PHYSICAL pinchL end is its `:E` (swapped) -- resolved
                    # under upper_L's own name (the mirror of pinchR's own choice).
                    'pinchL': {'Arc1ID': 'proj_upper_L', 'Arc2ID': 'proj_lower_L', 'OuterID': 'proj_upper_L:E',
                               'InnerID': 'inner_proj_upper_L:E', 'Concave1': False, 'Concave2': False},
                },
            },
        ]
    }

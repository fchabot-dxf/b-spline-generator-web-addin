def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 15 - Flask): 6 corners, a MIX of two corner shapes.

    topR/topL: a straight line (top) meets ANOTHER straight line (neck_R/neck_L) -- a plain
    axis-aligned corner, unlike any of T14/T16/T17's own 6 corners (every one of theirs touches a
    circle). `ResolveInnerCorners` (fb_engine/inner_corners.py, Template 7's own base_R/base_L
    pattern) resolves these: each outer corner's inner SketchPoint is located by computed position
    (outer + Direction*Distance), not read off a circle at all.
      topR is at (topWidthFrac*hw, hh) -- the material sits at x < that (the neck's own interior)
        and y < hh (below the top edge), so inward is (-1,-1).
      topL is at (-topWidthFrac*hw, hh) -- the mirror: inward is (1,-1).

    neckBottomR/BR/BL/neckBottomL: a straight line (neck_R/neck_L, or base) meets the dome arc --
    exactly like T14/T16's own line-circle corners, `ResolveLineCircleCorner`
    (fb_engine/inner_corners.py), Concave=False (the dome bulges OUTWARD, away from the board's own
    centreline, so its own centre sits on the material's INTERIOR side -- same reasoning T14/T16's
    own module docstrings already give for their outward bulges, re-confirmed here via
    fb_engine/t15_flask_geometry.py's own module docstring on the SKETCH_2_PARAMETERS chain, which
    measured the actual resolved centre position before this was trusted).

    UNLIKE T14 (whose BR/BL had to be relabelled under `base` to avoid a declaredMiterJointIndices
    collision with its own circle-circle pinch corners), this template has NO circle-circle corners
    at all -- the dome arc only ever touches TWO corners (neckBottomR, BR on the right; mirrored on
    the left), so there is no collision to avoid: every line-circle corner below is labelled under
    its own arc, the same clean convention T16/T17 always use.

    Each corner's outer id picks WHICHEVER of its two meeting pieces' own `:S`/`:E` actually lands
    there (p02_02_loop.py's own docstring table). InnerID IS JUST AN OUTPUT LABEL (confirmed by
    reading `line_circle_corner_step`/`inner_corner_step` directly, fb_engine/inner_corners.py: both
    find the single nearest EXISTING SketchPoint to the computed corner and register it under
    InnerID) -- ArcID/OuterID are what actually supply the geometry.
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
                    # topR: neck_R's own physical topR end is its `:S` (unswapped -- a Line).
                    'topR': {'OuterID': 'proj_neck_R:S', 'InnerID': 'inner_proj_neck_R:S', 'Direction': (-1.0, -1.0)},
                    # topL: neck_L's own physical topL end is its `:E` (unswapped -- a Line).
                    'topL': {'OuterID': 'proj_neck_L:E', 'InnerID': 'inner_proj_neck_L:E', 'Direction': (1.0, -1.0)},
                },
            },
            {
                'Type': 'ResolveLineCircleCorner',
                'FrameThickness': 'frame_thickness',
                'Tolerance': 0.2,
                'Corners': {
                    # neckBottomR: neck_R (far=topR, near=neckBottomR) meets dome_R. dome_R's own
                    # PHYSICAL neckBottomR end is its `:E` (swapped, p02_02_loop.py's own table).
                    'neckBottomR': {'LineFarID': 'proj_neck_R:S', 'LineNearID': 'proj_neck_R:E',
                                    'ArcID': 'proj_dome_R', 'InnerID': 'inner_proj_dome_R:E', 'Concave': False},
                    # BR: base (far=BL, near=BR) meets dome_R. dome_R's own PHYSICAL BR end is its
                    # `:S` (swapped).
                    'BR': {'LineFarID': 'proj_base:E', 'LineNearID': 'proj_base:S',
                           'ArcID': 'proj_dome_R', 'InnerID': 'inner_proj_dome_R:S', 'Concave': False},
                    # BL: base (far=BR, near=BL) meets dome_L. dome_L's own PHYSICAL BL end is its
                    # `:E` (swapped).
                    'BL': {'LineFarID': 'proj_base:S', 'LineNearID': 'proj_base:E',
                           'ArcID': 'proj_dome_L', 'InnerID': 'inner_proj_dome_L:E', 'Concave': False},
                    # neckBottomL: neck_L (far=topL, near=neckBottomL) meets dome_L. dome_L's own
                    # PHYSICAL neckBottomL end is its `:S` (swapped).
                    'neckBottomL': {'LineFarID': 'proj_neck_L:E', 'LineNearID': 'proj_neck_L:S',
                                    'ArcID': 'proj_dome_L', 'InnerID': 'inner_proj_dome_L:S', 'Concave': False},
                },
            },
        ]
    }

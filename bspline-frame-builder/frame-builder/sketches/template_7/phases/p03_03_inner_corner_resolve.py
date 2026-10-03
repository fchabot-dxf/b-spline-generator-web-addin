def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 7 - Diamond-top Hourglass): 5 corners.

    Same resolver as every template (fb_engine/inner_corners.py) for peak/base: each outer
    corner's inner SketchPoint is located by computed POSITION (outer + Direction*Distance,
    within Tolerance), bypassing the offset's own curve-tagging fragility - see that module's own
    docstring.

      peak:    both roof lines at +/-45deg -> Direction=(0,-1), Distance = frame_thickness *
               sqrt(2) (the fixed numeric constant, not a Fusion sqrt() call - see
               t7_roof_eave.peak_inner_corner's own docstring for the derivation).
      base_R/L: a plain 90-degree axis-aligned corner (side meets base), same convention every
               other template's base corners already use - Direction=(+-1,1), Distance =
               'frame_thickness' (symbolic, always live).

    H23 item 38 (MEASURED: the app's own seeded neck/body handle proportions vary per Send -- a
    randomized Shape Lattice "Generate", not a fixed default -- so a Distance/Direction baked
    here ahead of time from t7_geometry.py's own DEFAULT proportions almost never matches the
    real corner; it was previously missing the intended target point by a wide margin, wide
    enough that Fusion's own profile classifier rejected the roof regions outright ("a miter did
    not split it") and extruded a degenerate sliver alongside each side bar):

      eave_R/L: now a 'ResolveLineCircleCorner' step (fb_engine/inner_corners.py) instead of a
               baked ResolveInnerCorners Distance/Direction -- it reads the REAL roof line and
               REAL (seeded) neck arc straight off the already-built sketch and computes the
               exact line-circle intersection LIVE (t7_roof_eave.line_circle_corner, the same
               proven math eave_inner_corner used, just fed live numbers instead of defaults).
               OuterID/InnerID pairs preserved exactly from the earlier declaration.
    """
    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness * 1.4142135623730951',  # sqrt(2), a fixed constant - see this module's own docstring
                'Tolerance': 0.05,
                'Corners': {
                    'peak': {'OuterID': 'proj_roof_R:S', 'InnerID': 'inner_proj_roof_R:S', 'Direction': (0.0, -1.0)},
                },
            },
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness',
                'Tolerance': 0.05,
                'Corners': {
                    'base_R': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1.0, 1.0)},
                    'base_L': {'OuterID': 'proj_side_L:S',      'InnerID': 'inner_proj_side_L:S',      'Direction': (1.0, 1.0)},
                },
            },
            {
                'Type': 'ResolveLineCircleCorner',
                'FrameThickness': 'frame_thickness',
                'Tolerance': 0.2,
                'Corners': {
                    # roof_R:S=peak (far from the arc), roof_R:E=E_R (tangent point, near the arc).
                    'eave_R': {'LineFarID': 'proj_roof_R:S', 'LineNearID': 'proj_roof_R:E',
                               'ArcID': 'proj_arc_neck_R', 'InnerID': 'inner_proj_arc_neck_R:S', 'Concave': True},
                    # roof_L:S=E_L (tangent point, near the arc), roof_L:E=peak (far) -- REVERSED
                    # vs the right side (p02_02_loop.py's own declared Points order).
                    'eave_L': {'LineFarID': 'proj_roof_L:E', 'LineNearID': 'proj_roof_L:S',
                               'ArcID': 'proj_arc_neck_L', 'InnerID': 'inner_proj_roof_L:S', 'Concave': True},
                },
            },
        ]
    }

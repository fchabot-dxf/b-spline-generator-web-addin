import math


def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 7 - Diamond-top Hourglass): 5
    corners. Same resolver as every template (fb_engine/inner_corners.py):
    each inner corner is the outer corner pulled in by frame_thickness
    along a declared (dx, dy), then the nearest SketchPoint is tagged.

    THE PEAK IS NOT AXIS-ALIGNED, so its own Direction is not a plain
    (+-1, +-1) like every other corner -- `inner_corners.py`'s own formula
    (`expected = outer + direction * dist`) is a per-axis SCALE, not
    restricted to +-1 by the code, only by convention (its own docstring
    says so, but never enforces it). Worked out by hand (both roof lines
    at 45 deg off vertical, meeting at a 90 deg apex): offsetting EACH
    roof line inward by `frame_thickness` (perpendicular to itself) and
    re-intersecting the two offset lines lands EXACTLY `frame_thickness *
    sqrt(2)` straight below the original peak, never sideways (the two
    lines' own x-offsets cancel by symmetry) -- confirmed algebraically,
    not assumed: solving the two offset line equations y = H -+ x -
    d*sqrt(2) for their intersection gives x=0, y = H - d*sqrt(2)
    directly. So Direction = (0, -sqrt(2)) here, the ONE corner in this
    codebase where that isn't (+-1, +-1) -- correct for exactly this
    reason, not a typo.

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
                    'peak':       {'OuterID': 'proj_roof_R:S',     'InnerID': 'inner_proj_roof_R:S',     'Direction': (0, -math.sqrt(2))},
                    'shoulder_R': {'OuterID': 'proj_ledge_R:S',    'InnerID': 'inner_proj_ledge_R:S',    'Direction': (-1, -1)},
                    'BR':         {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1, 1)},
                    'BL':         {'OuterID': 'proj_horn_BL:S',    'InnerID': 'inner_proj_horn_BL:S',    'Direction': (1, 1)},
                    'shoulder_L': {'OuterID': 'proj_roof_L:S',     'InnerID': 'inner_proj_roof_L:S',     'Direction': (1, -1)},
                },
            }
        ]
    }

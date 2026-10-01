def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 10 - Arched Hourglass).

    Resolves ONLY the 2 BOTTOM corners (BR, BL) by position -- identical to Template 1's own mechanism and
    rationale (fb_engine/inner_corners.py): a straight-line-to-straight-line corner's inner point is simply the
    outer corner pulled inward by frame_thickness along the two fixed axis directions, so it never collapses or
    merges under any frame_thickness.

    The TWO TOP corners (where a horn meets the arch) are deliberately NOT listed here: `ResolveInnerCorners`'s
    own (dx_sign, dy_sign) formula is only correct for an axis-aligned corner between two straight lines (the
    SAME magnitude pulled in on each axis independently reconstructs their true intersection) -- it does NOT
    hold for a line meeting a CURVE at a varying angle (this template's own point, Fred's "true bisector" ask: a
    semicircular rise gives a vertical, tangent-looking miter; a shallower one, a visibly slanted one). Fusion's
    own native Offset (p03_02) already produces the geometrically TRUE inner corner there (a real intersection of
    the offset line and the offset arc, exactly what a CAD offset computes, not an approximation) and tags its own
    curve endpoints the same way it already does at every tangent joint in every other template -- so
    `inner_proj_horn_TR:S` / `inner_proj_horn_TL:S` exist natively, with no extra resolve step, and p03_04's own
    miters reference them directly, the same as the two bottom corners below.
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
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL': {'OuterID': 'proj_horn_BL:S',     'InnerID': 'inner_proj_horn_BL:S',     'Direction': ( 1,  1)},
                },
            }
        ]
    }

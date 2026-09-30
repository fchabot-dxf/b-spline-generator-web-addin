def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset (Template 6 - Tab Top).
    The frame's inner edge: the 8-piece outline offset inward by
    frame_thickness. Every piece is a straight line, so each inner piece is
    a translated copy; at the 6 convex corners the copies meet inside, at
    the 2 inside (reflex) corners they are extended to meet (the inner
    corner sits t in from both lines, diagonally inside the reflex vertex).
    """
    outline_ids = [
        'proj_tab_top', 'proj_tab_side_R', 'proj_shoulder_R', 'proj_side_R',
        'proj_bottom_edge', 'proj_side_L', 'proj_shoulder_L', 'proj_tab_side_L',
    ]
    inner_ids = [f'inner_{eid}' for eid in outline_ids]

    return {
        "PhaseID": "p03_02_encl_offset",
        "Name": "Enclosure Offset",
        "Steps": [
            {
                "Type":         "Offset",
                "SourceID":     outline_ids,
                "DistanceExpr": "frame_thickness",
                "TargetIDs":    inner_ids,
                # CornerIDs intentionally omitted (as every template): the
                # miters reference the inner corners by parent-curve
                # endpoint names, resolved by position in p03_03.
            }
        ]
    }

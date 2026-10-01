def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset (Template 9 - I Shape).
    The frame's inner edge: the 12-piece outline offset inward by
    frame_thickness. Every piece is a straight line, so each inner piece is
    a translated copy; at the 8 convex corners the copies meet inside, at
    the 4 inside (reflex) corners they are extended to meet (the inner
    corner sits t in from both lines, diagonally inside the reflex vertex),
    exactly as Template 6's own single notch.
    """
    outline_ids = [
        'proj_top_edge', 'proj_flange_side_R', 'proj_shoulder_TR', 'proj_stem_side_R',
        'proj_shoulder_BR', 'proj_flange_side_BR', 'proj_bottom_edge', 'proj_flange_side_BL',
        'proj_shoulder_BL', 'proj_stem_side_L', 'proj_shoulder_TL', 'proj_flange_side_TL',
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

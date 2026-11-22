def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset (Template 20 - Trapezoid).
    The frame's inner edge: the 4-piece outline offset inward by
    frame_thickness. Every piece is a straight line, so each inner piece is a
    copy moved along its own normal, and the copies meet at the 4 inner
    corners, which p03_03 resolves by position.
    """
    outline_ids = ['proj_top_edge', 'proj_side_R', 'proj_bottom_edge', 'proj_side_L']
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

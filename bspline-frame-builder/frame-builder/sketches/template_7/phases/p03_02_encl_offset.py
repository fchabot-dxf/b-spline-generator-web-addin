def get_block(ui_data=None):
    """
    Enclosure Offset (Template 7 - Diamond-top Hourglass).
    Creates the frame silhouette by offsetting the construction outline inward by frame_thickness.
    The 9-piece loop, clockwise from the peak.
    """
    outline_ids = [
        'proj_roof_R', 'proj_arc_neck_R', 'proj_arc_body_R', 'proj_side_R', 'proj_bottom_edge',
        'proj_side_L', 'proj_arc_body_L', 'proj_arc_neck_L', 'proj_roof_L',
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
                # CornerIDs intentionally omitted, as every other template - p03_03/p03_04
                # reference the inner corners by computed position / parent-curve endpoint names,
                # not by the offset's own spatial classification.
            }
        ]
    }

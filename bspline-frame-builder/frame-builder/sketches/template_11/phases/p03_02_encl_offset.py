def get_block(ui_data=None):
    """
    Enclosure Offset (Template 11 - Diamond-top, 3-arc Hourglass).
    Creates the frame silhouette by offsetting the construction outline inward by frame_thickness.
    The 13-piece loop, clockwise from the peak.
    """
    outline_ids = [
        'proj_roof_R', 'proj_eave_straight_R', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R',
        'proj_side_straight_R', 'proj_bottom_edge',
        'proj_side_straight_L', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L',
        'proj_eave_straight_L', 'proj_roof_L',
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

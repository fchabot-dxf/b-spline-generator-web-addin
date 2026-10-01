def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset (Template 7 - Diamond-top Hourglass).
    The frame's inner edge: the 15-piece outline offset inward by
    frame_thickness. CornerIDs intentionally omitted (as every template):
    the miters reference the inner corners by parent-curve endpoint
    names, resolved by position in p03_03.
    """
    outline_ids = [
        'proj_roof_R', 'proj_ledge_R', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R',
        'proj_horn_BR', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L',
        'proj_arc_shoulder_L', 'proj_horn_TL', 'proj_ledge_L', 'proj_roof_L',
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
            }
        ]
    }

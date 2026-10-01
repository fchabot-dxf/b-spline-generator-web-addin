def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset (Template 8 - Dipped Top + Left-Only Wave).
    Creates the jesmonite frame silhouette by offsetting the construction outline.
    The 12-piece loop, clockwise from the top-right corner.
    """
    outline_ids = [
        'proj_side_R', 'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L',
        'proj_arc_shoulder_L', 'proj_horn_TL', 'proj_top_edge_L', 'proj_arc_top_shoulder_L', 'proj_arc_top_dip',
        'proj_arc_top_shoulder_R', 'proj_top_edge_R',
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
                # CornerIDs intentionally omitted, as Template 5 - p03_04_encl_miters references the inner
                # offset corners by parent-curve endpoint names, not by spatial classification.
            }
        ]
    }

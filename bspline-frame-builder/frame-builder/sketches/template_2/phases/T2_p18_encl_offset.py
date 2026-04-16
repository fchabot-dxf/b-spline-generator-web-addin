def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset.
    Creates the jesmonite frame silhouette by offsetting the construction outline.
    """
    outline_ids = [
        'proj_top_edge', 'proj_horn_TR', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR',
        'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_horn_TL'
    ]
    inner_ids = [f'inner_{eid}' for eid in outline_ids]

    return {
        "PhaseID": "p18_encl_offset",
        "Name": "Enclosure Offset",
        "Steps": [
            {
                "Type":         "Offset",
                "SourceID":     outline_ids,
                "DistanceExpr": "frame_thickness",
                "TargetIDs":    inner_ids,
                "CornerIDs":    {'TL': 'inner_corner_TL', 'TR': 'inner_corner_TR', 'BL': 'inner_corner_BL', 'BR': 'inner_corner_BR'}
            }
        ]
    }

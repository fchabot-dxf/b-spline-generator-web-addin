def get_block(ui_data=None):
    """
    Phase 17: Enclosure Offset.
    Creates the jesmonite frame silhouette by offsetting the construction outline.

    Identical to Template 1's own. Fusion's own Offset computes the TRUE inward offset of whatever `proj_top_edge`
    solved to -- for Template 10 an arc, concentric at (radius - frame_thickness), same operation it already
    performs for the shoulder/waist/hip arcs, nothing new to this step.
    """
    outline_ids = [
        'proj_top_edge', 'proj_horn_TR', 'proj_arc_shoulder_R', 'proj_arc_waist_R', 'proj_arc_hip_R', 'proj_horn_BR',
        'proj_bottom_edge', 'proj_horn_BL', 'proj_arc_hip_L', 'proj_arc_waist_L', 'proj_arc_shoulder_L', 'proj_horn_TL'
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

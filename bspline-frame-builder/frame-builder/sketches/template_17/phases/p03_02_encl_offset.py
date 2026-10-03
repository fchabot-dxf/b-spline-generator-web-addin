def get_block(ui_data=None):
    """
    Enclosure Offset (Template 17 - Tulip).
    Creates the frame silhouette by offsetting the construction outline inward by frame_thickness.
    The 6-piece loop, clockwise from the top-right corner.
    """
    outline_ids = ['proj_upper_R', 'proj_lower_R', 'proj_base', 'proj_lower_L', 'proj_upper_L', 'proj_arch']
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

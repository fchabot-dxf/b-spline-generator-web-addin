def get_block(ui_data=None):
    """
    Phase 0b: Bounding Box Offset.
    Creates the 'Safe Zone' for the frame silhouette.
    Tags the four corners as reference anchors for Sketch 2.
    """
    return {
        "PhaseID": "p01_02_bb_offset",
        "Name": "Safe Zone Offset",
        "Steps": [
            {
                "Type": "Offset",
                "SourceID": ["BB_top", "BB_right", "BB_bottom", "BB_left"],
                "DistanceExpr": "boundingboxoffset",
                "TargetIDs": ["offset_BB_top", "offset_BB_right", "offset_BB_bottom", "offset_BB_left"],
                "CornerIDs": {
                    "TL": "offset_BB_corner_TL",
                    "TR": "offset_BB_corner_TR",
                    "BL": "offset_BB_corner_BL",
                    "BR": "offset_BB_corner_BR"
                }
            }
        ]
    }

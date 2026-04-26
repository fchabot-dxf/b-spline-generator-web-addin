def get_block(ui_data=None):
    """
    Phase 0b: Bounding Box Offset.
    Creates the 'Safe Zone' for the frame silhouette.

    No CornerIDs are needed: downstream phases reference the safe-zone
    corners via the rail endpoints (offset_BB_top:S for TL,
    offset_BB_right:S for TR, etc.) under the "start of next curve"
    naming convention. Parent-curve endpoints are deterministic across
    the offset operation, so a separate spatial-classification tagging
    step would be redundant.
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
            }
        ]
    }

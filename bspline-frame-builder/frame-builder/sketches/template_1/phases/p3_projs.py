def get_block(ui_data=None):
    """
    Phase 1: Projections.
    Grabs the reference corners from the layout sketch.
    """
    return {
        "Name": "Projections",
        "Projections": [
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_TL', 'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_TR', 'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_BL', 'TargetID': 'proj_off_corner_BL'},
            {'SourceSketch': '1_bounding-box', 'SourceID': 'BB_corner_BR', 'TargetID': 'proj_off_corner_BR'},
        ]
    }

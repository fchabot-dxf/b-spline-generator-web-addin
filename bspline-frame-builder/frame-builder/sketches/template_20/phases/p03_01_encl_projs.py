def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections (Template 20 - Trapezoid).
    Projects the 4 outline pieces into the enclosure sketch, clockwise from the
    top-left corner. Every corner is the :S end of the piece that starts there
    (the "start of next curve" rule):
      TL -> proj_top_edge:S     TR -> proj_side_R:S
      BR -> proj_bottom_edge:S  BL -> proj_side_L:S
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge',    'TargetID': 'proj_top_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_R',      'TargetID': 'proj_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge', 'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_L',      'TargetID': 'proj_side_L'},
        ]
    }

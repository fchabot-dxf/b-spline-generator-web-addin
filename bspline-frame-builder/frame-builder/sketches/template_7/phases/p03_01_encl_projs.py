def get_block(ui_data=None):
    """
    Enclosure Projections (Template 7 - Diamond-top Hourglass).
    Projects the 9-piece silhouette into the enclosure sketch, clockwise from the peak (matches
    template_data.py's FRAME_SEED_MAP `prim` order):
      roof_R, arc_neck_R, arc_body_R, side_R, bottom_edge, side_L, arc_body_L, arc_neck_L, roof_L.
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'roof_R',      'TargetID': 'proj_roof_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_neck_R',  'TargetID': 'proj_arc_neck_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_body_R',  'TargetID': 'proj_arc_body_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_R',      'TargetID': 'proj_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge', 'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_L',      'TargetID': 'proj_side_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_body_L',  'TargetID': 'proj_arc_body_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_neck_L',  'TargetID': 'proj_arc_neck_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'roof_L',      'TargetID': 'proj_roof_L'},
        ]
    }

def get_block(ui_data=None):
    """
    Enclosure Projections (Template 11 - Diamond-top, 3-arc Hourglass).
    Projects the 13-piece silhouette into the enclosure sketch, clockwise from the peak (matches
    template_data.py's FRAME_SEED_MAP `prim` order).
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'roof_R',          'TargetID': 'proj_roof_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'eave_straight_R', 'TargetID': 'proj_eave_straight_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_R',  'TargetID': 'proj_arc_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_R',     'TargetID': 'proj_arc_waist_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_R',       'TargetID': 'proj_arc_hip_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_straight_R', 'TargetID': 'proj_side_straight_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',     'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_straight_L', 'TargetID': 'proj_side_straight_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_L',       'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_L',     'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_L',  'TargetID': 'proj_arc_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'eave_straight_L', 'TargetID': 'proj_eave_straight_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'roof_L',          'TargetID': 'proj_roof_L'},
        ]
    }

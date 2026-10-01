def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections (Template 7 - Diamond-top Hourglass).
    Projects the 15 outline pieces into the enclosure sketch, clockwise
    from the peak. Every corner is the :S end of the piece that starts
    there (the "start of next curve" rule):
      peak       -> proj_roof_R:S       shoulder_R -> proj_ledge_R:S
      BR         -> proj_bottom_edge:S  BL         -> proj_horn_BL:S
      shoulder_L -> proj_roof_L:S
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'roof_R',           'TargetID': 'proj_roof_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'ledge_R',          'TargetID': 'proj_ledge_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TR',          'TargetID': 'proj_horn_TR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_R',   'TargetID': 'proj_arc_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_R',      'TargetID': 'proj_arc_waist_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_R',        'TargetID': 'proj_arc_hip_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BR',          'TargetID': 'proj_horn_BR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',      'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BL',          'TargetID': 'proj_horn_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_L',        'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_L',      'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_L',   'TargetID': 'proj_arc_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TL',          'TargetID': 'proj_horn_TL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'ledge_L',          'TargetID': 'proj_ledge_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'roof_L',           'TargetID': 'proj_roof_L'},
        ]
    }

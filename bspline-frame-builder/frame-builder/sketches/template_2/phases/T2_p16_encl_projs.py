def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections.
    Projects the silhouette and anchor points into the enclosure sketch.
    """
    return {
        "PhaseID": "p16_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            # The Main Loop (Used for Offset)
            {'SourceSketch': '2_shape-outline', 'SourceID': 'top_edge',           'TargetID': 'proj_top_edge'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_TR',            'TargetID': 'proj_horn_TR'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'arc_waist_R',        'TargetID': 'proj_arc_waist_R'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'arc_hip_R',          'TargetID': 'proj_arc_hip_R'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_BR',            'TargetID': 'proj_horn_BR'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'bottom_edge',        'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_BL',            'TargetID': 'proj_horn_BL'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'arc_hip_L',          'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'arc_waist_L',        'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_TL',            'TargetID': 'proj_horn_TL'},
            
            # The Anchor Points (Used for Miters)
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_TL:S',          'TargetID': 'proj_anchor_TL'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_TR:S',          'TargetID': 'proj_anchor_TR'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'horn_BR:S',          'TargetID': 'proj_anchor_BR'},
            {'SourceSketch': '2_shape-outline', 'SourceID': 'bottom_edge:E',      'TargetID': 'proj_anchor_BL'},
        ]
    }

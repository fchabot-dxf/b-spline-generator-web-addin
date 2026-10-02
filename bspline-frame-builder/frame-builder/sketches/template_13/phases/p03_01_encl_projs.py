def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections.
    Projects the silhouette curves into the enclosure sketch.

    Anchor SketchPoints removed - see template_1's copy of this phase
    for the full rationale. Miters now source from parent-curve
    endpoints (proj_top_edge:S, proj_horn_TR:S, etc.) rather than from
    separately-projected anchor points.
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge',           'TargetID': 'proj_top_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TR',            'TargetID': 'proj_horn_TR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_R',        'TargetID': 'proj_arc_waist_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_R',          'TargetID': 'proj_arc_hip_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BR',            'TargetID': 'proj_horn_BR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',        'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BL',            'TargetID': 'proj_horn_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_L',          'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_L',        'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TL',            'TargetID': 'proj_horn_TL'},
        ]
    }

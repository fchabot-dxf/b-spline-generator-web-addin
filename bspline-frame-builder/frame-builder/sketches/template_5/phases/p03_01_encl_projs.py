def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections (Template 5 - Hourglass Dipped Top).
    Projects the silhouette curves into the enclosure sketch.

    T5: Template 1's projections with the one top_edge replaced by the
    dipped top's five pieces, in clockwise order from the top-left corner:
    top_edge_L, arc_top_shoulder_L, arc_top_dip, arc_top_shoulder_R,
    top_edge_R.

    Anchor SketchPoints (proj_anchor_TL/TR/BR/BL) are no longer
    projected separately - they were redundant with the curve endpoints
    that projection already creates. The miter phase now sources
    directly from the parent-curve endpoint convention used on the
    target side, so no separate anchors are needed:
      TL -> proj_top_edge_L:S  (T5: the left stub starts at TL going CW)
      TR -> proj_horn_TR:S     (horn_TR starts at TR going down)
      BR -> proj_bottom_edge:S (bottom_edge starts at BR going CCW)
      BL -> proj_horn_BL:S     (horn_BL starts at BL going up)
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge_L',         'TargetID': 'proj_top_edge_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_top_shoulder_L', 'TargetID': 'proj_arc_top_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_top_dip',        'TargetID': 'proj_arc_top_dip'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_top_shoulder_R', 'TargetID': 'proj_arc_top_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge_R',         'TargetID': 'proj_top_edge_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TR',            'TargetID': 'proj_horn_TR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_R',     'TargetID': 'proj_arc_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_R',        'TargetID': 'proj_arc_waist_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_R',          'TargetID': 'proj_arc_hip_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BR',            'TargetID': 'proj_horn_BR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',        'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BL',            'TargetID': 'proj_horn_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_L',          'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_L',        'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_L',     'TargetID': 'proj_arc_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TL',            'TargetID': 'proj_horn_TL'},
        ]
    }

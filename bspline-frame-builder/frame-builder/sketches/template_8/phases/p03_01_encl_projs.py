def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections (Template 8 - Dipped Top + Left-Only Wave).
    Projects the silhouette curves into the enclosure sketch.

    T8: 12 pieces, clockwise from the top-right corner (matches template_data.py's FRAME_SEED_MAP `prim` order):
    side_R, bottom_edge, horn_BL, arc_hip_L, arc_waist_L, arc_shoulder_L, horn_TL, top_edge_L,
    arc_top_shoulder_L, arc_top_dip, arc_top_shoulder_R, top_edge_R.

    Anchor SketchPoints are not projected separately - projection already creates curve endpoint vertices at each
    corner (as every other template). The miter phase sources directly from the parent-curve endpoint convention:
      TL -> proj_top_edge_L:S  (the left stub starts at TL going right)
      TR -> proj_side_R:S      (side_R starts at TR going down)
      BR -> proj_bottom_edge:S (bottom_edge starts at BR going left)
      BL -> proj_horn_BL:S     (horn_BL starts at BL going up)
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_R',              'TargetID': 'proj_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',         'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_BL',             'TargetID': 'proj_horn_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_hip_L',           'TargetID': 'proj_arc_hip_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_waist_L',         'TargetID': 'proj_arc_waist_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_shoulder_L',      'TargetID': 'proj_arc_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'horn_TL',             'TargetID': 'proj_horn_TL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge_L',          'TargetID': 'proj_top_edge_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_top_shoulder_L',  'TargetID': 'proj_arc_top_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_top_dip',         'TargetID': 'proj_arc_top_dip'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'arc_top_shoulder_R',  'TargetID': 'proj_arc_top_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge_R',          'TargetID': 'proj_top_edge_R'},
        ]
    }

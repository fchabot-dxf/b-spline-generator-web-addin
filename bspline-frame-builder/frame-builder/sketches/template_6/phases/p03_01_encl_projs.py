def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections (Template 6 - Tab Top).
    Projects the 8 outline pieces into the enclosure sketch, clockwise from
    the tab's top-left corner. Every corner is the :S end of the piece that
    starts there (the "start of next curve" rule), the two inside corners
    included:
      tab TL -> proj_tab_top:S       tab TR -> proj_tab_side_R:S
      inside R -> proj_shoulder_R:S  shoulder R -> proj_side_R:S
      BR -> proj_bottom_edge:S       BL -> proj_side_L:S
      shoulder L -> proj_shoulder_L:S  inside L -> proj_tab_side_L:S
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'tab_top',     'TargetID': 'proj_tab_top'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'tab_side_R',  'TargetID': 'proj_tab_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'shoulder_R',  'TargetID': 'proj_shoulder_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_R',      'TargetID': 'proj_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge', 'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'side_L',      'TargetID': 'proj_side_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'shoulder_L',  'TargetID': 'proj_shoulder_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'tab_side_L',  'TargetID': 'proj_tab_side_L'},
        ]
    }

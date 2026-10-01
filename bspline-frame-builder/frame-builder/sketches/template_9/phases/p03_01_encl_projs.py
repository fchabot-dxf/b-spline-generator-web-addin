def get_block(ui_data=None):
    """
    Phase 15: Enclosure Projections (Template 9 - I Shape).
    Projects the 12 outline pieces into the enclosure sketch, clockwise from
    the top-left corner. Every corner is the :S end of the piece that starts
    there (the "start of next curve" rule), the 4 inside corners included
    (each a shoulder meeting a stem side):
      TL -> proj_top_edge:S                TR -> proj_flange_side_R:S
      notch TR outer -> proj_shoulder_TR:S notch TR inner -> proj_stem_side_R:S
      notch BR inner -> proj_shoulder_BR:S notch BR outer -> proj_flange_side_BR:S
      BR -> proj_bottom_edge:S             BL -> proj_flange_side_BL:S
      notch BL outer -> proj_shoulder_BL:S notch BL inner -> proj_stem_side_L:S
      notch TL inner -> proj_shoulder_TL:S notch TL outer -> proj_flange_side_TL:S
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top_edge',       'TargetID': 'proj_top_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'flange_side_R',  'TargetID': 'proj_flange_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'shoulder_TR',    'TargetID': 'proj_shoulder_TR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'stem_side_R',    'TargetID': 'proj_stem_side_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'shoulder_BR',    'TargetID': 'proj_shoulder_BR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'flange_side_BR', 'TargetID': 'proj_flange_side_BR'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'bottom_edge',    'TargetID': 'proj_bottom_edge'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'flange_side_BL', 'TargetID': 'proj_flange_side_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'shoulder_BL',    'TargetID': 'proj_shoulder_BL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'stem_side_L',    'TargetID': 'proj_stem_side_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'shoulder_TL',    'TargetID': 'proj_shoulder_TL'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'flange_side_TL', 'TargetID': 'proj_flange_side_TL'},
        ]
    }

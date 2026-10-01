def get_block(ui_data=None):
    """
    Phase 1: Projections (Template 8 - Dipped Top + Left-Only Wave; a copy of Template 1's).
    Grabs the four safe-zone corners from the layout sketch.

    Naming convention: "start of next curve" applied to the offset BB
    rectangle traversed clockwise. Each corner is the :S endpoint of
    the rail that begins at that joint going CW:
      TL = offset_BB_top:S    (top runs L->R, starts at TL)
      TR = offset_BB_right:S  (right runs T->B, starts at TR)
      BR = offset_BB_bottom:S (bottom runs R->L, starts at BR)
      BL = offset_BB_left:S   (left runs B->T, starts at BL)
    """
    return {
        "PhaseID": "p02_01_projs",
        "Name": "Projections",
        "Projections": [
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_top:S',    'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_right:S',  'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_bottom:S', 'TargetID': 'proj_off_corner_BR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_left:S',   'TargetID': 'proj_off_corner_BL'},
        ]
    }

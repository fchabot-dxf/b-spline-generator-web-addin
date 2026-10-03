def get_block(ui_data=None):
    """
    Phase 1: Projections (Template 14 - Sand Timer).

    Same convention as Template 7/11/16's own copy of this phase: only the 2 base corners are real
    bounding-box anchors (everything else -- the top, the two pinches, the four bulges -- is
    positioned by its own HW/HH expression in p02_02, never touching the bounding box directly).

      BR = offset_BB_bottom:S (bottom runs R->L, starts at BR)
      BL = offset_BB_left:S   (left runs B->T, starts at BL)
    """
    return {
        "PhaseID": "p02_01_projs",
        "Name": "Projections",
        "Projections": [
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_bottom:S', 'TargetID': 'proj_off_corner_BR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_left:S',   'TargetID': 'proj_off_corner_BL'},
        ]
    }

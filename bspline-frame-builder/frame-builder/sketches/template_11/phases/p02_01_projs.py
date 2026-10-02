def get_block(ui_data=None):
    """
    Phase 1: Projections (Template 11 - Diamond-top, 3-arc Hourglass).

    Same convention as Template 7's own copy of this phase (see that file's own doc comment for the
    full rationale): only the 2 base corners are real bounding-box anchors. The peak sits mid-edge
    (top-centre), the eave is positioned by the SAME roof/eave expressions Template 7 uses (reused
    verbatim, fb_engine/t7_roof_eave.py), and every shoulder/waist/hip point is positioned by its own
    HW/HH/A expression (p02_02) -- none of them touch the bounding box directly.

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

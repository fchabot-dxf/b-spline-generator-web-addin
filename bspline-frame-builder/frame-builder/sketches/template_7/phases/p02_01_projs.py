def get_block(ui_data=None):
    """
    Phase 1: Projections (Template 7 - Diamond-top Hourglass).

    Only the 2 base corners are needed as real anchors: the peak sits mid-edge
    (top-centre, not a bounding-box corner) and the eave/neck/body points are
    positioned by their own HW/HH expressions (p02_02), same as Template 8's
    dip stubs are never anchored except at the actual corners they touch.

    Naming convention: "start of next curve" applied to the offset BB
    rectangle traversed clockwise - see template_1's copy of this phase for
    the full rationale.
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

def get_block(ui_data=None):
    """
    Phase 1: Projections.
    Grabs the four safe-zone corners from the layout sketch, and (T3) the
    safe zone's top edge for the narrow top to ride on.

    Naming convention: "start of next curve" applied to the offset BB
    rectangle traversed clockwise. Each corner is the :S endpoint of
    the rail that begins at that joint going CW:
      TL = offset_BB_top:S    (top runs L->R, starts at TL)
      TR = offset_BB_right:S  (right runs T->B, starts at TR)
      BR = offset_BB_bottom:S (bottom runs R->L, starts at BR)
      BL = offset_BB_left:S   (left runs B->T, starts at BL)
    Replaces the earlier offset_BB_corner_TL/TR/BL/BR scheme that
    relied on spatial classification at offset time. Parent-curve
    endpoints are deterministic (Fusion preserves rail orientation
    through the offset) and don't need a separate tagging step.
    """
    return {
        "PhaseID": "p02_01_projs",
        "Name": "Projections",
        "Projections": [
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_top:S',    'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_right:S',  'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_bottom:S', 'TargetID': 'proj_off_corner_BR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_left:S',   'TargetID': 'proj_off_corner_BL'},
            # T3 TAPERED HOURGLASS: the safe zone's whole top edge, as Template 2 projects it: the narrow
            # top edge rides on it (p02_03: Horizontal + top_edge:S on this line) instead of being pinned to the
            # top corners (which would force the top as wide as the base).
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_top',      'TargetID': 'proj_off_BB_top'},
        ]
    }

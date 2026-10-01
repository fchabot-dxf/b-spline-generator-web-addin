def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 9 - I Shape).

    1. Head-to-tail: each piece's end on the next piece's start, closing
       the 12-piece loop (12 Coincidents).
    2. Anchors: BOTH the top edge and the base span the full width (unlike
       Template 6's tab, whose width is free), so all 4 corners are pinned
       directly to the projected safe-zone corners (Template 1's rule).
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['top_edge:E',       'flange_side_R:S']},
        {'Type': 'Coincident', 'Targets': ['flange_side_R:E',  'shoulder_TR:S']},
        {'Type': 'Coincident', 'Targets': ['shoulder_TR:E',    'stem_side_R:S']},
        {'Type': 'Coincident', 'Targets': ['stem_side_R:E',    'shoulder_BR:S']},
        {'Type': 'Coincident', 'Targets': ['shoulder_BR:E',    'flange_side_BR:S']},
        {'Type': 'Coincident', 'Targets': ['flange_side_BR:E', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E',    'flange_side_BL:S']},
        {'Type': 'Coincident', 'Targets': ['flange_side_BL:E', 'shoulder_BL:S']},
        {'Type': 'Coincident', 'Targets': ['shoulder_BL:E',    'stem_side_L:S']},
        {'Type': 'Coincident', 'Targets': ['stem_side_L:E',    'shoulder_TL:S']},
        {'Type': 'Coincident', 'Targets': ['shoulder_TL:E',    'flange_side_TL:S']},
        {'Type': 'Coincident', 'Targets': ['flange_side_TL:E', 'top_edge:S']},

        {'Type': 'Coincident', 'Targets': ['top_edge:S',       'proj_off_corner_TL']},
        {'Type': 'Coincident', 'Targets': ['top_edge:E',       'proj_off_corner_TR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S',    'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E',    'proj_off_corner_BL']},
    ]
    return {
        'Name': 'Loop Welds',
        'PhaseID': 'p02_03_welds',
        'BuildSequence': seq,
    }

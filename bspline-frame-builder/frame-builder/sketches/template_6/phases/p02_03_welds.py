def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 6 - Tab Top).

    1. Head-to-tail: each piece's end on the next piece's start, closing
       the 8-piece loop (8 Coincidents).
    2. Anchors: the base on the two projected safe-zone bottom corners
       (Template 1's corner rule), the tab's top-left corner on the safe
       zone's top LINE (Template 2's narrow-top rule: its width is free).
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['tab_top:E',     'tab_side_R:S']},
        {'Type': 'Coincident', 'Targets': ['tab_side_R:E',  'shoulder_R:S']},
        {'Type': 'Coincident', 'Targets': ['shoulder_R:E',  'side_R:S']},
        {'Type': 'Coincident', 'Targets': ['side_R:E',      'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'side_L:S']},
        {'Type': 'Coincident', 'Targets': ['side_L:E',      'shoulder_L:S']},
        {'Type': 'Coincident', 'Targets': ['shoulder_L:E',  'tab_side_L:S']},
        {'Type': 'Coincident', 'Targets': ['tab_side_L:E',  'tab_top:S']},

        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['tab_top:S',     'proj_off_BB_top']},
    ]
    return {
        'Name': 'Loop Welds',
        'PhaseID': 'p02_03_welds',
        'BuildSequence': seq,
    }

def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 20 - Trapezoid).

    1. Head-to-tail: each piece's end on the next piece's start, closing the
       4-piece loop (4 Coincidents).
    2. Anchors: the top piece's start on the safe zone's top LINE, the bottom
       piece's start on its bottom LINE (with p02_04's Horizontals each whole
       side lies on its line). No corner pin: which side is wide (narrow side
       Up or Down) and where each narrow end sits (Left / Right inset, each on
       its own) are the seeds' -- one constraint set builds every case.
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['top_edge:E',    'side_R:S']},
        {'Type': 'Coincident', 'Targets': ['side_R:E',      'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'side_L:S']},
        {'Type': 'Coincident', 'Targets': ['side_L:E',      'top_edge:S']},

        {'Type': 'Coincident', 'Targets': ['top_edge:S',    'proj_off_BB_top']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_BB_bottom']},
    ]
    return {
        'Name': 'Loop Welds',
        'PhaseID': 'p02_03_welds',
        'BuildSequence': seq,
    }

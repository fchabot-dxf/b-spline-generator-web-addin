def get_block(ui_data=None):
    """
    Orientation (Template 9 - I Shape): every piece axis-aligned.

    Vertical: the 2 flange sides on each of the left/right edges plus the 2
    stem sides (6 pieces). Horizontal: the 4 shoulders. NOT the top edge or
    the base: all 4 of their ends are already pinned to the projected
    corners (p02_03), so a Horizontal on either would repeat them
    (VCS_SKETCH_OVER_CONSTRAINTS, Template 6's own finding).
    """
    seq = [
        {'Type': 'Vertical',   'Targets': ['flange_side_R', 'stem_side_R', 'flange_side_BR',
                                            'flange_side_BL', 'stem_side_L', 'flange_side_TL']},
        {'Type': 'Horizontal', 'Targets': ['shoulder_TR', 'shoulder_BR', 'shoulder_BL', 'shoulder_TL']},
    ]
    return {
        'Name': 'Orientation',
        'PhaseID': 'p02_04_orientation',
        'BuildSequence': seq,
    }

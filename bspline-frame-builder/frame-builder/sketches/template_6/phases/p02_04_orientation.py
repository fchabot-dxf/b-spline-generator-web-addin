def get_block(ui_data=None):
    """
    Orientation (Template 6 - Tab Top): every piece axis-aligned.

    Vertical: the two sides and the two tab sides. Horizontal: the tab top
    and the two shoulders. NOT the base: its two ends are already pinned to
    the projected bottom corners, so a Horizontal on it would repeat them
    (VCS_SKETCH_OVER_CONSTRAINTS).
    """
    seq = [
        {'Type': 'Vertical',   'Targets': ['side_R', 'side_L', 'tab_side_R', 'tab_side_L']},
        {'Type': 'Horizontal', 'Targets': ['tab_top', 'shoulder_R', 'shoulder_L']},
    ]
    return {
        'Name': 'Orientation',
        'PhaseID': 'p02_04_orientation',
        'BuildSequence': seq,
    }

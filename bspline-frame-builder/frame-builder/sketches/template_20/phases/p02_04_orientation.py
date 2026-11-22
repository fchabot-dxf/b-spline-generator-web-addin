def get_block(ui_data=None):
    """
    Orientation (Template 20 - Trapezoid): the two horizontal sides parallel.

    DOF after p02_02..p02_03: 4 vertices = 8 values; the two line anchors fix 2,
    these two Horizontals 2, so 4 are left -- the 4 corner x values, all seeded
    (the wide side's two ends at the safe-zone corners, the narrow side's at the
    app's Left / Right inset). The slanted sides get no constraint: their lean
    is whatever those x values make it (a 0% inset = a vertical side).
    """
    seq = [
        {'Type': 'Horizontal', 'Targets': ['top_edge', 'bottom_edge']},
    ]
    return {
        'Name': 'Orientation',
        'PhaseID': 'p02_04_orientation',
        'BuildSequence': seq,
    }

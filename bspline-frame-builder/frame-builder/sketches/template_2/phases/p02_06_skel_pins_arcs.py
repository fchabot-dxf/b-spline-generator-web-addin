def get_block(ui_data=None):
    """Auto-generated phase block."""
    seq = [
        {'Type': 'Coincident', 'Targets': ["arc_waist_L:C", "p02_SketchLine_02:E"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine:S", "arc_waist_R:C"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine_03:E", "arc_hip_L:C"]},
        {'Type': 'Coincident', 'Targets': ["arc_hip_R:C", "p02_SketchLine_04:S"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine_04"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine_03"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine"]},
        {'Type': 'Horizontal', 'Targets': ["p02_SketchLine_02"]},
    ]
    return {
        'Name': 'p02_06_skel_pins_arcs',
        'PhaseID': 'p02_06_skel_pins_arcs',
        'BuildSequence': seq,
    }
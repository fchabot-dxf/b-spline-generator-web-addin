def get_block(ui_data=None):
    """
    Pin the skeleton lines' open ends to the arc centers.

    Horizontal constraints on p02_SketchLine / _02 / _03 / _04 are NOT
    applied here - p02_02_anatomy already constrains them horizontal
    when it seeds the skeleton, so re-applying here fails with
    "Constraint has already been applied to the selected sketch object".
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ["arc_waist_L:C",      "p02_SketchLine_02:E"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine:S",   "arc_waist_R:C"]},
        {'Type': 'Coincident', 'Targets': ["p02_SketchLine_03:E", "arc_hip_L:C"]},
        {'Type': 'Coincident', 'Targets': ["arc_hip_R:C",        "p02_SketchLine_04:S"]},
    ]
    return {
        'Name': 'p02_06_skel_pins_arcs',
        'PhaseID': 'p02_06_skel_pins_arcs',
        'BuildSequence': seq,
    }

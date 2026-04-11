def get_block(ui_data=None):
    """
    Phase 5: Aesthetic Shaping.
    Procedural tangency and global curvature rules.
    """
    seq = [
        # HORN TANGENCY (Vertical Entry/Exit)
        {'Type': 'Tangent',    'Targets': ['horn_TR',          'arc_shoulder_R']},
        {'Type': 'Tangent',    'Targets': ['arc_hip_R',        'horn_BR']},
        {'Type': 'Tangent',    'Targets': ['arc_shoulder_L',   'horn_TL']},
        {'Type': 'Tangent',    'Targets': ['horn_BL',          'arc_hip_L']},

        # GLOBAL CHAIN TANGENCY
        {'Type': 'Tangent',    'Targets': ['arc_shoulder_R', 'arc_waist_R']},
        {'Type': 'Tangent',    'Targets': ['arc_waist_R',    'arc_hip_R']},
        {'Type': 'Tangent',    'Targets': ['arc_shoulder_L', 'arc_waist_L']},
        {'Type': 'Tangent',    'Targets': ['arc_waist_L',    'arc_hip_L']},
    ]

    return {
        "Name": "Shaping",
        "BuildSequence": seq
    }

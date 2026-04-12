def get_block(ui_data=None):
    """
    Phase 5b: Horn Tangency.
    Enforces G1 continuity between the anatomical arcs and the vertical horns.
    Applied after the anatomical arc chain is finished, ensuring the
    transition to the top/bottom corners is perfectly smooth.
    """
    seq = [
        # SHOULDER TO HORN
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_R', 'horn_TR']},
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_L', 'horn_TL']},

        # HIP TO HORN
        {'Type': 'Tangent', 'Targets': ['arc_hip_R',      'horn_BR']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_L',      'horn_BL']},
    ]

    return {
        "Name": "Horn Tangency",
        "BuildSequence": seq
    }

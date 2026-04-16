def get_block(ui_data=None):
    """
    Phase 5b: Horn Tangency.
    Enforces G1 continuity between the anatomical arcs and the vertical horns.
    Applied after the anatomical arc chain is finished, ensuring the
    transition to the top/bottom corners is perfectly smooth.
    """
    seq = [
        # WAIST TO HORN
        {'Type': 'Tangent', 'Targets': ['arc_waist_R', 'horn_TR']},
        {'Type': 'Tangent', 'Targets': ['arc_waist_L', 'horn_TL']},

        # HIP TO HORN
        {'Type': 'Tangent', 'Targets': ['arc_hip_R',      'horn_BR']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_L',      'horn_BL']},
    ]

    return {
        "PhaseID": "p11_horn_tangency",
        "Name": "Horn Tangency",
        "BuildSequence": seq
    }

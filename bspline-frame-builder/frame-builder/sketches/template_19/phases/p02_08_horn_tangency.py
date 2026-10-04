def get_block(ui_data=None):
    """
    Phase 5b: Horn Tangency.
    Enforces G1 continuity between the anatomical arcs and the vertical horns.
    Applied after the anatomical arc chain is finished, ensuring the
    transition to the top/bottom corners is perfectly smooth.

    Identical to Template 1's own (the sides are untouched by the top arch; the TOP horns' own tangency here is
    still to their own shoulder arc, at their BOTTOM end -- unaffected by the arch now meeting them at the TOP).
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
        "PhaseID": "p02_08_horn_tangency",
        "Name": "Horn Tangency",
        "BuildSequence": seq
    }

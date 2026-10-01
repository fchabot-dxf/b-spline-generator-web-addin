def get_block(ui_data=None):
    """
    Phase 5b: Horn Tangency (Template 8 - Dipped Top + Left-Only Wave).
    Enforces G1 continuity between the anatomical arcs and the vertical horn / straight stub on the LEFT side and
    the TOP dip. No RIGHT side entry: `side_R` meets its own corners directly, no arc transition needed.
    """
    seq = [
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_L', 'horn_TL']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_L',      'horn_BL']},

        # TOP SHOULDER TO STUB (the dipped top's straight stubs, as a side's horns)
        {'Type': 'Tangent', 'Targets': ['arc_top_shoulder_L', 'top_edge_L']},
        {'Type': 'Tangent', 'Targets': ['arc_top_shoulder_R', 'top_edge_R']},
    ]

    return {
        "PhaseID": "p02_08_horn_tangency",
        "Name": "Horn Tangency",
        "BuildSequence": seq
    }

def get_block(ui_data=None):
    """
    Phase 5: Arc Trio Tangency.
    Enforces G1 continuity across each adjacent arc pair on both sides.
    Applied after arc-to-arc Coincidents (Phase 4) so the solver has
    shared endpoints before smoothness is imposed.
    """
    seq = [
        # RIGHT side
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_R', 'arc_waist_R']},
        {'Type': 'Tangent', 'Targets': ['arc_waist_R',    'arc_hip_R']},

        # LEFT side
        {'Type': 'Tangent', 'Targets': ['arc_hip_L',      'arc_waist_L']},
        {'Type': 'Tangent', 'Targets': ['arc_waist_L',    'arc_shoulder_L']},
    ]

    return {
        "Name": "ArcTangency",
        "PhaseID": "p02_07_tangency",
        "BuildSequence": seq
    }

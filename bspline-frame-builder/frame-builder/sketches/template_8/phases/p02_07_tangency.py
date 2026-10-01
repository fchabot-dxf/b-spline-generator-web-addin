def get_block(ui_data=None):
    """
    Phase 5: Arc Trio Tangency (Template 8 - Dipped Top + Left-Only Wave).
    Enforces G1 continuity across each adjacent arc pair, on the LEFT side and the TOP dip. No RIGHT side entry:
    `side_R` is a straight line with no arc neighbour to be tangent to (it's already collinear with its own
    horn-less corners by construction, see p02_03's own doc comment).
    """
    seq = [
        # LEFT side
        {'Type': 'Tangent', 'Targets': ['arc_hip_L',      'arc_waist_L']},
        {'Type': 'Tangent', 'Targets': ['arc_waist_L',    'arc_shoulder_L']},

        # TOP: shoulder, dip, shoulder (as a side's shoulder, waist, hip)
        {'Type': 'Tangent', 'Targets': ['arc_top_shoulder_L', 'arc_top_dip']},
        {'Type': 'Tangent', 'Targets': ['arc_top_dip',        'arc_top_shoulder_R']},
    ]

    return {
        "Name": "ArcTangency",
        "PhaseID": "p02_07_tangency",
        "BuildSequence": seq
    }

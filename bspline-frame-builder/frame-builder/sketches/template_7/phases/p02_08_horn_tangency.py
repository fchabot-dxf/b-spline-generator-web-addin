def get_block(ui_data=None):
    """
    Phase 5b: Horn Tangency (T7: unchanged from Template 1).
    Enforces G1 continuity between the anatomical arcs and the vertical
    horns. The horn's OTHER end (meeting the roof, p02_03_loop.py) is
    deliberately NOT tangent -- a genuine mitered corner, the same way
    Template 1's own horn/top_edge corner was never tangent either.
    """
    seq = [
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_R', 'horn_TR']},
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_L', 'horn_TL']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_R',      'horn_BR']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_L',      'horn_BL']},
    ]

    return {
        "PhaseID": "p02_08_horn_tangency",
        "Name": "Horn Tangency",
        "BuildSequence": seq
    }

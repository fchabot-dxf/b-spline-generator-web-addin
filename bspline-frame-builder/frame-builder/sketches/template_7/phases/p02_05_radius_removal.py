def get_block(ui_data=None):
    """
    Final pulse (Template 7 - Diamond-top Hourglass).
    H23 item 27 (the T11 recipe): no seed Radius dimension is declared any more (p02_02_loop.py's
    own docstring) -- each arc is seeded with its TRUE closed-form via point instead, so there is
    nothing left to delete here (T11's own equivalent phase, lane-b's p02_04_tangency.py, says the
    same: "no seed Radius to delete first and no joint to Fix afterwards"). Kept as its own phase
    file (not merged into p02_04) to avoid shifting every other phase's own step-count/ordering.
    """
    seq = [
        # Pulse to snap the solved loop into the viewport (as every other template's final p02 phase).
        {'Type': 'Pulse'}
    ]

    return {
        "PhaseID": "p02_05_radius_removal",
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

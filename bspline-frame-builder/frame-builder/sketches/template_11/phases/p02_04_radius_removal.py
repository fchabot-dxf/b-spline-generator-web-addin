def get_block(ui_data=None):
    """
    Radius Removal (Template 11 - Diamond-top, 3-arc Hourglass).

    Deletes the 6 temporary seed radius dimensions (shoulder/waist/hip, both sides) -- moved BEFORE
    Tangent (p02_05) this turn, not after, per a live finding (WORK-LOG-lane-b.md Turn 220): with the
    seed Radius dimension still present, each arc's SIZE is completely pinned, so a Tangent constraint
    added afterward can only reposition/reorient the (wrong-sized) arc to satisfy tangency, never
    resize it -- confirmed live, every arc stayed at its literal seed radius (1.5*HW) after the OLD
    seed-radius-then-tangent-then-delete order. Deleting the Radius dimension FIRST leaves each arc's
    curvature genuinely free, so the Tangent constraints that follow can actually solve it.
    """
    seq = [
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_L'},
    ]

    return {
        "PhaseID": "p02_04_radius_removal",
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

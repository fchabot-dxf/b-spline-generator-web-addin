def get_block(ui_data=None):
    """
    Radius Removal (Template 11 - Diamond-top, 3-arc Hourglass).
    Deletes the 6 temporary seed radius dimensions (shoulder/waist/hip, both sides) once tangency
    (p02_04) has taken over - same pattern as Template 7's own p02_05_radius_removal.py.
    """
    seq = [
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_L'},

        # Pulse to snap the solved loop into the viewport (as every other template's final p02 phase).
        {'Type': 'Pulse'}
    ]

    return {
        "PhaseID": "p02_05_radius_removal",
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

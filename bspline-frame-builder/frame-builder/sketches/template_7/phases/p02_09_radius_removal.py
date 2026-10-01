def get_block(ui_data=None):
    """
    Step 11: Radius Removal (T7: unchanged from Template 1).
    Surgically deletes the temporary seed radius dimensions.
    """
    seq = [
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_R'},

        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_L'},
    ]

    return {
        "PhaseID": "p02_09_radius_removal",
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

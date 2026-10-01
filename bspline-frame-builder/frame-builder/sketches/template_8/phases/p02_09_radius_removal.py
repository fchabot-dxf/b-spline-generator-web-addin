def get_block(ui_data=None):
    """
    Step 11: Radius Removal (Template 8 - Dipped Top + Left-Only Wave).
    Surgically deletes the temporary seed radius dimensions, once tangency has taken over.
    """
    seq = [
        # LEFT side radii
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_hip_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_waist_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_shoulder_L'},

        # Top dip radii
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_top_shoulder_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_top_dip'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_top_shoulder_R'},
    ]

    return {
        "PhaseID": "p02_09_radius_removal",
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

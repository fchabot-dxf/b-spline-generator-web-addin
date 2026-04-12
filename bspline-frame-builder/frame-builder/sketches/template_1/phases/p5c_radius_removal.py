def get_block(ui_data=None):
    """
    Phase 5c: Radius Removal.
    Surgically deletes the temporary seed radius dimensions 
    added in Phase 3. This releases the 'training wheels' 
    after the loop is fully tangent and pinned, allowing 
    the solver to settle perfectly.
    """
    seq = [
        # Right Side Radii
        {'Type': 'DeleteDimension', 'Name': 'dim_seed_rad_shoulder_R'},
        {'Type': 'DeleteDimension', 'Name': 'dim_seed_rad_waist_R'},
        {'Type': 'DeleteDimension', 'Name': 'dim_seed_rad_hip_R'},

        # Left Side Radii
        {'Type': 'DeleteDimension', 'Name': 'dim_seed_rad_shoulder_L'},
        {'Type': 'DeleteDimension', 'Name': 'dim_seed_rad_waist_L'},
        {'Type': 'DeleteDimension', 'Name': 'dim_seed_rad_hip_L'},
    ]

    return {
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

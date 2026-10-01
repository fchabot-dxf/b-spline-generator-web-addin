def get_block(ui_data=None):
    """
    Radius Removal (Template 7 - Diamond-top Hourglass).
    Deletes the 4 temporary seed radius dimensions once tangency (p02_04) has taken over - same
    pattern as every other template with chained/tangent arcs (e.g. Template 8's own
    p02_09_radius_removal.py).
    """
    seq = [
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_neck_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_body_R'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_body_L'},
        {'Type': 'DeleteDimension', 'Name': 'seed_rad_neck_L'},

        # Pulse to snap the solved loop into the viewport (as every other template's final p02 phase).
        {'Type': 'Pulse'}
    ]

    return {
        "PhaseID": "p02_05_radius_removal",
        "Name": "Radius Removal",
        "BuildSequence": seq
    }

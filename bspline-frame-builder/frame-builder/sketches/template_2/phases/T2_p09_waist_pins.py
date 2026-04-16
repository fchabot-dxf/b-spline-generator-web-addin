def get_block(ui_data=None):
    """
    Phase 4c: Waist Pins.
    Surgically anchors the waist arc centers to the skeleton endpoints
    BEFORE the tangency solver runs. This stabilizes the waist region
    and prevents arc-flipping during the shaping phase.
    """
    seq = [
        # NECK-TO-SKELETON WELDS: waist arc centers → neck hub endpoints
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:C', 'skel_neck_pin_R:E'], 'Name': 'neck_center_pin_R'},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:C', 'skel_neck_pin_L:E'], 'Name': 'neck_center_pin_L'},
    ]

    return {
        "PhaseID": "p09_waist_pins",
        "Name": "Waist Pins",
        "BuildSequence": seq
    }

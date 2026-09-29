def get_block(ui_data=None):
    """
    Phase 4c: Waist Pins.
    Surgically anchors the waist arc centers to the skeleton endpoints
    BEFORE the tangency solver runs. This stabilizes the waist region
    and prevents arc-flipping during the shaping phase.

    T5: the dipped top's dip arc centre goes ON the Y axis here too (one
    equation: the dip is centred; with p02_11's Equal on the two top
    shoulders the whole top is then symmetric). Its height is left to the
    seeds, like Template 1's radii.
    """
    seq = [
        # WAIST-TO-SKELETON WELDS: waist arc centers → waist hub endpoints
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:C', 'skel_waist_pin_R:E'], 'Name': 'waist_center_pin_R'},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:C', 'skel_waist_pin_L:E'], 'Name': 'waist_center_pin_L'},
        # T5 TOP: the dip centred
        {'Type': 'Coincident', 'Targets': ['arc_top_dip:C', 'Y_AXIS'], 'Name': 'top_dip_center_on_axis'},
    ]

    return {
        "PhaseID": "p02_06_waist_pins",
        "Name": "Waist Pins",
        "BuildSequence": seq
    }

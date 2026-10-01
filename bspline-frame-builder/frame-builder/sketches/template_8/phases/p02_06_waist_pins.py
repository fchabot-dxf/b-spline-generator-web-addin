def get_block(ui_data=None):
    """
    Phase 4c: Waist Pin (Template 8 - Dipped Top + Left-Only Wave).
    Surgically anchors the LEFT waist arc's centre to the skeleton endpoint BEFORE the tangency solver runs, as
    Template 1's own waist pins. No RIGHT waist pin (no right pinch at all).

    No dip-centre pin (unlike Template 5's `Coincident(arc_top_dip:C, Y_AXIS)`): Fred's sketch puts the dip off
    centre, so its horizontal position is left to the seeds (like Template 1 leaves its radii to seeds) rather
    than pinned to the Y axis - the app's own "dip position" handle (seeded) is what actually places it at Send
    time. Leaving this unpinned trades 1 DOF that used to force symmetry for 1 DOF of genuine horizontal freedom;
    p02_11's `top_shoulder_equal` still ties the two shoulder radii together (a shared-radius, off-centre wave -
    see that phase's own doc comment).
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:C', 'skel_waist_pin_L:E'], 'Name': 'waist_center_pin_L'},
    ]

    return {
        "PhaseID": "p02_06_waist_pins",
        "Name": "Waist Pins",
        "BuildSequence": seq
    }

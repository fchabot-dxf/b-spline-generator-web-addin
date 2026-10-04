def get_block(ui_data=None):
    """
    Step 13: Symmetry Finalization.
    Re-introduces skeletal equality constraints after all silhouette welds
    have settled. This ensures symmetry without stressing the initial placement of arcs.

    Identical to Template 1's own (the sides are untouched by the top arch; the arch's own left/right symmetry
    is a SEPARATE constraint, p02_03's own `Symmetry(top_edge:S, top_edge:E, Y_AXIS)`, not this phase's).
    """
    seq = [
        # SKELETAL EQUALITY: Force mirroring of the anatomy foundation.
        {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L'], 'Name': 'shoulder_equal', 'CK': 'ck_skel_shoulder_equal'},
        {'Type': 'Equal', 'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L'],    'Name': 'waist_equal',    'CK': 'ck_skel_waist_equal'},

        # Pulse to snap symmetry into the viewport
        {'Type': 'Pulse'}
    ]

    return {"Name": "Symmetry", "PhaseID": "p02_11_symmetry", "BuildSequence": seq}

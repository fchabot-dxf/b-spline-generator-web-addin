def get_block(ui_data=None):
    """
    Step 13: Symmetry Finalization (T7: unchanged from Template 1).
    Re-introduces skeletal equality constraints after all silhouette
    welds have settled. This ensures symmetry without stressing the
    initial placement of arcs. The roof/peak needs no separate symmetry
    constraint of its own -- see p02_03_loop.py's own docstring (the
    peak's position is pinned by the 45-45-90 construction pair, and
    roof_L then follows from its own two already-fixed endpoints).
    """
    seq = [
        {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L'], 'Name': 'shoulder_equal', 'CK': 'ck_skel_shoulder_equal'},
        {'Type': 'Equal', 'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L'],    'Name': 'waist_equal',    'CK': 'ck_skel_waist_equal'},

        {'Type': 'Pulse'}
    ]

    return {"Name": "Symmetry", "PhaseID": "p02_11_symmetry", "BuildSequence": seq}

def get_block(ui_data=None):
    """
    Step 13: Symmetry Finalization.
    Re-introduces skeletal equality constraints after all silhouette welds 
    have settled. This ensures symmetry without stressing the initial placement of arcs.
    """
    seq = [
        # SKELETAL EQUALITY: Force mirroring of the anatomy foundation.
        #
        # hip_equal removed - hip seeds are already exactly symmetric
        # (widthIn * +/-0.34996) and the hip arc centers (which the hip
        # pin outer endpoints are welded to in p02_10) are fully
        # determined by symmetric S/B/E seeds, so hip pin lengths are
        # already equal by construction. Re-asserting Equal on top of
        # that fails with VCS_SKETCH_OVER_CONSTRAINTS.
        # Shoulder still benefits (L seed is -0.350521 vs R 0.34996).
        # Waist kept defensively in case future seed edits diverge.
        {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L'], 'Name': 'shoulder_equal', 'CK': 'ck_skel_shoulder_equal'},
        {'Type': 'Equal', 'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L'],    'Name': 'waist_equal',    'CK': 'ck_skel_waist_equal'},

        # Pulse to snap symmetry into the viewport
        {'Type': 'Pulse'}
    ]

    return {"Name": "Symmetry", "PhaseID": "p02_11_symmetry", "BuildSequence": seq}

def get_block(ui_data=None):
    """
    Phase 6: Skeleton Welds (Template 8 - Dipped Top + Left-Only Wave).
    Anchors the LEFT arc chain to the parametric skeleton using arc centre points (:C). No RIGHT side pair (no
    right pinch, so no `Pulse` between two pairs is needed either - only one).
    """
    seq = [
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_shoulder_pin_L:E'], 'Name': 'shoulder_center_pin_L', 'CK': 'ck_arc_shoulder_weld', 'AllowNudge': True},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_hip_pin_L:E'],      'Name': 'hip_center_pin_L',      'CK': 'ck_arc_hip_weld',      'AllowNudge': True},
    ]

    return {"Name": "Welds", "PhaseID": "p02_10_welds", "BuildSequence": seq}

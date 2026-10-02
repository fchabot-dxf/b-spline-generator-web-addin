def get_block(ui_data=None):
    """
    Phase 6: Skeleton Welds.
    Anchors the arc chain to the parametric skeleton using arc center points (:C),
    and connects horn endpoints directly to arc start points (Tip Welds).
    No point-on-curve constraints — all welds are center-to-hub Coincidents.
    """
    seq = [
        # PAIR 1: RIGHT SIDE (VERTICAL)
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:C', 'skel_shoulder_pin_R:E'], 'Name': 'shoulder_center_pin_R', 'CK': 'ck_arc_shoulder_weld', 'AllowNudge': True},
        {'Type': 'Coincident', 'Targets': ['arc_hip_R:C',      'skel_hip_pin_R:E'],      'Name': 'hip_center_pin_R',      'CK': 'ck_arc_hip_weld',      'AllowNudge': True},

        {'Type': 'Pulse'},

        # PAIR 2: LEFT SIDE (VERTICAL)
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_shoulder_pin_L:E'], 'Name': 'shoulder_center_pin_L', 'CK': 'ck_arc_shoulder_weld', 'AllowNudge': True},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_hip_pin_L:E'],      'Name': 'hip_center_pin_L',      'CK': 'ck_arc_hip_weld',      'AllowNudge': True},
    ]

    return {"Name": "Welds", "PhaseID": "p02_10_welds", "BuildSequence": seq}

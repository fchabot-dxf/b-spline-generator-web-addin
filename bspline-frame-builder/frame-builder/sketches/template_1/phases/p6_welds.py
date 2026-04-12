def get_block(ui_data=None):
    """
    Phase 6: Skeleton Welds.
    Anchors the arc chain to the parametric skeleton using arc center points (:C),
    and connects horn endpoints directly to arc start points (Tip Welds).
    No point-on-curve constraints — all welds are center-to-hub Coincidents.
    """
    seq = [
        # ARC-TO-SKELETON WELDS: shoulder and hip arc centers → anatomy hub endpoints
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:C', 'skel_shoulder_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:C', 'skel_shoulder_pin_L:E']},
        {'Type': 'Coincident', 'Targets': ['arc_hip_R:C',      'skel_hip_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:C',      'skel_hip_pin_L:E']},

    ]

    return {"Name": "Welds", "BuildSequence": seq}

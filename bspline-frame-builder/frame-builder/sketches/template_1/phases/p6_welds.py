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

        # WAIST-TO-SKELETON WELDS: waist arc centers → waist hub endpoints
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:C', 'skel_waist_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:C', 'skel_waist_pin_L:E']},

        # TIP WELDS: horn :E endpoints → arc endpoints at the horn-tip level
        # TR/BL horns connect to arc :S (those arcs start at the horn tip)
        # BR/TL horns connect to arc :E (those arcs end at the horn tip)
        {'Type': 'Coincident', 'Targets': ['horn_TR:E', 'arc_shoulder_R:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:E', 'arc_hip_R:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:E', 'arc_shoulder_L:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E', 'arc_hip_L:S']},
    ]

    return {"Name": "Welds", "BuildSequence": seq}

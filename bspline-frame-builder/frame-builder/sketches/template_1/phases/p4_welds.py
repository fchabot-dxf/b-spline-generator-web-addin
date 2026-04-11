def get_block(ui_data=None):
    """
    Phase 4: Fusion Welds.
    The "Anti-Flip" anchoring of the silhouette to the anatomy.
    """
    seq = [
        # HUB WELDS: Weld endpoints to anatomical hubs
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'skel_shoulder_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:S', 'skel_shoulder_pin_L:E']},
        {'Type': 'Coincident', 'Targets': ['arc_hip_R:S',      'skel_hip_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:E',      'skel_hip_pin_L:E']},

        # SILHOUETTE WELDS: Point-on-Curve for waist arcs
        {'Type': 'Coincident', 'Targets': ['arc_waist_R',      'skel_waist_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L',      'skel_waist_pin_L:E']},

        # TIP WELDS: Align horns to pins
        {'Type': 'Coincident', 'Targets': ['horn_TR:E', 'skel_shoulder_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'skel_hip_pin_R:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'skel_shoulder_pin_L:E']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E', 'skel_hip_pin_L:E']},

        # CHAIN STITCHING: Head-to-Tail connectivity
        {'Type': 'Coincident', 'Targets': ['top_edge:E',    'horn_TR:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:E',     'arc_shoulder_R:S']},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:E',    'arc_hip_R:S']},
        {'Type': 'Coincident', 'Targets': ['arc_hip_R:E',     'horn_BR:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:E',     'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'horn_BL:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:E',     'arc_hip_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:E',      'arc_waist_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E',    'arc_shoulder_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'horn_TL:S']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:E',     'top_edge:S']},
    ]

    return {
        "Name": "Welds",
        "BuildSequence": seq
    }

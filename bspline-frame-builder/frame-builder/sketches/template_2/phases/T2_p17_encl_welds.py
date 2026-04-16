def get_block(ui_data=None):
    """
    Phase 16: Enclosure Welds (Stitching).
    Welds the projected silhouette curves together in Sketch 3.
    This creates the closed loop required for the parametric Offset to succeed.
    """
    seq = [
        # Loop stitching: Connect each projected curve's End to the next one's Start
        {'Type': 'Coincident', 'Targets': ['proj_top_edge:E',           'proj_horn_TR:S']},
        {'Type': 'Coincident', 'Targets': ['proj_horn_TR:E',            'proj_arc_waist_R:S']},
        {'Type': 'Coincident', 'Targets': ['proj_arc_waist_R:E',        'proj_arc_hip_R:S']},
        {'Type': 'Coincident', 'Targets': ['proj_arc_hip_R:E',          'proj_horn_BR:S']},
        {'Type': 'Coincident', 'Targets': ['proj_horn_BR:E',            'proj_bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['proj_bottom_edge:E',        'proj_horn_BL:S']},
        {'Type': 'Coincident', 'Targets': ['proj_horn_BL:E',            'proj_arc_hip_L:S']},
        {'Type': 'Coincident', 'Targets': ['proj_arc_hip_L:E',          'proj_arc_waist_L:S']},
        {'Type': 'Coincident', 'Targets': ['proj_arc_waist_L:E',        'proj_horn_TL:S']},
        {'Type': 'Coincident', 'Targets': ['proj_horn_TL:E',            'proj_top_edge:S']}, # Closing the master loop
    ]

    return {"Name": "Enclosure Welds", "PhaseID": "p17_encl_welds", "BuildSequence": seq}

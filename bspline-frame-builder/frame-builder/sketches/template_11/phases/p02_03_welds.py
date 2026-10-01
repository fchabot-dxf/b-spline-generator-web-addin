def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 11 - Diamond-top, 3-arc Hourglass).

    1. Head-to-tail: each piece's end meets the next piece's start, closing the 13-piece loop
       (p02_02_loop.py's own doc comment: clockwise from the peak).
    2. Corner topology: exactly ONE direct anchor per base corner (every other template's own
       convention - every other piece meeting there welds to that anchor's own endpoint, never
       independently to the projected corner). The peak and the two eave tips have no bounding-box
       anchor at all; their absolute position comes purely from their own HW/HH/A expressions in
       p02_02_loop.py, welded together here.
    """
    seq = [
        # Peak: roof_R starts there, roof_L ends there.
        {'Type': 'Coincident', 'Targets': ['roof_R:S', 'roof_L:E'], 'Name': 'peak_weld'},

        # Right side: eave tip (miter, roof -> eave-straight), then the 3-arc tangent chain, then the
        # straight run to the hip horn.
        {'Type': 'Coincident', 'Targets': ['roof_R:E', 'eave_straight_R:S'], 'Name': 'eave_weld_R'},
        {'Type': 'Coincident', 'Targets': ['eave_straight_R:E', 'arc_shoulder_R:S'], 'Name': 'eave_shoulder_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:E', 'arc_waist_R:S'], 'Name': 'shoulder_waist_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:E', 'arc_hip_R:S'], 'Name': 'waist_hip_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_hip_R:E', 'side_straight_R:S'], 'Name': 'hip_side_weld_R'},

        # Base-right: bottom_edge is the ONE direct anchor; side_straight_R welds to it.
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['side_straight_R:E', 'bottom_edge:S'], 'Name': 'base_R_weld'},

        # Base-left: side_straight_L is the ONE direct anchor; bottom_edge welds to it.
        {'Type': 'Coincident', 'Targets': ['side_straight_L:S', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'side_straight_L:S'], 'Name': 'base_L_weld'},

        # Left side (mirror): straight run, 3-arc tangent chain, eave tip.
        {'Type': 'Coincident', 'Targets': ['side_straight_L:E', 'arc_hip_L:S'], 'Name': 'hip_side_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:E', 'arc_waist_L:S'], 'Name': 'waist_hip_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:S'], 'Name': 'shoulder_waist_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:E', 'eave_straight_L:S'], 'Name': 'eave_shoulder_weld_L'},
        {'Type': 'Coincident', 'Targets': ['eave_straight_L:E', 'roof_L:S'], 'Name': 'eave_weld_L'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

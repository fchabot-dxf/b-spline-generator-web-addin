def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 7 - Diamond-top Hourglass).

    1. Head-to-tail: each piece's end meets the next piece's start, closing the 9-piece loop
       (p02_02_loop.py's own doc comment: clockwise from the peak).
    2. Corner topology: exactly ONE direct anchor per base corner (Template 1/5/6/8's own
       convention - every other piece meeting there welds to that anchor's own endpoint, never
       independently to the projected corner). The peak and the two eave tips have no bounding-box
       anchor at all (they are not BB corners); their absolute position comes purely from their own
       HW/HH expressions in p02_02_loop.py, welded together here.
    """
    seq = [
        # Peak: roof_R starts there, roof_L ends there.
        {'Type': 'Coincident', 'Targets': ['roof_R:S', 'roof_L:E'], 'Name': 'peak_weld'},

        # Right side: eave tip, neck/body join, body/line join.
        {'Type': 'Coincident', 'Targets': ['roof_R:E', 'arc_neck_R:S'], 'Name': 'eave_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_neck_R:E', 'arc_body_R:S'], 'Name': 'neck_body_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_body_R:E', 'side_R:S'], 'Name': 'body_line_weld_R'},

        # Base-right: bottom_edge is the ONE direct anchor; side_R welds to it.
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['side_R:E', 'bottom_edge:S'], 'Name': 'base_R_weld'},

        # Base-left: side_L is the ONE direct anchor; bottom_edge welds to it.
        {'Type': 'Coincident', 'Targets': ['side_L:S', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'side_L:S'], 'Name': 'base_L_weld'},

        # Left side (mirror): line/body join, body/neck join, eave tip.
        {'Type': 'Coincident', 'Targets': ['side_L:E', 'arc_body_L:S'], 'Name': 'body_line_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_body_L:E', 'arc_neck_L:S'], 'Name': 'neck_body_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_neck_L:E', 'roof_L:S'], 'Name': 'eave_weld_L'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

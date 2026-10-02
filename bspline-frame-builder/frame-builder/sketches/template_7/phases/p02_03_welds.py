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
    3. H23 item 27: welds declared against Fusion's OWN CCW rule (fusion360-quirks skill), not
       loop-direction/creation order. `arc_body_R` / `arc_body_L`'s own declared 3-point order
       turns CLOCKWISE once seeded with their own TRUE angular-midpoint via point (p02_02_loop.py's
       own docstring), so addByThreePoints assigns their :S/:E the OPPOSITE way round from declared
       (`arc_body_R:S` physically = B, the body's own far end, not N). `arc_neck_R/L` turn CCW with
       their own TRUE via point (no correction needed, their tags mean what they say) -- MEASURED
       directly, not assumed: an EARLIER attempt at this fix had a sign bug in the neck via point's
       own formula (reused the body circle's own u-vector without negating it for the neck circle's
       own opposite-side centre), which put the neck via ~90 deg off and ALSO flipped its own
       apparent turn direction -- a reminder that the via point's own position is part of what
       decides the CW/CCW turn sign, so this table must be re-checked fresh after ANY via-point
       change, never assumed stable. Confirmed against H23 item 27 part 2's own all-template test
       (test_all_templates_shape_outline.py), which flags any weld this table gets wrong, and its
       own seed-midpoint check (now in EXACT_SEED_TEMPLATES), which flags any via-point error.
    """
    seq = [
        # Peak: roof_R starts there, roof_L ends there.
        {'Type': 'Coincident', 'Targets': ['roof_R:S', 'roof_L:E'], 'Name': 'peak_weld'},

        # Right side: eave tip, neck/body join, body/line join.
        {'Type': 'Coincident', 'Targets': ['roof_R:E', 'arc_neck_R:S'], 'Name': 'eave_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_neck_R:E', 'arc_body_R:E'], 'Name': 'neck_body_weld_R'},  # arc_body_R:E physically = N
        {'Type': 'Coincident', 'Targets': ['arc_body_R:S', 'side_R:S'], 'Name': 'body_line_weld_R'},  # arc_body_R:S physically = B

        # Base-right: bottom_edge is the ONE direct anchor; side_R welds to it.
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['side_R:E', 'bottom_edge:S'], 'Name': 'base_R_weld'},

        # Base-left: side_L is the ONE direct anchor; bottom_edge welds to it.
        {'Type': 'Coincident', 'Targets': ['side_L:S', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'side_L:S'], 'Name': 'base_L_weld'},

        # Left side (mirror): line/body join, body/neck join, eave tip.
        {'Type': 'Coincident', 'Targets': ['side_L:E', 'arc_body_L:E'], 'Name': 'body_line_weld_L'},  # arc_body_L:E physically = B
        {'Type': 'Coincident', 'Targets': ['arc_body_L:S', 'arc_neck_L:S'], 'Name': 'neck_body_weld_L'},  # arc_body_L:S physically = N
        {'Type': 'Coincident', 'Targets': ['arc_neck_L:E', 'roof_L:S'], 'Name': 'eave_weld_L'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

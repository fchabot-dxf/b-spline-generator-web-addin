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

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (MEASURED 2026-10-01, fusion360-quirks skill "A
    SketchArc ALWAYS runs counter-clockwise from startSketchPoint to endSketchPoint"): the engine
    tags `<arc>:S` from Fusion's own startSketchPoint, and Fusion makes that the counter-clockwise
    start regardless of the order addByThreePoints received the points. The two CONVEX arcs per side
    (shoulder, hip) run CLOCKWISE in loop direction, so their :S is the point p02_02 declares LAST;
    the CONCAVE waist runs counter-clockwise, so its tags match the declared order. Welding "this:E
    to next:S" blindly along the loop joined the wrong physical ends of all four convex arcs and the
    solver dragged the whole chain into an impossible topology -- the "under-constrained" symptom of
    the first two live attempts. Physical point at each tagged end:

        arc_shoulder_R  :S = shoulder/waist jct   :E = shoulder horn        (clockwise, swapped)
        arc_waist_R     :S = shoulder/waist jct   :E = waist/hip jct        (counter-clockwise)
        arc_hip_R       :S = hip horn             :E = waist/hip jct        (clockwise, swapped)
        arc_hip_L       :S = waist/hip jct        :E = hip horn             (clockwise, swapped)
        arc_waist_L     :S = waist/hip jct        :E = shoulder/waist jct   (counter-clockwise)
        arc_shoulder_L  :S = shoulder horn        :E = shoulder/waist jct   (clockwise, swapped)

    fb_engine/test_t11_fusion_expressions.py derives this table from p02_02's own declared points
    (the sign of the three-point turn) and checks every weld below joins two physically coincident
    ends -- so a future change to the loop that flips an arc's bulge is caught without Fusion.
    Template 1 encodes the same fact empirically (its chain welds :S to :S); Template 7's body arcs
    have the same crossed welds and have never been live-built -- flagged, not fixed here.
    """
    seq = [
        # Peak: roof_R starts there, roof_L ends there.
        {'Type': 'Coincident', 'Targets': ['roof_R:S', 'roof_L:E'], 'Name': 'peak_weld'},

        # Right side: eave tip (miter, roof -> eave-straight), then the 3-arc tangent chain, then the
        # straight run to the hip horn.
        {'Type': 'Coincident', 'Targets': ['roof_R:E', 'eave_straight_R:S'], 'Name': 'eave_weld_R'},
        {'Type': 'Coincident', 'Targets': ['eave_straight_R:E', 'arc_shoulder_R:E'], 'Name': 'eave_shoulder_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_R:S', 'arc_waist_R:S'], 'Name': 'shoulder_waist_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_waist_R:E', 'arc_hip_R:E'], 'Name': 'waist_hip_weld_R'},
        {'Type': 'Coincident', 'Targets': ['arc_hip_R:S', 'side_straight_R:S'], 'Name': 'hip_side_weld_R'},

        # Base-right: bottom_edge is the ONE direct anchor; side_straight_R welds to it.
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['side_straight_R:E', 'bottom_edge:S'], 'Name': 'base_R_weld'},

        # Base-left: side_straight_L is the ONE direct anchor; bottom_edge welds to it.
        {'Type': 'Coincident', 'Targets': ['side_straight_L:S', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'side_straight_L:S'], 'Name': 'base_L_weld'},

        # Left side (mirror): straight run, 3-arc tangent chain, eave tip.
        {'Type': 'Coincident', 'Targets': ['side_straight_L:E', 'arc_hip_L:E'], 'Name': 'hip_side_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_hip_L:S', 'arc_waist_L:S'], 'Name': 'waist_hip_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:E'], 'Name': 'shoulder_waist_weld_L'},
        {'Type': 'Coincident', 'Targets': ['arc_shoulder_L:S', 'eave_straight_L:S'], 'Name': 'eave_shoulder_weld_L'},
        {'Type': 'Coincident', 'Targets': ['eave_straight_L:E', 'roof_L:S'], 'Name': 'eave_weld_L'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 17 - Tulip).

    1. Head-to-tail: each piece's end meets the next piece's start, closing the 6-piece loop
       (p02_02_loop.py's own doc comment: clockwise from the top-right corner).
    2. Corner topology: exactly ONE direct anchor per base corner (every other template's own
       convention). The other 4 corners have no bounding-box anchor at all.

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (p02_02_loop.py's own docstring): the 3 CONVEX
    arcs (arch, lower_R, lower_L) turn CLOCKWISE in declared order, so Fusion's own
    addByThreePoints tags :S at the point declared LAST, :E at the point declared FIRST (swapped);
    the 2 CONCAVE arcs (upper_R, upper_L -- arcs here, where Template 16 had plain lines) turn
    COUNTER-clockwise, so their own :S/:E match declared order directly (NOT swapped). Physical
    point at each tagged end:

        arch     :S = topR     :E = topL      (clockwise, swapped)
        upper_R  :S = topR     :E = waistR     (counter-clockwise, NOT swapped)
        lower_R  :S = BR       :E = waistR     (clockwise, swapped)
        lower_L  :S = waistL   :E = BL         (clockwise, swapped)
        upper_L  :S = waistL   :E = topL       (counter-clockwise, NOT swapped)

    Net effect: IDENTICAL weld table to Template 16's own copy of this phase (both pieces at every
    corner physically agree on which suffix is there) -- welding "this piece's :E to the next
    piece's :S" blindly along the loop would still join the wrong physical ends at 3 of the 6
    joints below (waistR, BL, topL); each weld here is named by the PHYSICAL corner it joins.
    """
    seq = [
        # topR: both upper_R and arch physically land :S here.
        {'Type': 'Coincident', 'Targets': ['upper_R:S', 'arch:S'], 'Name': 'topR_weld'},

        # waistR: both upper_R and lower_R physically land :E here.
        {'Type': 'Coincident', 'Targets': ['upper_R:E', 'lower_R:E'], 'Name': 'waistR_weld'},

        # BR: the ONE direct bounding-box anchor; lower_R's own :S welds to it, base's own :S
        # welds to lower_R's :S in turn.
        {'Type': 'Coincident', 'Targets': ['base:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['lower_R:S', 'base:S'], 'Name': 'BR_weld'},

        # BL: the OTHER direct bounding-box anchor; lower_L's own :E welds to it, base's own :E
        # welds to lower_L's :E in turn.
        {'Type': 'Coincident', 'Targets': ['lower_L:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['base:E', 'lower_L:E'], 'Name': 'BL_weld'},

        # waistL: both lower_L and upper_L physically land :S here.
        {'Type': 'Coincident', 'Targets': ['lower_L:S', 'upper_L:S'], 'Name': 'waistL_weld'},

        # topL: both upper_L and arch physically land :E here. Closes the loop back to upper_R via
        # arch:S/topR_weld.
        {'Type': 'Coincident', 'Targets': ['upper_L:E', 'arch:E'], 'Name': 'topL_weld'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

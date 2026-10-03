def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 16 - Arched Funnel).

    1. Head-to-tail: each piece's end meets the next piece's start, closing the 6-piece loop
       (p02_02_loop.py's own doc comment: clockwise from the top-right corner).
    2. Corner topology: exactly ONE direct anchor per base corner (every other template's own
       convention - every other piece meeting there welds to that anchor's own endpoint, never
       independently to the projected corner). The other 4 corners have no bounding-box anchor at
       all; their absolute position comes purely from their own HW/HH/handle-fraction expressions
       in p02_02_loop.py, welded together here.

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (p02_02_loop.py's own docstring, reconfirmed
    2026-10-03 via the sign of each arc's own declared 3-point turn): all three arcs here (arch,
    lower_R, lower_L) turn CLOCKWISE in declared order, so Fusion's own addByThreePoints tags :S
    at the point declared LAST, :E at the point declared FIRST -- swapped relative to every other
    template's own convention, for all three. Physical point at each tagged end:

        arch     :S = topR     :E = topL      (declared [topL, apex, topR], clockwise, swapped)
        lower_R  :S = BR       :E = waistR     (declared [waistR, via, BR], clockwise, swapped)
        lower_L  :S = waistL   :E = BL         (declared [BL, via, waistL], clockwise, swapped)

    Welding "this piece's :E to the next piece's :S" blindly along the loop would join the wrong
    physical ends at 3 of the 6 joints below (waistR, BL, topL) -- each weld here is named by the
    PHYSICAL corner it joins, not by loop position.
    """
    seq = [
        # topR: upper_R starts there (:S); arch's own LAST declared point (topR) is its own :S too
        # (both swapped-or-not conventions happen to agree here -- see docstring table).
        {'Type': 'Coincident', 'Targets': ['upper_R:S', 'arch:S'], 'Name': 'topR_weld'},

        # waistR: upper_R ends there (:E); lower_R's own FIRST declared point (waistR) is its own
        # :E (swapped) -- NOT :S, see docstring table.
        {'Type': 'Coincident', 'Targets': ['upper_R:E', 'lower_R:E'], 'Name': 'waistR_weld'},

        # BR: the ONE direct bounding-box anchor; lower_R's own :S (swapped to its LAST declared
        # point, BR) welds to it, base's own :S welds to lower_R's :S in turn.
        {'Type': 'Coincident', 'Targets': ['base:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['lower_R:S', 'base:S'], 'Name': 'BR_weld'},

        # BL: the OTHER direct bounding-box anchor; lower_L's own :E (swapped to its LAST declared
        # point, BL) welds to it, base's own :E welds to lower_L's :E in turn.
        {'Type': 'Coincident', 'Targets': ['lower_L:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['base:E', 'lower_L:E'], 'Name': 'BL_weld'},

        # waistL: lower_L's own :S (swapped to its LAST declared point, waistL) meets upper_L's
        # own :S (unswapped, a line).
        {'Type': 'Coincident', 'Targets': ['lower_L:S', 'upper_L:S'], 'Name': 'waistL_weld'},

        # topL: upper_L ends there (:E); arch's own FIRST declared point (topL) is its own :E
        # (swapped) -- NOT :S, see docstring table. Closes the loop back to upper_R via arch:S/topR_weld.
        {'Type': 'Coincident', 'Targets': ['upper_L:E', 'arch:E'], 'Name': 'topL_weld'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

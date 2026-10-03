def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 14 - Sand Timer).

    1. Head-to-tail: each piece's end meets the next piece's start, closing the 6-piece loop
       (p02_02_loop.py's own doc comment: clockwise from the top-right corner).
    2. Corner topology: exactly ONE direct anchor per base corner (every other template's own
       convention -- every other piece meeting there welds to that anchor's own endpoint, never
       independently to the projected corner). The other 4 corners have no bounding-box anchor at
       all; their absolute position comes purely from their own HW/HH/handle-fraction expressions
       in p02_02_loop.py, welded together here.

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (p02_02_loop.py's own docstring, confirmed
    numerically 2026-10-03 via the sign of each arc's own declared 3-point turn): ALL FOUR arcs
    here (upper_R, lower_R, lower_L, upper_L) turn CLOCKWISE in declared order, so Fusion's own
    addByThreePoints tags :S at the point declared LAST, :E at the point declared FIRST -- swapped
    relative to every other template's own convention, for all four (unlike T16, where only its 3
    arcs were swapped and its lines were not -- here EVERY side piece is an arc). Physical point at
    each tagged end:

        upper_R  :S = pinchR   :E = topR     (declared [topR, via, pinchR], clockwise, swapped)
        lower_R  :S = BR       :E = pinchR   (declared [pinchR, via, BR], clockwise, swapped)
        lower_L  :S = pinchL   :E = BL       (declared [BL, via, pinchL], clockwise, swapped)
        upper_L  :S = topL     :E = pinchL   (declared [pinchL, via, topL], clockwise, swapped)
    base/top are Lines, unswapped: base :S=BR :E=BL; top :S=topL :E=topR.

    Welding "this piece's :E to the next piece's :S" blindly along the loop would join the wrong
    physical ends at every one of the 4 pinch/top/base joints below that touch an arc -- each weld
    here is named by the PHYSICAL corner it joins, not by loop position.
    """
    seq = [
        # topR: top ends there (:E, unswapped); upper_R's own LAST declared point (topR) is its
        # own :E too (swapped) -- both land on topR.
        {'Type': 'Coincident', 'Targets': ['top:E', 'upper_R:E'], 'Name': 'topR_weld'},

        # pinchR: upper_R's own FIRST declared point (pinchR) is its own :S (swapped); lower_R's
        # own FIRST declared point (pinchR) is its own :E (swapped) -- NOT :S, see docstring table.
        {'Type': 'Coincident', 'Targets': ['upper_R:S', 'lower_R:E'], 'Name': 'pinchR_weld'},

        # BR: the ONE direct bounding-box anchor; lower_R's own :S (swapped to its LAST declared
        # point, BR) welds to it, base's own :S welds to lower_R's :S in turn.
        {'Type': 'Coincident', 'Targets': ['base:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['lower_R:S', 'base:S'], 'Name': 'BR_weld'},

        # BL: the OTHER direct bounding-box anchor; lower_L's own :E (swapped to its LAST declared
        # point, BL) welds to it, base's own :E welds to lower_L's :E in turn.
        {'Type': 'Coincident', 'Targets': ['lower_L:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['base:E', 'lower_L:E'], 'Name': 'BL_weld'},

        # pinchL: lower_L's own FIRST declared point (pinchL) is its own :S (swapped); upper_L's
        # own FIRST declared point (pinchL) is its own :E (swapped) -- NOT :S, see docstring table.
        {'Type': 'Coincident', 'Targets': ['lower_L:S', 'upper_L:E'], 'Name': 'pinchL_weld'},

        # topL: upper_L's own LAST declared point (topL) is its own :S (swapped); top's own FIRST
        # declared point (topL) is its own :S too (unswapped) -- both land on topL. Closes the loop
        # back to upper_R via top:E/topR_weld.
        {'Type': 'Coincident', 'Targets': ['upper_L:S', 'top:S'], 'Name': 'topL_weld'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

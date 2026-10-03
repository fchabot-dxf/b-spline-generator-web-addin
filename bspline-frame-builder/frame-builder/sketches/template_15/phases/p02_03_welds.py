def get_block(ui_data=None):
    """
    Loop welds and anchors (Template 15 - Flask).

    1. Head-to-tail: each piece's end meets the next piece's start, closing the 6-piece loop
       (p02_02_loop.py's own doc comment: clockwise from the top-right corner).
    2. Corner topology: exactly ONE direct anchor per base corner (every other template's own
       convention). The other 4 corners have no bounding-box anchor at all; their absolute position
       comes purely from their own HW/HH/handle-fraction expressions in p02_02_loop.py, welded
       together here.

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (p02_02_loop.py's own docstring, confirmed
    numerically 2026-10-03 via the sign of each arc's own declared 3-point turn): BOTH dome_R and
    dome_L turn CLOCKWISE in declared order, so Fusion's own addByThreePoints tags :S at the point
    declared LAST, :E at the point declared FIRST -- swapped relative to every other template's own
    convention, for both. Physical point at each tagged end:

        dome_R  :S = BR            :E = neckBottomR   (declared [neckBottomR, via, BR], clockwise, swapped)
        dome_L  :S = neckBottomL   :E = BL             (declared [BL, via, neckBottomL], clockwise, swapped)
    neck_R/base/neck_L/top are Lines, unswapped: neck_R :S=topR :E=neckBottomR; base :S=BR :E=BL;
    neck_L :S=neckBottomL :E=topL; top :S=topL :E=topR.

    Welding "this piece's :E to the next piece's :S" blindly along the loop would join the wrong
    physical ends at the neckBottomR/BR/BL/neckBottomL joints below (each touches an arc) -- each
    weld here is named by the PHYSICAL corner it joins, not by loop position.
    """
    seq = [
        # topR: top ends there (:E, unswapped); neck_R's own FIRST declared point (topR) is its own
        # :S too (unswapped) -- both land on topR.
        {'Type': 'Coincident', 'Targets': ['top:E', 'neck_R:S'], 'Name': 'topR_weld'},

        # neckBottomR: neck_R's own LAST declared point (neckBottomR) is its own :E (unswapped);
        # dome_R's own FIRST declared point (neckBottomR) is its own :E (swapped) -- both :E.
        {'Type': 'Coincident', 'Targets': ['neck_R:E', 'dome_R:E'], 'Name': 'neckBottomR_weld'},

        # BR: the ONE direct bounding-box anchor; dome_R's own LAST declared point (BR) is its own
        # :S (swapped), base's own FIRST declared point (BR) is its own :S (unswapped) -- both weld
        # to the anchor and to each other.
        {'Type': 'Coincident', 'Targets': ['base:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['dome_R:S', 'base:S'], 'Name': 'BR_weld'},

        # BL: the OTHER direct bounding-box anchor; base's own LAST declared point (BL) is its own
        # :E (unswapped), dome_L's own FIRST declared point (BL) is its own :E (swapped).
        {'Type': 'Coincident', 'Targets': ['dome_L:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['base:E', 'dome_L:E'], 'Name': 'BL_weld'},

        # neckBottomL: dome_L's own LAST declared point (neckBottomL) is its own :S (swapped);
        # neck_L's own FIRST declared point (neckBottomL) is its own :S (unswapped) -- both :S.
        {'Type': 'Coincident', 'Targets': ['dome_L:S', 'neck_L:S'], 'Name': 'neckBottomL_weld'},

        # topL: neck_L's own LAST declared point (topL) is its own :E (unswapped); top's own FIRST
        # declared point (topL) is its own :S (unswapped). Closes the loop back to neck_R via
        # top:E/topR_weld.
        {'Type': 'Coincident', 'Targets': ['neck_L:E', 'top:S'], 'Name': 'topL_weld'},
    ]

    return {"Name": "Welds", "PhaseID": "p02_03_welds", "BuildSequence": seq}

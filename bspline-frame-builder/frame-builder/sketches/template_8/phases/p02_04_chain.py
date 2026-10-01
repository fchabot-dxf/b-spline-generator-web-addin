def get_block(ui_data=None):
    """
    Phase 4: Arc Chain (Template 8 - Dipped Top + Left-Only Wave).
    Head-to-tail Coincident constraints connecting the arc seeds into a continuous curve, isolated as its own
    phase for incremental inspection (as Template 1/5). No RIGHT side chain: `side_R` is a single plain line with
    no internal joints to chain.
    """
    seq = [
        # LEFT side (Template 1's own): waist:S meets hip:S, waist:E meets shoulder:E
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:S', 'arc_hip_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_waist_L:E', 'arc_shoulder_L:E']},
        # TOP (as Template 5): dip:S meets the left top shoulder's dip end (:S), dip:E the right one's (:E)
        {'Type': 'Coincident', 'Targets': ['arc_top_dip:S', 'arc_top_shoulder_L:S']},
        {'Type': 'Coincident', 'Targets': ['arc_top_dip:E', 'arc_top_shoulder_R:E']},
    ]

    return {"Name": "ArcChain", "PhaseID": "p02_04_chain", "BuildSequence": seq}

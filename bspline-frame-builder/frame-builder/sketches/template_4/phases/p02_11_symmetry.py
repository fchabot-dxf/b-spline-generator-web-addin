def get_block(ui_data=None):
    """
    Step 13: Left/Right Ties (Template 4 - Offset Hourglass).

    Template 1 ties the two sides through the skeleton: each pin pair's
    inner ends are merged (p02_02: same height per level) and the shoulder
    and waist pins are Equal (same length). That mirrors the whole outline.
    Template 4 wants the left and right waist pinches at their OWN heights
    and depths, so it keeps only the RADII tied left to right:

      Equal(arc_shoulder_R, arc_shoulder_L)
      Equal(arc_waist_R,    arc_waist_L)
      Equal(arc_hip_R,      arc_hip_L)

    DOF count, per side (horns vertical on the pinned corners, three arcs
    chained, tangent to each other and to the horns, each centre welded to
    its own horizontal pin whose inner end rides the Y axis): 5 free values,
    the waist centre height, the pinch depth and the three radii (Template
    1's own count). Template 1 removes 5 of the 10 with its 3 height merges
    + 2 pin Equals (the hip Equal was redundant THERE: with the heights
    merged the hip radius already follows). Here the heights are free, so
    the three radius Equals are three independent equations on three
    different free values: none follows from the others and none repeats a
    height rule (no over-constraint), leaving 7 free values (each pinch's
    height and depth, the three shared radii), set by the seeds like
    Template 1's 5. NEEDS LIVE VERIFICATION (LIVE_CHECK.md): that Fusion
    accepts all three without VCS_SKETCH_OVER_CONSTRAINTS and the pinches
    stay where the seeds put them.

    Gating: the existing toggles keep their meaning ("shoulder / waist equal
    left to right"): ck_skel_shoulder_equal gates the shoulder arc Equal,
    ck_skel_waist_equal the waist one. The hip Equal is not gated (no new
    parameter: Fred's rule).
    """
    seq = [
        {'Type': 'Equal', 'Targets': ['arc_shoulder_R', 'arc_shoulder_L'], 'Name': 'shoulder_arc_equal', 'CK': 'ck_skel_shoulder_equal'},
        {'Type': 'Equal', 'Targets': ['arc_waist_R',    'arc_waist_L'],    'Name': 'waist_arc_equal',    'CK': 'ck_skel_waist_equal'},
        {'Type': 'Equal', 'Targets': ['arc_hip_R',      'arc_hip_L'],      'Name': 'hip_arc_equal'},

        # Pulse to snap the ties into the viewport
        {'Type': 'Pulse'}
    ]

    return {"Name": "Symmetry", "PhaseID": "p02_11_symmetry", "BuildSequence": seq}

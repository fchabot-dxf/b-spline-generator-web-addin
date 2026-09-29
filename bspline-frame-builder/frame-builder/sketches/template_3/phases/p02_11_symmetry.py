def get_block(ui_data=None):
    """
    Step 13: Symmetry Finalization (Template 3 - Tapered Hourglass).

    Template 1's two skeleton Equals, plus ONE top left/right tie.

    Why T3 needs the extra tie: Template 1 pins both top corners, so each
    top horn sits at x = +/-hw and (with the shoulder pins Equal) the two
    shoulder radii are equal by construction. Template 3's top edge only
    rides on the safe-zone top line (p02_03), so each side keeps one free
    degree of freedom: a bigger shoulder radius moves that side's top horn
    out (centre fixed on its pin), which the waist / hip tangencies absorb.
    Nothing else ties the two sides, so the top could come out lopsided.

    Choice: Equal(arc_shoulder_R, arc_shoulder_L). It removes exactly that
    one left/right degree of freedom (then top horn x = pin length + r is
    mirrored, and the waist / hip radii follow through their tangencies),
    and Template 2 already uses Equal on arc pairs. The alternative,
    Symmetry(top_edge:S, top_edge:E, Y_AXIS), also asserts "same height",
    which Horizontal(top_edge) already does, so it would be a redundant
    constraint (VCS_SKETCH_OVER_CONSTRAINTS risk). NEEDS LIVE VERIFICATION
    (LIVE_CHECK.md): that Fusion accepts it without an over-constraint
    error and the top comes out symmetric.

    Not gated by a ck_* toggle on purpose: a gate would be a new template
    parameter (Fred's rule: no new parameters).
    """
    seq = [
        # SKELETAL EQUALITY (as Template 1; see its p02_11 for why there is no hip Equal).
        {'Type': 'Equal', 'Targets': ['skel_shoulder_pin_R', 'skel_shoulder_pin_L'], 'Name': 'shoulder_equal', 'CK': 'ck_skel_shoulder_equal'},
        {'Type': 'Equal', 'Targets': ['skel_waist_pin_R',    'skel_waist_pin_L'],    'Name': 'waist_equal',    'CK': 'ck_skel_waist_equal'},

        # T3: the narrow top's left/right tie (see above).
        {'Type': 'Equal', 'Targets': ['arc_shoulder_R', 'arc_shoulder_L'], 'Name': 'shoulder_arc_equal'},

        # Pulse to snap symmetry into the viewport
        {'Type': 'Pulse'}
    ]

    return {"Name": "Symmetry", "PhaseID": "p02_11_symmetry", "BuildSequence": seq}

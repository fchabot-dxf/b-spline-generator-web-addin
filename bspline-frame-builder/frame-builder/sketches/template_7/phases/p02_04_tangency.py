def get_block(ui_data=None):
    """
    Arc Tangency (Template 7 - Diamond-top Hourglass).

    G1 continuity at the two SMOOTH joins per side (fb_engine/t7_geometry.py's own module
    docstring: "the neck-to-body join and the body-to-straight join are both TANGENT, not
    miters"): neck arc <-> body arc at N (opposite curvature - the genuine S-curve), and body arc
    <-> the straight side at B ("tangent to the vertical straight side at B"). No tangency at the
    eave (roof meets side) or at the base corner (side meets base): both are TRUE MITERS per the
    approved spec, left to the miter machinery in sketch 3 (p03_04_encl_miters.py), same division
    every other template already uses between a smooth join (Tangent here) and a cut corner
    (miter in the enclosure sketch).
    """
    seq = [
        # Right side
        {'Type': 'Tangent', 'Targets': ['arc_neck_R', 'arc_body_R']},
        {'Type': 'Tangent', 'Targets': ['arc_body_R', 'side_R']},

        # Left side (mirror)
        {'Type': 'Tangent', 'Targets': ['arc_body_L', 'arc_neck_L']},
        {'Type': 'Tangent', 'Targets': ['side_L', 'arc_body_L']},
    ]

    return {
        "Name": "ArcTangency",
        "PhaseID": "p02_04_tangency",
        "BuildSequence": seq
    }

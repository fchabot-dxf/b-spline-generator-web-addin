def get_block(ui_data=None):
    """
    Arc Tangency (Template 11 - Diamond-top, 3-arc Hourglass).

    G1 continuity at the 4 SMOOTH joins per side (fb_engine/t11_geometry.py's own module docstring:
    "every join WITHIN a side... is TANGENT, not a miter"): eave-straight <-> shoulder arc, shoulder
    <-> waist (the genuine S-curve), waist <-> hip (the other half of the S-curve), hip <-> the
    straight run to the base. No tangency at the eave (roof meets the eave-straight run) or at the
    base corner (side meets base): both are TRUE MITERS per the approved spec, left to the miter
    machinery in sketch 3 (p03_04_encl_miters.py), same division Template 7 already uses between a
    smooth join (Tangent here) and a cut corner (miter in the enclosure sketch).
    """
    seq = [
        # Right side
        {'Type': 'Tangent', 'Targets': ['eave_straight_R', 'arc_shoulder_R']},
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_R', 'arc_waist_R']},
        {'Type': 'Tangent', 'Targets': ['arc_waist_R', 'arc_hip_R']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_R', 'side_straight_R']},

        # Left side (mirror)
        {'Type': 'Tangent', 'Targets': ['side_straight_L', 'arc_hip_L']},
        {'Type': 'Tangent', 'Targets': ['arc_hip_L', 'arc_waist_L']},
        {'Type': 'Tangent', 'Targets': ['arc_waist_L', 'arc_shoulder_L']},
        {'Type': 'Tangent', 'Targets': ['arc_shoulder_L', 'eave_straight_L']},
    ]

    return {
        "Name": "ArcTangency",
        "PhaseID": "p02_04_tangency",
        "BuildSequence": seq
    }

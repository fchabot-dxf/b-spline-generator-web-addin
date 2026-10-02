def get_block(ui_data=None):
    """
    Arc Tangency (Template 11 - Diamond-top, 3-arc Hourglass) - the LAST sketch-2 phase.

    G1 continuity at the 4 SMOOTH joins per side (fb_engine/t11_geometry.py's own module docstring:
    "every join WITHIN a side... is TANGENT, not a miter"): eave-straight <-> shoulder arc, shoulder
    <-> waist (the genuine S-curve), waist <-> hip (the other half of the S-curve), hip <-> the
    straight run to the base. No tangency at the eave (roof meets the eave-straight run) or at the
    base corner (side meets base): both are TRUE MITERS per the approved spec, left to the miter
    machinery in sketch 3 (p03_04_encl_miters.py), same division Template 7 already uses between a
    smooth join (Tangent here) and a cut corner (miter in the enclosure sketch).

    These constraints LOCK a chain that p02_02 already seeded exactly; they do not find it (measured,
    see p02_02_loop.py's own docstring, item 1). There is no seed Radius to delete first and no joint
    to Fix afterwards: with the exact seed and the physically-correct welds of p02_03, Tangent is
    satisfied at zero residual and every radius/centre stays where the closed form put it.
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

        # Pulse to snap the solved loop into the viewport (as every other template's final p02 phase).
        {'Type': 'Pulse'},
    ]

    return {
        "Name": "ArcTangency",
        "PhaseID": "p02_04_tangency",
        "BuildSequence": seq
    }

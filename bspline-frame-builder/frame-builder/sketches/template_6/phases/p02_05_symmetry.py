def get_block(ui_data=None):
    """
    Symmetry (Template 6 - Tab Top): two left/right ties, nothing else.

    DOF after p02_02..p02_04: the closed loop has 8 vertices = 16 values;
    the base corners fix 4, the tab top on the top line 1, 4 Vertical + 3
    Horizontal 7, so 4 are left. Two of them are left/right differences,
    removed here:
      - Equal(side_L, side_R): both shoulders at the same height;
      - Equal(shoulder_L, shoulder_R): the tab centred (the sides sit at
        +/-hw, so equal shoulders put the tab sides at +/-a).
    That leaves exactly the 2 seeded values: the tab's half width and its
    height. Symmetry(tab_top:S, tab_top:E, Y_AXIS) is NOT used: its "same
    height" half repeats Horizontal(tab_top) (Template 3's finding).

    Not gated by a ck_* toggle on purpose: a gate would be a new template
    parameter (Fred's rule: no new parameters).
    """
    seq = [
        {'Type': 'Equal', 'Targets': ['side_L', 'side_R'],         'Name': 'tab_top_side_equal'},
        {'Type': 'Equal', 'Targets': ['shoulder_L', 'shoulder_R'], 'Name': 'tab_top_shoulder_equal'},
        {'Type': 'Pulse'},
    ]
    return {"Name": "Symmetry", "PhaseID": "p02_05_symmetry", "BuildSequence": seq}

def get_block(ui_data=None):
    """
    Symmetry (Template 9 - I Shape): four Equal ties, nothing else.

    DOF after p02_02..p02_04: the closed 12-piece loop has 12 vertices = 24
    values; the 4 corners (TL/TR/BR/BL, each pinned by 2 Coincidents) fix 8,
    6 Vertical + 4 Horizontal remove 10 more, so 6 are left: the right
    stem-side x (shared by the TR/BR notches via stem_side_R's own
    Vertical), the left stem-side x (shared by TL/BL via stem_side_L's own
    Vertical), and the 4 shoulders' own heights (TR, BR, BL, TL), still
    independent of each other. Four Equal ties bring that to the 2 seeded
    values (the stem's half width and the flange height):
      - Equal(shoulder_TR, shoulder_TL): both shoulder BARS the same length
        (HW - stem x on each side), i.e. the stem centred;
      - Equal(flange_side_R, flange_side_BR): the right flange sides the
        same length, i.e. the right top/bottom shoulders mirror the centre
        line (TR's shoulder height = -1 x BR's, both measured the same
        way: each flange side runs from its own OUTER corner, known, down
        to its own shoulder);
      - Equal(flange_side_TL, flange_side_BL): the same tie on the left;
      - Equal(flange_side_R, flange_side_TL): the right pair's shared
        height tied to the left pair's, so all 4 shoulders end up equal.

    Not gated by a ck_* toggle on purpose: a gate would be a new template
    parameter (Fred's rule: no new parameters, Template 6's own finding).
    """
    seq = [
        {'Type': 'Equal', 'Targets': ['shoulder_TR', 'shoulder_TL'],      'Name': 'i_shape_stem_centred'},
        {'Type': 'Equal', 'Targets': ['flange_side_R', 'flange_side_BR'], 'Name': 'i_shape_right_mirrored'},
        {'Type': 'Equal', 'Targets': ['flange_side_TL', 'flange_side_BL'],'Name': 'i_shape_left_mirrored'},
        {'Type': 'Equal', 'Targets': ['flange_side_R', 'flange_side_TL'], 'Name': 'i_shape_sides_equal'},
        {'Type': 'Pulse'},
    ]
    return {"Name": "Symmetry", "PhaseID": "p02_05_symmetry", "BuildSequence": seq}

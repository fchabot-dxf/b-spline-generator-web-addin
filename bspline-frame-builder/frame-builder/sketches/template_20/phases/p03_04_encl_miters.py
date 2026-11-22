def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters (Template 20 - Trapezoid): 4 miters, one per
    corner, each from the outer corner to its inner corner (p03_03: the true
    offset-line intersection, so the miter bisects that corner's own angle --
    the two corners of a slanted side differ, acute at the wide side, obtuse at
    the narrow one). 4 miters -> 4 bars (one per outline piece).

    Must match template_data.FRAME_CORNERS (test_frame_defs.py checks it).
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_top_edge:S',    'Target': 'inner_proj_top_edge:S',    'IsConstruction': False},
            {'Source': 'proj_side_R:S',      'Target': 'inner_proj_side_R:S',      'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S', 'IsConstruction': False},
            {'Source': 'proj_side_L:S',      'Target': 'inner_proj_side_L:S',      'IsConstruction': False},
        ]
    }

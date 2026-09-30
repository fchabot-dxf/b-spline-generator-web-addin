def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters (Template 6 - Tab Top): 8 miters, one per
    corner, each from the outer corner to its inner corner (45 deg: the
    outline is axis-aligned). The two INSIDE corners are mitered too: the
    line runs from the reflex vertex to the inner corner diagonally inside
    it, so the shoulder bar and the tab-side bar each get half the corner
    square. 8 miters -> 8 bars (one per outline piece).

    Must match template_data.FRAME_CORNERS (test_frame_defs.py checks it).
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_tab_top:S',     'Target': 'inner_proj_tab_top:S',     'IsConstruction': False},
            {'Source': 'proj_tab_side_R:S',  'Target': 'inner_proj_tab_side_R:S',  'IsConstruction': False},
            {'Source': 'proj_shoulder_R:S',  'Target': 'inner_proj_shoulder_R:S',  'IsConstruction': False},
            {'Source': 'proj_side_R:S',      'Target': 'inner_proj_side_R:S',      'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S', 'IsConstruction': False},
            {'Source': 'proj_side_L:S',      'Target': 'inner_proj_side_L:S',      'IsConstruction': False},
            {'Source': 'proj_shoulder_L:S',  'Target': 'inner_proj_shoulder_L:S',  'IsConstruction': False},
            {'Source': 'proj_tab_side_L:S',  'Target': 'inner_proj_tab_side_L:S',  'IsConstruction': False},
        ]
    }

def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters (Template 9 - I Shape): 12 miters, one per
    corner, each from the outer corner to its inner corner (45 deg: the
    outline is axis-aligned). The 4 INSIDE corners are mitered too: the
    line runs from the reflex vertex to the inner corner diagonally inside
    it, so the shoulder bar and the stem-side bar each get half the corner
    square -- Template 6's own rule, applied at 4 notches instead of 1.
    12 miters -> 12 bars (one per outline piece).

    Must match template_data.FRAME_CORNERS (test_frame_defs.py checks it).
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_top_edge:S',       'Target': 'inner_proj_top_edge:S',       'IsConstruction': False},
            {'Source': 'proj_flange_side_R:S',  'Target': 'inner_proj_flange_side_R:S',  'IsConstruction': False},
            {'Source': 'proj_shoulder_TR:S',    'Target': 'inner_proj_shoulder_TR:S',    'IsConstruction': False},
            {'Source': 'proj_stem_side_R:S',    'Target': 'inner_proj_stem_side_R:S',    'IsConstruction': False},
            {'Source': 'proj_shoulder_BR:S',    'Target': 'inner_proj_shoulder_BR:S',    'IsConstruction': False},
            {'Source': 'proj_flange_side_BR:S', 'Target': 'inner_proj_flange_side_BR:S', 'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S',    'Target': 'inner_proj_bottom_edge:S',    'IsConstruction': False},
            {'Source': 'proj_flange_side_BL:S', 'Target': 'inner_proj_flange_side_BL:S', 'IsConstruction': False},
            {'Source': 'proj_shoulder_BL:S',    'Target': 'inner_proj_shoulder_BL:S',    'IsConstruction': False},
            {'Source': 'proj_stem_side_L:S',    'Target': 'inner_proj_stem_side_L:S',    'IsConstruction': False},
            {'Source': 'proj_shoulder_TL:S',    'Target': 'inner_proj_shoulder_TL:S',    'IsConstruction': False},
            {'Source': 'proj_flange_side_TL:S', 'Target': 'inner_proj_flange_side_TL:S', 'IsConstruction': False},
        ]
    }

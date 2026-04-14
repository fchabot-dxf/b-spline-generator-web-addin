def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters.
    Closes the surround rectangle corners to complete the solid generation profiles.
    """
    return {
        "PhaseID": "p18_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_anchor_TL', 'Target': 'inner_corner_TL', 'IsConstruction': False},
            {'Source': 'proj_anchor_TR', 'Target': 'inner_corner_TR', 'IsConstruction': False},
            {'Source': 'proj_anchor_BR', 'Target': 'inner_corner_BR', 'IsConstruction': False},
            {'Source': 'proj_anchor_BL', 'Target': 'inner_corner_BL', 'IsConstruction': False},
        ]
    }

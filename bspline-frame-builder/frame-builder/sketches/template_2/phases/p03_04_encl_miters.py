def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters.
    Closes the surround rectangle corners to complete the solid generation profiles.

    Naming convention: "start of next curve" applied to the silhouette
    loop traversed clockwise. See template_1's copy of this phase for
    the full rationale.
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_top_edge:S',    'Target': 'inner_proj_top_edge:S'},
            {'Source': 'proj_horn_TR:S',     'Target': 'inner_proj_horn_TR:S'},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S'},
            {'Source': 'proj_horn_BL:S',     'Target': 'inner_proj_horn_BL:S'},
        ]
    }

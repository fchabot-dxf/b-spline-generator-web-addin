def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters (Template 8 - Dipped Top + Left-Only Wave).
    Closes the surround rectangle corners to complete the solid generation profiles.

    Naming convention: "start of next curve" applied to the silhouette loop traversed clockwise. At each BB
    corner, the canonical reference is the :S endpoint of whichever curve begins at that joint going CW.

      TL -> top_edge_L:S  (the dipped top's left stub starts at TL going right)
      TR -> side_R:S      (side_R starts at TR going down)
      BR -> bottom_edge:S (bottom_edge starts at BR going left)
      BL -> horn_BL:S     (horn_BL starts at BL going up)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_top_edge_L:S',  'Target': 'inner_proj_top_edge_L:S',  'IsConstruction': False},
            {'Source': 'proj_side_R:S',      'Target': 'inner_proj_side_R:S',      'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S', 'IsConstruction': False},
            {'Source': 'proj_horn_BL:S',     'Target': 'inner_proj_horn_BL:S',     'IsConstruction': False},
        ]
    }

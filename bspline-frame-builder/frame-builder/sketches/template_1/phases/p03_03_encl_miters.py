def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters.
    Closes the surround rectangle corners to complete the solid generation profiles.

    Naming convention: "start of next curve" applied to the silhouette
    loop traversed clockwise. At each BB corner, the canonical reference
    is the :S endpoint of whichever curve begins at that joint going CW.

      TL → top_edge:S        (top_edge starts at TL going right)
      TR → horn_TR:S         (horn_TR starts at TR going down)
      BR → bottom_edge:S     (bottom_edge starts at BR going left)
      BL → horn_BL:S         (horn_BL starts at BL going up)

    This keeps a single rule for any joint in the loop, BB-corner or
    internal, and avoids the spatial-classification fragility we hit
    earlier when picking the "extreme per quadrant" point.
    """
    return {
        "PhaseID": "p03_03_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_top_edge:S',    'Target': 'inner_proj_top_edge:S',    'IsConstruction': False},
            {'Source': 'proj_horn_TR:S',     'Target': 'inner_proj_horn_TR:S',     'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S', 'IsConstruction': False},
            {'Source': 'proj_horn_BL:S',     'Target': 'inner_proj_horn_BL:S',     'IsConstruction': False},
        ]
    }

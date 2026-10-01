def get_block(ui_data=None):
    """
    Phase 18: Enclosure Miters.
    Closes the surround rectangle corners to complete the solid generation profiles.

    Identical to Template 1's own canonical corner references. The 2 TOP miters (TL, TR) now join a point on a
    LINE (the horn) to a point on an ARC (the inner offset of the arch) rather than two straight-line offsets --
    a TRUE, varying-angle bisector, not Template 1's own fixed 45 deg (Fred's explicit ask; the miter's own
    direction visibly changes with the arch's rise, confirmed in the 7x9 preview he approved).

      TL → top_edge:S        (top_edge starts at TL going right)
      TR → horn_TR:S         (horn_TR starts at TR going down)
      BR → bottom_edge:S     (bottom_edge starts at BR going left)
      BL → horn_BL:S         (horn_BL starts at BL going up)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_top_edge:S',    'Target': 'inner_proj_top_edge:S',    'IsConstruction': False},
            {'Source': 'proj_horn_TR:S',     'Target': 'inner_proj_horn_TR:S',     'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S', 'IsConstruction': False},
            {'Source': 'proj_horn_BL:S',     'Target': 'inner_proj_horn_BL:S',     'IsConstruction': False},
        ]
    }

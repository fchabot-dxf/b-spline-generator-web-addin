def get_block(ui_data=None):
    """
    Enclosure Miters (Template 17 - Tulip): 6 miters, one per corner, each from the outer corner
    to its resolved inner corner (p03_03). Every joint in this template is a miter, same as
    Template 16.

    Naming convention: each corner's outer id is whichever of its two meeting pieces' own `:S`/`:E`
    physically lands there (p02_02_loop.py's own docstring table). These Source/Target pairs are
    IDENTICAL to Template 16's own copy of this phase -- the concave upper arcs happen to agree
    with the suffixes the straight lines they replaced already had, and p03_03 resolves every
    corner under the same owner piece (arch or the relevant lower bulge) Template 16 used.
      topR   -> arch:S      waistR -> lower_R:E      BR -> lower_R:S
      BL     -> lower_L:E   waistL -> lower_L:S       topL -> arch:E
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_arch:S',     'Target': 'inner_proj_arch:S',     'IsConstruction': False},
            {'Source': 'proj_lower_R:E',  'Target': 'inner_proj_lower_R:E',  'IsConstruction': False},
            {'Source': 'proj_lower_R:S',  'Target': 'inner_proj_lower_R:S',  'IsConstruction': False},
            {'Source': 'proj_lower_L:E',  'Target': 'inner_proj_lower_L:E',  'IsConstruction': False},
            {'Source': 'proj_lower_L:S',  'Target': 'inner_proj_lower_L:S',  'IsConstruction': False},
            {'Source': 'proj_arch:E',     'Target': 'inner_proj_arch:E',     'IsConstruction': False},
        ]
    }

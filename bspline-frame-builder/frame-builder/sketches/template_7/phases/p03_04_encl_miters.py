def get_block(ui_data=None):
    """
    Enclosure Miters (Template 7 - Diamond-top Hourglass): 5 miters, one per corner, each from the
    outer corner to its resolved inner corner (p03_03). The neck-to-body and body-to-line joins
    are NOT here - they are smooth (Tangent, p02_04_tangency.py), not miters, per the approved
    spec (fb_engine/t7_geometry.py's own module docstring).

    Naming convention: "start of next curve" applied to the silhouette loop traversed clockwise
    from the peak (p03_01_encl_projs.py's own doc comment).
      peak    -> roof_R:S      (roof_R starts at the peak going down-right)
      eave_R  -> arc_neck_R:S  (arc_neck_R starts at the right eave tip)
      base_R  -> bottom_edge:S (bottom_edge starts at the base-right corner)
      base_L  -> side_L:S      (side_L starts at the base-left corner)
      eave_L  -> roof_L:S      (roof_L starts at the left eave tip)
    """
    return {
        "PhaseID": "p03_04_encl_miters",
        "Name": "Enclosure Miters",
        "Miters": [
            {'Source': 'proj_roof_R:S',      'Target': 'inner_proj_roof_R:S',      'IsConstruction': False},
            {'Source': 'proj_arc_neck_R:S',  'Target': 'inner_proj_arc_neck_R:S',  'IsConstruction': False},
            {'Source': 'proj_bottom_edge:S', 'Target': 'inner_proj_bottom_edge:S', 'IsConstruction': False},
            {'Source': 'proj_side_L:S',      'Target': 'inner_proj_side_L:S',      'IsConstruction': False},
            {'Source': 'proj_roof_L:S',      'Target': 'inner_proj_roof_L:S',      'IsConstruction': False},
        ]
    }

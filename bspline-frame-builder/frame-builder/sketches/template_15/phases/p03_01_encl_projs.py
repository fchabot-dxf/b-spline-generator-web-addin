def get_block(ui_data=None):
    """
    Enclosure Projections (Template 15 - Flask).
    Projects the 6-piece silhouette into the enclosure sketch, clockwise from the top-right corner
    (matches template_data.py's FRAME_SEED_MAP `prim` order):
      neck_R, dome_R, base, dome_L, neck_L, top.
    """
    return {
        "PhaseID": "p03_01_encl_projs",
        "Name": "Enclosure Projections",
        "Projections": [
            {'SourceSketch': '2_shape_outline', 'SourceID': 'neck_R', 'TargetID': 'proj_neck_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'dome_R', 'TargetID': 'proj_dome_R'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'base',   'TargetID': 'proj_base'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'dome_L', 'TargetID': 'proj_dome_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'neck_L', 'TargetID': 'proj_neck_L'},
            {'SourceSketch': '2_shape_outline', 'SourceID': 'top',    'TargetID': 'proj_top'},
        ]
    }

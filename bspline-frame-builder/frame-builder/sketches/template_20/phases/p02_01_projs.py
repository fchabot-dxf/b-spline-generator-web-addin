def get_block(ui_data=None):
    """
    Phase 1: Projections (Template 20 - Trapezoid).
    The safe zone's top and bottom LINES, from the layout sketch: the trapezoid's
    two horizontal sides ride on them. No corner is projected -- nothing pins a
    corner (p02_03_welds), so the narrow side can be up or down and each of its
    ends set on its own by the seeds, all with this one constraint set.
    """
    return {
        "PhaseID": "p02_01_projs",
        "Name": "Projections",
        "Projections": [
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_top',    'TargetID': 'proj_off_BB_top'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_bottom', 'TargetID': 'proj_off_BB_bottom'},
        ]
    }

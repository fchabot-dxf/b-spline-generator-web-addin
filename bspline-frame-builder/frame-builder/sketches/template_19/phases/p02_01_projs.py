def get_block(ui_data=None):
    """
    Phase 1: Projections (Template 10 - Arched Hourglass).
    Template 1's own four safe-zone corners, PLUS the safe zone's own top LINE (Template 6's own
    `proj_off_BB_top` pattern): the arch's own two ends are NOT anchored to the top corners here (unlike every
    other hourglass-family template) -- its APEX is tangent to this line instead (p02_03), so the corners
    themselves are only used by the base.

    Naming convention: "start of next curve" applied to the offset BB
    rectangle traversed clockwise - see template_1's copy of this
    phase for the full rationale.
    """
    return {
        "PhaseID": "p02_01_projs",
        "Name": "Projections",
        "Projections": [
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_top:S',    'TargetID': 'proj_off_corner_TL'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_right:S',  'TargetID': 'proj_off_corner_TR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_bottom:S', 'TargetID': 'proj_off_corner_BR'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_left:S',   'TargetID': 'proj_off_corner_BL'},
            {'SourceSketch': '1_bounding_box', 'SourceID': 'offset_BB_top',      'TargetID': 'proj_off_BB_top'},
        ]
    }

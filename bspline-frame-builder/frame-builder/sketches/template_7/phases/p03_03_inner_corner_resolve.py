from fb_engine.t7_geometry import t7_outline
from fb_engine.t7_roof_eave import eave_inner_corner


def _float(ui_data, key, default):
    try:
        return float(ui_data[key])
    except (KeyError, TypeError, ValueError):
        return default


def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 7 - Diamond-top Hourglass): 5 corners.

    Same resolver as every template (fb_engine/inner_corners.py): each outer corner's inner
    SketchPoint is located by computed POSITION (outer + Direction*Distance, within Tolerance),
    bypassing the offset's own curve-tagging fragility - see that module's own docstring.

    T7 has 3 DISTINCT corner shapes (fb_engine/t7_geometry.inner_corner_directions, already
    tested against an independent oracle, fb_engine/test_t7_roof_eave.py /
    test_t7_geometry.py), grouped into 3 ResolveInnerCorners steps by shared Distance:

      peak:    both roof lines at +/-45deg -> Direction=(0,-1), Distance = frame_thickness *
               sqrt(2) (the fixed numeric constant, not a Fusion sqrt() call - see
               t7_roof_eave.peak_inner_corner's own docstring for the derivation).
      base_R/L: a plain 90-degree axis-aligned corner (side meets base), same convention every
               other template's base corners already use - Direction=(+-1,1), Distance =
               'frame_thickness' (symbolic, always live).
      eave_R/L: the TRUE line-circle intersection between the offset roof line and the offset
               neck arc (t7_roof_eave.eave_inner_corner) - NOT a simple axis-aligned formula.
               This one genuinely needs the live widthIn/heightIn/frame_thickness AND the neck/
               body handle proportions to compute; ui_data (passed to every get_block, see
               template_loader.py) carries the FIRST three (the template's own DECLARED Fusion
               params - send_frame.frame_ui_data filters payload.params to declared_param_names),
               but NOT the seeded handle fractions (seed_geometry.py only ever patches literal
               Points/Radius values, never a ResolveInnerCorners config) - so this computation
               necessarily uses this template's OWN DEFAULT handle proportions (the exact same
               defaults p02_02_loop.py's own seed points use before any Send-time override).

    KNOWN LIVE-VERIFY GAP (LIVE_CHECK.md): at the default handle settings this is exact. If Fred
    drags the neck width/height or body flare handles far enough from default AND re-Sends, the
    TRUE eave corner moves with them while this baked Distance does not, and the 0.05cm default
    Tolerance may miss it (a WARNING in the Fusion log, that corner's miter simply not drawn - see
    inner_corners.py's own docstring). Tolerance is widened here (0.2cm) as cheap headroom for a
    modest drag, not a fix for a large one. If seat A's live check finds this corner failing at a
    dragged handle, the real fix is a new, explicit channel carrying the live handle fractions
    into ui_data (additive - every other template already ignores unknown ui_data keys), not a
    wider Tolerance.
    """
    width_in = _float(ui_data or {}, 'widthIn', 7.0) - 2 * _float(ui_data or {}, 'boundingboxoffset', 0.25)
    height_in = _float(ui_data or {}, 'heightIn', 9.0) - 2 * _float(ui_data or {}, 'boundingboxoffset', 0.25)
    frame_thickness = _float(ui_data or {}, 'frame_thickness', 0.75)

    outline = t7_outline(width_in, height_in, frame_thickness)
    eave_dir, eave_dist, _e_in = eave_inner_corner(width_in, height_in, frame_thickness,
                                                    outline["C_neck"], outline["r_neck"])

    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness * 1.4142135623730951',  # sqrt(2), a fixed constant - see this module's own docstring
                'Tolerance': 0.05,
                'Corners': {
                    'peak': {'OuterID': 'proj_roof_R:S', 'InnerID': 'inner_proj_roof_R:S', 'Direction': (0.0, -1.0)},
                },
            },
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness',
                'Tolerance': 0.05,
                'Corners': {
                    'base_R': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1.0, 1.0)},
                    'base_L': {'OuterID': 'proj_side_L:S',      'InnerID': 'inner_proj_side_L:S',      'Direction': (1.0, 1.0)},
                },
            },
            {
                'Type': 'ResolveInnerCorners',
                'Distance': f'{eave_dist} in',
                'Tolerance': 0.2,
                'Corners': {
                    'eave_R': {'OuterID': 'proj_arc_neck_R:S', 'InnerID': 'inner_proj_arc_neck_R:S', 'Direction': (eave_dir[0], eave_dir[1])},
                    'eave_L': {'OuterID': 'proj_roof_L:S',     'InnerID': 'inner_proj_roof_L:S',      'Direction': (-eave_dir[0], eave_dir[1])},
                },
            },
        ]
    }

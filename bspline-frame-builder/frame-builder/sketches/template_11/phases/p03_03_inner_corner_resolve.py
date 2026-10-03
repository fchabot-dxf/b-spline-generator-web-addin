from fb_engine.t11_geometry import inner_corner_directions


def _float(ui_data, key, default):
    try:
        return float(ui_data[key])
    except (KeyError, TypeError, ValueError):
        return default


def get_block(ui_data=None):
    """
    Inner Corner Resolve (Template 11 - Diamond-top, 3-arc Hourglass): 5 corners.

    Same resolver as every template (fb_engine/inner_corners.py): each outer corner's inner
    SketchPoint is located by computed POSITION (outer + Direction*Distance, within Tolerance),
    bypassing the offset's own curve-tagging fragility - see that module's own docstring.

    T11 has 3 DISTINCT corner shapes (fb_engine/t11_geometry.inner_corner_directions, already tested
    against an independent oracle, fb_engine/test_t11_geometry.py -- the eave corner specifically is
    cross-validated against T7's own already-proven peak_inner_corner), grouped into 3
    ResolveInnerCorners steps by shared Distance:

      peak:     T7's own fixed 90-degree peak (roof_geometry/peak_inner_corner reused verbatim) ->
                Direction=(0,-1), Distance = frame_thickness * sqrt(2) (a fixed numeric constant, not
                a Fusion sqrt() call - see t7_roof_eave.peak_inner_corner's own docstring).
      base_R/L: a plain 90-degree axis-aligned corner (side meets base), same convention every other
                template's base corners already use - Direction=(+-1,1), Distance = 'frame_thickness'
                (symbolic, always live).
      eave_R/L: the TRUE line-line miter between the offset roof line and the offset eave-straight
                run (fb_engine.t11_geometry._line_line_inner_corner, via t11_outline) - simpler than
                T7's own line-CIRCLE eave corner, because the piece touching T11's own eave is a
                straight run, not an arc. This genuinely needs the live widthIn/heightIn/
                frame_thickness (ui_data carries the template's own DECLARED Fusion params), but NOT
                the seeded waist-reach/corner-radius/waist-position handle fractions (seed_geometry.py
                only ever patches literal Points/Radius values, never a ResolveInnerCorners config) -
                so this computation necessarily uses this template's OWN DEFAULT handle proportions
                (the exact same defaults p02_02_loop.py's own seed points use before any Send-time
                override) -- same KNOWN LIVE-VERIFY GAP as Template 7's own copy of this phase
                (see that file's own docstring): at the default handle settings this is exact; a large
                drag of the waist-reach/corner-radius/waist-position handles followed by a re-Send
                could, in principle, move the true eave corner enough to miss the default Tolerance.
    """
    width_in = _float(ui_data or {}, 'widthIn', 7.0) - 2 * _float(ui_data or {}, 'boundingboxoffset', 0.25)
    height_in = _float(ui_data or {}, 'heightIn', 9.0) - 2 * _float(ui_data or {}, 'boundingboxoffset', 0.25)
    frame_thickness = _float(ui_data or {}, 'frame_thickness', 0.75)

    corners = inner_corner_directions(width_in, height_in, frame_thickness)
    peak_dir, peak_dist = corners['peak']
    eave_dir, eave_dist = corners['eave_R']
    base_dir, base_dist = corners['base_R']

    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness * 1.4142135623730951',  # sqrt(2), a fixed constant - see this module's own docstring
                'Tolerance': 0.05,
                'Corners': {
                    'peak': {'OuterID': 'proj_roof_R:S', 'InnerID': 'inner_proj_roof_R:S', 'Direction': (peak_dir[0], peak_dir[1])},
                },
            },
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness',
                'Tolerance': 0.05,
                'Corners': {
                    'base_R': {'OuterID': 'proj_bottom_edge:S',     'InnerID': 'inner_proj_bottom_edge:S',     'Direction': (base_dir[0], base_dir[1])},
                    'base_L': {'OuterID': 'proj_side_straight_L:S', 'InnerID': 'inner_proj_side_straight_L:S', 'Direction': (-base_dir[0], base_dir[1])},
                },
            },
            {
                'Type': 'ResolveInnerCorners',
                'Distance': f'{eave_dist} in',
                'Tolerance': 0.2,
                'Corners': {
                    'eave_R': {'OuterID': 'proj_eave_straight_R:S', 'InnerID': 'inner_proj_eave_straight_R:S', 'Direction': (eave_dir[0], eave_dir[1])},
                    'eave_L': {'OuterID': 'proj_roof_L:S',          'InnerID': 'inner_proj_roof_L:S',          'Direction': (-eave_dir[0], eave_dir[1])},
                },
            },
        ]
    }

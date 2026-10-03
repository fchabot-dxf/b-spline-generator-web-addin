def get_block(ui_data=None):
    """
    Phase 17: Inner Corner Resolve (Template 10 - Arched Hourglass).

    Resolves the 2 BOTTOM corners (BR, BL) by position -- identical to Template 1's own mechanism and
    rationale (fb_engine/inner_corners.py): a straight-line-to-straight-line corner's inner point is simply the
    outer corner pulled inward by frame_thickness along the two fixed axis directions, so it never collapses or
    merges under any frame_thickness.

    H23 item 43 (live-measured, item 38 part 1's own precedent for T7): the TWO TOP corners (where a horn
    meets the arch) were ORIGINALLY left unresolved here on the claim that "Fusion's own native Offset already
    produces the geometrically true inner corner there... and tags its own curve endpoints natively" -- MEASURED
    directly to be FALSE for this template's own default build: the offset DOES produce the geometrically
    correct inner arc and inner lines (their real coordinates match line_circle_corner's own closed-form answer
    to the sub-millimetre, confirmed by a live probe), but it tags NEITHER the inner arc nor the two inner horn
    lines with any ID at all (p02_02_loop's own offset-to-source ID matching apparently assumes a 1:1 curve
    correspondence an inward offset here does not give it) -- `inner_proj_top_edge:S` / `inner_proj_horn_TR:S`
    were simply never registered in entity_map, so p03_04's own miters there silently missed ("MITER MISS",
    never built -- item 38's own `declared_profiles.classify` then finds one unsplit profile spanning 3 bars).
    Resolved the SAME way as T7's own eave (fb_engine/inner_corners.py's `line_circle_corner_step`, already
    template-agnostic -- no new math): compute the true line-meets-arc corner LIVE from the REAL built
    top_edge arc + horn line, then tag whichever already-EXISTING (if anonymous) SketchPoint sits there --
    confirmed live, the correct point already exists, untagged, at the exact computed position (distance
    0.0000 cm over 2 independent runs).
    """
    return {
        "PhaseID": "p03_03_inner_corner_resolve",
        "Name": "Inner Corner Resolve",
        "BuildSequence": [
            {
                'Type': 'ResolveInnerCorners',
                'Distance': 'frame_thickness',
                'Tolerance': 0.05,
                'Corners': {
                    'BR': {'OuterID': 'proj_bottom_edge:S', 'InnerID': 'inner_proj_bottom_edge:S', 'Direction': (-1,  1)},
                    'BL': {'OuterID': 'proj_horn_BL:S',     'InnerID': 'inner_proj_horn_BL:S',     'Direction': ( 1,  1)},
                },
            },
            {
                'Type': 'ResolveLineCircleCorner',
                'FrameThickness': 'frame_thickness',
                'Tolerance': 0.2,
                'Corners': {
                    # TR: outer corner = proj_horn_TR:S (ON the arch's own circle, the tangent point); the
                    # horn's own FAR end (away from the arch) is :E.
                    'TR': {'LineFarID': 'proj_horn_TR:E', 'LineNearID': 'proj_horn_TR:S',
                           'ArcID': 'proj_top_edge', 'InnerID': 'inner_proj_horn_TR:S', 'Concave': False},
                    # TL: mirrored -- outer corner = proj_top_edge:S (the SAME physical point as
                    # proj_horn_TL:S), the horn's own far end is proj_horn_TL:E.
                    'TL': {'LineFarID': 'proj_horn_TL:E', 'LineNearID': 'proj_horn_TL:S',
                           'ArcID': 'proj_top_edge', 'InnerID': 'inner_proj_top_edge:S', 'Concave': False},
                },
            },
        ]
    }

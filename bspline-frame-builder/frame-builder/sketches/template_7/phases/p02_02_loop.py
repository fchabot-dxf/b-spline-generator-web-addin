def get_block(ui_data=None):
    """
    Silhouette Loop: the 9-piece clockwise Diamond-top Hourglass outline (Template 7).

    Approved shape (amendment 189/190 in .handoff/amendments.tsv; the authoritative spec -
    NEXT-SESSION-lane-b.md is stale on this topic, see WORK-LOG-lane-b.md Turn 197/199/201).
    Right half (left mirrored): peak on the safe-zone top edge (x=0); a 90-degree roof down to
    the EAVE tip; from the eave the side turns down-and-inward into a concave NECK (narrowest),
    tangent into a convex BODY arc flaring to the full safe-zone width, tangent into a straight
    line down to the base corner. 5 bars (roof_left, roof_right, side_left, side_right, base),
    5 miters (peak, 2 eaves, 2 base corners) - the neck-to-body and body-to-line joins are
    TANGENT (smooth), not miters (fb_engine/t7_geometry.py's own module docstring).

    Clockwise, starting at the peak (matches template_data.py's FRAME_SEED_MAP `prim` order):
      0 roof_R, 1 arc_neck_R, 2 arc_body_R, 3 side_R, 4 bottom_edge,
      5 side_L, 6 arc_body_L, 7 arc_neck_L, 8 roof_L.

    Every point here is the SAME closed-form math fb_engine/t7_geometry.py / t7_roof_eave.py
    already prove (peak/eave/roof via roof_geometry; neck/body via t7_outline), re-expressed as
    live Fusion EXPRESSIONS in widthIn/heightIn/boundingboxoffset (not baked decimals - the exact
    bug T8's own AMENDMENT fixed: a seed that only scales with one dimension is wrong off its one
    tuned board size). The neck-width/height/body-flare proportions are this template's OWN
    hand-build defaults (NECK_WIDTH_OF_HW_DEFAULT=0.50, NECK_HEIGHT_FRAC_DEFAULT=0.18,
    BODY_FLARE_HEIGHT_FRAC_DEFAULT=0.72, t7_geometry.py) - like every other template's seeded
    handles (T8's topDipPosition etc.), the app's own "neck width/height/body flare" handles move
    these same seed points directly at Send time (FRAME_SEED_MAP, fb_engine/seed_geometry.py); no
    dimension and no new parameter.

    Each Arc3Point's own middle ("via") point is only a solver-convergence HINT establishing the
    correct concave (neck) / convex (body) bulge direction - the exact radius is NOT seeded here,
    it is resolved downstream by the Tangent constraints in p02_05_tangency.py against the fixed
    E/N/B endpoints (same division of labour as Template 8's dip arcs: a seed hint + Tangent, not
    a closed-form seed radius). A temporary seed Radius dimension (p02_03_radii, generous and
    rough on purpose) gives the solver a reasonable starting curvature; p02_06_radius_removal
    deletes it once tangency has taken over, exactly as every other template with chained arcs.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction

    NOTE (seat A LIVE_CHECK.md item): this is the first phase file in this codebase to put
    `min(...)` inside a Fusion expression string (the roof half-width/height cap `a`). Fusion's
    expression editor documents `min`/`max`/`sqrt`/trig as supported, but nothing here has
    exercised it before - confirm it evaluates (no red expression) on the very first live build.
    """
    HW = '(widthIn/2 - boundingboxoffset)'
    HH = '(heightIn/2 - boundingboxoffset)'
    # Roof half-width/height `a` (t7_roof_eave.roof_geometry): min(0.62*hw, 0.42*H) where H is the
    # FULL safe-zone height (2*HH here, since HH is the half-height).
    A = f'min(0.62*{HW}, 0.84*{HH})'
    # yE (bottom-left-origin eave height) = height_in - a = 2*HH - a; `rest` in t7_geometry.py's
    # own t7_outline is exactly this same value.
    YE_BL = f'(2*{HH} - {A})'
    # Default handle proportions (fb_engine/t7_geometry.py NECK_WIDTH_OF_HW_DEFAULT etc.) - moved
    # live by the app's seeded handles at Send time, see this function's own doc comment.
    NX = f'max(0.50*{HW}, {A}*0.70)'            # neck half-width from centreline
    NECK_Y = f'({YE_BL}*0.82 - {HH})'           # 1 - 0.18 (NECK_HEIGHT_FRAC_DEFAULT), centred y
    BODY_Y = f'({YE_BL}*0.28 - {HH})'           # 1 - 0.72 (BODY_FLARE_HEIGHT_FRAC_DEFAULT), centred y

    # Arc3Point "via" hints: chord midpoint nudged toward the centreline (neck, concave) or away
    # from it (body, convex) by 15% of the chord's own horizontal span - a bulge-direction hint
    # only, see this function's own doc comment.
    neck_via_x_r = f'(({A} + {NX})/2 - 0.15*({A} - ({NX})))'
    neck_via_y_r = f'((({HH} - {A}) + ({NECK_Y}))/2)'
    body_via_x_r = f'((({NX}) + {HW})/2 + 0.15*({HW} - ({NX})))'
    body_via_y_r = f'((({NECK_Y}) + ({BODY_Y}))/2)'

    seq = [
        # Roof (right): peak -> eave tip E_R. Outer corner at the peak is exactly vertical by
        # symmetry (t7_roof_eave.peak_inner_corner's own docstring).
        {'ID': 'roof_R', 'Type': 'Line', 'Points': [['0', HH], [A, f'({HH} - {A})']], 'StartID': 'roof_R:S', 'EndID': 'roof_R:E'},

        # Right side: neck arc (concave, E_R -> N_R), body arc (convex, N_R -> B_R, tangent at
        # N_R), straight line (B_R -> base_R, tangent at B_R - t7_geometry.py's own "Body arc:
        # tangent to the vertical straight side at B").
        {'ID': 'arc_neck_R', 'Type': 'Arc3Point', 'Points': [
            [A, f'({HH} - {A})'],
            [neck_via_x_r, neck_via_y_r],
            [NX, NECK_Y]], 'StartID': 'arc_neck_R:S', 'EndID': 'arc_neck_R:E'},
        {'Type': 'Radius', 'Target': 'arc_neck_R', 'Expression': f'1.5 * ({HW})', 'Name': 'seed_rad_neck_R'},

        {'ID': 'arc_body_R', 'Type': 'Arc3Point', 'Points': [
            [NX, f'{NECK_Y} - 0.001'],
            [body_via_x_r, body_via_y_r],
            [HW, BODY_Y]], 'StartID': 'arc_body_R:S', 'EndID': 'arc_body_R:E'},
        {'Type': 'Radius', 'Target': 'arc_body_R', 'Expression': f'1.5 * ({HW})', 'Name': 'seed_rad_body_R'},

        {'ID': 'side_R', 'Type': 'Line', 'Points': [[HW, f'{BODY_Y} - 0.001'], [HW, f'-({HH})']], 'StartID': 'side_R:S', 'EndID': 'side_R:E'},

        # Base (bottom_edge): base_R -> base_L, anchored to the real offset-BB corners.
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[f'{HW} - 0.001', f'-({HH})'], [f'-{HW} + 0.001', f'-({HH})']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # Left side (mirror of the right - the SAME NX/NECK_Y/BODY_Y expressions, x negated).
        {'ID': 'side_L', 'Type': 'Line', 'Points': [[f'-{HW} + 0.001', f'-({HH})'], [f'-({HW})', f'{BODY_Y} - 0.002']], 'StartID': 'side_L:S', 'EndID': 'side_L:E'},

        {'ID': 'arc_body_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({HW})', BODY_Y],
            [f'-({body_via_x_r})', body_via_y_r],
            [f'-({NX})', f'{NECK_Y} - 0.002']], 'StartID': 'arc_body_L:S', 'EndID': 'arc_body_L:E'},
        {'Type': 'Radius', 'Target': 'arc_body_L', 'Expression': f'1.5 * ({HW})', 'Name': 'seed_rad_body_L'},

        {'ID': 'arc_neck_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({NX})', NECK_Y],
            [f'-({neck_via_x_r})', neck_via_y_r],
            [f'-({A})', f'({HH} - {A})']], 'StartID': 'arc_neck_L:S', 'EndID': 'arc_neck_L:E'},
        {'Type': 'Radius', 'Target': 'arc_neck_L', 'Expression': f'1.5 * ({HW})', 'Name': 'seed_rad_neck_L'},

        # Roof (left): eave tip E_L -> peak (0.001 short of the shared peak, per T6's own
        # convention - no auto-coincidence before the explicit weld in p02_04_welds.py).
        {'ID': 'roof_L', 'Type': 'Line', 'Points': [[f'-({A})', f'({HH} - {A}) + 0.001'], ['0.001', f'{HH} - 0.001']], 'StartID': 'roof_L:S', 'EndID': 'roof_L:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

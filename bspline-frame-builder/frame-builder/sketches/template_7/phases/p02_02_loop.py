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

    H23 item 27 (the T11 recipe -- fusion360-quirks skill, "A SketchArc ALWAYS runs counter-
    clockwise..." and "Tangent on an arc chain LOCKS the seed, it does not SOLVE for the shape"):
    each Arc3Point's own middle ("via") point is its TRUE angular midpoint on the arc's own real
    circle (centre + radius along the bisector of its two end directions), not a chord-midpoint
    hint pushed sideways -- the seed IS the answer, Tangent (p02_04_tangency.py) only LOCKS it.
    No seed Radius dimension, no 0.001-in endpoint nudges (explicit API welds, p02_03_welds.py,
    never needed them -- coincident coordinates are not auto-merged on API creation). The circle
    centres/radii/via points are declared as NAMED Fusion parameters (template_data.py's own
    SKETCH_2_PARAMETERS, t7_* ) rather than inlined here -- inlining this particular chain
    exploded to a 170KB expression string for the deepest one; see that file's own comment for
    the derivation + validation against fb_engine/t7_geometry.py's own t7_outline().

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    EXCEPT arc_body_R / arc_body_L: their own declared 3-point order turns CLOCKWISE, so Fusion's
    own addByThreePoints assigns :S/:E the OPPOSITE way round from every other piece here (the
    arc_neck_R/L pieces happen to turn CCW already, so THEIR tags need no correction) -- resolved
    by physical position (the sign of each arc's own 3-point turn), not creation order;
    p02_03_welds.py's own weld targets for these two arcs are declared against that physical
    reality, not the naive point[0]=:S assumption. MEASURED (H23 item 27 part 2's own all-
    template test, test_all_templates_shape_outline.py): these were the exact 4 welds it flagged.

    NOTE (seat A LIVE_CHECK.md item, RESOLVED H23 item 27): this WAS the first phase file in this
    codebase to put `min(...)` inside a Fusion expression string (the roof half-width/height cap
    `a`) -- MEASURED live it does NOT evaluate (`evaluateExpression` rejects `min`/`max` entirely,
    fusion360-quirks skill); `t7_a`/`t7_nx` above use the abs-form substitution instead.
    """
    HW = '(widthIn/2 - boundingboxoffset)'
    HH = '(heightIn/2 - boundingboxoffset)'
    # Roof half-width/height `a` (t7_roof_eave.roof_geometry): min(0.62*hw, 0.42*H) where H is the
    # FULL safe-zone height (2*HH here, since HH is the half-height). H23 item 27: Fusion's own
    # evaluateExpression does not support min()/max() at all (measured, fusion360-quirks skill) --
    # `t7_a` (template_data.py's own SKETCH_2_PARAMETERS) is the abs-form substitution, declared
    # once; referenced here by its bare name, never re-inlined.
    A = 't7_a'
    # yE (bottom-left-origin eave height) = height_in - a = 2*HH - a; `rest` in t7_geometry.py's
    # own t7_outline is exactly this same value.
    YE_BL = f'(2*{HH} - {A})'
    # Default handle proportions (fb_engine/t7_geometry.py NECK_WIDTH_OF_HW_DEFAULT etc.) - moved
    # live by the app's seeded handles at Send time, see this function's own doc comment. `t7_nx`:
    # same min/max-unsupported reasoning as `t7_a` above (abs-form max, declared once).
    NX = 't7_nx'                                # neck half-width from centreline
    NECK_Y = f'({YE_BL}*0.82 - {HH})'           # 1 - 0.18 (NECK_HEIGHT_FRAC_DEFAULT), centred y
    BODY_Y = f'({YE_BL}*0.28 - {HH})'           # 1 - 0.72 (BODY_FLARE_HEIGHT_FRAC_DEFAULT), centred y

    # Arc3Point "via" points: each arc's own TRUE angular midpoint, declared as the named t7_via_*
    # Fusion parameters above (template_data.py's own SKETCH_2_PARAMETERS) -- the seed IS the
    # answer (H23 item 27, this file's own module docstring).
    NECK_VIA_R = ('t7_via_neck_x', 't7_via_neck_y')
    BODY_VIA_R = ('t7_via_body_x', 't7_via_body_y')

    seq = [
        # Roof (right): peak -> eave tip E_R. Outer corner at the peak is exactly vertical by
        # symmetry (t7_roof_eave.peak_inner_corner's own docstring).
        {'ID': 'roof_R', 'Type': 'Line', 'Points': [['0', HH], [A, f'({HH} - {A})']], 'StartID': 'roof_R:S', 'EndID': 'roof_R:E'},

        # Right side: neck arc (concave, E_R -> N_R), body arc (convex, N_R -> B_R, tangent at
        # N_R), straight line (B_R -> base_R, tangent at B_R - t7_geometry.py's own "Body arc:
        # tangent to the vertical straight side at B"). No endpoint nudges (H23 item 27): explicit
        # API welds (p02_03_welds.py) never needed them.
        {'ID': 'arc_neck_R', 'Type': 'Arc3Point', 'Points': [
            [A, f'({HH} - {A})'],
            [NECK_VIA_R[0], NECK_VIA_R[1]],
            [NX, NECK_Y]], 'StartID': 'arc_neck_R:S', 'EndID': 'arc_neck_R:E'},

        {'ID': 'arc_body_R', 'Type': 'Arc3Point', 'Points': [
            [NX, NECK_Y],
            [BODY_VIA_R[0], BODY_VIA_R[1]],
            [HW, BODY_Y]], 'StartID': 'arc_body_R:S', 'EndID': 'arc_body_R:E'},

        {'ID': 'side_R', 'Type': 'Line', 'Points': [[HW, BODY_Y], [HW, f'-({HH})']], 'StartID': 'side_R:S', 'EndID': 'side_R:E'},

        # Base (bottom_edge): base_R -> base_L, anchored to the real offset-BB corners.
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[HW, f'-({HH})'], [f'-{HW}', f'-({HH})']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # Left side (mirror of the right - the SAME NX/NECK_Y/BODY_Y/t7_via_* expressions, x negated).
        {'ID': 'side_L', 'Type': 'Line', 'Points': [[f'-{HW}', f'-({HH})'], [f'-({HW})', BODY_Y]], 'StartID': 'side_L:S', 'EndID': 'side_L:E'},

        {'ID': 'arc_body_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({HW})', BODY_Y],
            [f'-({BODY_VIA_R[0]})', BODY_VIA_R[1]],
            [f'-({NX})', NECK_Y]], 'StartID': 'arc_body_L:S', 'EndID': 'arc_body_L:E'},

        {'ID': 'arc_neck_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({NX})', NECK_Y],
            [f'-({NECK_VIA_R[0]})', NECK_VIA_R[1]],
            [f'-({A})', f'({HH} - {A})']], 'StartID': 'arc_neck_L:S', 'EndID': 'arc_neck_L:E'},

        # Roof (left): eave tip E_L -> peak. No nudge (H23 item 27): explicit API welds never needed it.
        {'ID': 'roof_L', 'Type': 'Line', 'Points': [[f'-({A})', f'({HH} - {A})'], ['0', HH]], 'StartID': 'roof_L:S', 'EndID': 'roof_L:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

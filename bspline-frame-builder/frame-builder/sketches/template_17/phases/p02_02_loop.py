from fb_engine.t16_geometry import TOP_WIDTH_FRAC_DEFAULT


def get_block(ui_data=None):
    """
    Silhouette Loop: the 6-piece clockwise Tulip outline (Template 17). Shares Template 16's own
    arch/lower_R/lower_L/base VERBATIM (same t16_* named parameters, template_data.py's own
    SHARED_LOWER_SKETCH_2_PARAMETERS) -- the ONLY difference from that template is the two upper
    sides, which curve INWARD (concave) from the arch ends to the waist instead of running
    straight (see Template 16's own copy of this phase for the lower-half derivation/docstring;
    not repeated here).

    Fred-approved diagram (T84 items 1-2, commit 19f7bbb; items approved 2026-10-03). Right half
    (left mirrored), clockwise starting at the top-right corner:
      0 upper_R (ARC, topR -> waistR), 1 lower_R (arc, waistR -> BR), 2 base (line, BR -> BL),
      3 lower_L (arc, BL -> waistL), 4 upper_L (ARC, waistL -> topL), 5 arch (arc, topL -> topR).
    EVERY joint here is a MITER, same as Template 16 -- no tangent chain at all.

    The two upper arcs each need their own sagitta/via-point chain (fb_engine.closed_form_arc.
    sagitta_circle), same recipe as the lower bulges but with the FLIPPED normal sign
    sagitta_circle's own away-point disambiguation resolves to for THIS pair of chords (the
    concave bulge pulls INWARD toward the centreline, the opposite side from the lower bulges' own
    outward pull) -- declared as NAMED Fusion parameters in template_data.py's own
    UPPER_ARC_SKETCH_2_PARAMETERS (t17_ur_*), verified numerically against
    fb_engine.t16_geometry.outline()'s own upper_r_centre/via at 3 board sizes before being trusted
    here (fb_engine/t16_geometry.py's own module comment). upper_L is the exact x-mirror of
    upper_R (verified the same way) -- no separate named chain for it.

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (fusion360-quirks skill, "A SketchArc ALWAYS runs
    counter-clockwise from startSketchPoint to endSketchPoint" -- reconfirmed here 2026-10-03 via
    the sign of each arc's own declared 3-point turn, same method Template 16's own copy of this
    phase used): the arch/lower_R/lower_L arcs turn CLOCKWISE (swapped, same as Template 16), but
    upper_R/upper_L -- now arcs, where Template 16 had plain LINES -- turn COUNTER-clockwise in
    their own declared order (the concave bulge reverses the loop's own local winding relative to
    the convex pieces), so their own :S/:E are NOT swapped: they match declared order directly,
    exactly as a plain Line's own :S/:E always would. Physical point at each tagged end:
        arch     :S = topR     :E = topL      (declared [topL, apex, topR], clockwise, swapped)
        upper_R  :S = topR     :E = waistR     (declared [topR, via, waistR], counter-clockwise, NOT swapped)
        lower_R  :S = BR       :E = waistR     (declared [waistR, via, BR], clockwise, swapped)
        lower_L  :S = waistL   :E = BL         (declared [BL, via, waistL], clockwise, swapped)
        upper_L  :S = waistL   :E = topL       (declared [waistL, via, topL], counter-clockwise, NOT swapped)
    Net effect at each of this template's 6 corners is IDENTICAL to Template 16's own table (both
    pieces at every corner agree on which suffix is physically there, same 3 corners -- waistR,
    BL, topL -- only ever reachable via `:E`): p02_03_welds.py's own docstring has the full table
    reconfirmed against the welds, and p03_03/p03_04 use the exact same outer/inner ids Template 16
    does.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    For the five ARCS this is the DECLARED order of their points only; the LIVE :S/:E tags follow
    Fusion's counter-clockwise rule (see above and p02_03).
    """
    HW = 't16_hw'
    HH = 't16_hh'
    WW = 't16_ww'
    WY = 't16_wy'
    LR_VX, LR_VY = 't16_lr_vx', 't16_lr_vy'
    UR_VX, UR_VY = 't17_ur_vx', 't17_ur_vy'

    # topR / topL: A = topWidthFrac*hw (T84 item 4's own seeded "Top width" handle -- imported, see
    # Template 16's own copy of this phase), rise = 0.39*hw (ARCH_RISE_FRAC_DEFAULT).
    TOP_X, TOP_Y = f'({TOP_WIDTH_FRAC_DEFAULT}*{HW})', f'({HH} - 0.39*{HW})'

    seq = [
        # Upper right: topR -> waistR, concave (curving toward the centreline), seeded with its
        # own TRUE via point (t17_ur_vx/vy).
        {'ID': 'upper_R', 'Type': 'Arc3Point', 'Points': [
            [TOP_X, TOP_Y], [UR_VX, UR_VY], [WW, WY]], 'StartID': 'upper_R:S', 'EndID': 'upper_R:E'},

        # Lower right bulge: waistR -> BR, seeded with its own TRUE via point (t16_lr_vx/vy) --
        # identical to Template 16's own copy.
        {'ID': 'lower_R', 'Type': 'Arc3Point', 'Points': [
            [WW, WY], [LR_VX, LR_VY], [HW, f'-({HH})']], 'StartID': 'lower_R:S', 'EndID': 'lower_R:E'},

        # Base: BR -> BL, anchored to the real offset-BB corners (p02_03_welds.py).
        {'ID': 'base', 'Type': 'Line', 'Points': [[HW, f'-({HH})'], [f'-{HW}', f'-({HH})']], 'StartID': 'base:S', 'EndID': 'base:E'},

        # Lower left bulge (mirror of the right -- the SAME t16_lr_vx/vy parameters, x negated).
        {'ID': 'lower_L', 'Type': 'Arc3Point', 'Points': [
            [f'-{HW}', f'-({HH})'], [f'-({LR_VX})', LR_VY], [f'-({WW})', WY]], 'StartID': 'lower_L:S', 'EndID': 'lower_L:E'},

        # Upper left (mirror of the right -- the SAME t17_ur_vx/vy parameters, x negated).
        {'ID': 'upper_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({WW})', WY], [f'-({UR_VX})', UR_VY], [f'-({TOP_X})', TOP_Y]], 'StartID': 'upper_L:S', 'EndID': 'upper_L:E'},

        # Arch: topL -> topR, via EXACTLY the apex (0, hh) -- identical to Template 16's own copy
        # (no sagitta/via-point parameter needed: symmetric by construction).
        {'ID': 'arch', 'Type': 'Arc3Point', 'Points': [
            [f'-({TOP_X})', TOP_Y], ['0', HH], [TOP_X, TOP_Y]], 'StartID': 'arch:S', 'EndID': 'arch:E'},

        # F33 item 1: all five arcs above are lone miters (no Tangent chain to hold their shape) --
        # a bare Coincident weld (p02_03_welds.py) only pins an ARC'S OWN endpoint, it does not stop
        # addByThreePoints' own branch from being reinterpreted onto the reflex (long) way around once
        # that endpoint gets nudged by a later constraint (fusion360-quirks skill, "Fix the arc's own
        # endpoints directly -- never rely on a Coincident chain to propagate fixedness"; same recipe
        # as sketches/template_14/phases/p02_02_loop.py's own copy of this fix). UnseededOnly: a
        # seeded Send replaces these Points with the app's own absolute in-position values
        # (apply_seed_geometry), so there the arc is never left with this ambiguity to begin with;
        # this is purely the literal/unseeded path's own fix (Sketch Builder, record_frame_parity.py
        # goldens).
        {'Type': 'Fix', 'Targets': ['upper_R:S', 'upper_R:E'], 'UnseededOnly': True},
        {'Type': 'Fix', 'Targets': ['lower_R:S', 'lower_R:E'], 'UnseededOnly': True},
        {'Type': 'Fix', 'Targets': ['lower_L:S', 'lower_L:E'], 'UnseededOnly': True},
        {'Type': 'Fix', 'Targets': ['upper_L:S', 'upper_L:E'], 'UnseededOnly': True},
        {'Type': 'Fix', 'Targets': ['arch:S', 'arch:E'], 'UnseededOnly': True},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

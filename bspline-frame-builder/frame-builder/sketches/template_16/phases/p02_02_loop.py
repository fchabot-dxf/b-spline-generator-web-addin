def get_block(ui_data=None):
    """
    Silhouette Loop: the 6-piece clockwise Arched Funnel outline (Template 16; Template 17 "Tulip"
    reuses this same loop for its lower half, see that template's own copy of this phase).

    Fred-approved diagram (T84 items 1-2, commit 19f7bbb; items approved 2026-10-03): a ONE-piece
    arch (the apex is a tangent point of its OWN single arc, never a corner -- 6 bars, not 7),
    straight upper sides tapering to a waist, two outward-bulging lower curves, a flat base. Right
    half (left mirrored), clockwise starting at the top-right corner:
      0 upper_R (line, topR -> waistR), 1 lower_R (arc, waistR -> BR), 2 base (line, BR -> BL),
      3 lower_L (arc, BL -> waistL), 4 upper_L (line, waistL -> topL), 5 arch (arc, topL -> topR).
    EVERY joint here is a MITER (fb_engine/t16_geometry.py's own module docstring) -- unlike
    Template 7/11's tangent chains, no neighbour-tangency coupling: each arc is independently
    defined by its own CHORD + SAGITTA (fb_engine.closed_form_arc.sagitta_circle), seeded with its
    own TRUE via point (H23 item 27's own recipe: the seed IS the answer -- but here there is no
    Tangent step at all, since nothing here needs locking onto a neighbour; the miters,
    p03_04_encl_miters.py, only ever join an OUTER corner to its resolved INNER one).

    The arch is the one piece needing no sagitta/via-point machinery at all: topL/topR share the
    same y and the away-point is on the centreline, so by symmetry the arch's own via point is
    EXACTLY the apex (0, hh) -- fb_engine/test_t16_geometry.py's own TestArchIsSymmetric proves
    this against the independently-tested Python module. The two lower bulges are NOT symmetric
    about their own chord's perpendicular bisector the same simple way, so their own centre/via
    needs the full sagitta_circle + true_via_point chain -- declared as NAMED Fusion parameters
    (template_data.py's own SKETCH_2_PARAMETERS, t16_lr_*) rather than inlined here: inlining the
    via point's own formula (which references the centre, which references the radius, which
    references the chord -- each substituted in by hand) blew up to ~9,200 characters per
    coordinate (measured, scratch check before this file was written) -- the same blowup Template
    7's own module docstring already warns about for an equivalent chain.

    Default proportions baked as LITERAL fractions of hw/hh (ARCH_RISE_FRAC_DEFAULT=0.39,
    WAIST_WIDTH_FRAC_DEFAULT=0.38, WAIST_HEIGHT_FRAC_DEFAULT=0.55, BULGE_FRAC_DEFAULT=0.169,
    fb_engine/t16_geometry.py) -- like every other template's seeded handles, the app's own
    "arch rise / waist width / waist height / bulge" handles move these same seed points directly
    at Send time (FRAME_SEED_MAP, fb_engine/seed_geometry.py); no dimension, no new parameter.

    CLOSED-FORM DERIVATION (verified numerically against fb_engine.t16_geometry.outline()'s own
    independently-computed board-coordinate values before being trusted here -- see
    fb_engine/test_t16_fusion_expressions.py, which resolves the SKETCH_2_PARAMETERS chain in pure
    Python and checks every point, exactly mirroring test_t11_fusion_expressions.py's own pattern):
      hw/hh = the safe-zone half-width/height (t16_hw/t16_hh, template_data.py).
      topR = (0.75*hw, hh - 0.39*hw); topL = mirror.             (A = 0.75*hw, FIXED, not a handle)
      apex = (0, hh)                                              (the arch's own exact via point)
      waistR = (0.38*hw, hh*(1 - 2*0.55)); waistL = mirror.
      BR = (hw, -hh); BL = (-hw, -hh).
      lower_R: chord waistR->BR, sagitta 0.169*hw, bulging away from the board's own centreline --
        t16_lr_cx/cy (the circle's own centre) and t16_lr_vx/vy (the TRUE via point) are the named
        parameter chain's own final outputs (template_data.py). lower_L is the EXACT x-mirror
        (verified numerically, not assumed: fb_engine's own outline() computes lower_L
        independently via the SAME sagitta_circle call on BL/waistL, and it lands exactly on
        lower_R's own mirror at every board size checked).

    THE ARCS' :S/:E ARE FUSION'S, NOT THE LOOP'S (fusion360-quirks skill, "A SketchArc ALWAYS runs
    counter-clockwise from startSketchPoint to endSketchPoint" -- MEASURED, and independently
    reconfirmed here 2026-10-03 via the sign of each arc's own declared 3-point turn): all THREE
    arcs below (arch, lower_R, lower_L) turn CLOCKWISE in their declared Points order, so Fusion's
    own addByThreePoints tags :S at the point declared LAST, :E at the point declared FIRST -- the
    OPPOSITE of every other template's own convention, for all three. Physical point at each
    tagged end:
        arch     :S = topR     :E = topL      (declared [topL, apex, topR], clockwise, swapped)
        lower_R  :S = BR       :E = waistR     (declared [waistR, via, BR], clockwise, swapped)
        lower_L  :S = waistL   :E = BL         (declared [BL, via, waistL], clockwise, swapped)
    Three of this template's six corners (waistR, BL, topL) are therefore only reachable via an
    arc's own `:E`, never its `:S` -- fixed in editor-frame-profile.js's own `frameCutProfile`
    (T84 item 3: it only ever stripped a trailing `:S` when mapping a corner id back to its
    primitive index, so every corner declared via `:E` silently fell out of its own exemption set
    and would have been flagged as a false `notTangent` defect at every one of these 3 corners).
    p02_03_welds.py's own docstring has the physical-point table reconfirmed against the welds.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    For the three ARCS this is the DECLARED order of their points only; the LIVE :S/:E tags follow
    Fusion's counter-clockwise rule (see above and p02_03).
    """
    HW = 't16_hw'
    HH = 't16_hh'
    WW = 't16_ww'
    WY = 't16_wy'
    LR_VX, LR_VY = 't16_lr_vx', 't16_lr_vy'

    # topR / topL: A = 0.75*hw (FIXED proportion, not a handle), rise = 0.39*hw (ARCH_RISE_FRAC_DEFAULT).
    TOP_X, TOP_Y = f'(0.75*{HW})', f'({HH} - 0.39*{HW})'

    seq = [
        # Upper right: topR -> waistR (straight; Template 17's own copy of this phase replaces this
        # with a concave arc -- see that template's own module docstring).
        {'ID': 'upper_R', 'Type': 'Line', 'Points': [[TOP_X, TOP_Y], [WW, WY]], 'StartID': 'upper_R:S', 'EndID': 'upper_R:E'},

        # Lower right bulge: waistR -> BR, seeded with its own TRUE via point (t16_lr_vx/vy).
        {'ID': 'lower_R', 'Type': 'Arc3Point', 'Points': [
            [WW, WY], [LR_VX, LR_VY], [HW, f'-({HH})']], 'StartID': 'lower_R:S', 'EndID': 'lower_R:E'},

        # Base: BR -> BL, anchored to the real offset-BB corners (p02_03_welds.py).
        {'ID': 'base', 'Type': 'Line', 'Points': [[HW, f'-({HH})'], [f'-{HW}', f'-({HH})']], 'StartID': 'base:S', 'EndID': 'base:E'},

        # Lower left bulge (mirror of the right -- the SAME t16_lr_vx/vy parameters, x negated).
        {'ID': 'lower_L', 'Type': 'Arc3Point', 'Points': [
            [f'-{HW}', f'-({HH})'], [f'-({LR_VX})', LR_VY], [f'-({WW})', WY]], 'StartID': 'lower_L:S', 'EndID': 'lower_L:E'},

        # Upper left (mirror of the right).
        {'ID': 'upper_L', 'Type': 'Line', 'Points': [[f'-({WW})', WY], [f'-({TOP_X})', TOP_Y]], 'StartID': 'upper_L:S', 'EndID': 'upper_L:E'},

        # Arch: topL -> topR, via EXACTLY the apex (0, hh) -- no sagitta/via-point parameter needed
        # (this module's own docstring: symmetric by construction).
        {'ID': 'arch', 'Type': 'Arc3Point', 'Points': [
            [f'-({TOP_X})', TOP_Y], ['0', HH], [TOP_X, TOP_Y]], 'StartID': 'arch:S', 'EndID': 'arch:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

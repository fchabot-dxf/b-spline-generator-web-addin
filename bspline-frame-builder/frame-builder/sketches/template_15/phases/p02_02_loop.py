def get_block(ui_data=None):
    """
    Silhouette Loop: the 6-piece clockwise Flask outline (Template 15, F31 item 2b; Fred approved the
    diagram as drawn, tools/repro/f31_item2_flask_diagram.mjs).

    A straight neck (two vertical sides) meeting a dome that bulges OUTWARD and down to the flat
    base, a flat top closing the neck. Right half (left mirrored), clockwise starting at the
    top-right corner:
      0 neck_R (line, topR -> neckBottomR), 1 dome_R (arc, neckBottomR -> BR), 2 base (line, BR -> BL),
      3 dome_L (arc, BL -> neckBottomL), 4 neck_L (line, neckBottomL -> topL), 5 top (line, topL -> topR).
    EVERY joint here is a MITER (fb_engine/t15_flask_geometry.py's own module docstring) -- same
    structural class as T14/T16/T17: no tangent chain, no neighbour-tangency coupling. The dome arc
    is built independently from its own CHORD + SAGITTA (fb_engine.closed_form_arc.sagitta_circle),
    seeded with its own TRUE via point.

    UNLIKE T14/T16/T17, two of this template's own six corners (topR, topL) are a plain straight-
    line-meets-straight-line corner -- no circle touches them -- so p03_03_inner_corner_resolve.py
    resolves them with the simpler, generic ResolveInnerCorners step (Template 7's own base_R/base_L
    pattern) instead of ResolveLineCircleCorner.

    ONLY ONE independent arc chain is needed: dome_R's own (neckBottomR -> BR); dome_L is the EXACT
    x-mirror (verified numerically against fb_engine.t15_flask_geometry.outline() before being
    trusted here -- neckBottomL/BL are themselves the exact x-mirror of neckBottomR/BR, and the
    away-point used to pick the outward normal is the same y on both sides). Declared as a NAMED
    Fusion parameter chain (template_data.py's own SKETCH_2_PARAMETERS, t15_dr_*) rather than
    inlined, same blowup-avoidance reasoning T7/T14/T16's own module docstrings already give.

    Default proportions baked as LITERAL fractions of hw/hh (TOP_WIDTH_FRAC_DEFAULT=0.45,
    NECK_HEIGHT_FRAC_DEFAULT=0.45, DOME_FULLNESS_FRAC_DEFAULT=0.1422,
    fb_engine/t15_flask_geometry.py) -- like every other template's seeded handles, the app's own
    "top width / neck height / dome fullness" handles move these same seed points directly at Send
    time (FRAME_SEED_MAP, fb_engine/seed_geometry.py); no dimension, no new parameter.

    CLOSED-FORM DERIVATION (verified numerically against fb_engine.t15_flask_geometry.outline()'s
    own independently-computed board-coordinate values before being trusted here -- see
    fb_engine/test_t15_fusion_expressions.py, which resolves the SKETCH_2_PARAMETERS chain in pure
    Python and checks every point, mirroring test_t14_fusion_expressions.py's own pattern):
      hw/hh = the safe-zone half-width/height (t15_hw/t15_hh, template_data.py).
      topR = (topWidthFrac*hw, hh); topL = mirror.                  (nw = topWidthFrac*hw, the shared
                                                                      "topWidth" handle, T84 item 4)
      neckBottomR = (nw, neckBottomY); neckBottomL = mirror.
      neckBottomY = hh - neckHeightFrac*2*hh    (0=top edge, 1=base edge, Y-UP: SAME convention as
        T14's own pinchY / T16's own waistCenterY sign, re-derived from first principles for THIS
        template's own Y-UP frame -- NOT a sign-flipped copy of the diagram's own Y-DOWN formula,
        same caution sandTimerConstruction's own JS doc comment gives for the opposite direction).
      BR = (hw, -hh); BL = (-hw, -hh).
      dome_R: chord neckBottomR->BR, sagitta domeFullnessFrac*hw, bulging OUTWARD (away from the
        centreline) -- t15_dr_cx/cy (the circle's own centre) and t15_dr_vx/vy (the TRUE via point)
        are the named parameter chain's own final outputs (template_data.py).
      dome_L: the EXACT x-mirror of dome_R (negate cx/vx inline below, cy/vy/r unchanged) --
        confirmed numerically, not assumed (see module docstring above).

    ARC TURN DIRECTION (CONFIRMED NUMERICALLY, 2026-10-03, via the sign of each arc's own declared
    3-point turn at 7x9 defaults -- fusion360-quirks skill, "A SketchArc ALWAYS runs counter-
    clockwise from startSketchPoint to endSketchPoint": a clockwise triplet gets silently SWAPPED):
    BOTH dome_R (declared [neckBottomR, via, BR]) AND dome_L (declared [BL, via, neckBottomL]) turn
    CLOCKWISE in declared order -- re-derived from first principles for THIS template's own chord
    directions, NOT assumed from T14/T16's mirror-symmetry (a naive "mirroring flips the cross-
    product sign" argument was checked and found WRONG here: both sides measure clockwise, not
    opposite signs). Physical point at each tagged end:
        dome_R  :S = BR            :E = neckBottomR   (declared [neckBottomR, via, BR], clockwise, swapped)
        dome_L  :S = neckBottomL   :E = BL             (declared [BL, via, neckBottomL], clockwise, swapped)
    neck_R/base/neck_L/top are Lines (no ambiguity): neck_R :S=topR :E=neckBottomR; base :S=BR :E=BL;
    neck_L :S=neckBottomL :E=topL; top :S=topL :E=topR.
    p02_03_welds.py's own docstring has the physical-point table reconfirmed against the welds.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    For the two ARCS this is the DECLARED order of their points only; the LIVE :S/:E tags follow
    Fusion's counter-clockwise rule (see above and p02_03).
    """
    HW = 't15_hw'
    HH = 't15_hh'
    NW = 't15_nw'
    NBY = 't15_neckBottomY'
    DR_VX, DR_VY = 't15_dr_vx', 't15_dr_vy'

    TOP_X, TOP_Y = NW, HH

    seq = [
        # Neck right: topR -> neckBottomR, straight.
        {'ID': 'neck_R', 'Type': 'Line', 'Points': [[TOP_X, TOP_Y], [NW, NBY]], 'StartID': 'neck_R:S', 'EndID': 'neck_R:E'},

        # Dome right: neckBottomR -> BR, outward-bulging arc, seeded with its own TRUE via point.
        {'ID': 'dome_R', 'Type': 'Arc3Point', 'Points': [
            [NW, NBY], [DR_VX, DR_VY], [HW, f'-({HH})']], 'StartID': 'dome_R:S', 'EndID': 'dome_R:E'},

        # Base: BR -> BL, anchored to the real offset-BB corners (p02_03_welds.py).
        {'ID': 'base', 'Type': 'Line', 'Points': [[HW, f'-({HH})'], [f'-{HW}', f'-({HH})']], 'StartID': 'base:S', 'EndID': 'base:E'},

        # Dome left (mirror of the right -- the SAME t15_dr_vx/vy parameters, x negated).
        {'ID': 'dome_L', 'Type': 'Arc3Point', 'Points': [
            [f'-{HW}', f'-({HH})'], [f'-({DR_VX})', DR_VY], [f'-({NW})', NBY]], 'StartID': 'dome_L:S', 'EndID': 'dome_L:E'},

        # Neck left: neckBottomL -> topL, straight (mirror of the right).
        {'ID': 'neck_L', 'Type': 'Line', 'Points': [[f'-({NW})', NBY], [f'-({TOP_X})', TOP_Y]], 'StartID': 'neck_L:S', 'EndID': 'neck_L:E'},

        # Top: topL -> topR, closing the loop back to neck_R.
        {'ID': 'top', 'Type': 'Line', 'Points': [[f'-({TOP_X})', TOP_Y], [TOP_X, TOP_Y]], 'StartID': 'top:S', 'EndID': 'top:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

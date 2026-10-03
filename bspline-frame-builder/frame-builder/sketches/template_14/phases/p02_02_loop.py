from fb_engine.t14_sandtimer_geometry import TOP_WIDTH_FRAC_DEFAULT


def get_block(ui_data=None):
    """
    Silhouette Loop: the 6-piece clockwise Sand Timer outline (Template 14, T84 item 5, moved from
    seat C's F31 item 1b; Fred approved the diagram as drawn, fb-app 5e0b5fa,
    tools/repro/f31_item1_sandtimer_diagram.mjs).

    A flat top, two outward-bulging arcs per side meeting at a sharp pinch partway in from each
    edge (a genuine miter corner -- the two arcs' own tangents differ there, same "neck as drawn"
    shape the diagram's own bulgeArc() built), a flat base. Right half (left mirrored), clockwise
    starting at the top-right corner:
      0 upper_R (arc, topR -> pinchR), 1 lower_R (arc, pinchR -> BR), 2 base (line, BR -> BL),
      3 lower_L (arc, BL -> pinchL), 4 upper_L (arc, pinchL -> topL), 5 top (line, topL -> topR).
    EVERY joint here is a MITER (fb_engine/t14_sandtimer_geometry.py's own module docstring) --
    same structural class as T16/T17 (fb_engine/t16_geometry.py): no tangent chain, no neighbour-
    tangency coupling, each arc built independently from its own CHORD + SAGITTA
    (fb_engine.closed_form_arc.sagitta_circle), seeded with its own TRUE via point.

    UNLIKE T16 (whose arch needed no via-point parameter at all, by symmetry) and T17 (one shared
    lower chain + one upper chain), ALL FOUR of this template's own side pieces are arcs needing
    the full sagitta_circle + true_via_point chain -- but only TWO independent chains are needed:
    upper_R's own (topR -> pinchR) and lower_R's own (pinchR -> BR); lower_L/upper_L are each the
    EXACT x-mirror of lower_R/upper_R respectively (verified numerically against
    fb_engine.t14_sandtimer_geometry.outline() before being trusted here -- all four centres/radii
    match to 1e-9, see that module's own test file). Declared as NAMED Fusion parameters
    (template_data.py's own SKETCH_2_PARAMETERS, t14_ur_*/t14_lr_*) rather than inlined, same
    blowup-avoidance reasoning T7/T16's own module docstrings already give.

    Default proportions baked as LITERAL fractions of hw/hh (PINCH_REACH_FRAC_DEFAULT=0.6,
    BULGE_FRAC_DEFAULT=0.14, PINCH_HEIGHT_FRAC_DEFAULT=0.5, fb_engine/t14_sandtimer_geometry.py) --
    like every other template's seeded handles, the app's own "pinch reach / bulge / pinch height"
    handles move these same seed points directly at Send time (FRAME_SEED_MAP,
    fb_engine/seed_geometry.py); no dimension, no new parameter. topWidth (T84 item 4's own shared-
    key convention) defaults to 1.0 -- reproduces the Fred-approved diagram's own full-width top
    exactly, narrower only on request.

    CLOSED-FORM DERIVATION (verified numerically against fb_engine.t14_sandtimer_geometry.outline()'s
    own independently-computed board-coordinate values before being trusted here -- see
    fb_engine/test_t14_fusion_expressions.py, which resolves the SKETCH_2_PARAMETERS chain in pure
    Python and checks every point, exactly mirroring test_t16_fusion_expressions.py's own pattern):
      hw/hh = the safe-zone half-width/height (t14_hw/t14_hh, template_data.py).
      topR = (topWidthFrac*hw, hh); topL = mirror.           (A = topWidthFrac*hw, the ONE handle)
      pinchR = (hw*(1-0.6), pinchY); pinchL = mirror.          (pinchHalf = hw*(1-pinchReachFrac))
      BR = (hw, -hh); BL = (-hw, -hh).
      pinchY = hh*(2*0.5 - 1) = 0 at the default (centred); t14_pinchY in general.
      upper_R: chord topR->pinchR, sagitta 0.14*hw, bulging OUTWARD (away from the centreline) --
        t14_ur_cx/cy (the circle's own centre) and t14_ur_vx/vy (the TRUE via point) are the named
        parameter chain's own final outputs (template_data.py).
      lower_R: chord pinchR->BR, same bulge, same chain shape (t14_lr_*).
      lower_L/upper_L: the EXACT x-mirror of lower_R/upper_R (negate cx/vx inline below, cy/vy/r
        unchanged) -- confirmed numerically, not assumed (see module docstring above).

    EVERY ONE OF THE 4 ARCS TURNS CLOCKWISE IN DECLARED TRAVEL ORDER (confirmed numerically,
    2026-10-03, via the sign of each arc's own declared 3-point turn -- fusion360-quirks skill, "A
    SketchArc ALWAYS runs counter-clockwise from startSketchPoint to endSketchPoint": a clockwise
    triplet gets silently SWAPPED). All four below are declared [near-pinch-end-of-travel ... far]
    in the SAME direction this module's own travel order uses (p0 -> via -> p1); Fusion's own CCW
    rule then tags :S at the point declared LAST, :E at the point declared FIRST -- for every one of
    them, unlike T16 where only its 3 arcs (not its 3 lines) had this swap. Physical point at each
    tagged end:
        upper_R  :S = pinchR   :E = topR     (declared [topR, via, pinchR], clockwise, swapped)
        lower_R  :S = BR       :E = pinchR   (declared [pinchR, via, BR], clockwise, swapped)
        lower_L  :S = pinchL   :E = BL       (declared [BL, via, pinchL], clockwise, swapped)
        upper_L  :S = topL     :E = pinchL   (declared [pinchL, via, topL], clockwise, swapped)
    base/top are Lines (no ambiguity): base :S=BR :E=BL; top :S=topL :E=topR.
    p02_03_welds.py's own docstring has the physical-point table reconfirmed against the welds.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    For the four ARCS this is the DECLARED order of their points only; the LIVE :S/:E tags follow
    Fusion's counter-clockwise rule (see above and p02_03).
    """
    HW = 't14_hw'
    HH = 't14_hh'
    PH = 't14_pinchHalf'
    PY = 't14_pinchY'
    UR_VX, UR_VY = 't14_ur_vx', 't14_ur_vy'
    LR_VX, LR_VY = 't14_lr_vx', 't14_lr_vy'

    # topR / topL: A = topWidthFrac*hw (T84 item 4's own seeded "Top width" handle -- imported, not
    # re-typed, so this stays the ONE declared value).
    TOP_X, TOP_Y = f'({TOP_WIDTH_FRAC_DEFAULT}*{HW})', HH

    seq = [
        # Upper right: topR -> pinchR, outward-bulging arc, seeded with its own TRUE via point.
        {'ID': 'upper_R', 'Type': 'Arc3Point', 'Points': [
            [TOP_X, TOP_Y], [UR_VX, UR_VY], [PH, PY]], 'StartID': 'upper_R:S', 'EndID': 'upper_R:E'},

        # Lower right: pinchR -> BR, outward-bulging arc.
        {'ID': 'lower_R', 'Type': 'Arc3Point', 'Points': [
            [PH, PY], [LR_VX, LR_VY], [HW, f'-({HH})']], 'StartID': 'lower_R:S', 'EndID': 'lower_R:E'},

        # Base: BR -> BL, anchored to the real offset-BB corners (p02_03_welds.py).
        {'ID': 'base', 'Type': 'Line', 'Points': [[HW, f'-({HH})'], [f'-{HW}', f'-({HH})']], 'StartID': 'base:S', 'EndID': 'base:E'},

        # Lower left (mirror of the right -- the SAME t14_lr_vx/vy parameters, x negated).
        {'ID': 'lower_L', 'Type': 'Arc3Point', 'Points': [
            [f'-{HW}', f'-({HH})'], [f'-({LR_VX})', LR_VY], [f'-({PH})', PY]], 'StartID': 'lower_L:S', 'EndID': 'lower_L:E'},

        # Upper left (mirror of the right -- the SAME t14_ur_vx/vy parameters, x negated).
        {'ID': 'upper_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({PH})', PY], [f'-({UR_VX})', UR_VY], [f'-({TOP_X})', TOP_Y]], 'StartID': 'upper_L:S', 'EndID': 'upper_L:E'},

        # Top: topL -> topR, closing the loop back to upper_R.
        {'ID': 'top', 'Type': 'Line', 'Points': [[f'-({TOP_X})', TOP_Y], [TOP_X, TOP_Y]], 'StartID': 'top:S', 'EndID': 'top:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

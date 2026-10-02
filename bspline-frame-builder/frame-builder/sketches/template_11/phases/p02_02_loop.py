def get_block(ui_data=None):
    """
    Silhouette Loop: the 13-piece clockwise Diamond-top 3-arc Hourglass outline (Template 11).

    Approved shape (T83 item 1; Fred approved the diagram, WORK-LOG-lane-b.md Turn 218; confirmed the
    hourglass-pinch side specifically after a later question, Turn 220 resumed). Right half (left
    mirrored): peak on the safe-zone top edge; a 90-degree roof down to the EAVE tip (T7's own
    roof/eave, fb_engine/t7_roof_eave.roof_geometry, reused VERBATIM); a short straight run down from
    the eave; a SMALL CONVEX shoulder arc curving in; a CONCAVE waist pinch; a CONVEX hip arc flaring
    back out to the board's own full width; straight down to the base. 5 bars (roof_left, roof_right,
    side_left, side_right, base), 5 miters (peak, 2 eaves, 2 base corners) - every join WITHIN a side
    (eave-straight -> shoulder -> waist -> hip -> base-straight) is TANGENT (smooth), not a miter
    (fb_engine/t11_geometry.py's own module docstring).

    HOW THE 3-ARC CHAIN IS BUILT (resolved 2026-10-01 after two sessions of "under-constrained" --
    both root causes MEASURED in an isolated solver probe, the full write-up lives in the
    fusion360-quirks skill, "A SketchArc ALWAYS runs counter-clockwise..." and "Tangent on an arc
    chain LOCKS the seed, it does not SOLVE for the shape"):
      1. Every arc is seeded as the EXACT answer: its 3 points are its real start, its real END, and
         its real arc MIDPOINT (centre + radius along the bisector of the two end directions), all in
         closed form below -- NOT a chord-midpoint "hint" pushed sideways. Measured on this very chain:
         the exact seed + welds + Tangent reproduces every radius/centre/sweep to 4 decimals; the same
         recipe from the hint seed lands the shoulder at 1.71 in instead of 0.935 in (a stable, wrong
         configuration, no solver error). Tangent only locks what is already right.
      2. NO seed Radius dimension and NO 0.001-in endpoint nudges. A Radius dimension on a hint-seeded
         arc with free endpoints moved its centre by up to 5.7 in before any weld was applied, and
         deleting it afterwards does not undo that; the nudges (an "avoid auto-coincidence" convention
         from T6/T7) left residuals of their own size after Fix+Tangent, and explicit API welds never
         needed them -- coincident coordinates are not auto-merged on API creation.
      3. The welds (p02_03) name each arc's ends by Fusion's OWN convention, not the loop direction: a
         SketchArc always runs counter-clockwise from startSketchPoint to endSketchPoint, so the four
         CLOCKWISE arcs here (both convex shoulders and hips) come back from addByThreePoints with
         :S at the point declared LAST below. p02_03's own docstring has the table.
    The former p02_04_radius_removal / p02_06_fix_joints phases are gone with their reason; sketch 2
    is p02_01 projections -> p02_02 this loop -> p02_03 welds -> p02_04 tangency (+ Pulse).

    Clockwise, starting at the peak (matches template_data.py's FRAME_SEED_MAP `prim` order):
      0 roof_R, 1 eave_straight_R, 2 arc_shoulder_R, 3 arc_waist_R, 4 arc_hip_R, 5 side_straight_R,
      6 bottom_edge, 7 side_straight_L, 8 arc_hip_L, 9 arc_waist_L, 10 arc_shoulder_L,
      11 eave_straight_L, 12 roof_L.

    Every point here is the SAME closed-form math fb_engine/t11_geometry.py already proves
    (t11_outline), re-expressed as live Fusion EXPRESSIONS in widthIn/heightIn/boundingboxoffset (not
    baked decimals - the same T8-amendment bug T7's own copy of this phase already guards against).
    The waist-reach/corner-radius/waist-centre-y proportions are this template's OWN seeded-handle
    defaults (WAIST_REACH_DEFAULT=0.55, CORNER_RADIUS_DEFAULT=0.22, WAIST_CENTER_Y_FRAC_DEFAULT=0.0,
    t11_geometry.py) - like Template 7's own seeded handles, the app's "waist reach / corner radius /
    waist position" handles move these same seed points directly at Send time (FRAME_SEED_MAP,
    fb_engine/seed_geometry.py); no dimension and no new parameter. When that app-side wiring lands,
    the app MUST send each arc's TRUE midpoint as its middle point (point 1 above), for the same
    reason as item 1: the seed is the answer.

    CLOSED-FORM DERIVATION (verified numerically against fb_engine.t11_geometry.t11_outline's own
    independently-computed board-coordinate values before being trusted here -- see
    fb_engine/test_t11_fusion_expressions.py, which also checks every via point sits ON its circle at
    the arc's angular midpoint):
      Let HW/HH be the safe-zone half-width/height, A = min(0.62*HW, 0.84*HH) (T7's own roof/eave `a`).
      At the literal default proportions, T1's own `_waist_radius_frac` (t11_geometry.py) collapses to
      the CONSTANT fraction 0.33 (max(0.55-0.22, 0.5*0.55) = max(0.33, 0.275) = 0.33), and the shoulder/
      hip corners' own tangent-length S = r + radius_waist collapses to exactly waistReach*HW = 0.55*HW
      (since r + (waistReach-r) = waistReach when r <= 0.5*waistReach, true here) -- both constants
      below are these ALREADY-COLLAPSED values, not re-derived max()/min() calls at build time.
        R  = 0.22*HW                              (shoulder/hip corner radius)
        S  = 0.55*HW                              (tangent length, == waistReach*HW)
        RW = 0.33*HW                              (waist radius)
        D_TOP  = A - 0.45*HW                       (shoulder's own "d" = S - (HW - A))
        DY_TOP = sqrt(max(0, D_TOP*(2*S - D_TOP)))
        UX_TOP = (S - D_TOP)/S ; UY_TOP = DY_TOP/S  (unit vector shoulder centre -> waist centre, y DOWN)
      The hip side has NO inset (d = S exactly), which collapses its own sqrt() term algebraically to
      dy=S, ux=0, uy=1 -- verified against t11_geometry's own printed hc['ux_bottom']==0.0,
      hc['uy_bottom']==1.0 exactly, so the hip side needs no sqrt() at all, only plain arithmetic.
      Circle centres (centred sketch coords, y UP):
        C_S = (A - R, SH_Y)            the shoulder horn (A, SH_Y) is where the eave straight is tangent
        C_W = (HW - S + RW, -A/2)      the waist centre, one RW OUTSIDE the pinch's deepest point
        C_H = (HW - R, HH_Y)           the hip horn (HW, HH_Y) is where the side straight is tangent
      Arc midpoints = centre + radius * unit(bisector of the two end directions) -- the MINOR-arc
      midpoint, which is what every arc here is at the template's own defaults (shoulder 46 deg,
      waist 136 deg, hip 90 deg at 9x12; t11_geometry's waist_major is False at these proportions):
        shoulder: ends at directions (1, 0) and (UX, -UY) from C_S -> bisector (1+UX, -UY)
        waist:    ends at directions (-UX, UY) and (0, -1) from C_W -> bisector (-UX, UY-1)
        hip:      ends at directions (0, 1) and (1, 0) from C_H   -> bisector (1, 1)

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    For the six ARCS this is the DECLARED order of their points only; the LIVE :S/:E tags follow
    Fusion's counter-clockwise rule (see item 3 above and p02_03).
    """
    HW = '(widthIn/2 - boundingboxoffset)'
    HH = '(heightIn/2 - boundingboxoffset)'
    # Fusion's own expression evaluator does NOT support min()/max() at all (CONFIRMED live,
    # fusion_execute: `design.unitsManager.evaluateExpression('min(1.0, 2.0)', 'cm')` itself raises
    # "The expression parameter is not a valid expression" -- Template 7's own copy of this phase
    # assumed otherwise and was never actually live-verified, per its own LIVE_CHECK.md unchecked
    # item). `abs()` IS supported, so `min(a,b) = (a+b-|a-b|)/2` substitutes exactly -- verified
    # against 10 random (a,b) pairs via the real evaluateExpression call before trusting it here.
    A_A, A_B = f'0.62*{HW}', f'0.84*{HH}'
    A = f'((({A_A} + {A_B}) - abs({A_A} - {A_B})) / 2)'

    R = f'(0.22*{HW})'
    S = f'(0.55*{HW})'
    RW = f'(0.33*{HW})'
    D_TOP = f'({A} - 0.45*{HW})'
    # max(0, x) = (x + |x|)/2 -- same min/max-unsupported substitution as A above.
    _DY_RADICAND = f'({D_TOP}*(2*{S} - {D_TOP}))'
    DY_TOP = f'sqrt((({_DY_RADICAND} + abs({_DY_RADICAND})) / 2))'
    UX_TOP = f'(({S} - {D_TOP})/{S})'
    UY_TOP = f'({DY_TOP}/{S})'

    E_X, E_Y = A, f'({HH} - {A})'
    SH_X, SH_Y = A, f'({DY_TOP} - {A}/2)'                          # shoulder_horn
    SW_X = f'({A} - {R}*(1 - {UX_TOP}))'                           # shoulder_waist_jct
    SW_Y = f'({SH_Y} - {R}*{UY_TOP})'
    WH_X = f'({HW} - {R})'                                         # waist_hip_jct
    WH_Y = f'(-{A}/2 - {RW})'
    HH_X, HH_Y = HW, f'(-{A}/2 - {S})'                             # hip_horn

    # The three circle centres and each arc's EXACT midpoint (see the docstring's derivation).
    CS_X, CS_Y = f'({A} - {R})', SH_Y
    CW_X, CW_Y = f'({HW} - {S} + {RW})', f'(-{A}/2)'
    CH_X, CH_Y = WH_X, HH_Y
    N_S = f'sqrt((1 + {UX_TOP})*(1 + {UX_TOP}) + {UY_TOP}*{UY_TOP})'
    shoulder_via_x = f'({CS_X} + {R}*(1 + {UX_TOP})/{N_S})'
    shoulder_via_y = f'({CS_Y} - {R}*{UY_TOP}/{N_S})'
    N_W = f'sqrt({UX_TOP}*{UX_TOP} + ({UY_TOP} - 1)*({UY_TOP} - 1))'
    waist_via_x = f'({CW_X} - {RW}*{UX_TOP}/{N_W})'
    waist_via_y = f'({CW_Y} + {RW}*({UY_TOP} - 1)/{N_W})'
    hip_via_x = f'({CH_X} + {R}/sqrt(2))'
    hip_via_y = f'({CH_Y} + {R}/sqrt(2))'

    seq = [
        # Roof (right): peak -> eave tip E_R. Identical to Template 7's own roof_R (reused verbatim).
        {'ID': 'roof_R', 'Type': 'Line', 'Points': [['0', HH], [E_X, E_Y]], 'StartID': 'roof_R:S', 'EndID': 'roof_R:E'},

        # Straight run from the eave down to the shoulder (a plain vertical line at x=A). The eave
        # joint itself is a MITER (matches T7's own roof->neck miter joint).
        {'ID': 'eave_straight_R', 'Type': 'Line', 'Points': [[E_X, E_Y], [SH_X, SH_Y]], 'StartID': 'eave_straight_R:S', 'EndID': 'eave_straight_R:E'},

        # Shoulder (convex), waist (concave), hip (convex) - the tangent chain, each seeded exactly
        # (start, TRUE arc midpoint, end). No seed Radius, no nudges (docstring, items 1-2).
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [
            [SH_X, SH_Y], [shoulder_via_x, shoulder_via_y], [SW_X, SW_Y]], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},

        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [
            [SW_X, SW_Y], [waist_via_x, waist_via_y], [WH_X, WH_Y]], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},

        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [
            [WH_X, WH_Y], [hip_via_x, hip_via_y], [HH_X, HH_Y]], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},

        # Straight run from the hip (already at the board's own full width) down to the base corner.
        {'ID': 'side_straight_R', 'Type': 'Line', 'Points': [[HH_X, HH_Y], [HW, f'-({HH})']], 'StartID': 'side_straight_R:S', 'EndID': 'side_straight_R:E'},

        # Base (bottom_edge): base_R -> base_L, anchored to the real offset-BB corners.
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[HW, f'-({HH})'], [f'-{HW}', f'-({HH})']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # Left side (mirror of the right - the SAME expressions, x negated).
        {'ID': 'side_straight_L', 'Type': 'Line', 'Points': [[f'-{HW}', f'-({HH})'], [f'-({HH_X})', HH_Y]], 'StartID': 'side_straight_L:S', 'EndID': 'side_straight_L:E'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({HH_X})', HH_Y], [f'-({hip_via_x})', hip_via_y], [f'-({WH_X})', WH_Y]], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},

        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({WH_X})', WH_Y], [f'-({waist_via_x})', waist_via_y], [f'-({SW_X})', SW_Y]], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},

        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({SW_X})', SW_Y], [f'-({shoulder_via_x})', shoulder_via_y], [f'-({SH_X})', SH_Y]], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},

        # Straight run from the shoulder back up to the eave (the miter joint).
        {'ID': 'eave_straight_L', 'Type': 'Line', 'Points': [[f'-({SH_X})', SH_Y], [f'-({E_X})', E_Y]], 'StartID': 'eave_straight_L:S', 'EndID': 'eave_straight_L:E'},

        # Roof (left): eave tip E_L -> peak, closed by the explicit peak weld in p02_03_welds.py.
        {'ID': 'roof_L', 'Type': 'Line', 'Points': [[f'-({E_X})', E_Y], ['0', HH]], 'StartID': 'roof_L:S', 'EndID': 'roof_L:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

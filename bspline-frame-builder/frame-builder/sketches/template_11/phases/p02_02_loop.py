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

    LIVE FUSION FINDING HISTORY (this turn, WORK-LOG-lane-b.md Turn 220 -- STILL UNRESOLVED, handed off
    to the advisor to continue in a separate worktree; kept here in full for whoever picks this up next).
    The shoulder/waist/hip tangent chain was UNDER-CONSTRAINED as first written.

    Attempt 1 (seed Arc3Points with an arbitrary generous `1.5*HW` seed Radius -> weld -> Tangent ->
    delete seed Radius): every arc on both sides came back at the literal seed radius unchanged -- the
    Radius dimension was still PINNING each arc's size when Tangent was applied, so Tangent could only
    reposition/reorient the (wrong-sized) arc, never resize it.

    Attempt 2 (this file's current state): (a) reordered so Radius deletion
    (p02_04_radius_removal.py) runs BEFORE Tangent (p02_05_tangency.py), so each arc's curvature is
    genuinely free when solved; (b) seeded the Radius dimension with the REAL computed `R`/`RW`
    formulas below instead of the arbitrary `1.5*HW` placeholder, since the reorder alone still left the
    solver too far from the true (much smaller) radius to converge from a poor starting guess; (c) added
    `p02_06_fix_joints.py` (fusion360-quirks skill's own "Fix is not transitive" finding), directly
    `Fix`-ing (`isFixed = True`) the 2 internal joint points per side as a belt-and-suspenders lock.
    RESULT, live-verified at 9x12/bbo=0.25/T=0.75: PARTIAL, NOT CORRECT. All 5 miters now report OK
    (vs. 3-4 misses before), but the 6 arc radii came back MIXED -- 2 landed EXACTLY on the expected
    value (shoulder_R=0.935in matching `R` exactly, hip_L=0.935in matching `R` exactly), the other 4
    did not (hip_R=0.9211in, close but not exact; waist_R=0.5345in, waist_L=2.9082in, shoulder_L=0.3169in
    -- all wrong, expected R=0.935in / RW=1.4025in for all of them). A sketch-2-only screenshot
    (`t11_fusion_shot5.png` in that turn's own scratchpad, not committed) shows a visibly ASYMMETRIC
    shape: the right side reads as a recognizable (if imperfect) pinch, the left side does not -- two
    near-straight segments with small nubs, no smooth arcs. The solver is reaching a locally-stable but
    WRONG configuration for several arcs even from a seed much closer to the true answer; not yet
    root-caused further (possibilities not yet tested: constraint APPLICATION ORDER within p02_05's own
    8 Tangent calls interacting badly across the chain; the via-point seed hints not actually
    establishing the intended convex/concave bulge direction for every arc; an actual T1-style
    skeleton-pin layer with a COMPUTED centre position, which pins shape directly rather than hoping
    Tangent+Fix converges to it). Every point POSITION in this file (the seed geometry) remains
    independently verified correct regardless (fb_engine/test_t11_fusion_expressions.py, cross-checked
    live against Fusion's own evaluateExpression) -- it is specifically the ARC RADIUS/SHAPE that is
    still unresolved.

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
    fb_engine/seed_geometry.py); no dimension and no new parameter.

    CLOSED-FORM DERIVATION (verified numerically against fb_engine.t11_geometry.t11_outline's own
    independently-computed board-coordinate values before being trusted here -- see
    tests/test_t11_fusion_expressions.py):
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
        UX_TOP = (S - D_TOP)/S ; UY_TOP = DY_TOP/S
      The hip side has NO inset (d = S exactly), which collapses its own sqrt() term algebraically to
      dy=S, ux=0, uy=1 -- verified against t11_geometry's own printed hc['ux_bottom']==0.0,
      hc['uy_bottom']==1.0 exactly, so the hip side needs no sqrt() at all, only plain arithmetic.

    Each Arc3Point's own middle ("via") point is only a solver-convergence HINT establishing the
    correct bulge direction (convex shoulder/hip bulge AWAY from the centreline; concave waist bulges
    TOWARD it) - the exact radius is resolved downstream by the Tangent constraints in
    p02_04_tangency.py against the fixed endpoints, same division of labour as Template 7's own neck/
    body arcs (this file's own precedent). A temporary seed Radius dimension per arc gives the solver a
    starting curvature; p02_05_radius_removal.py deletes all 6 once tangency has taken over.

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction

    Nudge convention (matches Template 7's own copy of this phase exactly): the roof->eave-straight
    joint (a MITER corner, resolved in sketch 3, not tangent) uses the IDENTICAL expression on both
    sides, unnudged -- same as T7's own roof->neck miter joint. The 3 TANGENT-chain internal joints
    (shoulder->waist, waist->hip, hip->side-straight) each nudge the NEXT piece's own start by -0.001
    in Y, same as T7's own neck->body and body->side tangent joints, so the explicit Coincident weld
    (p02_03) has two distinct points to merge rather than one Fusion may auto-coincide on its own.
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

    shoulder_via_x = f'(({SH_X} + {SW_X})/2 + 0.15*({SH_X} - {SW_X}))'
    shoulder_via_y = f'(({SH_Y} + {SW_Y})/2)'
    waist_via_x = f'(({SW_X} + {WH_X})/2 - 0.15*({WH_X} - {SW_X}))'
    waist_via_y = f'(({SW_Y} + {WH_Y})/2)'
    hip_via_x = f'(({WH_X} + {HH_X})/2 + 0.15*({HH_X} - {WH_X}))'
    hip_via_y = f'(({WH_Y} + {HH_Y})/2)'

    seq = [
        # Roof (right): peak -> eave tip E_R. Identical to Template 7's own roof_R (reused verbatim).
        {'ID': 'roof_R', 'Type': 'Line', 'Points': [['0', HH], [E_X, E_Y]], 'StartID': 'roof_R:S', 'EndID': 'roof_R:E'},

        # Straight run from the eave down to the shoulder (a plain vertical line at x=A). The eave
        # joint itself is a MITER (unnudged, matches T7's own roof->neck miter joint).
        {'ID': 'eave_straight_R', 'Type': 'Line', 'Points': [[E_X, E_Y], [SH_X, SH_Y]], 'StartID': 'eave_straight_R:S', 'EndID': 'eave_straight_R:E'},

        # Shoulder (convex), waist (concave), hip (convex) - tangent chain, each via-hint bulging the
        # correct direction (shoulder/hip AWAY from centreline, waist TOWARD it).
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [
            [SH_X, SH_Y], [shoulder_via_x, shoulder_via_y], [SW_X, SW_Y]], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': R, 'Name': 'seed_rad_shoulder_R'},

        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [
            [SW_X, f'{SW_Y} - 0.001'], [waist_via_x, waist_via_y], [WH_X, WH_Y]], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R', 'Expression': RW, 'Name': 'seed_rad_waist_R'},

        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [
            [WH_X, f'{WH_Y} - 0.001'], [hip_via_x, hip_via_y], [HH_X, HH_Y]], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R', 'Expression': R, 'Name': 'seed_rad_hip_R'},

        # Straight run from the hip (already at the board's own full width) down to the base corner.
        {'ID': 'side_straight_R', 'Type': 'Line', 'Points': [[HH_X, f'{HH_Y} - 0.001'], [HW, f'-({HH})']], 'StartID': 'side_straight_R:S', 'EndID': 'side_straight_R:E'},

        # Base (bottom_edge): base_R -> base_L, anchored to the real offset-BB corners.
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [[f'{HW} - 0.001', f'-({HH})'], [f'-{HW} + 0.001', f'-({HH})']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # Left side (mirror of the right - the SAME expressions, x negated).
        {'ID': 'side_straight_L', 'Type': 'Line', 'Points': [[f'-{HW} + 0.001', f'-({HH})'], [f'-({HH_X})', f'{HH_Y} - 0.002']], 'StartID': 'side_straight_L:S', 'EndID': 'side_straight_L:E'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({HH_X})', HH_Y], [f'-({hip_via_x})', hip_via_y], [f'-({WH_X})', f'{WH_Y} - 0.002']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': R, 'Name': 'seed_rad_hip_L'},

        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({WH_X})', WH_Y], [f'-({waist_via_x})', waist_via_y], [f'-({SW_X})', f'{SW_Y} - 0.002']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': RW, 'Name': 'seed_rad_waist_L'},

        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [
            [f'-({SW_X})', SW_Y], [f'-({shoulder_via_x})', shoulder_via_y], [f'-({SH_X})', SH_Y]], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': R, 'Name': 'seed_rad_shoulder_L'},

        # Straight run from the shoulder back up to the eave (the miter joint, unnudged).
        {'ID': 'eave_straight_L', 'Type': 'Line', 'Points': [[f'-({SH_X})', SH_Y], [f'-({E_X})', E_Y]], 'StartID': 'eave_straight_L:S', 'EndID': 'eave_straight_L:E'},

        # Roof (left): eave tip E_L -> peak (0.001 short of the shared peak, per T6/T7's own convention
        # - no auto-coincidence before the explicit weld in p02_03_welds.py).
        {'ID': 'roof_L', 'Type': 'Line', 'Points': [[f'-({E_X})', f'{E_Y} + 0.001'], ['0.001', f'{HH} - 0.001']], 'StartID': 'roof_L:S', 'EndID': 'roof_L:E'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_02_loop',
        'BuildSequence': seq,
    }

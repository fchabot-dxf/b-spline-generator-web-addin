def get_block(ui_data=None):
    """
    Silhouette Loop: 12-segment clockwise frame outline (Template 10 - Arched Hourglass).

    Template 1's own 12 pieces and topology, except the TOP: the one flat top_edge becomes ONE ARC spanning the
    full width (chord = the top horns' own x, same span Template 1's flat top already had), its apex touching
    the safe zone's own top line, its own two ends pulled DOWN into the board -- eating into the top horns' own
    length, never adding height above them (the advisor's own correction, confirmed against Fred's sketch and
    the 7x9 preview he approved: "looks perfect"). Unlike Template 5's dip (stub, shoulder arc, dip arc, shoulder
    arc, stub -- 5 pieces, both ends staying square ON the real board corners), this is the SIMPLEST possible top:
    one piece, no stub, because the corner itself moves -- there is no longer a square 90 deg corner at the
    board's own top-left/top-right at all, only wherever the horn meets the arch, at a TRUE, VARYING bisector
    angle (not 45 deg, Fred's own explicit ask).

    The arch's own two ends are NOT anchored to the projected board corners (unlike every other hourglass-family
    template's top_edge). H23 item 15 (3rd fresh-seat attempt): a `Tangent(top_edge, proj_off_BB_top)` +
    `Symmetry` pair only pins the arc's RADIUS magnitude for a given chord height -- it does NOT pin which
    BRANCH (short way up vs. the 180+ deg long way around) the solver lands on. Two things were tried and
    MEASURED not to fix it: (a) a literal apex point made Coincident to `top_edge` itself -- turns out
    Fusion's point-on-curve Coincident only constrains the point to the arc's SUPPORTING CIRCLE, not to its
    trimmed sweep, so it does nothing to disambiguate which of the two arcs on that circle is "the arc" (a
    live debug-log trace showed the live sweep angle barely moved, 269.7 -> 267.0 deg, with the apex
    constraint confirmed applied); (b) pinning the shoulder/hip arc centers earlier in the phase order (to
    rule out cross-coupling) -- moving them before `p02_05_horns` made it WORSE (333 deg) and threw a fresh
    `VCS_SKETCH_OVER_CONSTRAINTS` on `arc_hip_R`/`horn_BR`; reverted (`p02_10_welds.py` is back to its
    committed, unmodified state -- the shoulder/hip "ears" bug is confirmed independent of the arch and still
    open, see LIVE-RESULTS-ranchy.md's own "Item 15 (3rd attempt)" section).

    Replaced with a CLOSED-FORM, fully pre-computed circle instead of an iterative solve: given a fixed chord
    half-width `hw` and chord height `cy` (the SAME fractions the old seed already used) and the safe zone's
    own top line height `Ly`, the unique circle through `(+-hw, cy)` that is tangent to `y = Ly` from below has
    `centre_y = (hw^2 + cy^2 - Ly^2) / (2*(cy - Ly))` (derived from `hw^2 + (cy-centre_y)^2 = radius^2 =
    (Ly-centre_y)^2`, i.e. "distance to the chord end" = "distance to the tangent point", both equal radius).
    `top_edge` is SEEDED at exactly this circle's own S/apex/E, so `addByThreePoints` creates the correct short
    arc on the first try. Two more things were then tried and MEASURED not to be enough on their own: (c) an
    anchor-point-plus-Coincident layer (bare construction points at the exact S/C/E coordinates, Coincident to
    `top_edge`) -- a Coincident is NOT one-directional, so an unFixed anchor is just as movable as the arc
    point it's tied to (confirmed live: the anchors held through `p02_03`'s own audit, then both the arc's
    shape AND the "pinned" anchors had visibly moved together by `p02_05_horns`); (d) Fixing the anchors AND
    Coincident-ing S/E to them held S/E rigid through every later phase (confirmed), but adding a THIRD
    Coincident pinning `top_edge:C` to a matching fixed centre anchor threw `VCS_SKETCH_SOLVING_FAILED` --
    and even with that third pin merely failing (not applied), the circle's radius/bulge still drifted during
    the SAME simultaneous solve that reconciles the rest of the sketch (horn verticals, corner welds, etc. all
    solve together while compute is deferred), landing on the reflex branch again. The fix that actually holds:
    skip the anchor layer and `Fix` (zero remaining DOF) `top_edge`'s own `:S`/`:E` points directly, right after
    creation -- nothing downstream applies Tangent/Radius/Symmetry to `top_edge` again, so its one remaining DOF
    (the bulge) is never touched by anything and stays exactly as seeded. `horn_TR`/`horn_TL` then derive their
    OWN position from these fixed points via the Coincident below -- the same pattern Template 1 uses for its
    own board-corner anchor. `archRise` is still not wired into this build (same as before this item) -- the
    apex always sits exactly on the top line.

    The two top horns (horn_TR/horn_TL) keep Template 1's own BOTTOM end (welded to their own shoulder arc,
    p02_05/p02_08, untouched) but their TOP end is now coincident with the arch's own chord end instead of a
    projected board corner -- its own x comes for free from the UNCHANGED shoulder-tangent chain (horn_TR stays
    Vertical, and its own bottom end's x is already fixed by that chain), so no new anchor is needed for it either.

    Base and the sides are Template 1's own, seeds included; see Template 1's copy of this phase for that
    rationale.

    Seeds (T10 top): the 7x9 solve of the app's provisional Template 10 shape (archRise = 0.35 hw = 1.1375 in,
    giving a chord at 3.1125 in and a radius of ~5.21 in -- frame-defs shapeModel), as widthIn / heightIn
    expressions, so the seeded top is already close to the apex and closed at the seed board.

    Loop direction: clockwise.
      Right side flows top -> bottom (shoulder -> waist -> hip).
      Left  side flows bottom -> top (hip -> waist -> shoulder).

    StartID / EndID convention preserved for downstream phases:
      :S = start of segment in loop direction
      :E = end of segment in loop direction
    """
    # Closed-form arch circle (see docstring): hw/cy are the same fractions the original seed used; Ly is the
    # safe zone's own top line height (same fraction `proj_off_BB_top` resolves to). The seed below already
    # implies the unique tangent-from-below centre for a circle through (+-hw, cy) touching y=Ly; `Fix` just
    # locks that in rather than re-deriving it separately.
    HW = 'widthIn * 0.464286'
    CY = 'heightIn * 0.345833'
    LY = 'heightIn * 0.472222'

    seq = [
        # 1. Rails. Top (T10): ONE arc, seeded at the EXACT closed-form circle (not just a nearby guess) so
        # addByThreePoints creates the correct short arc on the first try. Bottom: Template 1's own flat base,
        # unchanged.
        {'ID': 'top_edge', 'Type': 'Arc3Point', 'Points': [
            [f'-({HW})', CY],
            ['0.001', LY],
            [HW, CY],
        ], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns. TR/TL seeded at the chord height (not the board corner) at their own TOP end; BR/BL
        # unchanged (loose-seeded 0.001 off-target at the BB-corner end, Template 1's own convention).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', CY], ['widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', CY], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        {'Type': 'Vertical', 'Targets': ['horn_TR', 'horn_BR', 'horn_TL', 'horn_BL']},

        # 3. Corner topology. BR/BL unchanged (anchored to the real board corners). TR/TL: NOT anchored to the
        # board corner -- tied to the arch's own chord end instead, which is itself pinned below to the
        # closed-form anchor points.
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},
        # Fix top_edge's own S/E points directly at their exact closed-form seed (no intermediate anchor --
        # MEASURED that an anchor-plus-Coincident layer still let the solver flip the bulge while reconciling
        # the rest of the sketch in the same simultaneous solve, even with the anchor itself Fixed). horn_TR/TL
        # then derive their own position FROM these fixed points via the Coincident above, same pattern
        # Template 1 uses for its own board-corner anchor. Replaces the old Tangent(top_edge, proj_off_BB_top)
        # + Symmetry pair.
        #
        # Two weaker alternatives were also tried and MEASURED worse: Fix on the CENTRE alone (Symmetry doing
        # the rest) left the radius completely free, and the chain found a degenerate "more locally convenient"
        # solution instead (hw collapsed to ~0.26in instead of ~3.25in, dragging arc_shoulder_R into ITS OWN
        # reflex); adding a permanent closed-form Radius dimension on top of the centre Fix (pinning the whole
        # circle, not just its centre) made the ARCH itself reflex again (354 deg). Fixing S/E directly is the
        # only version that has reliably held top_edge correct (77.2 deg) across every later phase, every time
        # it was tried.
        {'Type': 'Fix', 'Targets': ['top_edge:S', 'top_edge:E']},

        # 4. Arc seeds. Points are [Start, Bulge, End] in arc-traversal
        # order - Bulge is the real arc midpoint (a point ON the arc),
        # NOT the center of curvature. Coordinates come from the inspector
        # output in S -> B -> E -> C order; the first three feed directly
        # into Fusion's addByThreePoints. The center (C) is implicit in
        # the geometry (the unique circle through S, B, E) and not stored
        # here. Right side X-mirrors the left; because B is on the arc
        # (not on the opposite side from where it bulges), simple X
        # negation produces an outward-bulging arc on both sides.
        {'ID': 'arc_shoulder_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.476432', 'heightIn * 0.15042'], ['widthIn * 0.452856', 'heightIn * 0.099912'], ['widthIn * 0.395939', 'heightIn * 0.078992']], 'StartID': 'arc_shoulder_R:S', 'EndID': 'arc_shoulder_R:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_R'},
        {'ID': 'arc_waist_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.395939', '-heightIn * 0.071429'], ['widthIn * 0.315446', '0'], ['widthIn * 0.395939', 'heightIn * 0.071429']], 'StartID': 'arc_waist_R:S', 'EndID': 'arc_waist_R:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_R'},
        {'ID': 'arc_hip_R', 'Type': 'Arc3Point', 'Points': [['widthIn * 0.395939', '-heightIn * 0.079718'], ['widthIn * 0.452856', '-heightIn * 0.100638'], ['widthIn * 0.476432', '-heightIn * 0.151146']], 'StartID': 'arc_hip_R:S', 'EndID': 'arc_hip_R:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_R', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_R'},

        {'ID': 'arc_hip_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.395939', '-heightIn * 0.079718'], ['-widthIn * 0.452856', '-heightIn * 0.100638'], ['-widthIn * 0.476432', '-heightIn * 0.151146']], 'StartID': 'arc_hip_L:S', 'EndID': 'arc_hip_L:E'},
        {'Type': 'Radius', 'Target': 'arc_hip_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_hip_L'},
        {'ID': 'arc_waist_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.395939', '-heightIn * 0.071429'], ['-widthIn * 0.315446', '0'], ['-widthIn * 0.395939', 'heightIn * 0.071429']], 'StartID': 'arc_waist_L:S', 'EndID': 'arc_waist_L:E'},
        {'Type': 'Radius', 'Target': 'arc_waist_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_waist_L'},
        {'ID': 'arc_shoulder_L', 'Type': 'Arc3Point', 'Points': [['-widthIn * 0.476432', 'heightIn * 0.15042'], ['-widthIn * 0.452856', 'heightIn * 0.099912'], ['-widthIn * 0.395939', 'heightIn * 0.078992']], 'StartID': 'arc_shoulder_L:S', 'EndID': 'arc_shoulder_L:E'},
        {'Type': 'Radius', 'Target': 'arc_shoulder_L', 'Expression': 'heightIn/14', 'Name': 'seed_rad_shoulder_L'},
    ]

    return {
        'Name': 'Silhouette',
        'PhaseID': 'p02_03_loop',
        'BuildSequence': seq,
    }

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
    template's top_edge). H23 item 15: a `Tangent(top_edge, proj_off_BB_top)` + `Symmetry` pair only pins the
    arc's RADIUS magnitude for a given chord height -- it does NOT pin which BRANCH (short way up vs. the
    180+ deg long way around) the solver lands on; neither does a literal apex point made Coincident to
    `top_edge` itself (Fusion's point-on-curve Coincident only constrains a point to the arc's SUPPORTING
    CIRCLE, not its trimmed sweep).

    Replaced with a CLOSED-FORM, fully pre-computed circle instead of an iterative solve: given the chord
    half-width `hw` (the EXACT safe-zone half-width, the SAME value the real board corner
    `proj_off_corner_BR/BL` resolve to -- H23 item 17's own finding, see HW's own comment below) and chord
    height `cy` and the safe zone's own top line height `Ly`, the unique circle through `(+-hw, cy)` tangent
    to `y = Ly` from below has `centre_y = (hw^2 + cy^2 - Ly^2) / (2*(cy - Ly))` (derived from
    `hw^2 + (cy-centre_y)^2 = radius^2 = (Ly-centre_y)^2`, i.e. "distance to the chord end" = "distance to the
    tangent point", both equal radius). `top_edge` is SEEDED at exactly this circle's own S/apex/E, so
    `addByThreePoints` creates the correct short arc on the first try.

    Keeping it that way through the REST of the build turned out to need two separate pieces, confirmed live,
    each load-bearing on its own:
      1. `top_edge:S`/`:E` are pinned to two Fixed construction `Point` anchors (this phase, below) -- NOT a
         direct `Fix` on `top_edge`'s own points. MEASURED: the anchor-plus-Coincident layer is what the
         shoulder/waist/hip chain needs present THROUGHOUT the rest of the build to resolve correctly itself
         (p02_04 through p02_11) -- removing it (a bare direct `Fix` instead) reliably fixes `top_edge` alone
         but sends `arc_shoulder_R/L` back to 357.9 deg, the "ears" bug item 15 first found and left open; it
         was never a separate bug from the arch's own, just a harder instance of the same one (3 mutually-
         tangent arcs instead of 1).

         H23 item 47 (item 45/46's own live finding: the Arch-rise handle built IDENTICAL volumes at both
         drag extremes): the anchors used to be their OWN literal `[-(HW), CY]`/`[HW, CY]` points -- a THIRD
         independent copy of the SAME closed-form formula (`top_edge`'s own seeded Points were the first,
         `p02_12_arch_rebuild.py`'s rebuild the second, item 46's own SeedFrom already unified THAT pair).
         Fixing the rebuild's own duplicate did nothing for the handle, because the anchors -- not the
         rebuild -- are what actually pin `top_edge`'s FINAL solved position: any seed sent for `top_edge`
         only ever set its INITIAL guess; the very next steps (`Fix` + `Coincident`, right below) snapped it
         straight back to the anchors' own always-literal position regardless. Now `SeedFrom` on a `Point`
         step (`fb_engine/geometry.py`'s own `_create_point`, generic, not T10-specific): each anchor reads
         `top_edge`'s own JUST-CREATED (not yet constrained) endpoint geometry directly, chosen by actual
         LEFT/RIGHT position -- never by Fusion's `:S`/`:E` label, which item 46 measured does NOT reliably
         correspond to which point was seeded as which (`addByThreePoints` assigns start/end by the arc's
         own geometric direction, not argument order). Since the anchor now sits exactly where `top_edge`
         already landed, the `Coincident` below is satisfied with zero solver movement -- `top_edge` stays
         wherever it was actually seeded, and the handle becomes genuinely live.
      2. That same anchor-plus-Coincident layer leaves `top_edge` ITSELF on the reflex branch (a bare
         `Coincident`, even to an exactly-Fixed anchor, does not stop an Arc3Point from reinterpreting its
         own trim between two now-correctly-placed endpoints -- same ambiguity as the point-on-curve finding
         above, just at the endpoint level). So `top_edge` is deliberately left reflex here and corrected
         LATER, once everything that needs this section's own Coincident link has already resolved against
         it -- see `p02_12_arch_rebuild.py`'s own docstring for that half and why it has to run last.

    `HW`/`CY`/`LY` are written so that `seed_basis.seed_sketch`'s own automatic widthIn/heightIn -> seed-board
    rewrite (`widthIn -> (widthIn - 2*(boundingboxoffset - 0.25in))`, Line/Arc3Point/Radius Points/Expression
    fields only) turns them into the EXACT safe-zone formula for ANY board/offset, not just the one (width
    7in, boundingboxoffset 0.25in) the old literal fractions (`widthIn * 0.464286` etc.) happened to match --
    see each constant's own inline comment for the algebra. `archRise`'s own 0.35 (`archRiseOfHw`,
    `FRAME_PROVISIONAL_SHAPE`) is baked into `CY` this way rather than wired as a template parameter -- still
    not independently adjustable.

    The two top horns (horn_TR/horn_TL) keep Template 1's own BOTTOM end (welded to their own shoulder arc,
    p02_05/p02_08, untouched) but their TOP end is now coincident with the arch's own chord end instead of a
    projected board corner -- their own x comes FROM the arch's now-exact anchor (horn_TR stays Vertical, so
    pinning its top end also pins its bottom end's own x, the same value the whole shoulder-tangent chain
    below now resolves against).

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
    # Closed-form arch circle (see docstring). HW/CY/LY are written so that `seed_basis.seed_sketch`'s own
    # automatic widthIn/heightIn -> seed-board rewrite (Line/Arc3Point/Radius Points/Expression fields only)
    # turns them into the EXACT safe-zone formula -- see the docstring's own algebra. Do not "simplify" these
    # by substituting `boundingboxoffset` back in directly: that would make `seed_basis`'s rewrite apply TWICE.
    HW = 'widthIn/2 - 0.25 in'                           # -> widthIn/2 - boundingboxoffset, after rewrite
    CY = 'heightIn/2 - 0.175 * widthIn - 0.1625 in'       # -> the arch's own cy (archRiseOfHw = 0.35), after rewrite
    LY = 'heightIn/2 - 0.25 in'                           # -> heightIn/2 - boundingboxoffset (the top line), after rewrite

    seq = [
        # 1. Rails. Top (T10): ONE arc, seeded at the EXACT closed-form circle (not just a nearby guess) so
        # addByThreePoints creates the correct short arc on the first try. Bottom: Template 1's own flat base,
        # unchanged.
        {'ID': 'top_edge', 'Type': 'Arc3Point', 'Points': [
            [f'-({HW})', CY],
            ['0.001', LY],
            [HW, CY],
        ], 'StartID': 'top_edge:S', 'EndID': 'top_edge:E'},
        {'ID': 'top_S_anchor', 'Type': 'Point', 'Points': [{'SeedFrom': {'id': 'top_edge', 'side': 'left'}}], 'IsConstruction': True},
        {'ID': 'top_E_anchor', 'Type': 'Point', 'Points': [{'SeedFrom': {'id': 'top_edge', 'side': 'right'}}], 'IsConstruction': True},
        {'Type': 'Fix', 'Targets': ['top_S_anchor', 'top_E_anchor']},
        {'Type': 'Coincident', 'Targets': ['top_edge:S', 'top_S_anchor'], 'Name': 'top_edge_pin_S'},
        {'Type': 'Coincident', 'Targets': ['top_edge:E', 'top_E_anchor'], 'Name': 'top_edge_pin_E'},

        {'ID': 'bottom_edge', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2 + 0.001', '-heightIn/2 + 0.001']], 'StartID': 'bottom_edge:S', 'EndID': 'bottom_edge:E'},

        # 2. Vertical horns. TR/TL seeded at the chord height (not the board corner) at their own TOP end; BR/BL
        # unchanged (loose-seeded 0.001 off-target at the BB-corner end, Template 1's own convention).
        {'ID': 'horn_TR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', CY], ['widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TR:S', 'EndID': 'horn_TR:E'},
        {'ID': 'horn_BR', 'Type': 'Line', 'Points': [['widthIn/2 - 0.001', '-heightIn/2 + 0.001'], ['widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BR:S', 'EndID': 'horn_BR:E'},
        {'ID': 'horn_TL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', CY], ['-widthIn/2', 'heightIn * 0.183']], 'StartID': 'horn_TL:S', 'EndID': 'horn_TL:E'},
        {'ID': 'horn_BL', 'Type': 'Line', 'Points': [['-widthIn/2 + 0.001', '-heightIn/2 + 0.001'], ['-widthIn/2', '-heightIn * 0.183']], 'StartID': 'horn_BL:S', 'EndID': 'horn_BL:E'},

        # T84 item 7 (H23 item 59/60's own gate, resolved): horn_TR/TL dropped from Vertical -- a
        # slanted (tapered) horn has no such constraint (Template 12's own identical pattern,
        # p02_03_loop.py's own docstring: "drops horn_TR/horn_TL from the Vertical targets"). At
        # taperAngle=0 this is a no-op (both endpoints are still individually pinned -- :S to
        # top_edge's own end, :E to the shoulder arc's own tangent point via horn_tip_weld,
        # p02_05_horns.py -- so the line is still fully determined, 0 remaining DOF, and lands
        # exactly vertical anyway). horn_BR/BL (untouched by taper, item 59's own construction fix
        # leaves the bottom corner alone) stay Vertical, unchanged.
        {'Type': 'Vertical', 'Targets': ['horn_BR', 'horn_BL']},

        # 3. Corner topology. BR/BL unchanged (anchored to the real board corners). TR/TL: NOT anchored to the
        # board corner directly -- tied to the arch's own chord end instead, already pinned exactly in section
        # 1b above (before this phase's own Vertical/corner-topology constraints existed to cross-couple with
        # it; see that section's own comment for why the ordering matters).
        {'Type': 'Coincident', 'Targets': ['bottom_edge:S', 'proj_off_corner_BR']},
        {'Type': 'Coincident', 'Targets': ['bottom_edge:E', 'proj_off_corner_BL']},
        {'Type': 'Coincident', 'Targets': ['horn_BR:S', 'bottom_edge:S']},
        {'Type': 'Coincident', 'Targets': ['horn_BL:S', 'bottom_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TR:S', 'top_edge:E']},
        {'Type': 'Coincident', 'Targets': ['horn_TL:S', 'top_edge:S']},

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

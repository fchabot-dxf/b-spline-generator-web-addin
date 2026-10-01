"""
t7_roof_eave.py — the 90-degree roof + eave corner geometry, factored out so it is reusable by any later
sibling template built on the same peak/roof/eave (the advisor's own note on T82 item 1: "keep your T7
roof code reusable... because T11 will build on it after T7 merges" -- T11 is the planned 3-arc
hourglass-side variant of this same roof). Pure, stdlib-only Python -- no adsk.* dependency, unit-testable
without Fusion (see tests/test_t7_roof_eave.py).

Coordinates are INCHES, board-local, origin BOTTOM-LEFT, y UP -- Fusion's own sketch convention (NOT the
app editor's convention, which is origin top-left, y DOWN; the JS side flips when it reads these same
proportions back, see editor-shape-lattice-generator.js's own tSevenConstruction).

Derivation (WORK-LOG-lane-b.md, Turn 197/201; the authoritative approved spec is amendment 189/190 in
.handoff/amendments.tsv, not NEXT-SESSION-lane-b.md, which is stale on this topic): peak on the top edge,
a 90-degree roof down to the EAVE tip, a 5-bar/5-miter frame (peak + 2 eaves + 2 base corners; the roof
itself is 2 bars, mitred at the peak). The peak miter is exactly vertical (verified below, not assumed);
the eave miter is the TRUE bisector of the roof line and the neck arc's own tangent direction at the eave
-- computed per board/handle values, never a fixed angle (a real bug in an earlier version of this build's
own scratch diagram pointed the eave miter OUTWARD by assuming a fixed-formula bisector instead of the
real line-arc intersection; fixed by connecting outer corner directly to the already-solved TRUE inner
corner -- see eave_inner_corner below, which does the same thing for the real Fusion build).
"""
import math


def roof_geometry(width_in, height_in):
    """The peak, the roof half-width/height `a`, and the right eave tip E (mirror for the left).

    `a = min(0.62*hw, 0.42*H)`: the 90-degree roof's own half-width AND height (rise=run for a 45/45 roof),
    capped so the roof never outgrows the board on a wide/short board (the "works at every size, landscape
    gets a graceful fallback, never excluded" ruling -- amendment 190). MEASURED to stay inside the board
    from the narrowest supported size (5.51x1.97) to the widest (24x4): see
    tests/test_t7_roof_eave.py::test_roof_stays_inside_board_every_size.
    """
    hw = width_in / 2.0
    cx = hw
    a = min(0.62 * hw, 0.42 * height_in)
    peak = (cx, height_in)
    E = (cx + a, height_in - a)
    return {"hw": hw, "cx": cx, "a": a, "peak": peak, "E": E}


def peak_inner_corner(frame_thickness):
    """The TRUE inner peak corner as a (Direction, Distance) pair, for fb_engine/inner_corners.py's own
    ResolveInnerCorners phase step (the SAME declarative mechanism every other template's square corners
    already use -- T7 does not need a new mechanism here, only non-(+-1,+-1) numbers).

    Both roof lines sit at +/-45deg from vertical, so by symmetry the true inner peak lies exactly on the
    centerline, straight down from the outer peak -- Direction = (0, -1). The distance is the standard
    miter-length formula for a 90-degree interior angle: frame_thickness / sin(45deg) = frame_thickness *
    sqrt(2) (NOT frame_thickness itself -- ResolveInnerCorners' existing default, correct only for an
    axis-aligned corner, would under-shoot here by a factor of sqrt(2) and miss the real SketchPoint
    outside its own 0.05cm tolerance). Verified directly against the real two-offset-line intersection, not
    assumed from the formula alone: see
    tests/test_t7_roof_eave.py::test_peak_direction_distance_matches_true_line_intersection.
    """
    return (0.0, -1.0), frame_thickness * math.sqrt(2)


def _line_circle_intersection_nearer(p0, direction, center, radius, reference_s):
    """The point on the line p0 + s*direction (direction a UNIT vector) that lies on the circle
    (center, radius), choosing whichever of the two roots has `s` closer to `reference_s` -- the OTHER
    root is the line's far-side crossing, not a real corner here. Returns (point, s)."""
    ux, uy = direction
    px, py = p0[0] - center[0], p0[1] - center[1]
    b = 2 * (px * ux + py * uy)
    c = px * px + py * py - radius * radius
    disc = max(0.0, b * b - 4 * c)
    sq = math.sqrt(disc)
    s = min([(-b + sq) / 2, (-b - sq) / 2], key=lambda sv: abs(sv - reference_s))
    return (p0[0] + s * ux, p0[1] + s * uy), s


def eave_inner_corner(width_in, height_in, frame_thickness, neck_center, neck_radius):
    """The TRUE inner eave corner (right side; mirror x for the left), as a (Direction, Distance) pair for
    ResolveInnerCorners -- computed by the EXACT line-circle intersection between the offset roof line and
    the offset neck arc, not a bisector-of-edge-directions formula (that formula points the WRONG way at a
    cusp-like corner such as this eave -- a real bug caught and fixed in this build's own scratch miter
    diagram, WORK-LOG-lane-b.md Turn 201: "miter_line() extrapolated from a bisector... points INTO
    material at a convex corner like the peak but AWAY from it at the eave's own cusp shape"). This
    function sidesteps that failure mode entirely by using the same two already-solved pieces of real
    geometry (the roof line's own inward offset, the neck arc's own inward offset) and intersecting them
    directly, exactly mirroring what Fusion's own sketch.offset() does to the real curves -- the Direction/
    Distance pair returned here is only ever used to find (not compute) the matching already-correct
    SketchPoint Fusion's offset produced.

    `neck_center`/`neck_radius` describe the OUTER neck arc (not yet offset) -- this function performs the
    neck arc's own inward offset (+frame_thickness; the neck arc is concave, its center sits on the
    material's EXTERIOR side, so offsetting inward GROWS the radius -- the same "arcs concentric at r+t"
    rule used throughout, see t7_geometry.py's own module docstring) before intersecting.
    """
    g = roof_geometry(width_in, height_in)
    peak, E = g["peak"], g["E"]
    interior_pt = (g["cx"], height_in * 0.5)
    dx, dy = E[0] - peak[0], E[1] - peak[1]
    line_len = math.hypot(dx, dy)
    n = (-dy / line_len, dx / line_len)
    mid = ((peak[0] + E[0]) / 2, (peak[1] + E[1]) / 2)
    to_interior = (interior_pt[0] - mid[0], interior_pt[1] - mid[1])
    if n[0] * to_interior[0] + n[1] * to_interior[1] < 0:
        n = (-n[0], -n[1])
    p0_offset = (peak[0] + n[0] * frame_thickness, peak[1] + n[1] * frame_thickness)
    u = (dx / line_len, dy / line_len)
    s_outer_E = line_len  # E's own distance from peak along the (unnormalized) line direction equals line_len since u is already unit
    r_in = neck_radius + frame_thickness
    e_in, _ = _line_circle_intersection_nearer(p0_offset, u, neck_center, r_in, s_outer_E)

    vec = (e_in[0] - E[0], e_in[1] - E[1])
    dist = math.hypot(*vec)
    direction = (vec[0] / dist, vec[1] / dist)
    return direction, dist, e_in

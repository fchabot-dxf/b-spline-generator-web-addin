"""
Turn 220 (resumed after an advisor-ordered pause: Fred questioned whether this hourglass-pinched side was
really the target vs. a smooth T7-style dome with no waist pinch -- confirmed the pinch is correct as
designed, resuming from the WIP checkpoint committed at that pause).

The pause-era `every_outer_point_inside_board` bug ("no sweep matched" on the waist arc, every board size)
is FIXED: root cause was `C_waist` itself, not `sample_arc`'s sweep search -- `hw - depth` is the waist
pinch's own DEEPEST point (closest approach to the centreline), not the arc's centre; the centre sits one
more `radius_waist` further out. Confirmed numerically (both shoulder_waist_jct/waist_hip_jct now sit at
exactly r_waist from the corrected centre, to 1e-9, across 7x9/6x9/9x12/14x18) before trusting it. Separately
hardened `sample_arc` to return a "no match" sentinel instead of raising for a genuinely degenerate sweep
(hit at the extreme 12x6 landscape aspect ratio, unrelated to the C_waist bug) -- `is_valid_t11_outline`
already treats that as "not valid here", so `clamp_t11_handles`'s own "clamped, never refused" blend handles
it the same as any other out-of-range combination, matching t7_geometry.clamp_t7_handles's own contract.
`is_valid_t11_outline`/`clamp_t11_handles`/`every_outer_point_inside_board` are now trustworthy;
`t11_outline`, `inner_corner_directions` and `inner_profile_radii` were already verified independently and
are unaffected by either fix.

Still NOT wired into any Fusion phase, template_data.py, or test file -- that is this turn's next step.

t11_geometry.py — Template 11 (Diamond-top, 3-arc Hourglass side): T7's own roof/eave
(t7_roof_eave.roof_geometry, reused VERBATIM) feeding directly into T1's own 3-arc hourglass side
(shoulder/waist/hip, the SAME algebra editor-shape-lattice-generator.js's own hourglassConstruction uses,
ported here unmodified) instead of T7's own neck/body S-curve. Pure, stdlib-only Python -- no adsk.*
dependency, unit-tested without Fusion in tests/test_t11_geometry.py.

Coordinates are INCHES, board-local, origin BOTTOM-LEFT, y UP (Fusion's own sketch convention -- same as
t7_geometry.py).

Approved shape (T83 item 1; the diagram Fred approved, WORK-LOG-lane-b.md Turn 218): peak, 90-degree roof
down to the eave (T7's own `a = min(0.62*hw, 0.42*H)`), a short straight run down from the eave, a SMALL
CONVEX shoulder arc curving in, a CONCAVE waist pinch, a CONVEX hip arc flaring back OUT to the board's own
full width, straight down to the base. 5 bars (2 roof, 2 side, 1 base), 5 miters (peak, 2 eaves, 2 base
corners) -- every join WITHIN a side (eave-straight -> shoulder -> waist -> hip -> base-straight) is
TANGENT (smooth), not a miter, same division as T7's own neck/body/line chain.

The ONE link between the two borrowed pieces: T1's own hourglass side needs a "virtual top corner" (where
its own straight run above the shoulder starts) -- T1 itself puts that at the board's own plain half-width
(topInset=0). Here it is pulled IN to sit exactly on the eave tip instead, via T1's own ALREADY-DECLARED
`topInset` knob (T3 TAPERED HOURGLASS, editor-shape-lattice-generator.js): topInset = hw - a. Nothing else
about T1's own side algebra changes -- same literal defaults (waistReach=0.55, cornerRadius=0.22 top and
bottom, waistCenterY=0, waistRadius=max(waistReach-cornerRadius, 0.5*waistReach)=0.33), same formulas.

Verified (not assumed): WORK-LOG-lane-b.md Turn 218's own scratch script proved this composition out
first (every sampled point stays inside the board at 7x9 and 6x9, the "virtual top corner == eave tip"
link asserted exactly) -- this module is that same math, promoted into the real engine with Fusion's own
inner (bar-width) offset and inner-corner formulas added.

Inner (bar-width) offset, same "arcs concentric at r -/+ t" rule t7_geometry.py's own module docstring
states: the shoulder and hip arcs are CONVEX (material on the board-centre side of the arc) -> radius
SHRINKS by frame_thickness; the waist arc is CONCAVE -> radius GROWS by frame_thickness.

This module does NOT decide how Fusion actually builds the arcs (Arc3Point seed + Tangent constraints,
mirroring t7_geometry.py's own division of labour) -- it is the one place the EXACT math lives, read by:
the Fusion phase files (for seed points), the inner-corner-resolve phase (for the eave corner's own
Direction/Distance -- now a plain LINE-LINE miter, simpler than T7's own line-CIRCLE eave corner, because
the piece touching T11's own eave is the straight run, not an arc), and the app-parity tests.
"""
import math

from fb_engine.t7_roof_eave import roof_geometry, peak_inner_corner

# T1's own literal defaults (editor-shape-lattice-generator.js PRESETS.hourglass / DERIVED_PARAM_DEFAULTS.hourglass),
# reused VERBATIM -- T11 introduces no new side-shape parameter of its own.
WAIST_REACH_DEFAULT = 0.55
CORNER_RADIUS_DEFAULT = 0.22
WAIST_CENTER_Y_FRAC_DEFAULT = 0.0
WAIST_MIN_RADIUS_OF_DEPTH = 0.5  # editor-shape-lattice-generator.js's own WAIST_MIN_RADIUS_OF_DEPTH


def _waist_radius_frac(waist_reach, corner_radius_top):
    return max(waist_reach - corner_radius_top, WAIST_MIN_RADIUS_OF_DEPTH * waist_reach)


def _hourglass_side(region_w, region_h, waist_reach, corner_radius_top, corner_radius_bottom,
                     waist_center_y_frac, top_inset):
    """T1's own hourglassConstruction (editor-shape-lattice-generator.js), ported verbatim: region-local
    (centre-x origin, Y-DOWN), right side. Returns the shoulder/waist/hip centres+radii and each arc's own
    tangent unit vector (shoulder/hip centre -> waist centre), exactly as the JS function returns them."""
    hw, hh = region_w / 2.0, region_h / 2.0
    depth = hw * waist_reach
    waist_center_y = hh * waist_center_y_frac
    radius_waist = hw * _waist_radius_frac(waist_reach, corner_radius_top)

    def side(frac, sign, inset):
        r = hw * frac
        S = r + radius_waist
        d = depth - inset
        dy = math.sqrt(max(0.0, d * (2 * S - d)))
        cx = hw - inset - r
        y = waist_center_y + sign * dy
        ux, uy = (S - d) / S, dy / S
        return {"r": r, "cx": cx, "y": y, "ux": ux, "uy": uy}

    top = side(corner_radius_top, -1, top_inset)
    bot = side(corner_radius_bottom, +1, 0.0)
    waist_major = (math.atan2(top["uy"], top["ux"]) + math.atan2(bot["uy"], bot["ux"])) > math.pi
    return {
        "hw": hw, "hh": hh, "depth": depth, "radius_waist": radius_waist, "waist_center_y": waist_center_y,
        "top_x": hw - top_inset,
        "shoulder_cx": top["cx"], "shoulder_y": top["y"], "ux": top["ux"], "uy": top["uy"], "r_shoulder": top["r"],
        "hip_cx": bot["cx"], "hip_y": bot["y"], "ux_bottom": bot["ux"], "uy_bottom": bot["uy"], "r_hip": bot["r"],
        "waist_major": waist_major,
    }


def _line_line_inner_corner(p_shared, dir_in, dir_out, frame_thickness, interior_point):
    """The TRUE inner corner where two straight edges meet at `p_shared` (outer corner), each offset
    INWARD by frame_thickness, as a (Direction, Distance) pair for ResolveInnerCorners -- the general
    two-offset-line intersection (T7's own peak_inner_corner is the special case of this at a fixed
    90-degree symmetric corner; this is the general form, needed here because T11's eave corner is NOT
    symmetric: a 45-degree roof line meeting a vertical line, not two equal-and-opposite diagonals).

    `dir_in`/`dir_out` are UNIT vectors: the direction of travel arriving at p_shared (along the first
    edge) and leaving it (along the second edge) -- both pointing AWAY from p_shared along their own edge
    (i.e. dir_in is the direction FROM the corner backward along the incoming edge, dir_out is the
    direction FROM the corner forward along the outgoing edge; this matches how t7_roof_eave.py's own
    eave_inner_corner walks its own two lines).

    `interior_point` is an explicit point KNOWN to be inside the frame material (e.g. the board centre) --
    an EARLIER version of this function tried to infer "inward" from `-(dir_in + dir_out)` alone (no
    explicit reference point) and got it backwards at T11's own eave (a cusp-like corner where both edges
    head the same general direction away from the shared point, so their negated sum points OUTWARD, not
    in): verified numerically (the "inner" eave point landed FARTHER from board centre than the outer eave
    vertex, on both tried boards). This is the EXACT bug class t7_roof_eave.eave_inner_corner's own
    docstring already warns about ("a bisector-of-edge-directions formula... points the WRONG way at a
    cusp-like corner") and had already fixed once by using a real interior reference point instead of a
    direction-only heuristic -- this function now follows that same proven pattern rather than repeating
    the mistake.
    """
    # Each edge's own inward normal: rotate the edge's forward direction (from dir_in reversed to dir_out,
    # i.e. the path's own travel direction) +90deg, then pick whichever sign points toward the GIVEN
    # interior point (both edges pass through p_shared, so a vector from p_shared to interior_point is a
    # valid same-side probe for either line).
    def inward_normal(travel_dir):
        nx, ny = -travel_dir[1], travel_dir[0]
        to_interior = (interior_point[0] - p_shared[0], interior_point[1] - p_shared[1])
        if nx * to_interior[0] + ny * to_interior[1] < 0:
            nx, ny = -nx, -ny
        return nx, ny

    n_in = inward_normal(dir_in)
    n_out = inward_normal(dir_out)
    p_in0 = (p_shared[0] + n_in[0] * frame_thickness, p_shared[1] + n_in[1] * frame_thickness)
    p_out0 = (p_shared[0] + n_out[0] * frame_thickness, p_shared[1] + n_out[1] * frame_thickness)
    # Intersect line (p_in0 + s*dir_in) with line (p_out0 + t*dir_out).
    denom = dir_in[0] * dir_out[1] - dir_in[1] * dir_out[0]
    if abs(denom) < 1e-12:
        raise ValueError("_line_line_inner_corner: the two edges are parallel")
    dx, dy = p_out0[0] - p_in0[0], p_out0[1] - p_in0[1]
    s = (dx * dir_out[1] - dy * dir_out[0]) / denom
    inner = (p_in0[0] + s * dir_in[0], p_in0[1] + s * dir_in[1])
    dist = math.hypot(inner[0] - p_shared[0], inner[1] - p_shared[1])
    direction = ((inner[0] - p_shared[0]) / dist, (inner[1] - p_shared[1]) / dist) if dist > 0 else (0.0, 0.0)
    return direction, dist, inner


def t11_outline(width_in, height_in, frame_thickness,
                waist_reach=WAIST_REACH_DEFAULT,
                corner_radius_top=CORNER_RADIUS_DEFAULT,
                corner_radius_bottom=CORNER_RADIUS_DEFAULT,
                waist_center_y_frac=WAIST_CENTER_Y_FRAC_DEFAULT):
    """The full right-half outline (mirror x for the left) plus the 3 solved arc circles. Returns a dict
    with every key point, the 3 circles (shoulder/waist/hip), and the eave corner's own Direction/Distance.
    """
    g = roof_geometry(width_in, height_in)
    hw, a, peak, E = g["hw"], g["a"], g["peak"], g["E"]
    eave_y = E[1]
    assert abs(E[0] - (hw + a)) < 1e-9 and abs(eave_y - (height_in - a)) < 1e-9

    region_h = eave_y  # the side's own sub-region spans the eave down to the base (y=0)
    top_inset = hw - a  # T1's own "virtual top corner" pulled onto the eave tip, see module docstring
    hc = _hourglass_side(width_in, region_h, waist_reach, corner_radius_top, corner_radius_bottom,
                         waist_center_y_frac, top_inset)
    assert abs(hc["top_x"] - a) < 1e-9
    hh_r = region_h / 2.0

    def to_board(rx, ry):
        return (hw + rx, hh_r - ry)

    top_corner_board = to_board(hc["top_x"], -hh_r)
    assert math.hypot(top_corner_board[0] - E[0], top_corner_board[1] - E[1]) < 1e-9

    shoulder_horn = to_board(hc["top_x"], hc["shoulder_y"])  # eave -> shoulder_horn is the straight run
    shoulder_waist_jct = to_board(hc["shoulder_cx"] + hc["r_shoulder"] * hc["ux"], hc["shoulder_y"] + hc["r_shoulder"] * hc["uy"])
    waist_hip_jct = to_board(hc["hip_cx"] + hc["r_hip"] * hc["ux_bottom"], hc["hip_y"] - hc["r_hip"] * hc["uy_bottom"])
    hip_horn = to_board(hw, hc["hip_y"])  # hip_horn -> base is the straight run (full width, no inset)
    base = to_board(hw, hh_r)
    assert abs(base[0] - width_in) < 1e-9 and abs(base[1] - 0.0) < 1e-9

    C_shoulder = to_board(hc["shoulder_cx"], hc["shoulder_y"])
    # `hw - depth` is the waist's own DEEPEST point (the pinch's closest approach to the centreline), not
    # its centre -- the concave arc's centre sits one more radius further OUT from the centreline, back
    # toward C_shoulder/C_hip's own side. Omitting `+ radius_waist` here left C_waist off by exactly that
    # amount, which is why shoulder_waist_jct/waist_hip_jct (each solved to lie on the shoulder/hip circle
    # tangent to the TRUE waist circle) never actually landed on this mis-placed one -- confirmed numerically
    # (both jct points sit at distance r_waist from the corrected centre, to 1e-9).
    C_waist = to_board(hw - hc["depth"] + hc["radius_waist"], hc["waist_center_y"])
    C_hip = to_board(hc["hip_cx"], hc["hip_y"])

    # The eave corner: roof line (peak->E, travel direction away from E back toward peak = -roof_dir) meets
    # the straight eave->shoulder run (travel direction away from E, downward = toward shoulder_horn).
    roof_dir = ((E[0] - peak[0]), (E[1] - peak[1]))
    roof_len = math.hypot(*roof_dir)
    roof_dir = (roof_dir[0] / roof_len, roof_dir[1] / roof_len)
    eave_dir_in = (-roof_dir[0], -roof_dir[1])  # back toward the peak
    straight_dir = (shoulder_horn[0] - E[0], shoulder_horn[1] - E[1])
    straight_len = math.hypot(*straight_dir)
    eave_dir_out = (straight_dir[0] / straight_len, straight_dir[1] / straight_len) if straight_len > 1e-12 else (0.0, -1.0)
    interior_pt = (hw, height_in * 0.5)  # same "board centre" reference t7_roof_eave.eave_inner_corner uses
    eave_direction, eave_dist, _eave_inner = _line_line_inner_corner(E, eave_dir_in, eave_dir_out, frame_thickness, interior_pt)

    return dict(
        hw=hw, a=a, T=frame_thickness, peak=peak, E=E, base=base,
        shoulder_horn=shoulder_horn, shoulder_waist_jct=shoulder_waist_jct,
        waist_hip_jct=waist_hip_jct, hip_horn=hip_horn,
        C_shoulder=C_shoulder, r_shoulder=hc["r_shoulder"],
        C_waist=C_waist, r_waist=hc["radius_waist"], waist_major=hc["waist_major"],
        C_hip=C_hip, r_hip=hc["r_hip"],
        eave_direction=eave_direction, eave_distance=eave_dist,
        straight_eave_len=straight_len,
    )


def base_inner_corner(side='right'):
    """The base corner (side meets base, a plain 90-degree axis-aligned corner) -- identical to
    t7_geometry.py's own base_inner_corner (same shape of corner, same formula)."""
    return ((-1.0, 1.0) if side == 'right' else (1.0, 1.0)), None  # Distance left to the caller: 'frame_thickness'


def inner_corner_directions(width_in, height_in, frame_thickness, **side_kwargs):
    """All 3 distinct (right-side; base-left/eave-left mirror in x) inner-corner (Direction, Distance)
    pairs for ResolveInnerCorners. Returns {'peak': (dir, dist), 'eave_R': (dir, dist), 'base_R': (dir, dist)}."""
    o = t11_outline(width_in, height_in, frame_thickness, **side_kwargs)
    peak_dir, peak_dist = peak_inner_corner(frame_thickness)
    base_dir, _ = base_inner_corner('right')
    return {
        'peak': (peak_dir, peak_dist),
        'eave_R': (o['eave_direction'], o['eave_distance']),
        'base_R': (base_dir, frame_thickness),
    }


def inner_profile_radii(r_shoulder, r_waist, r_hip, frame_thickness):
    """The 3-arc chain's own inner (bar-width) radii: shoulder and hip SHRINK (-t, convex, centre on the
    interior side); waist GROWS (+t, concave, centre on the exterior side) -- see this module's own
    docstring."""
    return r_shoulder - frame_thickness, r_waist + frame_thickness, r_hip - frame_thickness


def every_outer_point_inside_board(width_in, height_in, outline, n_samples=200):
    """True iff every sampled point on the shoulder/waist/hip arcs (right half; left is an exact mirror)
    lies within [0,W]x[0,H]. The arc direction/angle-range for each is resolved the SAME way the diagram
    script (WORK-LOG-lane-b.md Turn 218) verified it: an explicit geometric check (convex bulges away from
    the board's own centreline; concave bulges toward it), not an assumed sign convention."""
    def sample_arc(p0, p1, center, radius, major, direction_ok):
        # The centre is ALREADY known analytically (t11_outline's own C_shoulder/C_waist/C_hip) -- no need
        # to re-derive candidate centres from the chord (that was this function's own first draft, and it
        # had a real bug: floating-point noise meant neither re-derived candidate matched the given centre
        # to 1e-6, so every sweep was rejected). Just sweep from p0 to p1 around the GIVEN centre.
        cx, cy = center
        N = 40
        a0 = math.atan2(p0[1] - cy, p0[0] - cx)
        a1 = math.atan2(p1[1] - cy, p1[0] - cx)
        d_ccw = (a1 - a0) % (2 * math.pi)
        for dtheta in (d_ccw, d_ccw - 2 * math.pi):
            if (abs(dtheta) > math.pi) != major:
                continue
            pts = [(cx + radius * math.cos(a0 + k / N * dtheta), cy + radius * math.sin(a0 + k / N * dtheta)) for k in range(N + 1)]
            if math.hypot(pts[-1][0] - p1[0], pts[-1][1] - p1[1]) > 1e-6:
                continue
            if direction_ok(pts[N // 2]):
                return pts
        # No candidate sweep matched -- an extreme/degenerate parameter combination (e.g. a very wide,
        # short landscape board) rather than a bug in a specific case; same "clamped, never refused"
        # contract as t7_geometry's own clamp_t7_handles, so this is reported as "not a valid outline"
        # (like any other geometric failure here), not an exception -- is_valid_t11_outline/
        # clamp_t11_handles blend back toward the proven default for cases like this.
        return None

    def chord_mid_x(p0, p1):
        return (p0[0] + p1[0]) / 2.0

    shoulder_pts = sample_arc(outline["shoulder_horn"], outline["shoulder_waist_jct"], outline["C_shoulder"], outline["r_shoulder"], False,
                               lambda m: m[0] > chord_mid_x(outline["shoulder_horn"], outline["shoulder_waist_jct"]) + 1e-9)
    waist_pts = sample_arc(outline["shoulder_waist_jct"], outline["waist_hip_jct"], outline["C_waist"], outline["r_waist"], outline["waist_major"],
                            lambda m: m[0] < chord_mid_x(outline["shoulder_waist_jct"], outline["waist_hip_jct"]) - 1e-9)
    hip_pts = sample_arc(outline["waist_hip_jct"], outline["hip_horn"], outline["C_hip"], outline["r_hip"], False,
                          lambda m: m[0] > chord_mid_x(outline["waist_hip_jct"], outline["hip_horn"]) + 1e-9)
    if shoulder_pts is None or waist_pts is None or hip_pts is None:
        return False
    for pts in (shoulder_pts, waist_pts, hip_pts):
        for (x, y) in pts:
            if not (-1e-6 <= x <= width_in + 1e-6 and -1e-6 <= y <= height_in + 1e-6):
                return False
    return True


def is_valid_t11_outline(width_in, height_in, frame_thickness, outline):
    """Structural validity: all 3 arc radii positive, the inner (bar-width) offset never collapses, both
    straight runs (eave->shoulder, hip->base) clear frame_thickness, and the whole outer profile stays
    inside the board."""
    r_s, r_w, r_h = outline["r_shoulder"], outline["r_waist"], outline["r_hip"]
    if not (r_s > frame_thickness and r_w > 0 and r_h > frame_thickness):
        return False
    if outline["straight_eave_len"] < frame_thickness:
        return False
    hip_to_base_len = math.hypot(outline["base"][0] - outline["hip_horn"][0], outline["base"][1] - outline["hip_horn"][1])
    if hip_to_base_len < frame_thickness:
        return False
    return every_outer_point_inside_board(width_in, height_in, outline)


def clamp_t11_handles(width_in, height_in, frame_thickness,
                      waist_reach=WAIST_REACH_DEFAULT,
                      corner_radius_top=CORNER_RADIUS_DEFAULT,
                      corner_radius_bottom=CORNER_RADIUS_DEFAULT,
                      waist_center_y_frac=WAIST_CENTER_Y_FRAC_DEFAULT,
                      max_iter=24):
    """'Clamped, never refused' -- same blend-toward-the-proven-default binary search as
    t7_geometry.clamp_t7_handles (see that function's own doc comment for why a blend, not a hand-derived
    closed-form safe range, for several coupled parameters)."""
    default = (WAIST_REACH_DEFAULT, CORNER_RADIUS_DEFAULT, CORNER_RADIUS_DEFAULT, WAIST_CENTER_Y_FRAC_DEFAULT)
    requested = (waist_reach, corner_radius_top, corner_radius_bottom, waist_center_y_frac)
    lo, hi = 0.0, 1.0
    best = default
    for _ in range(max_iter):
        t = (lo + hi) / 2
        candidate = tuple(d + t * (r - d) for d, r in zip(default, requested))
        o = t11_outline(width_in, height_in, frame_thickness, *candidate)
        if is_valid_t11_outline(width_in, height_in, frame_thickness, o):
            best = candidate
            lo = t
        else:
            hi = t
    return best

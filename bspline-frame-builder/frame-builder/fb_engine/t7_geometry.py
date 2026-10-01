"""
t7_geometry.py — Template 7 (Diamond-top Hourglass) full outline: the roof/eave (t7_roof_eave.py) plus the
neck-to-body S-curve and the base. Pure, stdlib-only Python -- no adsk.* dependency, unit-tested without
Fusion in tests/test_t7_geometry.py.

Coordinates are INCHES, board-local, origin BOTTOM-LEFT, y UP (Fusion's own sketch convention).

Approved shape (amendment 189/190 in .handoff/amendments.tsv -- the authoritative spec; NEXT-SESSION-lane-
b.md is stale on this topic, see WORK-LOG-lane-b.md Turn 197's own note): from the eave the side turns
down-and-inward into a concave NECK (narrowest point), then a convex BODY curve flares out to the FULL
board width, then straight down to the base corner. Mirrored. 5 bars (2 roof, 2 side, 1 base), 5 miters
(peak, 2 eaves, 2 base corners) -- the neck-to-body join and the body-to-straight join are both TANGENT
(smooth), not miters.

Construction, solved closed-form (not fit/guessed -- WORK-LOG-lane-b.md Turn 197):
  - Body arc: tangent to the vertical straight side at B=(W, body_y) -> its center sits on the horizontal
    through B; its radius is pinned by requiring the circle also pass through N (one equation, one
    unknown).
  - Neck arc: a genuine S-curve needs the two arcs' centers and the join point N to be exactly COLINEAR
    (opposite-curvature tangency) -> that fixes the neck arc's center DIRECTION; its radius is pinned by
    requiring the circle also pass through E (again one equation, one unknown).
  - Inner (bar-width) offset: body arc radius SHRINKS by frame_thickness (its center is on the INTERIOR
    side); neck arc radius GROWS by frame_thickness (its center is on the EXTERIOR side) -- "arcs
    concentric at r -/+ t", the same rule editor-frame-profile.js states for every template's true inward
    offset.

This module does NOT decide how Fusion actually builds the arcs (Arc3Point seed + Tangent constraints,
mirroring template_8's own dip construction -- see sketches/template_7/phases/p02_03_loop.py) -- it is the
one place the EXACT math lives, read by: the Fusion phase files (for seed points), the inner-corner-resolve
phase (for the eave's own Direction/Distance), and the app-parity tests.
"""
import math

from fb_engine.t7_roof_eave import roof_geometry, peak_inner_corner, eave_inner_corner

NECK_WIDTH_OF_HW_DEFAULT = 0.50          # advisor review, Turn 199: 0.44 read as "pinched shut" even though
                                          # it cleared a 1in floor; swept 0.44-0.60, 0.55 overflowed the 6x9
                                          # board, 0.50 is the largest that clears every supported size.
NECK_HEIGHT_FRAC_DEFAULT = 0.18          # how far down from the eave to the base the neck (narrowest point) sits
BODY_FLARE_HEIGHT_FRAC_DEFAULT = 0.72    # how far down from the eave to the base the body reaches full width


def t7_outline(width_in, height_in, frame_thickness,
               neck_width_of_hw=NECK_WIDTH_OF_HW_DEFAULT,
               neck_height_frac=NECK_HEIGHT_FRAC_DEFAULT,
               body_flare_height_frac=BODY_FLARE_HEIGHT_FRAC_DEFAULT):
    """The full right-half outline (mirror x for the left) plus the two solved arc circles. Returns a dict:
    hw, cx, a, T, peak, E, N, B, base (all points), C_neck, r_neck, C_body, r_body.
    """
    g = roof_geometry(width_in, height_in)
    hw, cx, a, peak, E = g["hw"], g["cx"], g["a"], g["peak"], g["E"]
    yE = height_in - a
    rest = yE
    nx = max(neck_width_of_hw * hw, a * 0.70)
    xN = cx + nx
    neck_y = yE - neck_height_frac * rest
    body_y = yE - body_flare_height_frac * rest
    N = (xN, neck_y)
    B = (width_in, body_y)
    base = (width_in, 0.0)

    dy = neck_y - body_y
    dxN = xN - width_in
    r_body = -(dxN * dxN + dy * dy) / (2 * dxN)
    C_body = (width_in - r_body, body_y)

    ux, uy = N[0] - C_body[0], N[1] - C_body[1]
    ulen = math.hypot(ux, uy)
    ux, uy = ux / ulen, uy / ulen
    vx, vy = N[0] - E[0], N[1] - E[1]
    v_dot_u = vx * ux + vy * uy
    v2 = vx * vx + vy * vy
    r_neck = -v2 / (2 * v_dot_u)
    C_neck = (N[0] + r_neck * ux, N[1] + r_neck * uy)

    return dict(hw=hw, cx=cx, a=a, T=frame_thickness, peak=peak, E=E, N=N, B=B, base=base,
                C_neck=C_neck, r_neck=r_neck, C_body=C_body, r_body=r_body)


def base_inner_corner(side='right'):
    """The base corner (side meets base, a plain 90-degree axis-aligned corner, same as every other
    template's base corners) as a (Direction, Distance) pair. Distance = frame_thickness exactly (not
    sqrt(2) -- unlike the peak, this corner's two edges are each purely horizontal/vertical, the case
    ResolveInnerCorners' existing default already handles correctly)."""
    return ((-1.0, 1.0) if side == 'right' else (1.0, 1.0)), None  # Distance left to the caller: 'frame_thickness'


def inner_corner_directions(width_in, height_in, frame_thickness,
                            neck_width_of_hw=NECK_WIDTH_OF_HW_DEFAULT,
                            neck_height_frac=NECK_HEIGHT_FRAC_DEFAULT,
                            body_flare_height_frac=BODY_FLARE_HEIGHT_FRAC_DEFAULT):
    """All 3 distinct (right-side; base-left/eave-left mirror in x) inner-corner (Direction, Distance)
    pairs for ResolveInnerCorners, computed together so the eave's own neck-arc dependency is resolved
    once. Returns {'peak': (dir, dist), 'eave_R': (dir, dist), 'base_R': (dir, dist)}."""
    o = t7_outline(width_in, height_in, frame_thickness, neck_width_of_hw, neck_height_frac, body_flare_height_frac)
    peak_dir, peak_dist = peak_inner_corner(frame_thickness)
    eave_dir, eave_dist, _ = eave_inner_corner(width_in, height_in, frame_thickness, o["C_neck"], o["r_neck"])
    base_dir, _ = base_inner_corner('right')
    return {
        'peak': (peak_dir, peak_dist),
        'eave_R': (eave_dir, eave_dist),
        'base_R': (base_dir, frame_thickness),
    }


def inner_profile_radii(r_neck, r_body, frame_thickness):
    """The S-curve arcs' own inner (bar-width) radii: neck GROWS (+t, center on the exterior side), body
    SHRINKS (-t, center on the interior side) -- see this module's own docstring."""
    return r_neck + frame_thickness, r_body - frame_thickness


def is_valid_t7_outline(width_in, height_in, frame_thickness, outline):
    """All the structural validity conditions a built outline must satisfy: both arc radii positive, the
    inner (bar-width) offset never collapses, every bar clears frame_thickness (no 'wing' risk -- Template
    7's own rejected first build's finding, see tests/frame-template-8.test.js's own citation of it), and
    the whole outer profile stays inside the board."""
    r_neck, r_body = outline["r_neck"], outline["r_body"]
    if not (r_neck > 0 and r_body > frame_thickness):
        return False
    if not (outline["N"][0] - outline["cx"] > frame_thickness):
        return False
    roof_len = math.hypot(outline["E"][0] - outline["peak"][0], outline["E"][1] - outline["peak"][1])
    if not (roof_len > frame_thickness and outline["B"][1] >= 0):
        return False
    return every_outer_point_inside_board(width_in, height_in, outline, n_samples=60)


def clamp_t7_handles(width_in, height_in, frame_thickness,
                     neck_width_of_hw=NECK_WIDTH_OF_HW_DEFAULT,
                     neck_height_frac=NECK_HEIGHT_FRAC_DEFAULT,
                     body_flare_height_frac=BODY_FLARE_HEIGHT_FRAC_DEFAULT,
                     max_iter=24):
    """'Clamped, never refused' (the same guarantee every other template's own handle range gives, T6's own
    test calls it out by name: 'any seed and any frame thickness gives a valid frame, clamped never
    refused'). MEASURED (not assumed): the 3 handles are NOT independently safe across their own declared
    ranges -- a handle sweep in tests/test_t7_geometry.py found real invalid combinations (negative/
    collapsed radii, points outside the board) at combinations of neckWidth/neckHeight/bodyFlareHeight that
    each individually look reasonable. Rather than hand-deriving a closed-form safe range for 3 coupled
    parameters (intricate, and a wrong derivation is exactly the kind of thing that can't be checked without
    Fusion), this blends the requested values toward the PROVEN-safe defaults (NECK_WIDTH_OF_HW_DEFAULT etc.
    -- validated inside the board at every supported size, tests/test_t7_geometry.py) by a shrinking factor
    `t` until the resulting outline validates (is_valid_t7_outline) or `t` bottoms out at the default itself
    (which is always valid, so this function always terminates with a valid result -- never refuses).
    """
    default = (NECK_WIDTH_OF_HW_DEFAULT, NECK_HEIGHT_FRAC_DEFAULT, BODY_FLARE_HEIGHT_FRAC_DEFAULT)
    requested = (neck_width_of_hw, neck_height_frac, body_flare_height_frac)
    lo, hi = 0.0, 1.0  # t=1 -> requested values; t=0 -> default values
    best = default
    for _ in range(max_iter):
        t = (lo + hi) / 2
        candidate = tuple(d + t * (r - d) for d, r in zip(default, requested))
        o = t7_outline(width_in, height_in, frame_thickness, *candidate)
        if is_valid_t7_outline(width_in, height_in, frame_thickness, o):
            best = candidate
            lo = t
        else:
            hi = t
    return best


def every_outer_point_inside_board(width_in, height_in, outline, n_samples=200):
    """True iff every sampled point on both the neck and body arcs (right half; the left half is an exact
    mirror) lies within [0,W]x[0,H] -- the ONE property the earlier spline-based concept prototype was
    flagged as failing (it bulged slightly outside the board at the base). Used by both the pytest suite
    and (indirectly, same math) the app-side JS tests."""
    C_neck, r_neck, E, N = outline["C_neck"], outline["r_neck"], outline["E"], outline["N"]
    C_body, r_body, B = outline["C_body"], outline["r_body"], outline["B"]
    ang_e = math.atan2(E[1] - C_neck[1], E[0] - C_neck[0])
    ang_n = math.atan2(N[1] - C_neck[1], N[0] - C_neck[0])
    ang_n2 = math.atan2(N[1] - C_body[1], N[0] - C_body[0])
    ang_b = math.atan2(B[1] - C_body[1], B[0] - C_body[0])
    for k in range(n_samples + 1):
        f = k / n_samples
        for (c, r, a0, a1) in [(C_neck, r_neck, ang_e, ang_n), (C_body, r_body, ang_n2, ang_b)]:
            ang = a0 + f * (a1 - a0)
            x, y = c[0] + r * math.cos(ang), c[1] + r * math.sin(ang)
            if not (-1e-6 <= x <= width_in + 1e-6 and -1e-6 <= y <= height_in + 1e-6):
                return False
    return True

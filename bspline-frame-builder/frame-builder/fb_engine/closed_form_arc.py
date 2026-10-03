"""
closed_form_arc.py — H23 item 18: the declared convention for seeding a shape-outline arc.

Every template's shape outline eventually needs an arc's radius/centre pinned down. The recurring
BUG CLASS this module exists to stop (three confirmed incidents before this item: Template 5's
dip radius scaling with heightIn while the span it bridges scales with widthIn, H23 item 6;
Template 10's `hw = widthIn * 0.464286` reused from Template 1 without re-deriving it for T10's
own hip/shoulder chain, items 14/15/17; Template 12/13's seed computed off the raw board
dimension instead of routing through seed_basis.py, seat C's F30 item 3) is a seed written as a
FITTED FRACTION of one board dimension (`widthIn * 0.464286`), hand-picked or copied from a
sibling template, instead of SOLVED from the actual geometric relationship the arc must satisfy.
A fitted fraction is only ever correct at the one board size (or the one sibling template) it was
picked for; a closed-form solve is correct at every size, by construction, because it IS the
relationship.

The worked example (H23 item 27): fb_engine/t7_geometry.py's own `t7_outline()` solves its body
and neck arc radii from two closed-form relationships -- "tangent to a known line, through a known
point" and "centre colinear with a neighbour's, through a known point" -- instead of fitting a
widthIn/heightIn fraction. This module extracts those two relationships (plus the arc's own TRUE
via point, the third piece H23 item 27 needed) as named, independently-tested, pure functions, so
a NEW template's own closed-form derivation starts from a declared primitive instead of
re-deriving the algebra from scratch every time -- not a framework: these three functions are the
whole of it. t7_geometry.py itself now calls them (see its own module docstring); use it as the
reference for how a template's derivation reads once it does.

When a seed genuinely IS just a board-size fraction (e.g. the trim offset's own corner, or
anything whose only constraint is "a fixed proportion of the board" rather than a relationship
to other geometry), a literal `widthIn * k` is not this bug class -- this module has nothing to
add there. The audit question is always: does this constant encode an actual geometric
relationship, and if so, is it SOLVED from that relationship or just fitted to look right at one
board size?

Coordinates are plain (x, y) tuples, any consistent unit (inches throughout this codebase). No
adsk.* dependency -- pure stdlib math, unit-tested without Fusion (test_closed_form_arc.py).
"""
import math


def tangent_circle_through_point(tangent_point, tangent_direction, through_point):
    """The circle tangent to the line through `tangent_point` in `tangent_direction` (need not be
    unit length), that also passes through `through_point`. Returns (centre, radius).

    Worked example: t7_geometry.py's body arc is tangent to the board's vertical right edge at
    B=(width_in, body_y) and must also pass through the neck join N -- exactly
    `tangent_circle_through_point(B, (0, 1), N)`.

    `radius` carries a sign (the side of the tangent line the solved centre landed on, following
    `tangent_direction` rotated +90 degrees for the normal) -- a caller that knows which side it
    wants and gets the other sign can negate both `radius` and recompute, or swap the direction's
    own sign, whichever reads clearer at the call site.
    """
    x0, y0 = tangent_point
    dx_dir, dy_dir = tangent_direction
    dlen = math.hypot(dx_dir, dy_dir)
    nx, ny = -dy_dir / dlen, dx_dir / dlen  # unit normal, 90 deg CCW from tangent_direction
    x1, y1 = through_point
    wx, wy = x1 - x0, y1 - y0
    n_dot_w = nx * wx + ny * wy
    w2 = wx * wx + wy * wy
    r = w2 / (2 * n_dot_w)
    centre = (x0 + r * nx, y0 + r * ny)
    return centre, r


def colinear_circle_through_point(vertex, ray_direction, through_point):
    """The circle whose centre lies on the ray from `vertex` in `ray_direction` (need not be unit
    length) -- i.e. `vertex` itself sits ON the circle, G1-continuous with a neighbouring arc whose
    own centre -> `vertex` direction IS `ray_direction` -- that also passes through `through_point`.
    Returns (centre, radius).

    Worked example: t7_geometry.py's neck arc shares its join point N with the body arc and must
    stay colinear with the body arc's own centre there (the S-curve's opposite-curvature
    tangency), and must also pass through the eave point E -- exactly
    `colinear_circle_through_point(N, unit_vector(C_body, N), E)`.
    """
    vx0, vy0 = vertex
    dx_dir, dy_dir = ray_direction
    ulen = math.hypot(dx_dir, dy_dir)
    ux, uy = dx_dir / ulen, dy_dir / ulen
    ex, ey = through_point
    wx, wy = vx0 - ex, vy0 - ey
    w_dot_u = wx * ux + wy * uy
    w2 = wx * wx + wy * wy
    r = -w2 / (2 * w_dot_u)
    centre = (vx0 + r * ux, vy0 + r * uy)
    return centre, r


def sagitta_circle(p0, p1, sag, away_point):
    """The circle through `p0` and `p1` whose arc bulges by sagitta `sag` AWAY from `away_point` (i.e. the
    chord's own midpoint, pushed out by `sag` along whichever of the two possible normals lands farther
    from `away_point`, is ON the circle). Returns (centre, radius).

    Unlike the two functions above (a neighbour's own tangency/colinearity pins the circle down), a
    sagitta construction needs no neighbour at all -- the chord + bulge depth alone fully determine it.
    T16/T17 (Arched Funnel / Tulip, T84 item 3) are built entirely from this: every joint between their
    own 6 pieces is a MITER, never a tangent continuation, so each arc stands alone. Ported from
    tools/repro/t84_items1_2_archedfunnel_tulip_diagram.mjs's own `bulgeArc` (the Fred-approved diagram,
    commit 19f7bbb) -- same formula, closed-form, no iteration.
    """
    x0, y0 = p0
    x1, y1 = p1
    mx, my = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    dx, dy = x1 - x0, y1 - y0
    chord_len = math.hypot(dx, dy)
    half_chord = chord_len / 2.0
    nx, ny = -dy / chord_len, dx / chord_len  # one of the two unit normals to the chord
    ax, ay = away_point
    d_this_side = (mx + nx - ax) ** 2 + (my + ny - ay) ** 2
    d_mid = (mx - ax) ** 2 + (my - ay) ** 2
    if d_this_side < d_mid:  # this normal points TOWARD away_point -- flip to the far side
        nx, ny = -nx, -ny
    r = (half_chord * half_chord + sag * sag) / (2.0 * sag)
    centre = (mx + nx * (sag - r), my + ny * (sag - r))
    return centre, r


def true_via_point(center, radius, end0, end1):
    """The TRUE angular midpoint of the MINOR arc between `end0` and `end1` on the circle
    (`center`, `radius`) -- centre + radius * the unit bisector of the two end-direction vectors.

    This is the exact point an Arc3Point's own middle point should be seeded with (H23 item 27's
    T7/T11 recipe, fusion360-quirks skill: "Tangent on an arc chain LOCKS the seed, it does not
    SOLVE for the shape" -- an internal joint's free end keeps whatever the seed said, so the seed
    must already BE the answer, not a rough hint). `end0`/`end1` must both already be exactly on
    the circle (e.g. the output of the two functions above, or a fixed board point the arc is
    constructed to pass through) -- this function does not fit or project them.
    """
    cx, cy = center
    e0x, e0y = end0
    e1x, e1y = end1
    u0x, u0y = (e0x - cx) / radius, (e0y - cy) / radius
    u1x, u1y = (e1x - cx) / radius, (e1y - cy) / radius
    bx, by = u0x + u1x, u0y + u1y
    blen = math.hypot(bx, by)
    bx, by = bx / blen, by / blen
    return (cx + radius * bx, cy + radius * by)

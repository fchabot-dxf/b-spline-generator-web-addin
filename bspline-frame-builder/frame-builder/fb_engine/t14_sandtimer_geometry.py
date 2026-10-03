"""
t14_sandtimer_geometry.py — Template 14 (Sand Timer), T84 item 5 (moved from seat C's F31 item 1b,
Fred approved the diagram as drawn, fb-app 5e0b5fa, tools/repro/f31_item1_sandtimer_diagram.mjs). Two
outward-bulging arcs per side (upper, lower) meeting at a sharp pinch (a genuine miter corner -- the
two arcs' tangents differ there, same "neck as drawn" shape the diagram's own bulgeArc() built), a flat
top and a flat base. This module ports that script's own buildSandTimer()/bulgeArc() to Python via
fb_engine.closed_form_arc.sagitta_circle -- the SAME closed-form bulge construction T16/T17
(fb_engine/t16_geometry.py) already use, since bulgeArc() was itself already a hand re-implementation
of sagitta_circle for the JS-only diagram context. See test_t14_sandtimer_geometry.py for the numeric
cross-check against the diagram script's own measured output (the ground truth Fred approved).

UNLIKE t7_geometry.py/t11_geometry.py, there is no tangent chain here either (same as T16/T17): every
one of the 6 joints is a MITER, each arc built independently from its own chord + sagitta, no
neighbour-tangency coupling to solve.

Six pieces, clockwise travel order starting at the top-right (matches the diagram's own PIECE_NAMES):
  0 upper_R, 1 lower_R, 2 base, 3 lower_L, 4 upper_L, 5 top
Six corners: topR, pinchR, BR, BL, pinchL, topL.

Coordinates: INCHES, board-local, origin board CENTRE, y UP -- same safe-zone convention as
t16_geometry.py (width_in/height_in here are the safe-zone dimensions, already
boundingboxoffset-subtracted).
"""
import math

from fb_engine.closed_form_arc import sagitta_circle, true_via_point

TOP_WIDTH_FRAC_DEFAULT = 1.0  # T84 item 5's own "topWidth" handle (shared key, T84 item 4 convention,
# basis hw, same as T16/T17's). Default 1.0 reproduces the Fred-approved diagram exactly (a full-width
# top, flush with the base) -- the diagram itself never drew a narrower top, so this handle starts at
# the shape-preserving identity and only narrows on request.
PINCH_REACH_FRAC_DEFAULT = 0.6  # the diagram's own pinchReachFrac (0..1, how far IN from the side the
# pinch sits; 0 = no pinch, at the board edge), default as drawn.
BULGE_FRAC_DEFAULT = 0.14  # the diagram's own bulgeFrac (fraction of hw, the outward sagitta of each of
# the 4 side arcs), default as drawn.
PINCH_HEIGHT_FRAC_DEFAULT = 0.5  # the diagram's own pinchHeightFrac (0 = pinch at the top edge, 1 = at
# the bottom edge, 0.5 = centred), default as drawn.

_BULGE_EPS = 1e-9  # below this, a side degenerates to a straight line (mirrors the diagram's own
# `bulgeArc`: `if (sag < 1e-9) return mkLine(p0, p1);`) -- bulge_frac is ONE shared parameter across
# all 4 side arcs here (unlike T16's two independent bulge-ish parameters), so this is an all-or-
# nothing case: every side is a line, or every side is an arc.

# ---------------------------------------------------------------------------
# Fusion SKETCH_2_PARAMETERS (named-parameter expression chains), declared ONCE here, same reasoning
# as fb_engine/t16_geometry.py's own SHARED_LOWER_SKETCH_2_PARAMETERS comment: inlining a via point's
# own formula (which references its own circle's centre, which references its own radius, which
# references the chord -- each substituted in by hand) blows up to thousands of characters per
# coordinate, so every arc's own centre/radius/via chain is a NAMED Fusion parameter chain instead.
# Units: the *nx/*ny/*u0x/*u0y/*u1x/*u1y/*bx/*by/*blen entries are genuine dimensionless ratios
# (Unit="") -- the SAME "a userParameter's .expression assignment enforces dimensional consistency"
# quirk T7/T16's own comments already found (fusion360-quirks skill): declaring these "in" instead
# would make Fusion silently reject the assignment and leave the parameter stuck at its birth value
# 0.0.
#
# UNLIKE T16 (one shared lower chain + T17's one upper chain), this template needs exactly TWO
# independent chains -- upper_R's own (topR->pinchR) and lower_R's own (pinchR->BR) -- because all
# four of its own side pieces are arcs, but lower_L/upper_L are each the EXACT x-mirror of
# lower_R/upper_R (verified numerically against outline() at 3 board sizes, same as T16's own
# lower_L-mirrors-lower_R finding) -- no separate named chain for them, p02_02_loop.py's own Points
# just negate t14_lr_vx/t14_ur_vx (and cx, inline in p02_02 -- never read directly here).
#
# CONFIRMED numerically (2026-10-03, before being trusted here): the plain `nx=-dy/chordlen,
# ny=dx/chordlen` formula (no away_point disambiguation, no conditional flip) reproduces every one of
# the 4 arcs' own sagitta_circle() centre/radius to 1e-9 -- the SAME zero-flip finding T16's own
# lower-bulge chain already made for its own (different) chord directions; this module's own
# test_t14_sandtimer_geometry.py pins the exact values.
_TOP_X = f'{TOP_WIDTH_FRAC_DEFAULT}*t14_hw'
SKETCH_2_PARAMETERS = [
    {"Name": "t14_hw",            "Label": "t14_hw",            "Category": "T14 Geometry", "Val": "(widthIn/2 - boundingboxoffset)", "Unit": "in"},
    {"Name": "t14_hh",            "Label": "t14_hh",            "Category": "T14 Geometry", "Val": "(heightIn/2 - boundingboxoffset)", "Unit": "in"},
    {"Name": "t14_pinchHalf",     "Label": "t14_pinchHalf",     "Category": "T14 Geometry", "Val": f"{1.0 - PINCH_REACH_FRAC_DEFAULT}*t14_hw", "Unit": "in"},
    {"Name": "t14_pinchY",        "Label": "t14_pinchY",        "Category": "T14 Geometry", "Val": f"t14_hh*(2*{PINCH_HEIGHT_FRAC_DEFAULT} - 1)", "Unit": "in"},
    {"Name": "t14_bulge",         "Label": "t14_bulge",         "Category": "T14 Geometry", "Val": f"{BULGE_FRAC_DEFAULT}*t14_hw", "Unit": "in"},

    # upper_R: chord topR=(topWidthFrac*hw, hh) -> pinchR=(pinchHalf, pinchY).
    {"Name": "t14_ur_dx",         "Label": "t14_ur_dx",         "Category": "T14 Geometry", "Val": f"t14_pinchHalf - ({_TOP_X})", "Unit": "in"},
    {"Name": "t14_ur_dy",         "Label": "t14_ur_dy",         "Category": "T14 Geometry", "Val": "t14_pinchY - t14_hh", "Unit": "in"},
    {"Name": "t14_ur_chordlen",   "Label": "t14_ur_chordlen",   "Category": "T14 Geometry", "Val": "sqrt(t14_ur_dx*t14_ur_dx + t14_ur_dy*t14_ur_dy)", "Unit": "in"},
    {"Name": "t14_ur_nx",         "Label": "t14_ur_nx",         "Category": "T14 Geometry", "Val": "-t14_ur_dy / t14_ur_chordlen", "Unit": ""},
    {"Name": "t14_ur_ny",         "Label": "t14_ur_ny",         "Category": "T14 Geometry", "Val": "t14_ur_dx / t14_ur_chordlen", "Unit": ""},
    {"Name": "t14_ur_halfchord",  "Label": "t14_ur_halfchord",  "Category": "T14 Geometry", "Val": "t14_ur_chordlen/2", "Unit": "in"},
    {"Name": "t14_ur_r",          "Label": "t14_ur_r",          "Category": "T14 Geometry", "Val": "(t14_ur_halfchord*t14_ur_halfchord + t14_bulge*t14_bulge)/(2*t14_bulge)", "Unit": "in"},
    {"Name": "t14_ur_cx",         "Label": "t14_ur_cx",         "Category": "T14 Geometry", "Val": f"(({_TOP_X}) + t14_pinchHalf)/2 + t14_ur_nx*(t14_bulge - t14_ur_r)", "Unit": "in"},
    {"Name": "t14_ur_cy",         "Label": "t14_ur_cy",         "Category": "T14 Geometry", "Val": "(t14_hh + t14_pinchY)/2 + t14_ur_ny*(t14_bulge - t14_ur_r)", "Unit": "in"},
    {"Name": "t14_ur_u0x",        "Label": "t14_ur_u0x",        "Category": "T14 Geometry", "Val": f"(({_TOP_X}) - t14_ur_cx)/t14_ur_r", "Unit": ""},
    {"Name": "t14_ur_u0y",        "Label": "t14_ur_u0y",        "Category": "T14 Geometry", "Val": "(t14_hh - t14_ur_cy)/t14_ur_r", "Unit": ""},
    {"Name": "t14_ur_u1x",        "Label": "t14_ur_u1x",        "Category": "T14 Geometry", "Val": "(t14_pinchHalf - t14_ur_cx)/t14_ur_r", "Unit": ""},
    {"Name": "t14_ur_u1y",        "Label": "t14_ur_u1y",        "Category": "T14 Geometry", "Val": "(t14_pinchY - t14_ur_cy)/t14_ur_r", "Unit": ""},
    {"Name": "t14_ur_bx",         "Label": "t14_ur_bx",         "Category": "T14 Geometry", "Val": "t14_ur_u0x + t14_ur_u1x", "Unit": ""},
    {"Name": "t14_ur_by",         "Label": "t14_ur_by",         "Category": "T14 Geometry", "Val": "t14_ur_u0y + t14_ur_u1y", "Unit": ""},
    {"Name": "t14_ur_blen",       "Label": "t14_ur_blen",       "Category": "T14 Geometry", "Val": "sqrt(t14_ur_bx*t14_ur_bx + t14_ur_by*t14_ur_by)", "Unit": ""},
    {"Name": "t14_ur_vx",         "Label": "t14_ur_vx",         "Category": "T14 Geometry", "Val": "t14_ur_cx + t14_ur_r*(t14_ur_bx/t14_ur_blen)", "Unit": "in"},
    {"Name": "t14_ur_vy",         "Label": "t14_ur_vy",         "Category": "T14 Geometry", "Val": "t14_ur_cy + t14_ur_r*(t14_ur_by/t14_ur_blen)", "Unit": "in"},

    # lower_R: chord pinchR=(pinchHalf, pinchY) -> BR=(hw, -hh).
    {"Name": "t14_lr_dx",         "Label": "t14_lr_dx",         "Category": "T14 Geometry", "Val": "t14_hw - t14_pinchHalf", "Unit": "in"},
    {"Name": "t14_lr_dy",         "Label": "t14_lr_dy",         "Category": "T14 Geometry", "Val": "(-t14_hh) - t14_pinchY", "Unit": "in"},
    {"Name": "t14_lr_chordlen",   "Label": "t14_lr_chordlen",   "Category": "T14 Geometry", "Val": "sqrt(t14_lr_dx*t14_lr_dx + t14_lr_dy*t14_lr_dy)", "Unit": "in"},
    {"Name": "t14_lr_nx",         "Label": "t14_lr_nx",         "Category": "T14 Geometry", "Val": "-t14_lr_dy / t14_lr_chordlen", "Unit": ""},
    {"Name": "t14_lr_ny",         "Label": "t14_lr_ny",         "Category": "T14 Geometry", "Val": "t14_lr_dx / t14_lr_chordlen", "Unit": ""},
    {"Name": "t14_lr_halfchord",  "Label": "t14_lr_halfchord",  "Category": "T14 Geometry", "Val": "t14_lr_chordlen/2", "Unit": "in"},
    {"Name": "t14_lr_r",          "Label": "t14_lr_r",          "Category": "T14 Geometry", "Val": "(t14_lr_halfchord*t14_lr_halfchord + t14_bulge*t14_bulge)/(2*t14_bulge)", "Unit": "in"},
    {"Name": "t14_lr_cx",         "Label": "t14_lr_cx",         "Category": "T14 Geometry", "Val": "(t14_pinchHalf + t14_hw)/2 + t14_lr_nx*(t14_bulge - t14_lr_r)", "Unit": "in"},
    {"Name": "t14_lr_cy",         "Label": "t14_lr_cy",         "Category": "T14 Geometry", "Val": "(t14_pinchY + (-t14_hh))/2 + t14_lr_ny*(t14_bulge - t14_lr_r)", "Unit": "in"},
    {"Name": "t14_lr_u0x",        "Label": "t14_lr_u0x",        "Category": "T14 Geometry", "Val": "(t14_pinchHalf - t14_lr_cx)/t14_lr_r", "Unit": ""},
    {"Name": "t14_lr_u0y",        "Label": "t14_lr_u0y",        "Category": "T14 Geometry", "Val": "(t14_pinchY - t14_lr_cy)/t14_lr_r", "Unit": ""},
    {"Name": "t14_lr_u1x",        "Label": "t14_lr_u1x",        "Category": "T14 Geometry", "Val": "(t14_hw - t14_lr_cx)/t14_lr_r", "Unit": ""},
    {"Name": "t14_lr_u1y",        "Label": "t14_lr_u1y",        "Category": "T14 Geometry", "Val": "((-t14_hh) - t14_lr_cy)/t14_lr_r", "Unit": ""},
    {"Name": "t14_lr_bx",         "Label": "t14_lr_bx",         "Category": "T14 Geometry", "Val": "t14_lr_u0x + t14_lr_u1x", "Unit": ""},
    {"Name": "t14_lr_by",         "Label": "t14_lr_by",         "Category": "T14 Geometry", "Val": "t14_lr_u0y + t14_lr_u1y", "Unit": ""},
    {"Name": "t14_lr_blen",       "Label": "t14_lr_blen",       "Category": "T14 Geometry", "Val": "sqrt(t14_lr_bx*t14_lr_bx + t14_lr_by*t14_lr_by)", "Unit": ""},
    {"Name": "t14_lr_vx",         "Label": "t14_lr_vx",         "Category": "T14 Geometry", "Val": "t14_lr_cx + t14_lr_r*(t14_lr_bx/t14_lr_blen)", "Unit": "in"},
    {"Name": "t14_lr_vy",         "Label": "t14_lr_vy",         "Category": "T14 Geometry", "Val": "t14_lr_cy + t14_lr_r*(t14_lr_by/t14_lr_blen)", "Unit": "in"},
]


def outline(width_in, height_in, frame_thickness,
            top_width_frac=TOP_WIDTH_FRAC_DEFAULT,
            pinch_reach_frac=PINCH_REACH_FRAC_DEFAULT,
            bulge_frac=BULGE_FRAC_DEFAULT,
            pinch_height_frac=PINCH_HEIGHT_FRAC_DEFAULT):
    """The full outline (6 pieces) plus every arc's own (centre, radius, via point). Mirrors
    tools/repro/f31_item1_sandtimer_diagram.mjs's own buildSandTimer()/bulgeArc() exactly (ported from
    JS to Python via the shared sagitta_circle primitive)."""
    hw, hh = width_in / 2.0, height_in / 2.0
    A = hw * top_width_frac
    pinch_half = hw * (1.0 - pinch_reach_frac)
    bulge = hw * bulge_frac
    pinch_y = -hh + pinch_height_frac * 2.0 * hh

    top_r = (A, hh)
    top_l = (-A, hh)
    BR = (hw, -hh)
    BL = (-hw, -hh)
    pinch_r = (pinch_half, pinch_y)
    pinch_l = (-pinch_half, pinch_y)

    def bulge_arc(p0, p1):
        if bulge <= _BULGE_EPS:
            return None, None, None
        away = (0.0, (p0[1] + p1[1]) / 2.0)  # the chord's own midpoint y, reflected to the centreline --
        # same awayPoint convention the diagram's own bulgeArc() calls used for all 4 sides, which picks
        # the OUTWARD branch (farther from x=0) via sagitta_circle's own d_this_side<d_mid flip.
        centre, radius = sagitta_circle(p0, p1, bulge, away_point=away)
        via = true_via_point(centre, radius, p0, p1)
        return centre, radius, via

    upper_r_centre, upper_r_radius, upper_r_via = bulge_arc(top_r, pinch_r)
    lower_r_centre, lower_r_radius, lower_r_via = bulge_arc(pinch_r, BR)
    lower_l_centre, lower_l_radius, lower_l_via = bulge_arc(BL, pinch_l)
    upper_l_centre, upper_l_radius, upper_l_via = bulge_arc(pinch_l, top_l)

    return dict(
        hw=hw, hh=hh, A=A, T=frame_thickness,
        top_r=top_r, top_l=top_l, BR=BR, BL=BL, pinch_r=pinch_r, pinch_l=pinch_l,
        upper_r_centre=upper_r_centre, upper_r_radius=upper_r_radius, upper_r_via=upper_r_via,
        lower_r_centre=lower_r_centre, lower_r_radius=lower_r_radius, lower_r_via=lower_r_via,
        lower_l_centre=lower_l_centre, lower_l_radius=lower_l_radius, lower_l_via=lower_l_via,
        upper_l_centre=upper_l_centre, upper_l_radius=upper_l_radius, upper_l_via=upper_l_via,
        bulge_sag=(bulge if upper_r_centre is not None else None),
        top_width_frac=top_width_frac, pinch_reach_frac=pinch_reach_frac,
        bulge_frac=bulge_frac, pinch_height_frac=pinch_height_frac,
    )


def _arc_sweep_deg(centre, radius, p0, p1):
    """The MINOR-arc sweep angle (degrees) between `p0` and `p1` -- see t16_geometry._arc_sweep_deg's
    own docstring for why this is only meaningful below is_valid_outline's own sag<half_chord guard."""
    cx, cy = centre
    a0 = math.atan2(p0[1] - cy, p0[0] - cx)
    a1 = math.atan2(p1[1] - cy, p1[0] - cx)
    d = (a1 - a0) % (2 * math.pi)
    return min(d, 2 * math.pi - d) * 180.0 / math.pi


def is_valid_outline(o):
    """Structural validity, same scope as t16_geometry.is_valid_outline: every radius positive (or the
    shared degenerate-line case, in which there's no radius to check), the top and base each at least
    frame_thickness long, every sagitta-built arc's own sag strictly less than half its chord (the
    point where sagitta_circle's construction stops producing the intended bulge), no arc sweeps past
    180 deg (H23 item 63's own undercut guard), the pinch strictly between the board's own centreline
    and its own edge, and the top strictly positive and at most the board's own half-width. The "neck
    opening"/miter-collision concern the diagram script's own neckOpening() probed for by hand is
    covered generically once this template is registered -- frame-no-hooked-miters.test.js's own H23
    item 39 sweep (miterStaysInsideWood via frameMiters) runs against every FRAME_DEFS.templates entry
    automatically, the same way it already covers T16/T17 with no template-specific code there either."""
    t = o["T"]
    if o["pinch_r"][0] <= 0 or o["pinch_r"][0] >= o["hw"]:
        return False
    if o["A"] <= 0 or o["A"] > o["hw"]:
        return False

    def plen(p0, p1):
        return math.hypot(p1[0] - p0[0], p1[1] - p0[1])

    base_len = plen(o["BR"], o["BL"])
    top_len = plen(o["top_r"], o["top_l"])
    if min(base_len, top_len) < t:
        return False

    arcs = [
        (o["upper_r_centre"], o["upper_r_radius"], o["top_r"], o["pinch_r"]),
        (o["lower_r_centre"], o["lower_r_radius"], o["pinch_r"], o["BR"]),
        (o["lower_l_centre"], o["lower_l_radius"], o["BL"], o["pinch_l"]),
        (o["upper_l_centre"], o["upper_l_radius"], o["pinch_l"], o["top_l"]),
    ]
    if arcs[0][0] is None:
        # the shared degenerate-line case: every side a straight line, each must still clear frame_thickness.
        for _, _, p0, p1 in arcs:
            if plen(p0, p1) < t:
                return False
        return True
    sag = o["bulge_sag"]
    for centre, radius, p0, p1 in arcs:
        if radius <= 0:
            return False
        if sag >= plen(p0, p1) / 2.0:
            return False
        sweep = _arc_sweep_deg(centre, radius, p0, p1)
        if radius * math.radians(sweep) < t:
            return False
        if sweep >= 180.0:
            return False
    return True

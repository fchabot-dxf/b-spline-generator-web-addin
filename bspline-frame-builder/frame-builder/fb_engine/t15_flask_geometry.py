"""
t15_flask_geometry.py — Template 15 (Flask), F31 item 2b (dispatch 2026-10-03, diagram approved as
drawn, fb-app commit history, tools/repro/f31_item2_flask_diagram.mjs). A straight neck (two
vertical sides) meeting a dome that bulges OUTWARD and down to the flat base, a flat top closing
the neck. This module ports that script's own buildFlask()/bulgeArc() to Python via
fb_engine.closed_form_arc.sagitta_circle -- the SAME closed-form bulge construction T14/T16/T17
already use.

Six pieces, clockwise travel order starting at the top-right corner (matches the diagram's own
PIECE_NAMES): 0 neck_R, 1 dome_R, 2 base, 3 dome_L, 4 neck_L, 5 top.
Six corners: topR, neckBottomR, BR, BL, neckBottomL, topL.

UNLIKE T14/T16/T17, two of this template's own six corners (topR, topL) are plain straight-line-
meets-straight-line corners (top meets neck_R/neck_L) -- no circle touches them at all, so they
need the simpler, generic ResolveInnerCorners step (Template 7's own base_R/base_L pattern), not
ResolveLineCircleCorner. The other four (neckBottomR/neckBottomL, BR/BL) are a line meeting the
dome arc, same ResolveLineCircleCorner shape T14/T16 already use. No two arcs ever meet directly
here, so ResolveCircleCircleCorner is never needed (see sketches/template_15/phases/
p03_03_inner_corner_resolve.py).

Every joint is a MITER (no tangent chain): the dome arc stands alone, built from its own chord +
sagitta, no neighbour-tangency coupling to solve -- same structural class as T14/T16/T17.

Coordinates: INCHES, board-local, origin board CENTRE, y UP -- same safe-zone convention as
t14_sandtimer_geometry.py/t16_geometry.py (width_in/height_in here are the safe-zone dimensions,
already boundingboxoffset-subtracted).
"""
import math

from fb_engine.closed_form_arc import sagitta_circle, true_via_point

TOP_WIDTH_FRAC_DEFAULT = 0.45  # T84 item 4's own shared "topWidth" handle (basis hw): the neck is
# dead straight for its whole height, so "neck width" and "topWidth" are the SAME physical quantity
# (Fred, 2026-10-03) -- declared under the shared key, not a second name. Default as drawn.
NECK_HEIGHT_FRAC_DEFAULT = 0.45  # 0 = top edge, 1 = base edge (same sign convention as T14's own
# PINCH_HEIGHT_FRAC_DEFAULT / T16's own WAIST_HEIGHT_FRAC_DEFAULT), how far down the neck extends
# before the dome starts. Default as drawn.
DOME_FULLNESS_FRAC_DEFAULT = 0.1421885365451818  # the dome arc's own outward sagitta, a fraction of
# hw. NOT a guess: measured once (at 7x9, full precision, not the console log's rounded "0.1422") from
# the advisor's own "vertical tangent at base" construction (zero free parameters, reproduces Fred's
# approved render exactly) -- tools/repro/f31_item2_flask_diagram.mjs's own
# sagittaOfVerticalTangentArc() construction, re-evaluated at full precision. Generalised into a
# genuine handle (bulgeArc/sagitta_circle) around this default, same move Sand Timer's own bulge made.

_BULGE_EPS = 1e-9  # below this, the dome degenerates to a straight line (mirrors the diagram's own
# `bulgeArc`: `if (sag < 1e-9) return mkLine(p0, p1);`).

# ---------------------------------------------------------------------------
# Fusion SKETCH_2_PARAMETERS (named-parameter expression chains), same reasoning as
# fb_engine/t14_sandtimer_geometry.py's own comment: inlining a via point's own formula blows up to
# thousands of characters per coordinate, so the dome's own centre/radius/via chain is a NAMED
# Fusion parameter chain instead. Units: the *nx/*ny/*u0x/*u0y/*u1x/*u1y/*bx/*by/*blen entries are
# genuine dimensionless ratios (Unit="") -- declaring them "in" makes Fusion silently reject the
# assignment and leave the parameter stuck at its birth value 0.0 (fusion360-quirks skill).
#
# ONLY ONE independent chain is needed (dome_R's own, neckBottomR->BR) -- dome_L is the EXACT
# x-mirror of dome_R (verified numerically against outline() before being trusted here: neckBottomL/
# BL are themselves the exact x-mirror of neckBottomR/BR, and bulgeArc's own away-point is the same
# y on both sides) -- p02_02_loop.py's own Points just negate t15_dome_r_cx/t15_dome_r_vx inline,
# same convention as T14's own lower_L mirroring lower_R.
#
# CONFIRMED numerically (2026-10-03, before being trusted here, real resolved numbers at 7x9
# defaults): the plain `nx=-dy/chordlen, ny=dx/chordlen` formula (no away_point disambiguation, no
# conditional flip) already picks the OUTWARD normal for dome_R's own chord direction (neckBottomR
# -> BR) -- d_this_side (10.95) > d_mid (5.55) from the centreline away-point, so sagitta_circle's
# own flip condition never fires. Re-derived from first principles for THIS chord, not assumed from
# T14/T16's own (different) chord directions -- see sandTimerConstruction's own JS doc comment on
# why a sign carried across a different construction cannot be trusted without re-checking.
SKETCH_2_PARAMETERS = [
    {"Name": "t15_hw",            "Label": "t15_hw",            "Category": "T15 Geometry", "Val": "(widthIn/2 - boundingboxoffset)", "Unit": "in"},
    {"Name": "t15_hh",            "Label": "t15_hh",            "Category": "T15 Geometry", "Val": "(heightIn/2 - boundingboxoffset)", "Unit": "in"},
    {"Name": "t15_nw",            "Label": "t15_nw",            "Category": "T15 Geometry", "Val": f"{TOP_WIDTH_FRAC_DEFAULT}*t15_hw", "Unit": "in"},
    {"Name": "t15_neckBottomY",   "Label": "t15_neckBottomY",   "Category": "T15 Geometry", "Val": f"t15_hh - {NECK_HEIGHT_FRAC_DEFAULT}*2*t15_hh", "Unit": "in"},
    {"Name": "t15_bulge",         "Label": "t15_bulge",         "Category": "T15 Geometry", "Val": f"{DOME_FULLNESS_FRAC_DEFAULT}*t15_hw", "Unit": "in"},

    # dome_R: chord neckBottomR=(nw, neckBottomY) -> BR=(hw, -hh).
    {"Name": "t15_dr_dx",         "Label": "t15_dr_dx",         "Category": "T15 Geometry", "Val": "t15_hw - t15_nw", "Unit": "in"},
    {"Name": "t15_dr_dy",         "Label": "t15_dr_dy",         "Category": "T15 Geometry", "Val": "(-t15_hh) - t15_neckBottomY", "Unit": "in"},
    {"Name": "t15_dr_chordlen",   "Label": "t15_dr_chordlen",   "Category": "T15 Geometry", "Val": "sqrt(t15_dr_dx*t15_dr_dx + t15_dr_dy*t15_dr_dy)", "Unit": "in"},
    {"Name": "t15_dr_nx",         "Label": "t15_dr_nx",         "Category": "T15 Geometry", "Val": "-t15_dr_dy / t15_dr_chordlen", "Unit": ""},
    {"Name": "t15_dr_ny",         "Label": "t15_dr_ny",         "Category": "T15 Geometry", "Val": "t15_dr_dx / t15_dr_chordlen", "Unit": ""},
    {"Name": "t15_dr_halfchord",  "Label": "t15_dr_halfchord",  "Category": "T15 Geometry", "Val": "t15_dr_chordlen/2", "Unit": "in"},
    {"Name": "t15_dr_r",          "Label": "t15_dr_r",          "Category": "T15 Geometry", "Val": "(t15_dr_halfchord*t15_dr_halfchord + t15_bulge*t15_bulge)/(2*t15_bulge)", "Unit": "in"},
    {"Name": "t15_dr_cx",         "Label": "t15_dr_cx",         "Category": "T15 Geometry", "Val": "(t15_nw + t15_hw)/2 + t15_dr_nx*(t15_bulge - t15_dr_r)", "Unit": "in"},
    {"Name": "t15_dr_cy",         "Label": "t15_dr_cy",         "Category": "T15 Geometry", "Val": "(t15_neckBottomY + (-t15_hh))/2 + t15_dr_ny*(t15_bulge - t15_dr_r)", "Unit": "in"},
    {"Name": "t15_dr_u0x",        "Label": "t15_dr_u0x",        "Category": "T15 Geometry", "Val": "(t15_nw - t15_dr_cx)/t15_dr_r", "Unit": ""},
    {"Name": "t15_dr_u0y",        "Label": "t15_dr_u0y",        "Category": "T15 Geometry", "Val": "(t15_neckBottomY - t15_dr_cy)/t15_dr_r", "Unit": ""},
    {"Name": "t15_dr_u1x",        "Label": "t15_dr_u1x",        "Category": "T15 Geometry", "Val": "(t15_hw - t15_dr_cx)/t15_dr_r", "Unit": ""},
    {"Name": "t15_dr_u1y",        "Label": "t15_dr_u1y",        "Category": "T15 Geometry", "Val": "((-t15_hh) - t15_dr_cy)/t15_dr_r", "Unit": ""},
    {"Name": "t15_dr_bx",         "Label": "t15_dr_bx",         "Category": "T15 Geometry", "Val": "t15_dr_u0x + t15_dr_u1x", "Unit": ""},
    {"Name": "t15_dr_by",         "Label": "t15_dr_by",         "Category": "T15 Geometry", "Val": "t15_dr_u0y + t15_dr_u1y", "Unit": ""},
    {"Name": "t15_dr_blen",       "Label": "t15_dr_blen",       "Category": "T15 Geometry", "Val": "sqrt(t15_dr_bx*t15_dr_bx + t15_dr_by*t15_dr_by)", "Unit": ""},
    {"Name": "t15_dr_vx",         "Label": "t15_dr_vx",         "Category": "T15 Geometry", "Val": "t15_dr_cx + t15_dr_r*(t15_dr_bx/t15_dr_blen)", "Unit": "in"},
    {"Name": "t15_dr_vy",         "Label": "t15_dr_vy",         "Category": "T15 Geometry", "Val": "t15_dr_cy + t15_dr_r*(t15_dr_by/t15_dr_blen)", "Unit": "in"},
]


def outline(width_in, height_in, frame_thickness,
            top_width_frac=TOP_WIDTH_FRAC_DEFAULT,
            neck_height_frac=NECK_HEIGHT_FRAC_DEFAULT,
            dome_fullness_frac=DOME_FULLNESS_FRAC_DEFAULT):
    """The full outline (6 pieces) plus the dome arc's own (centre, radius, via point). Mirrors
    tools/repro/f31_item2_flask_diagram.mjs's own buildFlask()/bulgeArc() exactly (ported from JS to
    Python via the shared sagitta_circle primitive, Y-UP re-derived from first principles -- NOT a
    sign-flipped copy of the diagram's own Y-DOWN formulas)."""
    hw, hh = width_in / 2.0, height_in / 2.0
    nw = hw * top_width_frac
    neck_bottom_y = hh - neck_height_frac * 2.0 * hh
    bulge = hw * dome_fullness_frac

    top_r = (nw, hh)
    top_l = (-nw, hh)
    BR = (hw, -hh)
    BL = (-hw, -hh)
    neck_bottom_r = (nw, neck_bottom_y)
    neck_bottom_l = (-nw, neck_bottom_y)

    if bulge <= _BULGE_EPS:
        dome_r_centre = dome_r_radius = dome_r_via = None
    else:
        away = (0.0, (neck_bottom_r[1] + BR[1]) / 2.0)  # the chord's own midpoint y, on the centreline
        dome_r_centre, dome_r_radius = sagitta_circle(neck_bottom_r, BR, bulge, away_point=away)
        dome_r_via = true_via_point(dome_r_centre, dome_r_radius, neck_bottom_r, BR)

    return dict(
        hw=hw, hh=hh, T=frame_thickness,
        top_r=top_r, top_l=top_l, BR=BR, BL=BL,
        neck_bottom_r=neck_bottom_r, neck_bottom_l=neck_bottom_l,
        dome_r_centre=dome_r_centre, dome_r_radius=dome_r_radius, dome_r_via=dome_r_via,
        dome_sag=(bulge if dome_r_centre is not None else None),
        top_width_frac=top_width_frac, neck_height_frac=neck_height_frac,
        dome_fullness_frac=dome_fullness_frac,
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
    """Structural validity, same scope as t14_sandtimer_geometry.is_valid_outline: the neck's own
    half-width strictly positive and inside the board, the neck-bottom strictly between the top and
    base edges, the top/base each at least frame_thickness long, the dome's own sagitta strictly
    less than half its chord (sagitta_circle's own degenerate-case threshold), its radius positive,
    and no arc sweeping past 180 deg (H23 item 63's own undercut guard). The "miters colliding"
    concern (a too-thick frame against a too-short neck/dome) is covered generically once this
    template is registered -- frame-no-hooked-miters.test.js's own H23 item 39 sweep runs against
    every FRAME_DEFS.templates entry automatically, same as T14/T16/T17."""
    t = o["T"]
    if o["top_r"][0] <= 0 or o["top_r"][0] >= o["hw"]:
        return False
    if not (-o["hh"] < o["neck_bottom_r"][1] < o["hh"]):
        return False

    def plen(p0, p1):
        return math.hypot(p1[0] - p0[0], p1[1] - p0[1])

    base_len = plen(o["BR"], o["BL"])
    top_len = plen(o["top_r"], o["top_l"])
    neck_len = plen(o["top_r"], o["neck_bottom_r"])
    if min(base_len, top_len, neck_len) < t:
        return False

    if o["dome_r_centre"] is None:
        return plen(o["neck_bottom_r"], o["BR"]) >= t

    sag = o["dome_sag"]
    centre, radius = o["dome_r_centre"], o["dome_r_radius"]
    p0, p1 = o["neck_bottom_r"], o["BR"]
    if radius <= 0:
        return False
    chord = plen(p0, p1)
    if sag >= chord / 2.0:
        return False
    sweep = _arc_sweep_deg(centre, radius, p0, p1)
    if radius * math.radians(sweep) < t:
        return False
    if sweep >= 180.0:
        return False
    return True

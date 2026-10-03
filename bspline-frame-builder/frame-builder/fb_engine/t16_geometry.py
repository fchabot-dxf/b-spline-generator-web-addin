"""
t16_geometry.py — Templates 16 (Arched Funnel) and 17 (Tulip), T84 item 3. Shared closed-form outline:
an arch (ONE continuous piece, Fred-approved 2026-10-03, so 6 bars not 7 -- the apex is a tangent point,
never a corner), straight-or-concave upper sides tapering to a waist, two outward-bulging lower curves,
a flat base. Template 16 = straight upper sides (upper_curve_frac=0); Template 17 = concave upper sides
(upper_curve_frac>0) -- the SAME outline() function builds both, exactly mirroring
tools/repro/t84_items1_2_archedfunnel_tulip_diagram.mjs's own `buildArchedTimer`/`bulgeArc` (the
Fred-approved diagram, commit 19f7bbb; defaults as drawn there).

UNLIKE t7_geometry.py/t11_geometry.py, there is no tangent chain here at all: every one of the 6 joints
(arch-to-side x2, side-to-waist x2, waist... no -- base corners x2) is a MITER, so each piece's own arc
is independently defined by its own CHORD + SAGITTA (fb_engine.closed_form_arc.sagitta_circle) with no
neighbour-tangency coupling to solve. That also means no `clamp_*_handles` blend-search is needed --
unlike T11's own several COUPLED parameters, each of this template's own handles is independently safe
across its own declared range (the app's own range function enforces the per-handle bounds; see
is_valid_outline below for the one thing that DOES need checking per combination: the undercut guard, H23
item 63, no outline arc may sweep past 180 degrees).

Coordinates: INCHES, board-local, origin board CENTRE, y UP (Fusion's own sketch convention, SAME as
t7_geometry.py/t11_geometry.py's own "safe-zone half-width/height" frame -- width_in/height_in here are
the SAFE-ZONE dimensions, i.e. already boundingboxoffset-subtracted, matching t11_geometry.t11_outline's
own convention: the Fusion phase file's own literal expressions separately compute
`(widthIn/2 - boundingboxoffset)`, this module's callers (tests) pass that same already-subtracted value).

Six pieces, clockwise travel order starting at the top-right (matches the Fusion phase file's own loop):
  0 upper_R, 1 lower_R, 2 base, 3 lower_L, 4 upper_L, 5 arch
Six corners: topR, waistR, BR, BL, waistL, topL.
"""
import math

from fb_engine.closed_form_arc import sagitta_circle, true_via_point

TOP_WIDTH_FRAC_DEFAULT = 0.75  # T84 item 4 (Fred-approved): the shared "topWidth" handle (basis
# "hw", same key seat C's own Sand Timer/Flask use) -- a half-width fraction of hw, same convention
# as waist_width_frac. Default = the current drawn top width (the value this constant held BEFORE
# item 4, when it was still a fixed, non-handle proportion named ARCH_HALF_SPAN_FRAC).

# Fred-approved defaults (diagram commit 19f7bbb), all fractions of hw except waist_height_frac (fraction
# of the full safe height, 0=top edge 1=bottom edge, matching F31 item 1's own pinchHeightFrac convention).
ARCH_RISE_FRAC_DEFAULT = 0.39
WAIST_WIDTH_FRAC_DEFAULT = 0.38
WAIST_HEIGHT_FRAC_DEFAULT = 0.55
BULGE_FRAC_DEFAULT = 0.169
UPPER_CURVE_FRAC_DEFAULT = 0.0  # Template 16's own default (straight sides); Template 17 overrides this
# T17's own default (concave upper sides). The diagram script (tools/repro/t84_items1_2_
# archedfunnel_tulip_diagram.mjs) computed a DIFFERENT "55% of max-clean" value per board size
# (0.145/0.175/0.208 at 6x9/7x9/9x12 -- the max-clean value itself grows with board size, 0.264 ->
# 0.378, so a single fraction of hw can't match all three at once) -- a template needs ONE value,
# so this uses 7x9's own (this codebase's established canonical default-parameter board size,
# SKETCH_1_PARAMETERS' own Val), confirmed comfortably inside 6x9's own tighter max (0.175 vs
# 0.264, ~34% margin) rather than re-deriving a bespoke cross-size compromise.
T17_UPPER_CURVE_FRAC_DEFAULT = 0.175

# ---------------------------------------------------------------------------
# Shared Fusion SKETCH_2_PARAMETERS (named-parameter expression chains), used by BOTH templates'
# own template_data.py -- declared ONCE here rather than copy-pasted into each (T16/T17 share the
# lower half -- arch/lower_R/lower_L/base -- verbatim; T17 alone adds the upper-arc chain below).
# Inlined, a via point's own formula (which references its own circle's centre, which references
# its own radius, which references the chord -- each substituted in by hand) blows up to ~9,200
# characters per coordinate (measured) -- the same blowup class T7's own SKETCH_2_PARAMETERS
# comment already warns about -- so every arc's own centre/radius/via chain is a NAMED Fusion
# parameter chain instead. Units: the *nx/*ny/*u0x/*u0y/*u1x/*u1y/*bx/*by/*blen entries are genuine
# dimensionless ratios (Unit="") -- the SAME "a userParameter's .expression assignment enforces
# dimensional consistency" quirk T7's own comment already found (fusion360-quirks skill): declaring
# these "in" instead would make Fusion silently reject the assignment and leave the parameter stuck
# at its birth value 0.0.
#
# The two lower bulges (waistR->BR, BL->waistL) bulge OUTWARD; lower_L is the exact x-mirror of
# lower_R (verified numerically against outline() at 3 board sizes) -- no separate named chain for
# it, its own p02_02_loop.py Points just negate t16_lr_vx.
SHARED_LOWER_SKETCH_2_PARAMETERS = [
    {"Name": "t16_hw",            "Label": "t16_hw",            "Category": "T16 Geometry", "Val": "(widthIn/2 - boundingboxoffset)", "Unit": "in"},
    {"Name": "t16_hh",            "Label": "t16_hh",            "Category": "T16 Geometry", "Val": "(heightIn/2 - boundingboxoffset)", "Unit": "in"},
    {"Name": "t16_ww",            "Label": "t16_ww",            "Category": "T16 Geometry", "Val": f"{WAIST_WIDTH_FRAC_DEFAULT}*t16_hw", "Unit": "in"},
    {"Name": "t16_wy",            "Label": "t16_wy",            "Category": "T16 Geometry", "Val": f"t16_hh*(1 - 2*{WAIST_HEIGHT_FRAC_DEFAULT})", "Unit": "in"},
    {"Name": "t16_bulge",         "Label": "t16_bulge",         "Category": "T16 Geometry", "Val": f"{BULGE_FRAC_DEFAULT}*t16_hw", "Unit": "in"},
    {"Name": "t16_lr_dx",         "Label": "t16_lr_dx",         "Category": "T16 Geometry", "Val": "t16_hw - t16_ww", "Unit": "in"},
    {"Name": "t16_lr_dy",         "Label": "t16_lr_dy",         "Category": "T16 Geometry", "Val": "(-t16_hh) - t16_wy", "Unit": "in"},
    {"Name": "t16_lr_chordlen",   "Label": "t16_lr_chordlen",   "Category": "T16 Geometry", "Val": "sqrt(t16_lr_dx*t16_lr_dx + t16_lr_dy*t16_lr_dy)", "Unit": "in"},
    {"Name": "t16_lr_nx",         "Label": "t16_lr_nx",         "Category": "T16 Geometry", "Val": "-t16_lr_dy / t16_lr_chordlen", "Unit": ""},
    {"Name": "t16_lr_ny",         "Label": "t16_lr_ny",         "Category": "T16 Geometry", "Val": "t16_lr_dx / t16_lr_chordlen", "Unit": ""},
    {"Name": "t16_lr_halfchord",  "Label": "t16_lr_halfchord",  "Category": "T16 Geometry", "Val": "t16_lr_chordlen/2", "Unit": "in"},
    {"Name": "t16_lr_r",          "Label": "t16_lr_r",          "Category": "T16 Geometry", "Val": "(t16_lr_halfchord*t16_lr_halfchord + t16_bulge*t16_bulge)/(2*t16_bulge)", "Unit": "in"},
    {"Name": "t16_lr_cx",         "Label": "t16_lr_cx",         "Category": "T16 Geometry", "Val": "(t16_ww + t16_hw)/2 + t16_lr_nx*(t16_bulge - t16_lr_r)", "Unit": "in"},
    {"Name": "t16_lr_cy",         "Label": "t16_lr_cy",         "Category": "T16 Geometry", "Val": "(t16_wy + (-t16_hh))/2 + t16_lr_ny*(t16_bulge - t16_lr_r)", "Unit": "in"},
    {"Name": "t16_lr_u0x",        "Label": "t16_lr_u0x",        "Category": "T16 Geometry", "Val": "(t16_ww - t16_lr_cx)/t16_lr_r", "Unit": ""},
    {"Name": "t16_lr_u0y",        "Label": "t16_lr_u0y",        "Category": "T16 Geometry", "Val": "(t16_wy - t16_lr_cy)/t16_lr_r", "Unit": ""},
    {"Name": "t16_lr_u1x",        "Label": "t16_lr_u1x",        "Category": "T16 Geometry", "Val": "(t16_hw - t16_lr_cx)/t16_lr_r", "Unit": ""},
    {"Name": "t16_lr_u1y",        "Label": "t16_lr_u1y",        "Category": "T16 Geometry", "Val": "((-t16_hh) - t16_lr_cy)/t16_lr_r", "Unit": ""},
    {"Name": "t16_lr_bx",         "Label": "t16_lr_bx",         "Category": "T16 Geometry", "Val": "t16_lr_u0x + t16_lr_u1x", "Unit": ""},
    {"Name": "t16_lr_by",         "Label": "t16_lr_by",         "Category": "T16 Geometry", "Val": "t16_lr_u0y + t16_lr_u1y", "Unit": ""},
    {"Name": "t16_lr_blen",       "Label": "t16_lr_blen",       "Category": "T16 Geometry", "Val": "sqrt(t16_lr_bx*t16_lr_bx + t16_lr_by*t16_lr_by)", "Unit": ""},
    {"Name": "t16_lr_vx",         "Label": "t16_lr_vx",         "Category": "T16 Geometry", "Val": "t16_lr_cx + t16_lr_r*(t16_lr_bx/t16_lr_blen)", "Unit": "in"},
    {"Name": "t16_lr_vy",         "Label": "t16_lr_vy",         "Category": "T16 Geometry", "Val": "t16_lr_cy + t16_lr_r*(t16_lr_by/t16_lr_blen)", "Unit": "in"},
]

# T17-only: the concave upper-right arc (topR->waistR), named analogously to t16_lr_* above but
# with the FLIPPED normal sign sagitta_circle's own `away_point` disambiguation resolves to for
# THIS chord (verified numerically against outline()'s own upper_r_centre/via at 3 board sizes,
# upper_curve_frac=T17_UPPER_CURVE_FRAC_DEFAULT, before being trusted here) -- the concave bulge
# pulls INWARD toward the centreline, the opposite side from the lower bulges' own outward pull,
# so the SAME "-dy/chordlen, dx/chordlen" formula would place the centre on the wrong side. upper_L
# is the exact x-mirror (verified the same way) -- no separate named chain for it either.
_TOP_X = f"{TOP_WIDTH_FRAC_DEFAULT}*t16_hw"
_TOP_Y = f"t16_hh - {ARCH_RISE_FRAC_DEFAULT}*t16_hw"
UPPER_ARC_SKETCH_2_PARAMETERS = [
    {"Name": "t17_upper",      "Label": "t17_upper",      "Category": "T17 Geometry", "Val": f"{T17_UPPER_CURVE_FRAC_DEFAULT}*t16_hw", "Unit": "in"},
    {"Name": "t17_ur_dx",      "Label": "t17_ur_dx",      "Category": "T17 Geometry", "Val": f"t16_ww - ({_TOP_X})", "Unit": "in"},
    {"Name": "t17_ur_dy",     "Label": "t17_ur_dy",      "Category": "T17 Geometry", "Val": f"t16_wy - ({_TOP_Y})", "Unit": "in"},
    {"Name": "t17_ur_chordlen", "Label": "t17_ur_chordlen", "Category": "T17 Geometry", "Val": "sqrt(t17_ur_dx*t17_ur_dx + t17_ur_dy*t17_ur_dy)", "Unit": "in"},
    {"Name": "t17_ur_nx",      "Label": "t17_ur_nx",      "Category": "T17 Geometry", "Val": "t17_ur_dy / t17_ur_chordlen", "Unit": ""},
    {"Name": "t17_ur_ny",      "Label": "t17_ur_ny",      "Category": "T17 Geometry", "Val": "-t17_ur_dx / t17_ur_chordlen", "Unit": ""},
    {"Name": "t17_ur_halfchord", "Label": "t17_ur_halfchord", "Category": "T17 Geometry", "Val": "t17_ur_chordlen/2", "Unit": "in"},
    {"Name": "t17_ur_r",       "Label": "t17_ur_r",       "Category": "T17 Geometry", "Val": "(t17_ur_halfchord*t17_ur_halfchord + t17_upper*t17_upper)/(2*t17_upper)", "Unit": "in"},
    {"Name": "t17_ur_cx",      "Label": "t17_ur_cx",      "Category": "T17 Geometry", "Val": f"(({_TOP_X}) + t16_ww)/2 + t17_ur_nx*(t17_upper - t17_ur_r)", "Unit": "in"},
    {"Name": "t17_ur_cy",      "Label": "t17_ur_cy",      "Category": "T17 Geometry", "Val": f"(({_TOP_Y}) + t16_wy)/2 + t17_ur_ny*(t17_upper - t17_ur_r)", "Unit": "in"},
    {"Name": "t17_ur_u0x",     "Label": "t17_ur_u0x",     "Category": "T17 Geometry", "Val": f"(({_TOP_X}) - t17_ur_cx)/t17_ur_r", "Unit": ""},
    {"Name": "t17_ur_u0y",     "Label": "t17_ur_u0y",     "Category": "T17 Geometry", "Val": f"(({_TOP_Y}) - t17_ur_cy)/t17_ur_r", "Unit": ""},
    {"Name": "t17_ur_u1x",     "Label": "t17_ur_u1x",     "Category": "T17 Geometry", "Val": "(t16_ww - t17_ur_cx)/t17_ur_r", "Unit": ""},
    {"Name": "t17_ur_u1y",     "Label": "t17_ur_u1y",     "Category": "T17 Geometry", "Val": "(t16_wy - t17_ur_cy)/t17_ur_r", "Unit": ""},
    {"Name": "t17_ur_bx",      "Label": "t17_ur_bx",      "Category": "T17 Geometry", "Val": "t17_ur_u0x + t17_ur_u1x", "Unit": ""},
    {"Name": "t17_ur_by",      "Label": "t17_ur_by",      "Category": "T17 Geometry", "Val": "t17_ur_u0y + t17_ur_u1y", "Unit": ""},
    {"Name": "t17_ur_blen",    "Label": "t17_ur_blen",    "Category": "T17 Geometry", "Val": "sqrt(t17_ur_bx*t17_ur_bx + t17_ur_by*t17_ur_by)", "Unit": ""},
    {"Name": "t17_ur_vx",      "Label": "t17_ur_vx",      "Category": "T17 Geometry", "Val": "t17_ur_cx + t17_ur_r*(t17_ur_bx/t17_ur_blen)", "Unit": "in"},
    {"Name": "t17_ur_vy",      "Label": "t17_ur_vy",      "Category": "T17 Geometry", "Val": "t17_ur_cy + t17_ur_r*(t17_ur_by/t17_ur_blen)", "Unit": "in"},
]


def outline(width_in, height_in, frame_thickness,
            top_width_frac=TOP_WIDTH_FRAC_DEFAULT,
            arch_rise_frac=ARCH_RISE_FRAC_DEFAULT,
            waist_width_frac=WAIST_WIDTH_FRAC_DEFAULT,
            waist_height_frac=WAIST_HEIGHT_FRAC_DEFAULT,
            bulge_frac=BULGE_FRAC_DEFAULT,
            upper_curve_frac=UPPER_CURVE_FRAC_DEFAULT):
    """The full right-half outline (mirror x for the left) plus every arc's own (centre, radius, via
    point). Returns a dict with every key point, the per-arc circles, and each corner's own outer point
    (for the inner-corner resolvers to reference by name)."""
    hw, hh = width_in / 2.0, height_in / 2.0
    A = hw * top_width_frac
    rise = hw * arch_rise_frac
    ww = hw * waist_width_frac
    wy = hh - waist_height_frac * 2.0 * hh
    bulge = hw * bulge_frac
    upper_curve = hw * upper_curve_frac

    top_r = (A, hh - rise)
    top_l = (-A, hh - rise)
    apex = (0.0, hh)
    waist_r = (ww, wy)
    waist_l = (-ww, wy)
    BR = (hw, -hh)
    BL = (-hw, -hh)

    # Arch: symmetric by construction (top_l/top_r share y, apex is the chord's own perpendicular bisector
    # point) -- the via point IS the apex exactly, no sagitta_circle call needed for this one piece; still
    # compute (centre, radius) via sagitta_circle for the validity/undercut checks and the resolver steps'
    # own live reads don't need it, but tests do (verifying apex == true_via_point independently).
    arch_centre, arch_radius = sagitta_circle(top_l, top_r, rise, away_point=(0.0, -hh))
    arch_via = true_via_point(arch_centre, arch_radius, top_l, top_r)

    # Lower bulges: waist -> base corner, bulging OUTWARD (away from the centreline).
    lower_r_centre, lower_r_radius = sagitta_circle(waist_r, BR, bulge, away_point=(0.0, (wy + BR[1]) / 2.0))
    lower_r_via = true_via_point(lower_r_centre, lower_r_radius, waist_r, BR)
    lower_l_centre, lower_l_radius = sagitta_circle(BL, waist_l, bulge, away_point=(0.0, (BL[1] + wy) / 2.0))
    lower_l_via = true_via_point(lower_l_centre, lower_l_radius, BL, waist_l)

    # Upper sides: straight (Template 16, upper_curve_frac=0 -> bulge=0, a degenerate "circle" we never
    # build) or concave (Template 17), bulging AWAY from a point far outside the board's own edge, which
    # pulls the arc INWARD toward the centreline (the Fusion phase file only builds an Arc3Point when
    # upper_curve_frac>0; at 0 it's a plain Line, matching bulgeArc's own sag<1e-9 -> straight-line
    # identity this whole design is built on).
    if upper_curve > 1e-9:
        upper_r_centre, upper_r_radius = sagitta_circle(top_r, waist_r, upper_curve, away_point=(hw * 3.0, (top_r[1] + wy) / 2.0))
        upper_r_via = true_via_point(upper_r_centre, upper_r_radius, top_r, waist_r)
        upper_l_centre, upper_l_radius = sagitta_circle(waist_l, top_l, upper_curve, away_point=(-hw * 3.0, (wy + top_l[1]) / 2.0))
        upper_l_via = true_via_point(upper_l_centre, upper_l_radius, waist_l, top_l)
    else:
        upper_r_centre = upper_r_radius = upper_r_via = None
        upper_l_centre = upper_l_radius = upper_l_via = None

    return dict(
        hw=hw, hh=hh, A=A, T=frame_thickness,
        top_r=top_r, top_l=top_l, apex=apex, waist_r=waist_r, waist_l=waist_l, BR=BR, BL=BL,
        arch_centre=arch_centre, arch_radius=arch_radius, arch_via=arch_via, arch_sag=rise,
        lower_r_centre=lower_r_centre, lower_r_radius=lower_r_radius, lower_r_via=lower_r_via, lower_r_sag=bulge,
        lower_l_centre=lower_l_centre, lower_l_radius=lower_l_radius, lower_l_via=lower_l_via, lower_l_sag=bulge,
        upper_r_centre=upper_r_centre, upper_r_radius=upper_r_radius, upper_r_via=upper_r_via,
        upper_l_centre=upper_l_centre, upper_l_radius=upper_l_radius, upper_l_via=upper_l_via,
        upper_r_sag=(upper_curve if upper_r_centre is not None else None),
        upper_l_sag=(upper_curve if upper_l_centre is not None else None),
        upper_curve_frac=upper_curve_frac,
    )


def _arc_sweep_deg(centre, radius, p0, p1):
    """The MINOR-arc sweep angle (degrees) between `p0` and `p1` on the circle (`centre`, `radius`) --
    only meaningful for an arc whose sagitta is < half its own chord length (is_valid_outline's own
    `sag < half_chord` check): beyond that threshold `true_via_point` no longer returns the geometrically
    intended bulge point at all (it stays pinned to the minor-arc bisector), so a minor-arc sweep computed
    here would describe the wrong curve, not a large-but-valid one. is_valid_outline screens that case out
    before trusting this function's result."""
    cx, cy = centre
    a0 = math.atan2(p0[1] - cy, p0[0] - cx)
    a1 = math.atan2(p1[1] - cy, p1[0] - cx)
    d = (a1 - a0) % (2 * math.pi)
    return min(d, 2 * math.pi - d) * 180.0 / math.pi


def is_valid_outline(o):
    """Structural validity: every radius positive, every piece at least frame_thickness long, every
    sagitta-built arc's own sag strictly less than half its chord (the point where sagitta_circle's
    construction stops producing the intended bulge -- see _arc_sweep_deg), no arc sweeps past 180 deg
    (H23 item 63's own undercut guard), the waist strictly between the two base corners (never crossing
    the centreline or overshooting the board edge)."""
    t = o["T"]
    if not (o["arch_radius"] > 0 and o["lower_r_radius"] > 0 and o["lower_l_radius"] > 0):
        return False
    if o["upper_r_radius"] is not None and not (o["upper_r_radius"] > 0 and o["upper_l_radius"] > 0):
        return False
    if o["waist_r"][0] <= 0 or o["waist_r"][0] >= o["hw"]:
        return False
    if o["A"] <= 0 or o["A"] >= o["hw"]:
        return False

    def plen(p0, p1):
        return math.hypot(p1[0] - p0[0], p1[1] - p0[1])

    straight_lens = [plen(o["BR"], o["BL"])]
    if o["upper_r_centre"] is None:
        straight_lens += [plen(o["top_r"], o["waist_r"]), plen(o["waist_l"], o["top_l"])]
    if min(straight_lens) < t:
        return False

    arcs = [(o["arch_centre"], o["arch_radius"], o["top_l"], o["top_r"], o["arch_sag"]),
            (o["lower_r_centre"], o["lower_r_radius"], o["waist_r"], o["BR"], o["lower_r_sag"]),
            (o["lower_l_centre"], o["lower_l_radius"], o["BL"], o["waist_l"], o["lower_l_sag"])]
    if o["upper_r_centre"] is not None:
        arcs += [(o["upper_r_centre"], o["upper_r_radius"], o["top_r"], o["waist_r"], o["upper_r_sag"]),
                 (o["upper_l_centre"], o["upper_l_radius"], o["waist_l"], o["top_l"], o["upper_l_sag"])]
    for centre, radius, p0, p1, sag in arcs:
        if sag >= plen(p0, p1) / 2.0:
            return False
        sweep = _arc_sweep_deg(centre, radius, p0, p1)
        if radius * math.radians(sweep) < t:
            return False
        if sweep >= 180.0:
            return False
    return True

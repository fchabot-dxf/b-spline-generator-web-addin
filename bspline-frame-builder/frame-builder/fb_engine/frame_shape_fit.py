"""
frame_shape_fit.py — FB-APP S4 (F8): each template's app shape MODEL, fitted
from the live-recorded Fusion goldens (tests/fixtures/frame-parity, written by
tools/repro/record_frame_parity.py). The goldens are the declared ground
truth; nothing is hand-copied. Pure, stdlib only; run by tools/gen_frame_defs.py.

Why a model and not fixed fractions (MEASURED F6/F8): Fusion's solve is not
scale-invariant. T1's pinch depth / hw is 0.32 at 7x9, 0.24 at 12x6 and 0.18
at 5.51x1.97, so one fraction set cannot match every board (12x6 was 0.44 in
off). The radii follow the templates' own seed radius (heightIn/14 = hh/7):
the fitted radius coefficients come out at ~0.142-0.147 * hh.

Model: every feature = b_hw * hw + b_hh * hh (scale-covariant, safe-zone half
sizes in inches), least squares over the valid goldens. With 3+ sizes the
residuals are a real check; with 2 the fit is exact at both (stated in the
emitted `fit` block).
"""
import glob
import json
import math
import os


def _safe_half(meta, bbo=0.25):
    return meta["widthIn"] / 2 - bbo, meta["heightIn"] / 2 - bbo


def _hourglass(curves, hw, hh, tol=2e-3):
    sh, wa, hp = curves["arc_shoulder_R"], curves["arc_waist_R"], curves["arc_hip_R"]
    rs = (sh["radius"] + hp["radius"]) / 2
    ok = (abs(sh["center"][0] - (hw - sh["radius"])) < tol
          and abs(math.dist(sh["center"], wa["center"]) - (sh["radius"] + wa["radius"])) < tol)
    wy = wa["center"][1]
    return ok, {
        # The pinch depth. Tangency couples it to the radii (d = S +/- sqrt(S^2 - notch^2)),
        # so the app DERIVES depth from notch + radii and uses this fitted value only
        # to pick the root (a fitted depth on its own can land where no tangency exists:
        # MEASURED at 5.51x1.97).
        "depth": hw - (wa["center"][0] - wa["radius"]),
        "cornerR": rs,                                    # shoulder/hip radius (Fusion keeps them Equal)
        "waistR": wa["radius"],
        "waistCy": -wy,                                   # app is y-down; Fusion is y-up
        # shoulder/hip centre height above/below the waist centre (the skeleton pins drive it)
        "notch": ((sh["center"][1] - wy) + (wy - hp["center"][1])) / 2,
    }


def _bottle(curves, hw, hh, tol=2e-3):
    nk, bd, top = curves["arc_waist_R"], curves["arc_hip_R"], curves["top_edge"]
    nhw = abs(top["end"][0])
    ok = (abs(bd["center"][0] - (hw - bd["radius"])) < tol
          and abs(math.dist(nk["center"], bd["center"]) - (nk["radius"] + bd["radius"])) < tol)
    return ok, {
        "neckHalfW": nhw,
        "neckR": nk["radius"],
        "neckTop": hh - nk["center"][1],  # neck arc centre, measured down from the top edge
        "bodyR": bd["radius"],
    }


def _bottle_taper(curves, hw, hh, tol=2e-3):
    """F30 item 3 (Template 13, Narrow Neck + taper): Template 2's own `top["end"][0]` reads the TAPERED top
    edge's own half width, not the neck circle's own untapered half width (`neckHalfW` = `skelX - radiusNeck`,
    an app-internal quantity the construction then re-tapers itself) -- the two coincide only at taperAngle 0,
    which is why plain `_bottle` silently measured the wrong thing here (MEASURED, 7x9: 1.79in from the tapered
    top edge vs the true 1.989in from the neck circle, a ~0.2in error that showed up as a real S4 parity failure,
    not a tolerance nuisance). Otherwise identical to `_bottle`: the body-tangent-at-hw and neck/body-tangency
    checks are both properties of the UNTAPERED circles themselves, unaffected by the top horn's own slant."""
    nk, bd = curves["arc_waist_R"], curves["arc_hip_R"]
    ok = (abs(bd["center"][0] - (hw - bd["radius"])) < tol
          and abs(math.dist(nk["center"], bd["center"]) - (nk["radius"] + bd["radius"])) < tol)
    return ok, {
        "neckHalfW": nk["center"][0] - nk["radius"],
        "neckR": nk["radius"],
        "neckTop": hh - nk["center"][1],
        "bodyR": bd["radius"],
    }


def _hourglass_narrow_top(curves, hw, hh, tol=2e-3):
    """T3 TAPERED HOURGLASS: the hourglass with its top horns `topInset` in from the edge.

    Template 1's extractor assumes BOTH corners are tangent to a horn at hw and averages the shoulder and hip
    (cornerR, notch). With a narrow top only the HIP side keeps that geometry, so: validity = the hip tangent to
    the side at hw, the shoulder tangent to its own (narrow) top horn, and both corners tangent to the waist;
    `cornerR` / `notch` are the hip's (the full-width side the app's depth root is picked for,
    paramsFromShapeModel), and the shoulder is a feature of its own (`cornerRTop`), with the top inset
    measured off the top edge's own end.
    """
    sh, wa, hp, top = curves["arc_shoulder_R"], curves["arc_waist_R"], curves["arc_hip_R"], curves["top_edge"]
    top_x = max(abs(top["start"][0]), abs(top["end"][0]))
    ok = (abs(hp["center"][0] - (hw - hp["radius"])) < tol
          and abs(sh["center"][0] - (top_x - sh["radius"])) < tol
          and abs(math.dist(sh["center"], wa["center"]) - (sh["radius"] + wa["radius"])) < tol
          and abs(math.dist(hp["center"], wa["center"]) - (hp["radius"] + wa["radius"])) < tol)
    wy = wa["center"][1]
    return ok, {
        "depth": hw - (wa["center"][0] - wa["radius"]),
        "cornerR": hp["radius"],
        "cornerRTop": sh["radius"],
        "cornerRBottom": hp["radius"],
        "waistR": wa["radius"],
        "waistCy": -wy,                     # app is y-down; Fusion is y-up
        "notch": wy - hp["center"][1],      # the hip side only (the top notch is shallower by design)
        "topInset": hw - top_x,
    }


def _hourglass_offset_waist(curves, hw, hh, tol=2e-3):
    """T4 OFFSET HOURGLASS: the hourglass with each waist pinch at its OWN height and depth (the radii shared L/R).

    The right side is Template 1's own extraction (so `depth` / `cornerR` / `waistR` / `waistCy` / `notch` mean
    exactly what they do for Template 1 and the app's depth root is picked the same way); the LEFT pinch adds its
    own centre height, notch and depth, read off the left arcs (Fusion x is mirrored: the left centre's x < 0).
    Valid when the right side is (Template 1's test) and the left corners are tangent to the side at -hw and to
    the left waist.
    """
    ok, feats = _hourglass(curves, hw, hh, tol)
    sh, wa, hp = curves["arc_shoulder_L"], curves["arc_waist_L"], curves["arc_hip_L"]
    ok = (ok and abs(sh["center"][0] + (hw - sh["radius"])) < tol
          and abs(hp["center"][0] + (hw - hp["radius"])) < tol
          and abs(math.dist(sh["center"], wa["center"]) - (sh["radius"] + wa["radius"])) < tol
          and abs(math.dist(hp["center"], wa["center"]) - (hp["radius"] + wa["radius"])) < tol)
    wy = wa["center"][1]
    feats.update({
        "depthLeft": hw - (-wa["center"][0] - wa["radius"]),
        "waistCyLeft": -wy,                                  # app is y-down; Fusion is y-up
        "notchLeft": ((sh["center"][1] - wy) + (wy - hp["center"][1])) / 2,
    })
    return ok, feats


def _hourglass_dipped_top(curves, hw, hh, tol=2e-3):
    """T5 HOURGLASS DIPPED TOP: Template 1 with the top edge dipped in the middle (stub, convex shoulder arc,
    concave dip arc, convex shoulder arc, stub; the corners square).

    The sides are Template 1's own extraction (so every Template 1 feature means what it does there); the top adds
    the dip's half width (centre line -> each stub's end = the top shoulder centres' x) and its depth below the top
    edge (at hh, Fusion y up). Valid when the sides are (Template 1's test), both top shoulders are tangent to the
    top edge, the dip centre is on the centre line, the dip is tangent to both shoulders, AND the two top shoulder
    centres haven't collapsed together (H23 item 6: at a board too small for this frame to physically fit -- e.g.
    5.51x1.97 -- the solver still finds a numerically tangent, "ok" solution, but it's a degenerate one with the
    two shoulder centres nearly coincident: MEASURED half-width 0.0095in (0.35% of hw) vs ~59-67% of hw at the
    other sizes -- comfortably below `tol` in absolute terms but still large enough that a fixed-inch tolerance
    doesn't catch it, hence the scale-aware check below. Fitting a line through that point alongside real ones
    pulls the whole model wildly off, so it's excluded here the same way Template 2/3 exclude their own
    genuinely-invalid sizes -- the build is "healthy" but not a real frame).
    """
    ok, feats = _hourglass(curves, hw, hh, tol)
    sl, dip, sr = curves["arc_top_shoulder_L"], curves["arc_top_dip"], curves["arc_top_shoulder_R"]
    half_width = (sr["center"][0] - sl["center"][0]) / 2
    ok = (ok and abs(sr["center"][1] - (hh - sr["radius"])) < tol
          and abs(sl["center"][1] - (hh - sl["radius"])) < tol
          and abs(dip["center"][0]) < tol
          and abs(math.dist(sr["center"], dip["center"]) - (sr["radius"] + dip["radius"])) < tol
          and abs(math.dist(sl["center"], dip["center"]) - (sl["radius"] + dip["radius"])) < tol
          and half_width > 0.05 * hw)
    feats.update({
        "topDipHalfWidth": half_width,
        "topDipDepth": hh - (dip["center"][1] - dip["radius"]),   # the dip's lowest point, below the top edge
    })
    return ok, feats


def _hourglass_arched_top(curves, hw, hh, tol=2e-3):
    """T10 ARCHED HOURGLASS: Template 1 with the flat top edge replaced by one arc spanning the full width, its
    apex ON the top edge, its own two ends pulled DOWN into the board (eating into the horn's own length, never
    adding height above it -- the advisor's own correction, confirmed against Fred's sketch and the 7x9 preview).

    The sides are Template 1's own extraction (so every Template 1 feature means what it does there); the top
    adds the rise (the safe zone's own top edge, at hh Fusion y up, minus the arc's own chord height). Valid when
    the sides are (Template 1's test), the arc's two ends are symmetric about the centre line (same y, opposite
    x) and its own apex (centre.y + radius, Fusion up: the HIGHEST point) sits exactly on the safe zone's top.
    """
    ok, feats = _hourglass(curves, hw, hh, tol)
    arch = curves["top_edge"]
    xs = sorted([arch["start"][0], arch["end"][0]])
    ok = (ok and abs(arch["start"][1] - arch["end"][1]) < tol  # the two ends symmetric: same y
          and abs(xs[0] + xs[1]) < tol  # ...and opposite x
          and abs((arch["center"][1] + arch["radius"]) - hh) < tol)  # the apex on the safe zone's own top edge
    feats.update({"archRise": hh - arch["start"][1]})
    return ok, feats


def _tab_top(curves, hw, hh, tol=2e-3):
    """T6 TAB TOP: a rectangle with a narrower rectangular tab centred on top (8 straight pieces).

    Features: the tab's half width (centre line -> each tab side) and its height (the top edge down to the
    shoulders). Valid when the tab top lies on the safe zone's top line, the base and sides on its edges, the tab
    centred, and the pieces axis-aligned (Fusion y up)."""
    tt, sr, sl = curves["tab_top"], curves["shoulder_R"], curves["shoulder_L"]
    tr, tl, rr, ll = curves["tab_side_R"], curves["tab_side_L"], curves["side_R"], curves["side_L"]
    xs = sorted([tt["start"][0], tt["end"][0]])
    ok = (abs(tt["start"][1] - hh) < tol and abs(tt["end"][1] - hh) < tol
          and abs(xs[0] + xs[1]) < tol
          and abs(sr["start"][1] - sr["end"][1]) < tol and abs(sr["start"][1] - sl["start"][1]) < tol
          and all(abs(c["start"][0] - c["end"][0]) < tol for c in (tr, tl, rr, ll))
          and abs(rr["start"][0] - hw) < tol and abs(ll["start"][0] + hw) < tol)
    return ok, {
        "tabHalfWidth": (xs[1] - xs[0]) / 2,
        "tabHeight": hh - sr["start"][1],
    }


def _dipped_left_wave(curves, hw, hh, tol=2e-3):
    """T8 DIPPED TOP + LEFT-ONLY WAVE: a plain straight right side and base (Template 1's classic 4 mitred
    corners), a Template-1-style pinch (shoulder/waist/hip arcs) on the LEFT side only ("the wave"), and a
    Template-5-style dipped top whose dip may sit off centre (Fred's sketch: middle-right of the top edge).

    The wave: Template 1's own LEFT-side extraction (`_hourglass`'s own left-arc block, mirrored: x < 0). The
    top: Template 5's own dip extraction, except the dip's centre is NOT required to sit on the centre line
    (`topDipPosition` = its own x, instead of asserting it is 0). Valid when: the LEFT arcs are tangent to the
    side at -hw and to each other; both top shoulders are tangent to the top edge and to the dip; `side_R` is a
    plain vertical line at x=hw.
    """
    sh, wa, hp = curves["arc_shoulder_L"], curves["arc_waist_L"], curves["arc_hip_L"]
    rs = (sh["radius"] + hp["radius"]) / 2
    ok = (abs(sh["center"][0] + (hw - sh["radius"])) < tol
          and abs(math.dist(sh["center"], wa["center"]) - (sh["radius"] + wa["radius"])) < tol
          and abs(math.dist(hp["center"], wa["center"]) - (hp["radius"] + wa["radius"])) < tol)
    wy = wa["center"][1]
    feats = {
        "waveDepth": hw - (-wa["center"][0] - wa["radius"]),
        "waveCornerR": rs,
        "waveR": wa["radius"],
        "waveCy": -wy,                                   # app is y-down; Fusion is y-up
        "waveNotch": ((sh["center"][1] - wy) + (wy - hp["center"][1])) / 2,
    }
    sl, dip, sr = curves["arc_top_shoulder_L"], curves["arc_top_dip"], curves["arc_top_shoulder_R"]
    ok = (ok and abs(sr["center"][1] - (hh - sr["radius"])) < tol
          and abs(sl["center"][1] - (hh - sl["radius"])) < tol
          and abs(math.dist(sr["center"], dip["center"]) - (sr["radius"] + dip["radius"])) < tol
          and abs(math.dist(sl["center"], dip["center"]) - (sl["radius"] + dip["radius"])) < tol)
    feats.update({
        "topDipHalfWidth": (sr["center"][0] - sl["center"][0]) / 2,
        "topDipPosition": (sr["center"][0] + sl["center"][0]) / 2,        # NOT asserted to be 0 (off centre, T8)
        "topDipDepth": hh - (dip["center"][1] - dip["radius"]),
    })
    side = curves["side_R"]
    ok = ok and abs(side["start"][0] - hw) < tol and abs(side["end"][0] - hw) < tol
    return ok, feats


def _i_shape(curves, hw, hh, tol=2e-3):
    """T9 I SHAPE: a capital serif I (12 straight pieces) -- full-width top and bottom flanges, a narrower stem
    between them, each transition a square (not filleted) step, like Template 6's tab but at all 4 corners.

    Features: the stem's half width (centre line -> either stem side) and the flange height (the top/bottom edge
    down/up to its own shoulder). Valid when the top and base lie on the safe zone's top/bottom lines, every piece
    is axis-aligned (Fusion y up), the stem centred, and the top/bottom flange heights equal (the 4-fold symmetry
    p02_05_symmetry builds in)."""
    top, base = curves["top_edge"], curves["bottom_edge"]
    fr, fbr, fbl, fl = curves["flange_side_R"], curves["flange_side_BR"], curves["flange_side_BL"], curves["flange_side_TL"]
    sTR, sBR, sBL, sTL = curves["shoulder_TR"], curves["shoulder_BR"], curves["shoulder_BL"], curves["shoulder_TL"]
    stR, stL = curves["stem_side_R"], curves["stem_side_L"]
    top_xs = sorted([top["start"][0], top["end"][0]])
    stem_xs = sorted([stR["start"][0], stL["start"][0]])
    ok = (abs(top["start"][1] - hh) < tol and abs(top["end"][1] - hh) < tol
          and abs(base["start"][1] + hh) < tol and abs(base["end"][1] + hh) < tol
          and abs(top_xs[0] + hw) < tol and abs(top_xs[1] - hw) < tol
          and abs(stem_xs[0] + stem_xs[1]) < tol  # the stem centred
          and all(abs(c["start"][0] - c["end"][0]) < tol for c in (fr, fbr, fbl, fl, stR, stL))
          and all(abs(c["start"][1] - c["end"][1]) < tol for c in (sTR, sBR, sBL, sTL))
          and abs(sTR["start"][1] - sTL["start"][1]) < tol  # the two top shoulders at the same height
          and abs(sBR["start"][1] - sBL["start"][1]) < tol  # the two bottom shoulders at the same height
          and abs((hh - sTR["start"][1]) - (hh + sBR["start"][1])) < tol)  # top flange height = bottom's
    return ok, {
        "stemHalfWidth": (stem_xs[1] - stem_xs[0]) / 2,
        "flangeHeight": hh - sTR["start"][1],
    }


def _diamond_top_hourglass(curves, hw, hh, tol=2e-3):
    """T7 DIAMOND-TOP HOURGLASS: a 90-degree gable roof (2 straight bars, mitred at the peak and at
    each eave), a concave-neck/convex-body S-curve on each side (2 tangent arcs, mitred to the
    roof at the eave, tangent to the straight base side at the bottom), a plain straight base.

    Features: gableNeckWidth (the neck arc's own narrowest x, from centre -- "gable" prefix, not the plain
    "neckWidth" Template 2's own bottle extractor could in principle collide with if ever merged into one
    namespace; matches editor-shape-lattice-generator.js's own PARAM_ORDER.diamondTopHourglass key),
    neckHeight / bodyFlareHeight
    (how far down from the eave the neck / the full-width point sit, in inches -- a plain geometric
    measurement, like every other extractor's own features, NOT pre-divided into a fraction: the
    model fits hw/hh coefficients against these real inch values once goldens exist; `paramsFromShapeModel`
    (editor-shape-lattice-generator.js) divides the fitted value back by the CONSTRUCTION's own
    `rest` to recover the fraction the app's param actually wants). Valid when the roof is symmetric about the centreline, each side's neck
    and body arcs are tangent to one another (opposite curvature: dist(centers) = r_neck + r_body,
    the genuine S-curve tangency fb_engine/t7_geometry.py's own module docstring describes), the
    body arc is tangent to the vertical straight side, and that side sits at x = +-hw.

    FIRST CUT, unverified against a real golden JSON (no template_7 goldens exist yet) - check the
    recorded curve dict's actual key shape (does an Arc3Point entry carry 'start'/'end' alongside
    'center'/'radius'?) the first time tools/repro/record_frame_parity.py runs for this template,
    per LIVE_CHECK.md.
    """
    roof_r, roof_l = curves["roof_R"], curves["roof_L"]
    neck_r, body_r = curves["arc_neck_R"], curves["arc_body_R"]
    neck_l, body_l = curves["arc_neck_L"], curves["arc_body_L"]
    side_r = curves["side_R"]
    eave_y = roof_r["end"][1]
    n_x, n_y = neck_r["end"][0], neck_r["end"][1]
    b_y = body_r["end"][1]
    rest = eave_y - (-hh)
    ok = (abs(roof_r["start"][0] - roof_l["end"][0]) < tol  # peak shared by both roof bars
          and abs(roof_r["start"][0]) < tol                 # peak on the centreline
          and abs(math.dist(neck_r["center"], body_r["center"]) - (neck_r["radius"] + body_r["radius"])) < tol
          and abs(math.dist(neck_l["center"], body_l["center"]) - (neck_l["radius"] + body_l["radius"])) < tol
          and abs(body_r["center"][0] - (hw - body_r["radius"])) < tol  # tangent to the vertical side
          and abs(side_r["start"][0] - hw) < tol and abs(side_r["end"][0] - hw) < tol
          and rest > 0)
    return ok, {
        "gableNeckWidth": n_x,
        "neckHeight": eave_y - n_y,       # inches, not a fraction -- see this function's own doc comment
        "bodyFlareHeight": eave_y - b_y,  # inches, not a fraction
    }


def _diamond_top_hourglass_pinch(curves, hw, hh, tol=2e-3):
    """T11 HOURGLASS ROOF: Template 7's own gable roof (2 straight bars, mitred at the peak) + a
    straight vertical "eave" bar from each eave point down to the shoulder arc's own top horn, over
    Template 1's own 3-arc shoulder/waist/hip pinch side (tangent chain -- SAME construction Template 3's
    own narrow-top hourglass extractor (`_hourglass_narrow_top`) already validates, except the shoulder
    is tangent to the EAVE's own x, not a `top_edge` curve's end), a plain straight base.

    Features mirror Template 3's own split-corner set (depth/cornerR/cornerRTop/cornerRBottom/waistR/
    waistCy/notch): the roof/eave shape itself (`a = min(0.62*hw, 0.84*hh)`, Template 7's own
    roof_geometry) is NOT a fitted feature here -- no FRAME_HANDLES entry controls it (purely hw/hh-
    derived), so this extractor only VALIDATES it (the `ok` checks below), never fits it -- a Template 7
    roof is checked the same way and never reported as a feature either.

    FIRST CUT, unverified against a real golden JSON (no template_11 goldens exist yet) -- check the
    recorded curve dict's actual key shape the first time tools/repro/record_frame_parity.py runs for
    this template, per LIVE_CHECK.md."""
    roof_r, roof_l = curves["roof_R"], curves["roof_L"]
    eave_r = curves["eave_straight_R"]
    sh, wa, hp = curves["arc_shoulder_R"], curves["arc_waist_R"], curves["arc_hip_R"]
    side_r = curves["side_straight_R"]
    top_x = eave_r["end"][0]
    ok = (abs(roof_r["start"][0] - roof_l["end"][0]) < tol    # peak shared by both roof bars
          and abs(roof_r["start"][0]) < tol                    # peak on the centreline
          and abs(eave_r["start"][0] - eave_r["end"][0]) < tol  # eave straight is vertical
          and abs(side_r["start"][0] - hw) < tol and abs(side_r["end"][0] - hw) < tol
          and abs(hp["center"][0] - (hw - hp["radius"])) < tol           # hip tangent to the side at hw
          and abs(sh["center"][0] - (top_x - sh["radius"])) < tol        # shoulder tangent to the eave's own x
          and abs(math.dist(sh["center"], wa["center"]) - (sh["radius"] + wa["radius"])) < tol
          and abs(math.dist(hp["center"], wa["center"]) - (hp["radius"] + wa["radius"])) < tol)
    wy = wa["center"][1]
    return ok, {
        "depth": hw - (wa["center"][0] - wa["radius"]),
        "cornerR": hp["radius"],          # the hip's (the full-width side the app's depth root is picked for)
        "cornerRTop": sh["radius"],
        "cornerRBottom": hp["radius"],
        "waistR": wa["radius"],
        "waistCy": -wy,                   # app is y-down; Fusion is y-up
        "notch": wy - hp["center"][1],    # the hip side only (the top notch sits behind the roof, not fitted)
    }


def _sagitta_from_center_radius(p0, p1, center, radius):
    """The sagitta (bulge depth) of the arc through `p0`/`p1` given its own already-built
    centre/radius -- half_chord = |p1-p0|/2, sagitta = radius - sqrt(radius^2 - half_chord^2) (the
    minor-arc case, true for every arc T16/T17 build at any moderate handle value -- see
    fb_engine/t16_geometry.py's own is_valid_outline, which rejects anything past that regime)."""
    half_chord = math.dist(p0, p1) / 2.0
    return radius - math.sqrt(max(0.0, radius * radius - half_chord * half_chord))


def _arched_funnel(curves, hw, hh, tol=2e-3):
    """T16 ARCHED FUNNEL: a one-piece arch, two straight upper sides tapering to a waist, two
    outward-bulging lower curves, a flat base -- every joint a MITER (fb_engine/t16_geometry.py's
    own module docstring), unlike every earlier template's own tangent chain.

    Features: topWidth (the arch's own chord half-span, inches), archRiseFrac (the arch's own
    sagitta, inches), waistWidthFrac (the waist's own half-width, inches), waistHeightFrac (hh
    minus the waist's own y, inches -- "how far down from the top edge", matching its basis="h"
    FRAME_HANDLES convention: paramsFromShapeModel recovers the fraction as feature / (2*hh), not
    feature / hh), bulgeFrac (the lower-right curve's own outward sagitta, inches) -- every one a
    plain inch value, NOT pre-divided into a fraction (same convention _diamond_top_hourglass
    above already uses: the model fits hw/hh coefficients against real inch values once goldens
    exist; the app's own paramsFromShapeModel divides the fitted/provisional value back by hw or
    2*hh). Valid when the arch's own two ends are symmetric about the centreline and at the same
    height, upper_R starts exactly where the arch ends, and the base sits at y = -hh.

    FIRST CUT, unverified against a real golden JSON (no template_16 goldens exist yet) -- check
    the recorded curve dict's actual key shape the first time tools/repro/record_frame_parity.py
    runs for this template, same caveat _diamond_top_hourglass's own docstring carries."""
    arch = curves["arch"]
    upper_r, lower_r, base = curves["upper_R"], curves["lower_R"], curves["base"]
    top_r, top_l = arch["start"], arch["end"]  # arch:S=topR, arch:E=topL (the CCW-swap table, p02_02_loop.py)
    waist_r, BR = lower_r["start"], lower_r["end"]
    ok = (abs(top_r[0] + top_l[0]) < tol and abs(top_r[1] - top_l[1]) < tol  # arch ends symmetric, same height
          and abs(upper_r["start"][0] - top_r[0]) < tol and abs(upper_r["start"][1] - top_r[1]) < tol
          and abs(base["start"][1] + hh) < tol and abs(base["end"][1] + hh) < tol)  # base at y=-hh
    return ok, {
        "topWidth": top_r[0],
        "archRiseFrac": hh - top_r[1],
        "waistWidthFrac": waist_r[0],
        "waistHeightFrac": hh - waist_r[1],
        "bulgeFrac": _sagitta_from_center_radius(waist_r, BR, lower_r["center"], lower_r["radius"]),
    }


def _tulip(curves, hw, hh, tol=2e-3):
    """T17 TULIP: Template 16's own arch/lower bulges/base, plus two CONCAVE upper sides (arcs,
    not Template 16's plain lines) curving toward the centreline from the arch ends to the waist.

    Features: Template 16's own 5, plus upperCurveFrac (the upper-right arc's own inward sagitta,
    inches). Valid the same way Template 16's own extractor is, plus upper_R must actually be an
    arc (carry 'center'/'radius') -- a genuinely concave side, not a degenerate straight one.

    FIRST CUT, unverified against a real golden JSON (no template_17 goldens exist yet) -- same
    caveat _arched_funnel's own docstring carries."""
    arch = curves["arch"]
    upper_r, lower_r, base = curves["upper_R"], curves["lower_R"], curves["base"]
    top_r, top_l = arch["start"], arch["end"]
    waist_r, BR = lower_r["start"], lower_r["end"]
    ok = (abs(top_r[0] + top_l[0]) < tol and abs(top_r[1] - top_l[1]) < tol
          and abs(upper_r["start"][0] - top_r[0]) < tol and abs(upper_r["start"][1] - top_r[1]) < tol
          and abs(base["start"][1] + hh) < tol and abs(base["end"][1] + hh) < tol
          and "center" in upper_r and "radius" in upper_r)  # a genuine arc, not a degenerate straight side
    return ok, {
        "topWidth": top_r[0],
        "archRiseFrac": hh - top_r[1],
        "waistWidthFrac": waist_r[0],
        "waistHeightFrac": hh - waist_r[1],
        "bulgeFrac": _sagitta_from_center_radius(waist_r, BR, lower_r["center"], lower_r["radius"]),
        "upperCurveFrac": _sagitta_from_center_radius(upper_r["start"], upper_r["end"],
                                                       upper_r["center"], upper_r["radius"]),
    }


FEATURE_EXTRACTORS = {"hourglass": _hourglass, "bottle": _bottle, "hourglass_narrow_top": _hourglass_narrow_top,
                      "hourglass_offset_waist": _hourglass_offset_waist, "hourglass_dipped_top": _hourglass_dipped_top,
                      "hourglass_arched_top": _hourglass_arched_top,
                      "bottle_taper": _bottle_taper,
                      "tab_top": _tab_top, "dipped_left_wave": _dipped_left_wave, "i_shape": _i_shape,
                      "diamond_top_hourglass": _diamond_top_hourglass,
                      "diamond_top_hourglass_pinch": _diamond_top_hourglass_pinch,
                      "arched_funnel": _arched_funnel, "tulip": _tulip}


def provisional_tab_top_model(half_width_of_hw, height_of_hh):
    """T6 TAB TOP, until its goldens are recorded live: a PROVISIONAL model (never none). There is no base template
    to derive it from (no arcs, nothing shared with the hourglass), so it is the provisional shape itself:
    `tabHalfWidth` = `half_width_of_hw` x hw, `tabHeight` = `height_of_hh` x hh. The app clamps both into their
    feasible ranges (the frame thickness rule: a tab side >= 2 x thickness, every bar >= the thickness long).
    Marked `provisional` so nothing mistakes it for a fit."""
    return {
        "features": {
            "tabHalfWidth": {"hw": half_width_of_hw, "hh": 0.0},
            "tabHeight": {"hw": 0.0, "hh": height_of_hh},
        },
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [],
            "excluded": [],
            "exactAtFittedSizes": False,
            "residualsIn": {},
            "maxResidualIn": None,
        },
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": None,
            "tabHalfWidthOfHw": half_width_of_hw,
            "tabHeightOfHh": height_of_hh,
        },
    }


def provisional_dipped_left_wave_model(wave_reach_of_hw, wave_height_of_hh, top_dip_half_width_of_hw,
                                        top_dip_depth_of_hh, top_dip_position_of_hw):
    """T8 DIPPED TOP + LEFT-ONLY WAVE, until its goldens are recorded live: a PROVISIONAL model (never none), like
    T6's tab top: no base template (the right side is a plain straight edge and the top dip sits off centre,
    neither of which any earlier template's fitted features describe). Fractions of the safe-zone half sizes
    (hw/hh), read straight by the app's own dippedLeftWave paramsFromShapeModel branch (editor-shape-lattice-
    generator.js); it clamps every one into its feasible range. Marked `provisional` so nothing mistakes it for
    a fit."""
    return {
        "features": {
            "waveDepth": {"hw": wave_reach_of_hw, "hh": 0.0},
            "waveCy": {"hw": 0.0, "hh": wave_height_of_hh},
            "topDipHalfWidth": {"hw": top_dip_half_width_of_hw, "hh": 0.0},
            "topDipDepth": {"hw": 0.0, "hh": top_dip_depth_of_hh},
            "topDipPosition": {"hw": top_dip_position_of_hw, "hh": 0.0},
        },
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [],
            "excluded": [],
            "exactAtFittedSizes": False,
            "residualsIn": {},
            "maxResidualIn": None,
        },
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": None,
            "waveReachOfHw": wave_reach_of_hw,
            "waveHeightOfHh": wave_height_of_hh,
            "topDipHalfWidthOfHw": top_dip_half_width_of_hw,
            "topDipDepthOfHh": top_dip_depth_of_hh,
            "topDipPositionOfHw": top_dip_position_of_hw,
        },
    }


def provisional_i_shape_model(stem_half_width_of_hw, flange_height_of_hh):
    """T9 I SHAPE, until its goldens are recorded live: a PROVISIONAL model (never none), like T6's tab top: no
    base template to derive it from (no arcs, nothing shared with the hourglass). `stemHalfWidth` = `stem_half_
    width_of_hw` x hw, `flangeHeight` = `flange_height_of_hh` x hh. The app clamps both into their feasible
    ranges (the frame thickness rule: no bar shorter than the thickness, no flange side shorter than ~2 x it).
    Marked `provisional` so nothing mistakes it for a fit."""
    return {
        "features": {
            "stemHalfWidth": {"hw": stem_half_width_of_hw, "hh": 0.0},
            "flangeHeight": {"hw": 0.0, "hh": flange_height_of_hh},
        },
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [],
            "excluded": [],
            "exactAtFittedSizes": False,
            "residualsIn": {},
            "maxResidualIn": None,
        },
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": None,
            "stemHalfWidthOfHw": stem_half_width_of_hw,
            "flangeHeightOfHh": flange_height_of_hh,
        },
    }


def provisional_diamond_top_hourglass_model(neck_width_of_hw, neck_height_of_hh, body_flare_of_hh):
    """T7 DIAMOND-TOP HOURGLASS, until its goldens are recorded live: a PROVISIONAL model (never
    none), like T6/T8/T9: no base template to derive it from (no earlier template has a gable
    roof or an S-curve side). `neckWidth` = `neck_width_of_hw` x hw. `neckHeight` / `bodyFlareHeight`
    are each "fraction x the run below the eave" (fb_engine/t7_geometry.py's own `rest` = 2*hh - a,
    where `a = min(0.62*hw, 0.84*hh)`, t7_roof_eave.roof_geometry) -- EXACT, not approximate, for a
    PORTRAIT board (hw < hh, project_portrait_only: Fred currently builds portrait boards only): the
    min() is binding at `0.62*hw` whenever hw/hh < 0.84/0.62 (~1.355), which every portrait board
    satisfies, so `rest = 2*hh - 0.62*hw` exactly, a genuine hw/hh-LINEAR expression (not degenerate
    like T8's own board-dependent "exact tangent-triple" case, which stays nonlinear no matter what).
    MEASURED, not assumed: an earlier `rest ~= 2*hh` approximation here was off by ~30% at 7x9
    (`a`=2.015in is not a small correction against hh=4.25in) and silently shrank the default straight
    side below frame_thickness (0.365in drawn vs 0.75in needed) -- caught by this template's own JS
    test suite (tests/frame-template-7.test.js), not assumed safe. A LANDSCAPE board (hw > hh) would
    need the OTHER branch of the min(); not implemented, a declared gap for that case alone (project_
    portrait_only: a landscape fallback belongs in the construction itself if ever needed, not a second
    provisional formula here). `paramsFromShapeModel` (editor-shape-lattice-generator.js, the
    diamondTopHourglass branch) divides the fitted/provisional inch value back by the CONSTRUCTION's
    own TRUE `rest`, so the round trip is exact here (portrait) and will stay exact once a real fit
    replaces this provisional model. The app clamps every value into its feasible range
    (fb_engine/t7_geometry.py's own clamp_t7_handles proves the valid combinations are coupled, not
    independent). Marked `provisional` so nothing mistakes it for a fit."""
    return {
        "features": {
            "gableNeckWidth": {"hw": neck_width_of_hw, "hh": 0.0},
            "neckHeight": {"hw": -0.62 * neck_height_of_hh, "hh": 2 * neck_height_of_hh},
            "bodyFlareHeight": {"hw": -0.62 * body_flare_of_hh, "hh": 2 * body_flare_of_hh},
        },
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [],
            "excluded": [],
            "exactAtFittedSizes": False,
            "residualsIn": {},
            "maxResidualIn": None,
        },
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": None,
            "neckWidthOfHw": neck_width_of_hw,
            "neckHeightOfHh": neck_height_of_hh,
            "bodyFlareOfHh": body_flare_of_hh,
        },
    }


def provisional_diamond_top_hourglass_pinch_model(waist_reach_of_hw, corner_radius_top_of_hw,
                                                  corner_radius_bottom_of_hw, waist_center_y_of_hh,
                                                  waist_radius_of_hw):
    """T11 HOURGLASS ROOF, until its goldens are recorded live: a PROVISIONAL model (never none), like
    T6/T7/T8/T9: no base template to derive it from (no earlier template combines a gable roof with a
    split-corner hourglass pinch side). Every feature here is EXACTLY hw- or hh-linear, not an
    approximation (contrast T7's own `rest` linearization, exact only for a portrait board): the roof/
    eave shape itself (`a`, Template 7's own roof_geometry) isn't one of this template's own FRAME_HANDLES
    (no param controls it), so it never enters these features -- only the shoulder/waist/hip side does,
    and that side is Template 1's own tangency algebra, unaffected by the roof above it.

    `cornerR` carries the HIP's own radius (paramsFromShapeModel's shared depth-root pick, same
    convention as T3's own `hourglass_narrow_top`); `cornerRTop`/`cornerRBottom` are read back separately.
    `notch` (the hip centre's own offset below the waist centre, Template 1's own `_hourglass_side`
    tangency: dy = sqrt(d(2S-d)) with the bottom inset 0, d=waistReachOfHw (the HIP's own depth, inset 0),
    S=cornerRadiusBottomOfHw + waistRadiusOfHw, all FRACTIONS of hw) is a pure hw-scalar: it depends only
    on the three hw-fraction inputs, never on waistCenterY or hh. MEASURED, not assumed: an earlier version
    of this formula used `d=cornerRadiusBottomOfHw` (not `waistReachOfHw`) -- at this template's own
    default proportions that put `S` EXACTLY equal to the true depth (the "shared-column" identity,
    `cornerRadiusBottomOfHw + waistRadiusOfHw == waistReachOfHw` whenever waistRadius sits above its own
    floor), so the wrong notch produced a root-picking TIE in paramsFromShapeModel's own `S +/- sqrt(S^2-
    notch^2)` -- both candidate roots equidistant from the reference `depth` feature -- and the `<=`
    tie-break silently picked the WRONG one (0.715 instead of the true 1.7875 at 7x9), caught by a real
    `generateSilhouette` call producing a visibly collapsed shoulder arc, not assumed safe. Every feature
    here round-trips EXACTLY back through paramsFromShapeModel to the fraction it started from. Marked
    `provisional` so nothing mistakes it for a fit."""
    cb, ct, wr = corner_radius_bottom_of_hw, corner_radius_top_of_hw, waist_radius_of_hw
    S = cb + wr
    notch_of_hw = math.sqrt(max(0.0, waist_reach_of_hw * (2 * S - waist_reach_of_hw)))
    return {
        "features": {
            "depth": {"hw": waist_reach_of_hw, "hh": 0.0},
            "cornerR": {"hw": cb, "hh": 0.0},
            "cornerRTop": {"hw": ct, "hh": 0.0},
            "cornerRBottom": {"hw": cb, "hh": 0.0},
            "waistR": {"hw": wr, "hh": 0.0},
            "waistCy": {"hw": 0.0, "hh": waist_center_y_of_hh},
            "notch": {"hw": notch_of_hw, "hh": 0.0},
        },
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [],
            "excluded": [],
            "exactAtFittedSizes": False,
            "residualsIn": {},
            "maxResidualIn": None,
        },
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": None,
            "waistReachOfHw": waist_reach_of_hw,
            "cornerRadiusTopOfHw": corner_radius_top_of_hw,
            "cornerRadiusBottomOfHw": corner_radius_bottom_of_hw,
            "waistCenterYOfHh": waist_center_y_of_hh,
            "waistRadiusOfHw": waist_radius_of_hw,
        },
    }


def provisional_shape_model(base_model, top_inset_of_depth):
    """T3 TAPERED HOURGLASS, until its goldens are recorded live: a PROVISIONAL model, never none (the app reads
    `shapeModel.features`). `base_model` = Template 1's fitted model (the same pieces, the same solve below the
    shoulders); its features unchanged, plus `topInset` = `top_inset_of_depth` x its fitted depth (0.7: the top
    horns sit 70% of the way to the waist pinch, 7x9: a 5.03 in top over the 6.5 in base, Fred's sketch). The
    app clamps topInset below the waist (never narrower than it). Marked `provisional` so nothing mistakes it
    for a fit."""
    feats = {k: dict(v) for k, v in base_model["features"].items()}
    d = feats["depth"]
    feats["topInset"] = {"hw": round(top_inset_of_depth * d["hw"], 6), "hh": round(top_inset_of_depth * d["hh"], 6)}
    return {
        "features": feats,
        "fit": dict(base_model["fit"]),
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": "the fitted Template 1 model",
            "topInsetOfDepth": top_inset_of_depth,
        },
    }


def provisional_taper_model(base_model, taper_angle_deg):
    """F30 item 3 (Fred's own taper copies, Template 12 from Template 1 / Template 13 from Template 2), until
    their goldens are recorded live: a PROVISIONAL model, never none. Unlike T3/T4/T5/T10's own provisional
    models, nothing about the base shape changes here -- the shoulder/waist (or neck/body) tangency the base
    template already fits is exactly what Template 12/13 build on (editor-shape-lattice-generator.js's own
    `_taperedCorner` only ever repositions the TOP horn and, past its own feasible floor, the shoulder/neck
    circle -- it never touches the rest of the silhouette). So `base_model`'s features are kept verbatim, plus
    one new scale-invariant `const` feature, `taperAngle` (degrees: 0 = the base template exactly, Fred's own
    default 8). Marked `provisional` so nothing mistakes it for a fit."""
    feats = {k: dict(v) for k, v in base_model["features"].items()}
    feats["taperAngle"] = {"hw": 0.0, "hh": 0.0, "const": taper_angle_deg}
    return {
        "features": feats,
        "fit": dict(base_model["fit"]),
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": "the fitted base template's own model, every feature kept",
            "taperAngleDeg": taper_angle_deg,
        },
    }


def provisional_arched_top_model(base_model, arch_rise_of_hw):
    """T10 ARCHED HOURGLASS, until its goldens are recorded live: a PROVISIONAL model, never none, from Template
    1's fitted one. Its features unchanged (the sides/base are Template 1's own pinch, untouched); plus
    `archRise` = `arch_rise_of_hw` x hw (0.35: a gentle dome, Fred's own sketch, confirmed against the 7x9
    preview he approved). The app caps it so the pinch always keeps room -- it eats into the existing top horn's
    own length, never adds height above the board (the advisor's own correction; Fred: going flat on an extreme
    landscape board is fine, no pinch-shrinking). Marked `provisional` so nothing mistakes it for a fit."""
    feats = {k: dict(v) for k, v in base_model["features"].items()}
    feats["archRise"] = {"hw": arch_rise_of_hw, "hh": 0.0}
    return {
        "features": feats,
        "fit": dict(base_model["fit"]),
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": "the fitted Template 1 model",
            "archRiseOfHw": arch_rise_of_hw,
        },
    }


def provisional_offset_waist_model(base_model, waist_offset_of_hh):
    """T4 OFFSET HOURGLASS, until its goldens are recorded live: a PROVISIONAL model (never none), from Template
    1's fitted one. Its features unchanged except the pinch heights: the RIGHT waist centre moves DOWN and the LEFT
    one UP by `waist_offset_of_hh` x hh each (app y-down: waistCy + k hh, waistCyLeft = waistCy - k hh), the left
    pinch otherwise a copy of the right (notchLeft = notch, depthLeft = depth: the same depth). 0.2: the left
    centre ~60% up the safe zone, the right ~40% (Template 1's sits at the middle). The app clamps each pinch into
    its own feasible range. Marked `provisional` so nothing mistakes it for a fit."""
    feats = {k: dict(v) for k, v in base_model["features"].items()}
    cy, k = feats["waistCy"], waist_offset_of_hh
    feats["waistCy"] = {"hw": cy["hw"], "hh": round(cy["hh"] + k, 6)}
    feats["waistCyLeft"] = {"hw": cy["hw"], "hh": round(cy["hh"] - k, 6)}
    feats["notchLeft"] = dict(feats["notch"])
    feats["depthLeft"] = dict(feats["depth"])
    return {
        "features": feats,
        "fit": dict(base_model["fit"]),
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": "the fitted Template 1 model",
            "waistOffsetOfHh": waist_offset_of_hh,
        },
    }


def provisional_dipped_top_model(base_model, depth_of_hh, half_width_of_hw):
    """T5 HOURGLASS DIPPED TOP, until its goldens are recorded live: a PROVISIONAL model (never none), from Template
    1's fitted one (the same sides). Its features unchanged, plus the top dip: `topDipDepth` = `depth_of_hh` x hh
    and `topDipHalfWidth` = `half_width_of_hw` x hw (0.14 / 0.72: 7x9, a 0.6 in deep dip with 0.91 in straight
    stubs from the corners). The app clamps both into their feasible ranges. Marked `provisional` so nothing
    mistakes it for a fit."""
    feats = {k: dict(v) for k, v in base_model["features"].items()}
    feats["topDipDepth"] = {"hw": 0.0, "hh": depth_of_hh}
    feats["topDipHalfWidth"] = {"hw": half_width_of_hw, "hh": 0.0}
    return {
        "features": feats,
        "fit": dict(base_model["fit"]),
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": "the fitted Template 1 model",
            "topDipDepthOfHh": depth_of_hh,
            "topDipHalfWidthOfHw": half_width_of_hw,
        },
    }


def provisional_arched_funnel_model(top_width_of_hw, arch_rise_of_hw, waist_width_of_hw, waist_height_of_h, bulge_of_hw):
    """T16 ARCHED FUNNEL, until its goldens are recorded live: a PROVISIONAL model (never none),
    like T7/T9/T11: no base template to derive it from (no earlier template has a one-piece arch
    over an all-miter outline). Every feature is a PLAIN hw- or hh-linear fraction straight from
    the construction (fb_engine/t16_geometry.py's own outline()) -- no `rest`-style nonlinear term
    the way T7's own neckHeight/bodyFlareHeight need (T9's own provisional_i_shape_model is the
    closer precedent here, not T7's).

    `waistHeightFrac` is the one basis="h" (full height, not half) handle: its own feature is
    `hh - waist_r.y` (how far down from the top edge, inches) = `waist_height_frac * 2 * hh`, so
    the hh coefficient is `2 * waist_height_of_h` with NO hw cross-term (unlike T7's own roof-
    shape-dependent eave position) -- paramsFromShapeModel recovers the fraction as
    `feature / (2*hh)`, matching FRAME_HANDLES' own declared basis exactly. The app clamps every
    value into its feasible range (frame-handles.js's own frameParamRanges, each handle solved
    independently -- fb_engine/t16_geometry.py's own module docstring: unlike T11's coupled
    parameters, no clamp_*_handles blend-search is needed here). Marked `provisional` so nothing
    mistakes it for a fit."""
    return {
        "features": {
            "topWidth": {"hw": top_width_of_hw, "hh": 0.0},
            "archRiseFrac": {"hw": arch_rise_of_hw, "hh": 0.0},
            "waistWidthFrac": {"hw": waist_width_of_hw, "hh": 0.0},
            "waistHeightFrac": {"hw": 0.0, "hh": 2 * waist_height_of_h},
            "bulgeFrac": {"hw": bulge_of_hw, "hh": 0.0},
        },
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [],
            "excluded": [],
            "exactAtFittedSizes": False,
            "residualsIn": {},
            "maxResidualIn": None,
        },
        "provisional": {
            "reason": "no recorded Fusion goldens for this template yet (tools/repro/record_frame_parity.py)",
            "baseModel": None,
            "topWidthFracOfHw": top_width_of_hw,
            "archRiseFracOfHw": arch_rise_of_hw,
            "waistWidthFracOfHw": waist_width_of_hw,
            "waistHeightFracOfH": waist_height_of_h,
            "bulgeFracOfHw": bulge_of_hw,
        },
    }


def provisional_tulip_model(top_width_of_hw, arch_rise_of_hw, waist_width_of_hw, waist_height_of_h,
                            bulge_of_hw, upper_curve_of_hw):
    """T17 TULIP, until its goldens are recorded live: a PROVISIONAL model (never none). Template
    16's own 5 features (see provisional_arched_funnel_model's own docstring) plus `upperCurveFrac`
    -- the two concave upper sides' own inward sagitta, a plain hw-linear fraction, same shape as
    `bulgeFrac`. Marked `provisional` so nothing mistakes it for a fit."""
    model = provisional_arched_funnel_model(top_width_of_hw, arch_rise_of_hw, waist_width_of_hw,
                                            waist_height_of_h, bulge_of_hw)
    model["features"]["upperCurveFrac"] = {"hw": upper_curve_of_hw, "hh": 0.0}
    model["provisional"]["upperCurveFracOfHw"] = upper_curve_of_hw
    return model


def _lsq2(X, y):
    a = sum(p * p for p, _ in X); b = sum(p * q for p, q in X); d = sum(q * q for _, q in X)
    e = sum(p * t for (p, _), t in zip(X, y)); f = sum(q * t for (_, q), t in zip(X, y))
    det = a * d - b * b
    return (d * e - b * f) / det, (a * f - b * e) / det


def fit_shape_model(template_id, preset, goldens_dir):
    """The fitted model for one template, or None if fewer than 2 valid goldens."""
    extract = FEATURE_EXTRACTORS[preset]
    samples = []
    for path in sorted(glob.glob(os.path.join(goldens_dir, f"{template_id}_*.json"))):
        with open(path, encoding="utf-8") as f:
            g = json.load(f)
        hw, hh = _safe_half(g["meta"])
        ok, feats = extract(g["sketch2_shape_outline"], hw, hh)
        samples.append({"size": os.path.basename(path)[len(template_id) + 1:-5], "hw": hw, "hh": hh,
                        "valid": ok, "features": feats})
    valid = [s for s in samples if s["valid"]]
    if len(valid) < 2:
        return None
    X = [(s["hw"], s["hh"]) for s in valid]
    features, residuals = {}, {}
    for name in valid[0]["features"]:
        y = [s["features"][name] for s in valid]
        b_hw, b_hh = _lsq2(X, y)
        features[name] = {"hw": round(b_hw, 6), "hh": round(b_hh, 6)}
        residuals[name] = [round(b_hw * p + b_hh * q - t, 4) for (p, q), t in zip(X, y)]
    return {
        "features": features,
        "fit": {
            "model": "feature = hw * features[f].hw + hh * features[f].hh (safe-zone half sizes, in)",
            "fittedFrom": [s["size"] for s in valid],
            "excluded": [s["size"] for s in samples if not s["valid"]],
            "exactAtFittedSizes": len(valid) == 2,
            "residualsIn": residuals,
            "maxResidualIn": max(abs(r) for rs in residuals.values() for r in rs),
        },
    }

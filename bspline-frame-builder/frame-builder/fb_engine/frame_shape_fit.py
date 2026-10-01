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
    adds the corner angle (F29 item 2: between the vertical horn and the arc's own tangent where they meet, not
    a free rise -- the app derives the rise from it and the chord half-width, editor-shape-lattice-generator.js
    `archRiseFromCornerAngle`, its own exact inverse). Valid when the sides are (Template 1's test), the arc's two
    ends are symmetric about the centre line (same y, opposite x) and its own apex (centre.y + radius, Fusion up:
    the HIGHEST point) sits exactly on the safe zone's top -- the tangent-to-the-top-edge relationship a fixed
    corner angle still preserves exactly (only WHICH angle the chord sits at changes, not that it is tangent).
    """
    ok, feats = _hourglass(curves, hw, hh, tol)
    arch = curves["top_edge"]
    xs = sorted([arch["start"][0], arch["end"][0]])
    ok = (ok and abs(arch["start"][1] - arch["end"][1]) < tol  # the two ends symmetric: same y
          and abs(xs[0] + xs[1]) < tol  # ...and opposite x
          and abs((arch["center"][1] + arch["radius"]) - hh) < tol)  # the apex on the safe zone's own top edge
    top_x = abs(arch["start"][0])
    arch_rise = hh - arch["start"][1]
    cos_t = -2 * top_x * arch_rise / (top_x * top_x + arch_rise * arch_rise) if arch_rise > 0 else 0.0
    feats.update({"archCornerAngle": math.degrees(math.acos(max(-1.0, min(1.0, cos_t))))})
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


FEATURE_EXTRACTORS = {"hourglass": _hourglass, "bottle": _bottle, "hourglass_narrow_top": _hourglass_narrow_top,
                      "hourglass_offset_waist": _hourglass_offset_waist, "hourglass_dipped_top": _hourglass_dipped_top,
                      "hourglass_arched_top": _hourglass_arched_top,
                      "bottle_taper": _bottle_taper,
                      "tab_top": _tab_top, "dipped_left_wave": _dipped_left_wave, "i_shape": _i_shape}


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
    one new scale-invariant `taperAngle` feature (degrees, the `const` pattern `archCornerAngle` already uses:
    0 = the base template exactly, Fred's own default 8). Marked `provisional` so nothing mistakes it for a fit."""
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


def provisional_reconstructed_arched_hourglass_model(base_model, depth_of_hw, corner_r_top_of_hw,
                                                      corner_r_bottom_of_hw, waist_r_of_hw, waist_cy_of_hh,
                                                      notch_of_hw, top_inset_of_hw, arch_corner_angle_deg):
    """T10 ARCHED HOURGLASS v2 (F29 item 2, Fred's own hand rebuild in Fusion, 2026-10-01): the first provisional
    dome (a free rise on Template 1's own plain pinch) built wrong in Fusion at every board size (H23 item 14's
    own capacity report, never fixed). Fred rebuilt the sketch from scratch instead: he took T10's OWN existing
    shoulder/waist/hip/waist-radius construction (confirmed by the live constraints dump's own entity names --
    NOT Template 2's, which has no "shoulder" arc at all) and dragged every one of its radii/depth/position to his
    own values, far outside anything Template 1 or the old T10 preview ever exercised: a narrow top (topInset), a
    huge gentle shoulder, a tight deep waist pulled low and off-centre, a tighter hip flaring back out to the full
    board width. So EVERY one of Template 1's own 5 fitted features is replaced here (not kept) -- read directly
    off Fred's own reconstructed sketch (.bspline-status/shots/fred/t10_fred_reconstructed_constraints_2026-10-
    01.json, the live Fusion constraint/entity dump, 7x9: hw=3.25in/hh=4.25in), each a pure fraction of hw or hh
    (a single data point, so no real hw+hh split is derivable -- same simplification every other provisional model
    here already makes). The arch itself is driven by its own corner angle (F29 item 2: the angle between the
    vertical horn and the arc's own tangent where they meet, Fred's own fixed 100-130 deg band, default 127, a
    scale-INVARIANT `const` feature -- seat A's matching Fusion construction is a tangent line + an angle
    dimension there, the exact replacement for the old free-rise handle that never built right).
    Marked `provisional` so nothing mistakes it for a fit; replaced once Fred's own rebuild is fully constrained
    and seat A's matching Fusion phases produce real recordable goldens."""
    feats = {k: dict(v) for k, v in base_model["features"].items()}
    feats["depth"] = {"hw": depth_of_hw, "hh": 0.0}
    feats["cornerR"] = {"hw": corner_r_bottom_of_hw, "hh": 0.0}  # the hip's (the full-width side the depth root is for)
    feats["cornerRTop"] = {"hw": corner_r_top_of_hw, "hh": 0.0}
    feats["cornerRBottom"] = {"hw": corner_r_bottom_of_hw, "hh": 0.0}
    feats["waistR"] = {"hw": waist_r_of_hw, "hh": 0.0}
    feats["waistCy"] = {"hw": 0.0, "hh": waist_cy_of_hh}
    feats["notch"] = {"hw": notch_of_hw, "hh": 0.0}
    feats["topInset"] = {"hw": top_inset_of_hw, "hh": 0.0}
    feats["archCornerAngle"] = {"hw": 0.0, "hh": 0.0, "const": arch_corner_angle_deg}
    return {
        "features": feats,
        "fit": dict(base_model["fit"]),
        "provisional": {
            "reason": "Fred's own hand rebuild in Fusion replaces the old free-rise dome (H23 item 14: it built "
                      "wrong in Fusion at every size); no recorded goldens yet either",
            "baseModel": "the fitted Template 1 model (every feature overridden, not inherited)",
            "depthOfHw": depth_of_hw, "cornerRTopOfHw": corner_r_top_of_hw, "cornerRBottomOfHw": corner_r_bottom_of_hw,
            "waistROfHw": waist_r_of_hw, "waistCyOfHh": waist_cy_of_hh, "notchOfHw": notch_of_hw,
            "topInsetOfHw": top_inset_of_hw, "archCornerAngleDeg": arch_corner_angle_deg,
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

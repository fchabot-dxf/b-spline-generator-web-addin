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


FEATURE_EXTRACTORS = {"hourglass": _hourglass, "bottle": _bottle, "hourglass_narrow_top": _hourglass_narrow_top,
                      "hourglass_offset_waist": _hourglass_offset_waist}


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

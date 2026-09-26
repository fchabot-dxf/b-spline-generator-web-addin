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


FEATURE_EXTRACTORS = {"hourglass": _hourglass, "bottle": _bottle}


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

"""T3 TAPERED HOURGLASS: the narrow-top shape extractor, the provisional model the app gets until Template 3's
goldens are recorded live, and that Template 1's / Template 2's models are untouched."""
import copy
import glob
import json
import math
import os
import shutil
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine import frame_shape_fit as fsf  # noqa: E402
from fb_engine.frame_definition import template_shape_model  # noqa: E402
from fb_engine.template_resolver import resolve_template  # noqa: E402

_REPO = os.path.dirname(os.path.dirname(_ROOT))
_GOLDENS = os.path.join(_REPO, "tests", "fixtures", "frame-parity")
_SIZES = ("7x9", "12x6", "5.51x1.97")


def _golden(tid, size):
    with open(os.path.join(_GOLDENS, f"{tid}_{size}.json"), encoding="utf-8") as f:
        return json.load(f)


def _narrowed(g, delta):
    """A Template 1 golden made narrow-topped by `delta` (inches) on both sides: the top edge ends, the top horns
    and the shoulder arcs move in; each shoulder centre is then re-seated on its tangency circle about the
    (unmoved) waist centre, so the outline stays tangent (the shoulder's own points are only translated: the
    extractor reads centres, radii and the top edge). None when no tangency is left at that inset."""
    g = copy.deepcopy(g)
    c = g["sketch2_shape_outline"]
    for side, s in (("R", 1), ("L", -1)):
        top = c["top_edge"]
        for k in ("start", "end"):
            if top[k][0] * s > 0:
                top[k][0] -= s * delta
        for k in ("start", "end"):
            c["horn_T" + side][k][0] -= s * delta
        sh, wa = c["arc_shoulder_" + side], c["arc_waist_" + side]
        for k in ("start", "mid", "end", "center"):
            sh[k][0] -= s * delta
        S = sh["radius"] + wa["radius"]
        dx = sh["center"][0] - wa["center"][0]
        if S * S < dx * dx:
            return None
        sh["center"][1] = wa["center"][1] + math.sqrt(S * S - dx * dx)
    return g


def test_the_narrow_top_extractor_reads_template_1_as_a_zero_inset():
    for size in _SIZES:
        g = _golden("template_1", size)
        hw, hh = fsf._safe_half(g["meta"])
        ok, f = fsf.FEATURE_EXTRACTORS["hourglass_narrow_top"](g["sketch2_shape_outline"], hw, hh)
        ok1, f1 = fsf.FEATURE_EXTRACTORS["hourglass"](g["sketch2_shape_outline"], hw, hh)
        assert ok and ok1, size
        assert f["topInset"] == pytest.approx(0, abs=1e-4)
        c = g["sketch2_shape_outline"]
        assert f["cornerRTop"] == c["arc_shoulder_R"]["radius"]
        assert f["cornerR"] == f["cornerRBottom"] == c["arc_hip_R"]["radius"]
        for k in ("depth", "waistR", "waistCy"):
            assert f[k] == f1[k]


def test_the_narrow_top_extractor_measures_a_narrow_top_and_the_template_1_one_rejects_it():
    g = _golden("template_1", "7x9")
    hw, hh = fsf._safe_half(g["meta"])
    c = _narrowed(g, 0.5)["sketch2_shape_outline"]
    ok, f = fsf.FEATURE_EXTRACTORS["hourglass_narrow_top"](c, hw, hh)
    assert ok
    assert f["topInset"] == pytest.approx(0.5, abs=1e-9)
    assert fsf.FEATURE_EXTRACTORS["hourglass"](c, hw, hh)[0] is False  # T1's assumes the shoulder at hw


def test_the_provisional_model_is_template_1_plus_a_top_inset():
    t1 = fsf.fit_shape_model("template_1", "hourglass", _GOLDENS)
    p = fsf.provisional_shape_model(t1, 0.7)
    assert set(p["features"]) == set(t1["features"]) | {"topInset"}
    for k, v in t1["features"].items():
        assert p["features"][k] == v
    d = t1["features"]["depth"]
    assert p["features"]["topInset"] == {"hw": round(0.7 * d["hw"], 6), "hh": round(0.7 * d["hh"], 6)}
    assert p["provisional"]["topInsetOfDepth"] == 0.7
    assert "provisional" not in t1  # the base model is not touched


def test_template_1_and_2_models_are_unchanged_by_the_template_shape_model_path():
    for tid, preset in (("template_1", "hourglass"), ("template_2", "bottle")):
        frame = resolve_template(tid)[0]["Frame"]
        assert "shapeExtractor" not in frame and "provisionalShape" not in frame
        assert template_shape_model(tid, frame, _GOLDENS) == fsf.fit_shape_model(tid, preset, _GOLDENS)


def test_template_3_gets_the_provisional_model_until_its_goldens_exist():
    frame = resolve_template("template_3")[0]["Frame"]
    assert frame["shapeExtractor"] == "hourglass_narrow_top"
    if glob.glob(os.path.join(_GOLDENS, "template_3_*.json")):
        pytest.skip("Template 3's goldens are recorded: the real fit applies")
    m = template_shape_model("template_3", frame, _GOLDENS)
    assert m is not None and m["provisional"]
    assert m == fsf.provisional_shape_model(fsf.fit_shape_model("template_1", "hourglass", _GOLDENS),
                                            frame["provisionalShape"]["topInsetOfDepth"])


def test_template_3_is_fitted_once_goldens_exist(tmp_path):
    """Recorded goldens (here: Template 1's, narrowed by 0.2 hw per size) replace the provisional model with a
    real narrow-top fit."""
    for path in glob.glob(os.path.join(_GOLDENS, "*.json")):
        shutil.copy(path, tmp_path)
    for size in _SIZES:
        g = _golden("template_1", size)
        n = _narrowed(g, 0.2 * fsf._safe_half(g["meta"])[0])
        if n is None:
            continue
        n["meta"]["template"] = "template_3"
        (tmp_path / f"template_3_{size}.json").write_text(json.dumps(n), encoding="utf-8")
    frame = resolve_template("template_3")[0]["Frame"]
    m = template_shape_model("template_3", frame, str(tmp_path))
    assert m is not None and "provisional" not in m
    assert len(m["fit"]["fittedFrom"]) >= 2
    assert {"topInset", "cornerRTop", "cornerRBottom"} <= set(m["features"])
    t = m["features"]["topInset"]
    assert t["hw"] == pytest.approx(0.2, abs=1e-6) and t["hh"] == pytest.approx(0, abs=1e-6)


# ------------------------------------------------------------------ T4 offset hourglass
def _offset(g, dy_right, dy_left):
    """A Template 1 golden with each side's shoulder / waist / hip moved vertically by its own amount (Fusion y
    up), the horns' arc ends with them: each side stays tangent (a pure translation), the two sides now at their
    own heights."""
    g = copy.deepcopy(g)
    c = g["sketch2_shape_outline"]
    for side, dy in (("R", dy_right), ("L", dy_left)):
        for arc in ("arc_shoulder_", "arc_waist_", "arc_hip_"):
            for k in ("start", "mid", "end", "center"):
                c[arc + side][k][1] += dy
    return g


def test_the_offset_extractor_reads_template_1_as_level_pinches():
    for size in _SIZES:
        g = _golden("template_1", size)
        hw, hh = fsf._safe_half(g["meta"])
        ok, f = fsf.FEATURE_EXTRACTORS["hourglass_offset_waist"](g["sketch2_shape_outline"], hw, hh)
        ok1, f1 = fsf.FEATURE_EXTRACTORS["hourglass"](g["sketch2_shape_outline"], hw, hh)
        assert ok == ok1, size
        for k, v in f1.items():
            assert f[k] == v  # the right side is Template 1's own extraction
        if ok:
            assert f["waistCyLeft"] == pytest.approx(f["waistCy"], abs=2e-3)
            assert f["depthLeft"] == pytest.approx(f["depth"], abs=2e-3)
            assert f["notchLeft"] == pytest.approx(f["notch"], abs=2e-3)


def test_the_offset_extractor_measures_each_pinch_height():
    g = _golden("template_1", "7x9")
    hw, hh = fsf._safe_half(g["meta"])
    base = fsf.FEATURE_EXTRACTORS["hourglass_offset_waist"](g["sketch2_shape_outline"], hw, hh)[1]
    ok, f = fsf.FEATURE_EXTRACTORS["hourglass_offset_waist"](_offset(g, -0.6, 0.8)["sketch2_shape_outline"], hw, hh)
    assert ok
    assert f["waistCy"] == pytest.approx(base["waistCy"] + 0.6, abs=1e-9)  # app y-down: the right pinch lower
    assert f["waistCyLeft"] == pytest.approx(base["waistCyLeft"] - 0.8, abs=1e-9)  # the left one higher
    assert f["notchLeft"] == pytest.approx(base["notchLeft"], abs=1e-9)


def test_the_provisional_offset_model_is_template_1_with_the_pinches_apart():
    t1 = fsf.fit_shape_model("template_1", "hourglass", _GOLDENS)
    p = fsf.provisional_offset_waist_model(t1, 0.2)
    assert set(p["features"]) == set(t1["features"]) | {"waistCyLeft", "notchLeft", "depthLeft"}
    for k, v in t1["features"].items():
        if k != "waistCy":
            assert p["features"][k] == v
    cy = t1["features"]["waistCy"]
    assert p["features"]["waistCy"] == {"hw": cy["hw"], "hh": round(cy["hh"] + 0.2, 6)}
    assert p["features"]["waistCyLeft"] == {"hw": cy["hw"], "hh": round(cy["hh"] - 0.2, 6)}
    assert p["features"]["notchLeft"] == t1["features"]["notch"] and p["features"]["depthLeft"] == t1["features"]["depth"]
    assert p["provisional"]["waistOffsetOfHh"] == 0.2
    assert "provisional" not in t1


def test_template_4_gets_the_provisional_model_until_its_goldens_exist():
    frame = resolve_template("template_4")[0]["Frame"]
    assert frame["shapeExtractor"] == "hourglass_offset_waist"
    if glob.glob(os.path.join(_GOLDENS, "template_4_*.json")):
        pytest.skip("Template 4's goldens are recorded: the real fit applies")
    m = template_shape_model("template_4", frame, _GOLDENS)
    assert m is not None and m["provisional"]
    assert m == fsf.provisional_offset_waist_model(fsf.fit_shape_model("template_1", "hourglass", _GOLDENS),
                                                   frame["provisionalShape"]["waistOffsetOfHh"])
    # Template 3's provisional model is still the narrow-top one
    f3 = resolve_template("template_3")[0]["Frame"]
    assert "topInset" in template_shape_model("template_3", f3, _GOLDENS)["features"]


def test_template_4_is_fitted_once_goldens_exist(tmp_path):
    """Recorded goldens (here: Template 1's, the right side 0.1 hh down and the left 0.1 hh up per size) replace
    the provisional model with a real offset fit."""
    for path in glob.glob(os.path.join(_GOLDENS, "*.json")):
        shutil.copy(path, tmp_path)
    for size in _SIZES:
        g = _golden("template_1", size)
        hh = fsf._safe_half(g["meta"])[1]
        n = _offset(g, -0.1 * hh, 0.1 * hh)
        n["meta"]["template"] = "template_4"
        (tmp_path / f"template_4_{size}.json").write_text(json.dumps(n), encoding="utf-8")
    frame = resolve_template("template_4")[0]["Frame"]
    m = template_shape_model("template_4", frame, str(tmp_path))
    t1 = fsf.fit_shape_model("template_1", "hourglass", _GOLDENS)
    assert m is not None and "provisional" not in m
    assert m["fit"]["fittedFrom"] == t1["fit"]["fittedFrom"]
    assert {"waistCyLeft", "notchLeft", "depthLeft"} <= set(m["features"])
    d = m["features"]["waistCy"]["hh"] - m["features"]["waistCyLeft"]["hh"]
    assert d == pytest.approx(0.2, abs=1e-6)

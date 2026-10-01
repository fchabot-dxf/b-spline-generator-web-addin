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
from fb_engine import frame_definition as fd  # noqa: E402
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


# ------------------------------------------------------------------ T5 hourglass dipped top
def _dipped(g, a_of_hw, d_of_hh):
    """A Template 1 golden with a dipped top added (Fusion y up): top shoulders at (+/-a, hh - r), the dip centre at
    (0, hh - d + r), all three radius r = (a^2 + d^2) / 4d (tangent, as the app draws it)."""
    g = copy.deepcopy(g)
    hw, hh = fsf._safe_half(g["meta"])
    a, d = a_of_hw * hw, d_of_hh * hh
    r = (a * a + d * d) / (4 * d)
    c = g["sketch2_shape_outline"]
    c["arc_top_shoulder_L"] = {"center": [-a, hh - r], "radius": r}
    c["arc_top_shoulder_R"] = {"center": [a, hh - r], "radius": r}
    c["arc_top_dip"] = {"center": [0.0, hh - d + r], "radius": r}
    return g


def test_the_dipped_top_extractor_reads_the_sides_as_template_1_and_measures_the_dip():
    for size in _SIZES:
        g = _dipped(_golden("template_1", size), 0.6, 0.1)
        hw, hh = fsf._safe_half(g["meta"])
        ok, f = fsf.FEATURE_EXTRACTORS["hourglass_dipped_top"](g["sketch2_shape_outline"], hw, hh)
        ok1, f1 = fsf.FEATURE_EXTRACTORS["hourglass"](g["sketch2_shape_outline"], hw, hh)
        assert ok == ok1, size
        for k, v in f1.items():
            assert f[k] == v  # the sides are Template 1's own extraction
        assert f["topDipHalfWidth"] == pytest.approx(0.6 * hw, abs=1e-9)
        assert f["topDipDepth"] == pytest.approx(0.1 * hh, abs=1e-9)


def test_the_dipped_top_extractor_rejects_an_off_centre_or_untangent_dip():
    g = _dipped(_golden("template_1", "7x9"), 0.6, 0.1)
    hw, hh = fsf._safe_half(g["meta"])
    assert fsf.FEATURE_EXTRACTORS["hourglass_dipped_top"](g["sketch2_shape_outline"], hw, hh)[0]
    bad = copy.deepcopy(g)
    bad["sketch2_shape_outline"]["arc_top_dip"]["center"][0] += 0.05
    assert not fsf.FEATURE_EXTRACTORS["hourglass_dipped_top"](bad["sketch2_shape_outline"], hw, hh)[0]
    bad = copy.deepcopy(g)
    bad["sketch2_shape_outline"]["arc_top_shoulder_R"]["center"][1] -= 0.05
    assert not fsf.FEATURE_EXTRACTORS["hourglass_dipped_top"](bad["sketch2_shape_outline"], hw, hh)[0]


def test_the_provisional_dipped_top_model_is_template_1_plus_the_dip():
    t1 = fsf.fit_shape_model("template_1", "hourglass", _GOLDENS)
    p = fsf.provisional_dipped_top_model(t1, 0.14, 0.72)
    assert set(p["features"]) == set(t1["features"]) | {"topDipDepth", "topDipHalfWidth"}
    for k, v in t1["features"].items():
        assert p["features"][k] == v
    assert p["features"]["topDipDepth"] == {"hw": 0.0, "hh": 0.14}
    assert p["features"]["topDipHalfWidth"] == {"hw": 0.72, "hh": 0.0}
    assert p["provisional"]["topDipDepthOfHh"] == 0.14 and p["provisional"]["topDipHalfWidthOfHw"] == 0.72
    assert "provisional" not in t1


def test_template_5_gets_the_provisional_model_until_its_goldens_exist():
    frame = resolve_template("template_5")[0]["Frame"]
    assert frame["shapeExtractor"] == "hourglass_dipped_top"
    if glob.glob(os.path.join(_GOLDENS, "template_5_*.json")):
        pytest.skip("Template 5's goldens are recorded: the real fit applies")
    m = template_shape_model("template_5", frame, _GOLDENS)
    assert m is not None and m["provisional"]
    prov = frame["provisionalShape"]
    assert m == fsf.provisional_dipped_top_model(fsf.fit_shape_model("template_1", "hourglass", _GOLDENS),
                                                 prov["topDipDepthOfHh"], prov["topDipHalfWidthOfHw"])
    # Templates 3 and 4 keep their own provisional models
    assert "topInset" in template_shape_model("template_3", resolve_template("template_3")[0]["Frame"], _GOLDENS)["features"]
    assert "waistCyLeft" in template_shape_model("template_4", resolve_template("template_4")[0]["Frame"], _GOLDENS)["features"]


def test_template_5_is_fitted_once_goldens_exist(tmp_path):
    """Recorded goldens (here: Template 1's with a 0.6 hw wide, 0.1 hh deep dip added per size) replace the
    provisional model with a real dipped-top fit."""
    for path in glob.glob(os.path.join(_GOLDENS, "*.json")):
        shutil.copy(path, tmp_path)
    for size in _SIZES:
        n = _dipped(_golden("template_1", size), 0.6, 0.1)
        n["meta"]["template"] = "template_5"
        (tmp_path / f"template_5_{size}.json").write_text(json.dumps(n), encoding="utf-8")
    frame = resolve_template("template_5")[0]["Frame"]
    m = template_shape_model("template_5", frame, str(tmp_path))
    t1 = fsf.fit_shape_model("template_1", "hourglass", _GOLDENS)
    assert m is not None and "provisional" not in m
    assert m["fit"]["fittedFrom"] == t1["fit"]["fittedFrom"]
    w, d = m["features"]["topDipHalfWidth"], m["features"]["topDipDepth"]
    assert w["hw"] == pytest.approx(0.6, abs=1e-6) and w["hh"] == pytest.approx(0, abs=1e-6)
    assert d["hh"] == pytest.approx(0.1, abs=1e-6) and d["hw"] == pytest.approx(0, abs=1e-6)


# ------------------------------------------------------------------ T6 tab top
def _tab_outline(hw, hh, a, h):
    """A Template 6 sketch-2 outline (Fusion y up) with tab half width a and height h."""
    ys = hh - h
    pts = {"tab_top": ((-a, hh), (a, hh)), "tab_side_R": ((a, hh), (a, ys)), "shoulder_R": ((a, ys), (hw, ys)),
           "side_R": ((hw, ys), (hw, -hh)), "bottom_edge": ((hw, -hh), (-hw, -hh)), "side_L": ((-hw, -hh), (-hw, ys)),
           "shoulder_L": ((-hw, ys), (-a, ys)), "tab_side_L": ((-a, ys), (-a, hh))}
    return {k: {"start": list(s), "end": list(e)} for k, (s, e) in pts.items()}


def test_the_tab_top_extractor_measures_the_tab_and_rejects_an_off_centre_one():
    ok, f = fsf._tab_top(_tab_outline(3.25, 4.25, 1.6, 2.0), 3.25, 4.25)
    assert ok and f["tabHalfWidth"] == pytest.approx(1.6) and f["tabHeight"] == pytest.approx(2.0)
    c = _tab_outline(3.25, 4.25, 1.6, 2.0)
    c["tab_top"]["end"][0] += 0.1  # off centre
    assert fsf._tab_top(c, 3.25, 4.25)[0] is False


def test_template_6_gets_its_own_provisional_model_until_its_goldens_exist():
    frame = resolve_template("template_6")[0]["Frame"]
    assert frame["shapeExtractor"] == "tab_top" and "from" not in frame["provisionalShape"]
    if glob.glob(os.path.join(_GOLDENS, "template_6_*.json")):
        pytest.skip("Template 6's goldens are recorded: the real fit applies")
    m = template_shape_model("template_6", frame, _GOLDENS)
    assert m == fsf.provisional_tab_top_model(0.5, 0.5)
    assert m["features"] == {"tabHalfWidth": {"hw": 0.5, "hh": 0.0}, "tabHeight": {"hw": 0.0, "hh": 0.5}}
    assert m["provisional"]["baseModel"] is None


def test_template_6_is_fitted_once_goldens_exist(tmp_path):
    """Recorded goldens (synthetic tab outlines, a = 0.45 hw, h = 0.4 hh per size) replace the provisional model."""
    for path in glob.glob(os.path.join(_GOLDENS, "*.json")):
        shutil.copy(path, tmp_path)
    for size, (w, h) in {"7x9": (7, 9), "12x6": (12, 6), "5.51x1.97": (5.51, 1.97)}.items():
        hw, hh = w / 2 - 0.25, h / 2 - 0.25
        g = {"meta": {"template": "template_6", "widthIn": w, "heightIn": h},
             "sketch2_shape_outline": _tab_outline(hw, hh, 0.45 * hw, 0.4 * hh)}
        (tmp_path / f"template_6_{size}.json").write_text(json.dumps(g), encoding="utf-8")
    m = template_shape_model("template_6", resolve_template("template_6")[0]["Frame"], str(tmp_path))
    assert m is not None and "provisional" not in m
    a, h = m["features"]["tabHalfWidth"], m["features"]["tabHeight"]
    assert a["hw"] == pytest.approx(0.45, abs=1e-6) and a["hh"] == pytest.approx(0, abs=1e-6)
    assert h["hh"] == pytest.approx(0.4, abs=1e-6) and h["hw"] == pytest.approx(0, abs=1e-6)


def _diamond_roof(g, rise_of_run=1.0):
    """A Template 1 golden with its own flat `top_edge` replaced by a synthetic `roof_R`/`roof_L` pair: each
    runs from its own top horn's own corner (`horn_TR`/`horn_TL`'s own `start`, UNCHANGED) up to a peak on the
    centre line, at `rise_of_run` x the horn's own half-width above it (1.0 = a genuine 90 deg apex; any other
    value is deliberately WRONG, to prove the extractor's own validation actually checks it, not just reads
    whatever two points it is given)."""
    g = copy.deepcopy(g)
    c = g["sketch2_shape_outline"]
    hTR, hTL = c["horn_TR"]["start"], c["horn_TL"]["start"]
    run = hTR[0]
    peak = [0.0, hTR[1] + rise_of_run * run]
    c["roof_R"] = {"construction": False, "type": "line", "start": list(peak), "end": list(hTR)}
    c["roof_L"] = {"construction": False, "type": "line", "start": list(hTL), "end": list(peak)}
    del c["top_edge"]
    return g


def test_the_diamond_top_extractor_reads_a_genuine_90_deg_peak_and_rejects_a_wrong_one():
    for size in _SIZES:
        base = _golden("template_1", size)
        hw, hh = fsf._safe_half(base["meta"])
        g_ok = _diamond_roof(base, rise_of_run=1.0)
        ok, f = fsf.FEATURE_EXTRACTORS["diamond_top_hourglass"](g_ok["sketch2_shape_outline"], hw, hh)
        assert ok, size
        # the SAME features Template 1's own extractor reads (the sides are unchanged) -- non-vacuous: this is
        # not just "ok is always True", the feature VALUES genuinely come from the (unchanged) side geometry
        ok1, f1 = fsf.FEATURE_EXTRACTORS["hourglass"](base["sketch2_shape_outline"], hw, hh)
        assert ok1 and f == f1
        # a wrong apex (not rise = run) is REJECTED, proving the check is real
        g_bad = _diamond_roof(base, rise_of_run=0.5)
        ok_bad, _ = fsf.FEATURE_EXTRACTORS["diamond_top_hourglass"](g_bad["sketch2_shape_outline"], hw, hh)
        assert not ok_bad, size
        # an off-centre peak is ALSO rejected (the two roof lines must actually meet on the centre line)
        g_off = _diamond_roof(base, rise_of_run=1.0)
        g_off["sketch2_shape_outline"]["roof_R"]["start"][0] += 0.2
        ok_off, _ = fsf.FEATURE_EXTRACTORS["diamond_top_hourglass"](g_off["sketch2_shape_outline"], hw, hh)
        assert not ok_off, size


def test_template_7_inherits_template_1s_own_fitted_model_plus_a_presence_only_topPeak_feature():
    """T7 DIAMOND-TOP HOURGLASS needs no goldens of its own: `{"from": "template_1"}` (no extra key) asks for
    Template 1's own model UNCHANGED, plus `topPeak`/`shoulderLedge`/`hipFlare` (frame_definition.py's own
    template_shape_model doc comment) -- the EXISTING goldens already in _GOLDENS (recorded for Template 1)
    are enough."""
    t1_frame = resolve_template("template_1")[0]["Frame"]
    t1_model = template_shape_model("template_1", t1_frame, _GOLDENS)
    t7_frame = resolve_template("template_7")[0]["Frame"]
    m = template_shape_model("template_7", t7_frame, _GOLDENS)
    assert m is not None
    assert m["provisional"] is None if "provisional" in m else True  # a REAL fit, not a provisional stub
    for name in ("cornerR", "depth", "notch", "waistCy", "waistR"):
        assert m["features"][name] == t1_model["features"][name]
    assert m["features"]["topPeak"] == {"hw": 0, "hh": 0}
    # shoulderLedge/hipFlare carry T7's own default proportions (fd.T7_SHOULDER_LEDGE_DEFAULT_OF_HW /
    # T7_HIP_FLARE_DEFAULT_OF_HW), encoded as the feature's `hw` coefficient (paramsFromShapeModel's own
    # `f.name / hw` round-trips it back to that exact fraction).
    assert m["features"]["shoulderLedge"] == {"hw": fd.T7_SHOULDER_LEDGE_DEFAULT_OF_HW, "hh": 0}
    assert m["features"]["hipFlare"] == {"hw": fd.T7_HIP_FLARE_DEFAULT_OF_HW, "hh": 0}
    assert m["fit"]["fittedFrom"] == t1_model["fit"]["fittedFrom"]  # the SAME fit report, not re-derived

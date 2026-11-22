"""
Template 20 (Trapezoid, Fred 2026-11-22: "a simple trapezoid ... narrow side up or down simply", amended the same
day: "irregular taper sides too"): the Fusion builder's side, pure Python, no Fusion.

Four straight pieces, clockwise from the top-left corner (top_edge, side_R, bottom_edge, side_L), each mitred at
its start. The two horizontal sides ride the safe zone's top / bottom lines; the four x positions are left to the
seeds (the app's Left inset / Right inset / Narrow side Up|Down, sent as seed geometry), so ONE constraint set
builds every case -- symmetric, asymmetric (a 0% side is vertical: a right-angle trapezoid) and Up or Down.
Every corner is a line-line corner at its own angle: its inner point is the true offset-line intersection
(Line1FarID / Line2FarID), so each miter bisects the corner's actual angle.
"""
import math
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine.seed_geometry import apply_seed_geometry  # noqa: E402
from fb_engine import inner_corners  # noqa: E402
from fb_engine.frame_shape_fit import FEATURE_EXTRACTORS, provisional_trapezoid_model  # noqa: E402

TID = "template_20"
BOARDS = [(7, 9), (9, 12), (6, 9)]
PIECES = ["top_edge", "side_R", "bottom_edge", "side_L"]
IN = 2.54


def _sketch(t, name):
    return next(s for s in t["Sketches"] if s["Name"] == name)


def _steps(sketch):
    return [st for b in sketch["Blocks"] for st in (b.get("BuildSequence") or [])]


def _ev(W, H, bbo):
    env = {"widthIn": W, "heightIn": H, "boundingboxoffset": bbo}
    return lambda e: eval(e.replace(" in", ""), {"__builtins__": {}}, env)  # noqa: S307 -- test-only, controlled strings


def _lines(t, W, H, bbo=0.25):
    ev = _ev(W, H, bbo)
    out = {}
    for st in _steps(_sketch(t, "2_shape_outline")):
        if st.get("Type") == "Line" and st.get("ID") in PIECES:
            out[st["ID"]] = [(ev(x), ev(y)) for x, y in st["Points"]]
    return out


def test_declared_as_template_20_trapezoid_four_mitred_bars():
    t, _ = resolve_template(TID)
    assert t["Name"] == "Template 20 - Trapezoid"
    f = t["Frame"]
    assert f["silhouettePreset"] == "trapezoid"
    assert f["regions"]["outline"] == ["proj_" + p for p in PIECES]
    assert f["regions"]["miters"] == [[f"proj_{p}:S", f"inner_proj_{p}:S"] for p in PIECES]
    assert [b["name"] for b in f["regions"]["bars"]] == ["frame_top", "frame_right", "frame_bottom", "frame_left"]
    assert [c["reflex"] for c in f["regions"]["corners"]] == [False] * 4
    assert [(e["id"], e["kind"], e["prim"]) for e in f["seedMap"]] == [(p, "line", i) for i, p in enumerate(PIECES)]
    assert [h["key"] for h in f["handles"]] == ["leftInset", "rightInset", "insetLink", "narrowSide"]
    assert all(h["binding"] == "seeded" for h in f["handles"])  # no Fusion user parameter (Fred's rule)


@pytest.mark.parametrize("W,H", BOARDS)
def test_unseeded_literal_is_the_default_symmetric_15_15_narrow_side_up(W, H):
    """The literal (unseeded) build -- Sketch Builder, goldens -- is the declared default: each narrow end 15% of
    the wide side in from its corner, the narrow side up, exact at every board (safe-zone expressions, not 7x9
    fractions), within the phases' own 0.001 in anti-auto-coincidence nudges."""
    t, _ = resolve_template(TID)
    hw, hh = W / 2 - 0.25, H / 2 - 0.25
    L = _lines(t, W, H)
    want = {"top_edge": (-hw + 0.3 * hw, hh), "side_R": (hw - 0.3 * hw, hh),
            "bottom_edge": (hw, -hh), "side_L": (-hw, -hh)}
    for p in PIECES:
        assert L[p][0][0] == pytest.approx(want[p][0], abs=0.0021), (p, L[p])
        assert L[p][0][1] == pytest.approx(want[p][1], abs=0.0021), (p, L[p])


def test_unseeded_literal_follows_the_safe_zone_at_a_bigger_trim_offset():
    """F14 seed basis: at boundingboxoffset 0.5 the literal corners sit on the SMALLER safe zone."""
    t, _ = resolve_template(TID)
    hw, hh = 7 / 2 - 0.5, 9 / 2 - 0.5
    L = _lines(t, 7, 9, bbo=0.5)
    assert L["bottom_edge"][0][0] == pytest.approx(hw, abs=0.0021)
    assert L["side_L"][0][0] == pytest.approx(-hw, abs=0.0021)
    assert L["top_edge"][0][1] == pytest.approx(hh, abs=0.0021)


def test_one_constraint_set_for_every_case_no_corner_pins():
    """Up/Down and any inset pair share ONE topology: the top and bottom pieces each lie on their own safe-zone line
    (a point on the line + Horizontal), the 4 pieces weld head to tail, and nothing pins a corner -- the 4 corner
    x values are the seeds' (so a Down build never fights an Up-only corner pin)."""
    t, _ = resolve_template(TID)
    steps = _steps(_sketch(t, "2_shape_outline"))
    co = [tuple(s["Targets"]) for s in steps if s.get("Type") == "Coincident"]
    assert ("top_edge:E", "side_R:S") in co and ("side_R:E", "bottom_edge:S") in co
    assert ("bottom_edge:E", "side_L:S") in co and ("side_L:E", "top_edge:S") in co
    assert ("top_edge:S", "proj_off_BB_top") in co and ("bottom_edge:S", "proj_off_BB_bottom") in co
    assert len(co) == 6
    assert not any("corner" in x for c in co for x in c)
    hz = [x for s in steps if s.get("Type") == "Horizontal" for x in s["Targets"]]
    assert sorted(hz) == ["bottom_edge", "top_edge"]
    assert not any(s.get("Type") in ("Vertical", "Equal", "Symmetry", "Distance") for s in steps)


def _app_seed_geometry(W, H, left, right, up):
    """What the app sends (editor/frame-handles.js frameSeedGeometry): the 4 lines, Fusion inches, centred, y up.
    left / right = each narrow end's inset from its wide-side corner, a fraction of hw."""
    hw, hh = W / 2 - 0.25, H / 2 - 0.25
    yn, yw = (hh, -hh) if up else (-hh, hh)
    nl, nr = (-hw + left * hw, yn), (hw - right * hw, yn)
    wl, wr = (-hw, yw), (hw, yw)
    TL, TR, BR, BL = (nl, nr, wr, wl) if up else (wl, wr, nr, nl)
    return {"top_edge": {"points": [list(TL), list(TR)]}, "side_R": {"points": [list(TR), list(BR)]},
            "bottom_edge": {"points": [list(BR), list(BL)]}, "side_L": {"points": [list(BL), list(TL)]}}


@pytest.mark.parametrize("left,right,up", [(0.3, 0.3, True), (0.3, 0.3, False), (0.0, 0.6, True), (0.0, 0.6, False)])
def test_the_apps_seed_geometry_moves_every_seed(left, right, up):
    t, _ = resolve_template(TID)
    seeds = _app_seed_geometry(7, 9, left, right, up)
    out = apply_seed_geometry(t, seeds)  # raises SeedGeometryError on any id the template lacks
    got = {st["ID"]: st["Points"] for st in _steps(_sketch(out, "2_shape_outline")) if st.get("ID") in PIECES}
    for p in PIECES:
        assert got[p] == [[f"{float(x)} in", f"{float(y)} in"] for x, y in seeds[p]["points"]]


class _Pt:
    def __init__(self, x, y):
        self.geometry = types.SimpleNamespace(x=x, y=y)


def _resolve_inner_corners(t, corners_cm, t_cm):
    """Run the template's own declared ResolveInnerCorners step (fb_engine/inner_corners.py) on a fake sketch whose
    outline corners are `corners_cm` (TL, TR, BR, BL; Fusion cm, y up) and whose only other points are the TRUE
    inner corners plus decoys at the axis-aligned (+-t, +-t) guesses -- returns {InnerID: (x, y)}."""
    enc = _sketch(t, "3_frame_enclosure")
    step = next(s for s in _steps(enc) if s.get("Type") == "ResolveInnerCorners")
    TL, TR, BR, BL = corners_cm
    ends = {"proj_top_edge": (TL, TR), "proj_side_R": (TR, BR), "proj_bottom_edge": (BR, BL), "proj_side_L": (BL, TL)}
    emap = {}
    for cid, (s, e) in ends.items():
        emap[f"{cid}:S"], emap[f"{cid}:E"] = _Pt(*s), _Pt(*e)
    # the true inner quad: each outline line offset inward by t, intersected with its neighbours
    def inner_pt(prev_s, corner, nxt_e):
        d1 = _unit((nxt_e[0] - corner[0], nxt_e[1] - corner[1]))
        d2 = _unit((prev_s[0] - corner[0], prev_s[1] - corner[1]))
        return inner_corners.line_line_inner_corner(corner, d1, d2, t_cm, (0.0, 0.0))[2]
    quad = [inner_pt(BL, TL, TR), inner_pt(TL, TR, BR), inner_pt(TR, BR, BL), inner_pt(BR, BL, TL)]
    decoys = [(c[0] + sx * t_cm, c[1] + sy * t_cm) for c, (sx, sy) in zip(corners_cm, [(1, -1), (-1, -1), (-1, 1), (1, 1)])]
    pts = [_Pt(*p) for p in quad + decoys]
    sketch = types.SimpleNamespace(sketchPoints=types.SimpleNamespace(count=len(pts), item=lambda i: pts[i]))
    tagged = {}
    ctx = types.SimpleNamespace(
        design=types.SimpleNamespace(unitsManager=types.SimpleNamespace(evaluateExpression=lambda e, u: t_cm)),
        logger=types.SimpleNamespace(log=lambda *a, **k: None), entity_map={"S3": emap},
        set_id=lambda pt, s, kind, override_id=None: tagged.__setitem__(override_id, (pt.geometry.x, pt.geometry.y)))
    inner_corners.inner_corner_step(ctx, sketch, "S3", step)
    return tagged, quad


def _unit(v):
    n = math.hypot(*v)
    return (v[0] / n, v[1] / n)


def _angle(u, v):
    return math.degrees(math.acos(max(-1.0, min(1.0, u[0] * v[0] + u[1] * v[1]))))


@pytest.mark.parametrize("left,right,up", [(0.3, 0.3, True), (0.3, 0.3, False), (0.0, 0.6, True), (0.0, 0.6, False)])
def test_every_miter_bisects_its_own_corner_angle(left, right, up):
    """The Fusion side resolves each inner corner at the TRUE offset-line intersection (not the axis-aligned
    (+-t, +-t) guess, which is only right at 90 deg), so the miter outer -> inner bisects the corner's actual
    angle -- also at an asymmetric trapezoid, whose corner angles all differ (0/30: two 90 deg corners on the
    vertical side, an acute and an obtuse one on the slanted side)."""
    t, _ = resolve_template(TID)
    g = _app_seed_geometry(7, 9, left, right, up)
    corners = [tuple(c * IN for c in g[p]["points"][0]) for p in PIECES]  # TL, TR, BR, BL (each piece's start)
    t_cm = 0.75 * IN
    tagged, quad = _resolve_inner_corners(t, corners, t_cm)
    angles = []
    for i, p in enumerate(PIECES):
        inner = tagged[f"inner_proj_{p}:S"]
        assert inner == pytest.approx(quad[i], abs=1e-9), p  # the true corner, never a decoy
        o, nxt, prv = corners[i], corners[(i + 1) % 4], corners[(i - 1) % 4]
        m = _unit((inner[0] - o[0], inner[1] - o[1]))
        a, b = _unit((nxt[0] - o[0], nxt[1] - o[1])), _unit((prv[0] - o[0], prv[1] - o[1]))
        theta = _angle(a, b)
        angles.append(theta)
        assert _angle(m, a) == pytest.approx(theta / 2, abs=1e-9), p
        assert _angle(m, b) == pytest.approx(theta / 2, abs=1e-9), p
        assert math.hypot(inner[0] - o[0], inner[1] - o[1]) == pytest.approx(t_cm / math.sin(math.radians(theta / 2)), abs=1e-9)
    assert sum(angles) == pytest.approx(360, abs=1e-9)
    if left != right:  # 0/30: the vertical side's corners are square, the slanted side's are not
        sq = [a for a in angles if abs(a - 90) < 1e-9]
        assert len(sq) == 2 and len({round(a, 6) for a in angles}) == 3


def test_provisional_model_and_extractor():
    """The app's shape model until goldens are recorded live: each narrow end 0.3 x hw (15% of the wide side) in.
    The extractor reads the same two insets back from a recorded outline (Up or Down)."""
    m = provisional_trapezoid_model(0.3, 0.3)
    assert m["features"] == {"leftInset": {"hw": 0.3, "hh": 0.0}, "rightInset": {"hw": 0.3, "hh": 0.0}}
    assert m["provisional"]["leftInsetOfHw"] == 0.3 and m["fit"]["fittedFrom"] == []
    t, _ = resolve_template(TID)
    assert t["Frame"]["shapeExtractor"] == "trapezoid"
    ex = FEATURE_EXTRACTORS["trapezoid"]
    hw, hh = 3.25, 4.25
    for up in (True, False):
        g = _app_seed_geometry(7, 9, 0.0, 0.6, up)
        curves = {p: {"start": g[p]["points"][0], "end": g[p]["points"][1]} for p in PIECES}
        ok, feats = ex(curves, hw, hh)
        assert ok, up
        assert feats["leftInset"] == pytest.approx(0.0, abs=1e-12)
        assert feats["rightInset"] == pytest.approx(0.6 * hw, abs=1e-12)

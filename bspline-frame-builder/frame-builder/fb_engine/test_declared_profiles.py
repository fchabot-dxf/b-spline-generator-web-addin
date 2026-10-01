"""F14 (S6): the extruder's profile -> feature choice comes from the template's
DECLARED frame features (declared_profiles), not the bounding box. The
profiles here are the real templates' declared curve ids; the live-recorded
ones (tests/fixtures/frame-profiles-live.json) are checked in
test_declared_profiles_live below."""
import json
import os
import sys
import types

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine import declared_profiles as dp  # noqa: E402
from fb_engine.frame_definition import FRAME_BOTTOM_PARAM  # noqa: E402
from fb_engine.template_resolver import resolve_template  # noqa: E402

_REPO = os.path.dirname(os.path.dirname(_ROOT))
_LIVE = os.path.join(_REPO, "tests", "fixtures", "frame-profiles-live.json")
_GOLDENS = os.path.join(_REPO, "tests", "fixtures", "frame-parity")


def _frame(tid):
    return resolve_template(tid)[0]["Frame"]


def _bar_profiles(frame):
    """The 4 bar profiles as the declaration draws them: the outline run
    between two miter starts, its inner offsets, and the two miters."""
    reg = frame["regions"]
    outline = reg["outline"]
    starts = [outline.index(m[0].split(":")[0]) for m in reg["miters"]]
    out = []
    for k, s in enumerate(starts):
        e = starts[(k + 1) % len(starts)] or len(outline)
        run = outline[s:e]
        out.append(set(run) | {"inner_" + c for c in run} | {f"miter-{reg['miters'][k][0]}", "miter-next"})
    return out


@pytest.mark.parametrize("tid", ["template_1", "template_2", "template_3", "template_4", "template_5", "template_8"])
def test_each_bar_profile_gets_its_declared_body_name(tid):
    frame = _frame(tid)
    bars = frame["features"][0]
    names = [dp.classify(ids, frame) for ids in _bar_profiles(frame)]
    assert [f["id"] for f, _ in names] == ["bars"] * 4
    assert [n for _, n in names] == ["frame_top", "frame_right", "frame_bottom", "frame_left"] == bars["bodyNames"]


@pytest.mark.parametrize("tid", ["template_1", "template_2", "template_3", "template_4", "template_5", "template_6", "template_8"])
def test_trim_and_opening(tid):
    frame = _frame(tid)
    reg = frame["regions"]
    trim_ids = set(reg["outline"]) | {reg["surround"], "surround_right", "surround_bottom", "surround_left"}
    feat, name = dp.classify(trim_ids, frame)
    assert (feat["id"], name) == ("trim", None)
    assert dp.classify(set(reg["inner"][:5]), frame) == (None, None)  # the opening: inner curves only
    # MEASURED F14 (T2 12x6): the re-solved inner offset curves carry no id at all
    assert dp.classify(set(), frame) == (None, None)


# ------------------------------------------------------------------ N-BAR
@pytest.mark.parametrize("tid", ["template_1", "template_2", "template_3", "template_4", "template_5", "template_8"])
def test_templates_1_to_5_keep_the_4_bar_default(tid):
    """N-BAR: no declared bar / corner list: the bars come from the miter walk and the 4 default names."""
    frame = _frame(tid)
    assert "bars" not in frame["regions"] and "corners" not in frame["regions"]
    bars = dp.frame_bars(frame)
    assert [b["name"] for b in bars] == ["frame_top", "frame_right", "frame_bottom", "frame_left"]
    assert sorted(c for b in bars for c in b["curves"]) == sorted(frame["regions"]["outline"])  # every curve, once


def test_template_6_declares_8_bars_one_per_outline_piece():
    """Template 6 (Tab Top): the declared bars ARE the classification: 8 profiles -> 8 named bodies, each bounded by
    its one outline piece, its inner offset and the two miters at its ends (the inside corners included)."""
    frame = _frame("template_6")
    reg = frame["regions"]
    names = ["frame_tab_top", "frame_tab_right", "frame_shoulder_right", "frame_side_right",
             "frame_base", "frame_side_left", "frame_shoulder_left", "frame_tab_left"]
    assert [b["name"] for b in dp.frame_bars(frame)] == names == frame["features"][0]["bodyNames"]
    assert [b["curves"] for b in reg["bars"]] == [[c] for c in reg["outline"]]
    n = len(reg["miters"])
    for k, c in enumerate(reg["outline"]):
        ids = {c, "inner_" + c, dp.miter_curve_id(*reg["miters"][k]), dp.miter_curve_id(*reg["miters"][(k + 1) % n])}
        assert dp.classify(ids, frame) == (frame["features"][0], names[k])
        # the miter walk (the default rule) agrees with the declaration
        assert dp.bar_index(c, {k2: v for k2, v in reg.items() if k2 != "bars"}) == k
    # a profile spanning two pieces means a miter did not split it: refused, never guessed
    with pytest.raises(dp.DeclaredProfileError):
        dp.classify({reg["outline"][1], reg["outline"][2]}, frame)


def test_the_plan_reads_start_extent_and_op_from_the_declaration():
    frame = _frame("template_1")
    bars, trim = frame["features"]
    assert bars["start"] == FRAME_BOTTOM_PARAM
    p = dp.extrude_plan(bars, "frame_top", "frame_height_offset")
    assert p == {"kind": "BAR", "name": "frame_top", "start": "frame_height_offset",
                 "extent": ("toFace", "0 in"), "taper": "0 deg", "order": "bars"}
    assert dp.extrude_plan(trim, None, "frame_height_offset") == {
        "kind": "SURROUND", "name": None, "start": "0 in", "extent": ("throughAll",),
        "taper": "0 deg", "order": "trim"}
    # a template declaring another start / offset is honoured, not overridden
    other = dict(bars, start="0.5 in", extent={"toFace": "core.underside", "offset": "0.1 in"})
    assert dp.extrude_plan(other, "frame_top", "frame_height_offset")["start"] == "0.5 in"
    assert dp.extrude_plan(other, "frame_top", "x")["extent"] == ("toFace", "0.1 in")


def test_undescribed_profiles_are_errors_not_guesses():
    frame = _frame("template_1")
    with pytest.raises(dp.DeclaredProfileError, match="spans 2 bars"):
        dp.classify({"proj_top_edge", "proj_horn_TR"}, frame)  # a miter missing: two bars fused
    with pytest.raises(dp.DeclaredProfileError, match="not in the declared regions"):
        dp.classify({"something_else"}, frame)
    with pytest.raises(dp.DeclaredProfileError, match="no feature for region"):
        dp.classify({"proj_top_edge"}, dict(frame, features=[frame["features"][1]]))


def test_bar_index_wraps_before_the_first_miter():
    reg = {"outline": ["a", "b", "c", "d"], "miters": [["b:S", "inner_b:S"], ["d:S", "inner_d:S"]]}
    assert [dp.bar_index(c, reg) for c in "abcd"] == [1, 0, 0, 1]


# ---------------------------------------------------------------- live-recorded profiles
_live = json.load(open(_LIVE, encoding="utf-8")) if os.path.exists(_LIVE) else {"cases": []}


def test_live_fixture_is_present():
    assert len(_live["cases"]) >= 2


@pytest.mark.parametrize("case", _live["cases"], ids=lambda c: c["golden"])
def test_declared_profiles_live(case):
    """The real Fusion profiles' curve ids (recorded live, F14) classify to
    the golden's 4 bars (each bar's area x 1 in height = the golden volume)
    + one trim + the opening."""
    frame = _frame(case["template"])
    golden = json.load(open(os.path.join(_GOLDENS, case["golden"] + ".json"), encoding="utf-8"))
    got = {}
    for prof in case["profiles"]:
        feat, name = dp.classify(set(prof["ids"]), frame)
        key = name or (feat["id"] if feat else "opening")
        assert key not in got, key
        got[key] = prof["area"]
    assert sorted(got) == sorted(list(golden["bars"]) + ["trim", "opening"])
    height = 1.0  # frame bottom -1 in to the core underside z = 0
    for name, bar in golden["bars"].items():
        assert got[name] * height == pytest.approx(bar["volume"], abs=1e-4), name

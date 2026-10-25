"""BAR NAMING (fb_engine/frame_definition.py BAR_NAME_RULE, Fred 2026-10-24): every template's frame bars are named by
position with one vocabulary -- frame_top / _bottom / _right / _left, or numbered frame_<side>_1..n when a side is several
bars (right / left top to bottom, top / bottom left to right), plus the inset window's frame_window_*. Before this, T9 /
T14 / T15 reused SOME classic names and the CAM lay-flat skipped them ("expected 4 frame bodies")."""
import os
import re
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from fb_engine.frame_definition import BAR_NAME_RULE, COMMON_FRAME_FEATURES, WINDOW_BARS_FEATURE  # noqa: E402
from fb_engine.template_resolver import get_available_templates, resolve_template  # noqa: E402


def _bar_names(template_value):
    spec, _prefix = resolve_template(template_value)
    feats = (spec.get("Frame") or {}).get("features") or []
    return next(f["bodyNames"] for f in feats if f["id"] == "bars")


def _templates():
    return [t["value"] for t in get_available_templates()]


def test_every_template_names_its_bars_by_the_rule():
    assert len(_templates()) >= 19
    for t in _templates():
        names = _bar_names(t)
        bad = [n for n in names if not BAR_NAME_RULE.match(n)]
        assert not bad, f"{t}: {bad}"
        assert len(set(names)) == len(names), f"{t}: duplicate bar names {names}"


def test_a_side_is_one_bar_or_numbered_1_to_n_never_both():
    for t in _templates():
        sides = {}
        for n in _bar_names(t):
            m = re.match(r"^frame_(top|bottom|right|left)(?:_(\d+))?$", n)
            sides.setdefault(m.group(1), []).append(int(m.group(2)) if m.group(2) else None)
        for side, nums in sides.items():
            if None in nums:
                assert nums == [None], f"{t}: frame_{side} and numbered frame_{side}_N together"
            else:
                assert sorted(nums) == list(range(1, len(nums) + 1)), f"{t}: frame_{side}_N not 1..{len(nums)}: {nums}"


def test_mirrored_sides_carry_the_same_numbers():
    """Left mirrors right's numbering (top to bottom on both sides), so a symmetric template has matching counts."""
    for t in _templates():
        names = _bar_names(t)
        right = sorted(n[len("frame_right"):] for n in names if n.startswith("frame_right"))
        left = sorted(n[len("frame_left"):] for n in names if n.startswith("frame_left"))
        assert right == left, f"{t}: right {right} vs left {left}"


def test_the_classic_four_and_the_window_bars_follow_the_rule():
    bars = next(f for f in COMMON_FRAME_FEATURES if f["id"] == "bars")["bodyNames"]
    assert sorted(bars) == ["frame_bottom", "frame_left", "frame_right", "frame_top"]
    assert all(BAR_NAME_RULE.match(n) for n in WINDOW_BARS_FEATURE["bodyNames"])


def test_the_rule_accepts_numbered_tops_and_refuses_old_names():
    for ok in ("frame_top", "frame_top_1", "frame_top_2", "frame_bottom_3", "frame_right_12", "frame_window_left"):
        assert BAR_NAME_RULE.match(ok), ok
    for bad in ("frame_base", "frame_arch", "frame_side_right", "frame_upper_left", "frame_top_0", "frame_right_",
                "frame_window_top_1", "frame_thickness"):
        assert not BAR_NAME_RULE.match(bad), bad

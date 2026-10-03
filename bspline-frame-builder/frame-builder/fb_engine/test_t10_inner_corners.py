"""
H23 item 43: T10's own 2 TOP corners (where a horn meets the arch) must be resolved the SAME way
as T7's own eave (item 38 part 1) -- a declared `ResolveLineCircleCorner` step, not a reliance on
Fusion's native offset to tag the corner itself.

MEASURED live, not guessed: a probe of T10's default build (7x9) found the offset DOES produce the
geometrically correct inner arc and inner horn lines (their real coordinates match
`line_circle_corner`'s own closed-form answer to within 2.3e-5 cm), but tags NEITHER with any ID at
all -- `inner_proj_top_edge:S` / `inner_proj_horn_TR:S` were never registered, so the miter step
(fb_engine/miters.py) silently misses ("MITER MISS"), and `declared_profiles.classify` then finds
one unsplit profile spanning 3 bars (right side + top + left side) -- T10's default built only 1 of
its 4 declared bars.

This test is PURE PYTHON (no Fusion): `resolve_template` runs the SAME template-resolution pipeline
`send_frame.py` uses, with no adsk stub needed (template_resolver itself never touches adsk).
"""
import sys
import os

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER_ROOT = os.path.dirname(_HERE)
if _FRAME_BUILDER_ROOT not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER_ROOT)

import pytest  # noqa: E402

from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine.t7_roof_eave import line_circle_corner  # noqa: E402


def _inner_corner_block(template):
    for sk in template["Sketches"]:
        for b in sk.get("Blocks", []):
            if b.get("PhaseID") == "p03_03_inner_corner_resolve":
                return b
    return None


def test_t10_declares_a_live_line_circle_corner_step_for_both_top_corners():
    """The declaration itself: p03_03's own BuildSequence must carry a ResolveLineCircleCorner
    step for TR and TL, each referencing the REAL built entities (the horn line's own far/near
    endpoints, the arch arc), not a baked value. Fails on the pre-item-43 file (no such step
    existed at all -- the top corners relied entirely on Fusion's own native offset tagging,
    MEASURED to never actually happen)."""
    template, _ = resolve_template("template_10")
    block = _inner_corner_block(template)
    assert block is not None, "p03_03_inner_corner_resolve phase not found"
    steps = block.get("BuildSequence", [])
    lcc = [s for s in steps if s.get("Type") == "ResolveLineCircleCorner"]
    assert len(lcc) == 1, f"expected exactly one ResolveLineCircleCorner step, found {len(lcc)}"
    corners = lcc[0]["Corners"]
    assert set(corners.keys()) == {"TR", "TL"}
    assert corners["TR"] == {
        "LineFarID": "proj_horn_TR:E", "LineNearID": "proj_horn_TR:S",
        "ArcID": "proj_top_edge", "InnerID": "inner_proj_horn_TR:S", "Concave": False,
    }
    assert corners["TL"] == {
        "LineFarID": "proj_horn_TL:E", "LineNearID": "proj_horn_TL:S",
        "ArcID": "proj_top_edge", "InnerID": "inner_proj_top_edge:S", "Concave": False,
    }
    # The ORIGINAL 2 bottom corners must still be declared, untouched.
    rc = [s for s in steps if s.get("Type") == "ResolveInnerCorners"]
    assert len(rc) == 1 and set(rc[0]["Corners"].keys()) == {"BR", "BL"}


def test_t10s_measured_default_geometry_resolves_to_the_real_existing_point():
    """Regression pin for the MEASURED live probe (H23 item 43, 7x9 default): the real
    coordinates of T10's own top_edge arc and horn_TR/horn_TL lines, fed through the SAME
    line_circle_corner T7's eave uses, land on the SAME point an untagged SketchPoint already
    occupied live (distance 0.0000 cm and 2.3e-5 cm respectively) -- proving this is a tagging
    gap, not a geometry error, and that line_circle_corner needs no T10-specific variant."""
    circle_center, circle_radius = (0.0, -2.4425), 13.2375
    ft_cm = 0.75 * 2.54
    tr = line_circle_corner((8.255, 3.2554), (8.255, 7.9058), (0.0, 0.0), ft_cm, circle_center, circle_radius, concave=False)
    tl = line_circle_corner((-8.255, 3.2554), (-8.255, 7.9058), (0.0, 0.0), ft_cm, circle_center, circle_radius, concave=False)
    assert tr == pytest.approx((6.35, 6.9438), abs=1e-3)
    assert tl == pytest.approx((-6.35, 6.9438), abs=1e-3)

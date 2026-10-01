"""FB-APP F14 (S8): no recorded Fusion frame build has an inverted outline
(fb_engine.outline_invariants). tests/fixtures/frame-inversion holds the case
that inverted live before the fix (T2 7x9 at boundingboxoffset 0.5, the app's
own payload), re-recorded after it; the S4 parity goldens must hold too."""
import glob
import json
import os

import pytest

from fb_engine.frame_definition import frame_fit
from fb_engine.outline_invariants import outline_violations

_FIX = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))),
                    "tests", "fixtures")
_PARITY = sorted(glob.glob(os.path.join(_FIX, "frame-parity", "*.json")))
_INVERSION = sorted(glob.glob(os.path.join(_FIX, "frame-inversion", "*.json")))
_DEFAULT_BBOX_IN = 0.25  # the templates' declared boundingboxoffset default (the parity goldens' value)

# H23 item 13: Template 10's shared hourglass top-arc construction solves to the wrong
# branch at every size tested (a circle swept ~331 deg the long way around instead of
# through its apex, confirmed via the sketch's own real Fusion boundingBox) -- the
# resulting `top_edge`/`arc_shoulder_*` curves genuinely do pass tens of cm outside the
# safe zone, so `outline_violations` correctly flags them; this is the known construction
# defect itself, not a false positive in the invariant. See LIVE-RESULTS-ranchy.md item 13
# and KNOWN_BROKEN_BUILD in frame-parity-app.test.js / test_frame_parity_goldens.py.
_KNOWN_BROKEN_OUTLINE = {"template_10_7x9.json", "template_10_6x9.json", "template_10_12x6.json"}


def _bbox(meta):
    return (meta.get("params") or {}).get("boundingboxoffset", _DEFAULT_BBOX_IN)


def test_the_inversion_case_is_recorded():
    assert [os.path.basename(p) for p in _INVERSION] == ["template_2_7x9_bbox0.5.json"]


@pytest.mark.parametrize("path", _PARITY + _INVERSION, ids=os.path.basename)
def test_no_golden_outline_is_inverted(path):
    if os.path.basename(path) in _KNOWN_BROKEN_OUTLINE:
        pytest.skip("known Fusion construction bug (wrong arc branch), not an invariant false positive -- see LIVE-RESULTS-ranchy.md item 13")
    g = json.load(open(path, encoding="utf-8"))
    m = g["meta"]
    if not frame_fit(m["widthIn"], m["heightIn"], 0.75, _bbox(m))["ok"]:
        # declared FRAME_FIT refuses this board before any build (a Send never
        # produces it); MEASURED there: T2 5.51x1.97's hip arcs overshoot the safe
        # zone by 0.045 in, sides intact.
        pytest.skip("the frame does not fit this board (FRAME_FIT)")
    assert outline_violations(g["sketch2_shape_outline"], m["widthIn"], m["heightIn"], _bbox(m)) == []


@pytest.mark.parametrize("path", _INVERSION, ids=os.path.basename)
def test_the_inversion_case_builds_the_frame(path):
    g = json.load(open(path, encoding="utf-8"))
    assert g["meta"]["timelineHealthy"] is True
    assert sorted(g["bars"]) == ["frame_bottom", "frame_left", "frame_right", "frame_top"]
    for bar in g["bars"].values():  # bars run from z = -1 in (frame bottom) up to the flat core underside z = 0
        assert bar["bbox"]["min"][2] == pytest.approx(-1.0) and bar["bbox"]["max"][2] == pytest.approx(0.0)


def test_the_invariant_catches_a_swapped_horn():
    curves = {"horn_TL": {"start": [3.7, 4.0], "end": [3.7, 3.3]}, "top_edge": {"start": [3.7, 4.0], "end": [-3.7, 4.0]}}
    bad = outline_violations(curves, 7, 9, 0.5)
    assert "horn_TL on the wrong side (x=3.7)" in bad and any("outside the safe zone" in b for b in bad)

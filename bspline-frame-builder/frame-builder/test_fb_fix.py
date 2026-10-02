"""FB-FIX (F4), pure parts: the ONE unit resolver (ParameterSchema.to_cm) and
the declared "board too small for this frame" rule (frame_definition.FRAME_FIT),
checked against the live-recorded S4 goldens. Plain Python, with no adsk."""
import glob
import json
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from fb_engine.parameter_schema import ParameterSchema, ResolveError  # noqa: E402
from fb_engine.frame_definition import FRAME_FIT, frame_fit  # noqa: E402

_GOLDENS = sorted(glob.glob(os.path.join(os.path.dirname(os.path.dirname(_HERE)),
                                         "tests", "fixtures", "frame-parity", "*.json")))


class TestToCm:
    @pytest.mark.parametrize("value,unit,cm", [
        ("0.75 in", "in", 1.905), ("0.75in", "in", 1.905), ('0.75"', "in", 1.905),
        ("19 mm", "in", 1.9), ("1.5 cm", "in", 1.5), ("2 ft", "in", 60.96),
        (0.75, "in", 1.905),          # a bare UI number takes the param's declared unit (inches)
        ("0.75", "in", 1.905),
        (1.0, "", 1.0),               # unitless toggle (ck_/en_) passes through
    ])
    def test_resolves(self, value, unit, cm):
        assert ParameterSchema.to_cm(value, unit) == pytest.approx(cm)

    @pytest.mark.parametrize("value", ["abc", "0.75 furlongs", "", "in", True])
    def test_never_silently_zero(self, value):
        with pytest.raises(ResolveError):
            ParameterSchema.to_cm(value, "in")


class TestFrameFit:
    def test_rule_is_declared_for_the_app(self):
        assert "frame_thickness" in FRAME_FIT["rule"] and "boundingboxoffset" in FRAME_FIT["rule"]

    def test_too_small_board_gets_a_message(self):
        fit = frame_fit(5.51, 1.97, 0.75, 0.25)
        assert fit["ok"] is False
        assert fit["safeZoneIn"] == pytest.approx(1.47) and fit["requiredIn"] == pytest.approx(1.5)
        assert "Board too small" in fit["message"]

    def test_normal_board_fits(self):
        assert frame_fit(7, 9, 0.75, 0.25) == {"ok": True, "safeZoneIn": 6.5, "requiredIn": 1.5, "message": None}

    # H23 item 1 (Template 3, 5.51x1.97): the live Fusion build gives 3 malformed bars instead
    # of the clean 0 the rule (correctly) predicts for "too small" -- a genuine, already-flagged
    # Fusion construction bug (Template 3 has no "too small" guard the other templates evidently
    # have), not a fault in `frame_fit`'s own rule. See LIVE-RESULTS-ranchy.md item 1.
    # H23 item 13 (Template 9, 12x6): the golden is a known-broken build -- the frame
    # enclosure's own inner-offset miter resolution fails at 2 of 12 corners when the
    # flange height shrinks relative to frame_thickness (66% ratio at 12x6), so NO bars
    # get built even though `frame_fit`'s rule correctly says this board fits. See
    # LIVE-RESULTS-ranchy.md item 13 and KNOWN_BROKEN_BUILD in frame-parity-app.test.js.
    # H23 item 13 (Template 10, 7x9/6x9): FIXED by H23 items 14/15/17, re-recorded live by item
    # 19 -- removed from this set, 4/4 bars now, matching `frame_fit`'s own rule with no
    # exception needed. (12x6 never needed an exception here either: its own build gets some
    # bars either way -- its own inconsistency is caught elsewhere, by test_golden_is_
    # consistent's KNOWN_BROKEN_BUILD.)
    # F30 item 3 (Template 13, Narrow Neck + taper): the same degenerate-tiny-board class as Template 3's own
    # 5.51x1.97 above -- 4 named bodies, 3 of them near-zero slivers, top/bottom bars missing entirely (see
    # test_frame_parity_goldens.py's own _DEGENERATE_BAR_COUNT_OVERRIDE for the measured detail).
    _KNOWN_BROKEN_GOLDENS = {
        "template_3_5.51x1.97.json", "template_9_12x6.json", "template_13_5.51x1.97.json",
    }

    @pytest.mark.parametrize("path", _GOLDENS, ids=os.path.basename)
    def test_rule_predicts_every_live_golden(self, path):
        # The live Fusion build is the ground truth: 0 bars <=> the rule says "too small".
        # H23 item 4: was hardcoded to "== 4" -- true for every golden that existed when this
        # was written (Templates 1/2, then 3/4/5, all 4-bar), but Template 6 is the first
        # N-bar template (8 bars) and correctly breaks that assumption. Fixed to match the
        # test's own comment: the real invariant is "some bars" vs "none", not "exactly 4".
        if os.path.basename(path) in self._KNOWN_BROKEN_GOLDENS:
            pytest.skip("known Fusion construction bug, not a frame_fit rule mismatch -- see LIVE-RESULTS-ranchy.md")
        d = json.load(open(path, encoding="utf-8"))
        m = d["meta"]
        fit = frame_fit(m["widthIn"], m["heightIn"], 0.75, 0.25)
        assert fit["ok"] == (len(d["bars"]) > 0), (os.path.basename(path), fit)

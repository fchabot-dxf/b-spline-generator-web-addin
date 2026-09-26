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

    @pytest.mark.parametrize("path", _GOLDENS, ids=os.path.basename)
    def test_rule_predicts_every_live_golden(self, path):
        # The live Fusion build is the ground truth: 0 bars <=> the rule says "too small".
        d = json.load(open(path, encoding="utf-8"))
        m = d["meta"]
        fit = frame_fit(m["widthIn"], m["heightIn"], 0.75, 0.25)
        assert fit["ok"] == (len(d["bars"]) == 4), (os.path.basename(path), fit)

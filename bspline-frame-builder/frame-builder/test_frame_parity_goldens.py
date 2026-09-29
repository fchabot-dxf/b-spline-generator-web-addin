"""FB-APP S4: the recorded frame-parity goldens (tests/fixtures/frame-parity,
recorded live by tools/repro/record_frame_parity.py) stay well-formed and keep
the facts they were recorded to show. The app-side parity comparison against
them arrives with S2/S3."""
import glob
import json
import os

import pytest

_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.realpath(__file__)))),
                    "tests", "fixtures", "frame-parity")
_FILES = sorted(glob.glob(os.path.join(_DIR, "*.json")))
# Too short for the frame: safe-zone height 1.97 - 2*0.25 = 1.47 in < 2 * 0.75 in.
_DEGENERATE = {"5.51x1.97"}


_SIZES = ("7x9", "5.51x1.97", "12x6")


def test_all_six_goldens_exist():
    names = {os.path.basename(f) for f in _FILES}
    # T3 TAPERED HOURGLASS: its goldens are recorded in a live Fusion session (sketches/template_3/LIVE_CHECK.md);
    # until then it has none and the app uses its provisional shape model. Once recorded: all three sizes.
    t3 = {n for n in names if n.startswith("template_3_")}
    assert t3 in (set(), {f"template_3_{s}.json" for s in _SIZES}), sorted(t3)
    assert names - t3 == {f"template_{t}_{s}.json" for t in (1, 2) for s in _SIZES}


@pytest.mark.parametrize("path", _FILES, ids=os.path.basename)
def test_golden_is_consistent(path):
    d = json.load(open(path, encoding="utf-8"))
    template, size = os.path.basename(path)[:-5].rsplit("_", 1)
    m = d["meta"]
    assert m["template"] == template and f"{m['widthIn']:g}x{m['heightIn']:g}" == size
    assert m["timelineHealthy"] is True
    assert len(d["bars"]) == (0 if size in _DEGENERATE else 4)
    for bar in d["bars"].values():  # bars run from z = -1 in (frame bottom) up to the flat core underside z = 0
        assert bar["bbox"]["min"][2] == pytest.approx(-1.0) and bar["bbox"]["max"][2] == pytest.approx(0.0)


@pytest.mark.parametrize("size", ["7x9", "12x6"])
def test_solved_template_1_is_left_right_mirror_symmetric(size):
    # MEASURED F3: the seeds' deliberate L/R difference is solved away.
    d = json.load(open(os.path.join(_DIR, f"template_1_{size}.json"), encoding="utf-8"))["sketch2_shape_outline"]
    for arc in ("shoulder", "waist", "hip"):
        r, l = d[f"arc_{arc}_R"], d[f"arc_{arc}_L"]
        assert r["center"][0] == pytest.approx(-l["center"][0], abs=1e-4)
        assert r["center"][1] == pytest.approx(l["center"][1], abs=1e-4)
        assert r["radius"] == pytest.approx(l["radius"], abs=1e-4)

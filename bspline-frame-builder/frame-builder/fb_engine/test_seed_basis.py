"""F14 (S8): the shape-outline seeds are fractions of the SEED BOARD
(fb_engine/seed_basis.py). At the default offset the seeds are exactly the old
ones at every board size (the S4 goldens stand); a bigger offset moves them
with the safe zone; sketches 1 and 3 keep the board."""
import os
import re
import sys

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine import seed_basis  # noqa: E402
from fb_engine.template_resolver import resolve_template  # noqa: E402
from template_loader import TemplateLoader  # noqa: E402,F401  (the loader the templates use)


def _eval(expr, w, h, bbox):
    """A seed expression in inches (bare numbers are cm, BuildContext's rule)."""
    s = re.sub(r"(\d*\.?\d+)\s*in\b", r"(\1)", str(expr))
    if re.fullmatch(r"\s*[-+]?\d*\.?\d+\s*", s):
        return float(s) / 2.54
    return eval(s, {"__builtins__": {}}, {"widthIn": w, "heightIn": h, "boundingboxoffset": bbox})


def _seeds(tid):
    sk2 = resolve_template(tid)[0]["Sketches"][1]
    out = []
    for block in sk2["Blocks"]:
        for st in block.get("BuildSequence", []):
            if st.get("Type") in ("Line", "Arc3Point"):
                out += [(st["ID"], v) for p in st["Points"] for v in p]
            elif st.get("Type") == "Radius":
                out.append((st["Name"], st["Expression"]))
    return out


@pytest.mark.parametrize("tid", ["template_1", "template_2"])
def test_every_board_relative_seed_is_on_the_seed_board(tid):
    seeds = _seeds(tid)
    board = [(i, e) for i, e in seeds if isinstance(e, str) and re.search(r"\b(widthIn|heightIn)\b", e)]
    assert len(board) > 20
    for i, e in board:
        assert "boundingboxoffset" in e, (i, e)
        for tok in re.findall(r"\b(widthIn|heightIn)\b(?! - 2 \* \(boundingboxoffset)", e):
            pytest.fail(f"{i}: a bare {tok} in {e}")


@pytest.mark.parametrize("tid", ["template_1", "template_2"])
@pytest.mark.parametrize("w, h", [(7, 9), (12, 6), (5.51, 1.97), (10, 14)])
def test_at_the_default_offset_the_seeds_are_unchanged(tid, w, h, monkeypatch):
    new = _seeds(tid)
    monkeypatch.setattr(seed_basis, "seed_sketch", lambda sk: sk)  # the pre-F14 seeds
    import importlib
    tmod = importlib.import_module(f"sketches.{tid}.template_data")
    monkeypatch.setattr(tmod, "seed_sketch", lambda sk: sk)
    old = _seeds(tid)
    assert [i for i, _ in new] == [i for i, _ in old]
    for (i, a), (_, b) in zip(new, old):
        assert _eval(a, w, h, 0.25) == pytest.approx(_eval(b, w, h, 0.25), abs=1e-12), (i, a, b)


def test_a_bigger_offset_moves_the_seeds_with_the_safe_zone():
    # T2's bottom corner seed (widthIn * 0.464286) sat on the 7 in board's safe-zone
    # corner at 0.25 in (3.25); at 0.5 in it follows the corner to ~3.0.
    e = seed_basis.on_seed_board("widthIn * 0.464286")
    assert _eval(e, 7, 9, 0.25) == pytest.approx(3.25, abs=1e-5)
    assert _eval(e, 7, 9, 0.5) == pytest.approx(3.0178, abs=1e-4)
    assert _eval(seed_basis.on_seed_board("heightIn/14"), 7, 9, 1.0) == pytest.approx((9 - 1.5) / 14)


def test_sketches_1_and_3_keep_the_board():
    spec = resolve_template("template_2")[0]
    for sk in (spec["Sketches"][0], spec["Sketches"][2]):
        text = repr(sk)
        assert "boundingboxoffset - 0.25 in" not in text

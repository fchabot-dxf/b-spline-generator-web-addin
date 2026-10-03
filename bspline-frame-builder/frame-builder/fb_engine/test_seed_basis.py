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


@pytest.mark.parametrize("tid", ["template_1", "template_2", "template_3", "template_4", "template_5", "template_6", "template_8"])
def test_every_board_relative_seed_is_on_the_seed_board(tid):
    seeds = _seeds(tid)
    board = [(i, e) for i, e in seeds if isinstance(e, str) and re.search(r"\b(widthIn|heightIn)\b", e)]
    assert len(board) > 20
    for i, e in board:
        assert "boundingboxoffset" in e, (i, e)
        for tok in re.findall(r"\b(widthIn|heightIn)\b(?! - 2 \* \(boundingboxoffset)", e):
            pytest.fail(f"{i}: a bare {tok} in {e}")


@pytest.mark.parametrize("tid", ["template_1", "template_2", "template_3", "template_4", "template_5", "template_6", "template_8"])
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


# T8 DIPPED TOP + LEFT-ONLY WAVE: AMENDMENT (seat A's live finding on Template 5) -- its own dip/shoulder seed
# RADIUS scaled with heightIn only while the span it bridges (the half width) scales with widthIn, so the seed
# was only right at the one board it was hand-tuned on and flipped or failed elsewhere. Template 8 reuses
# Template 5's dipped top, so it must NOT repeat that: every dip seed is a genuine widthIn+heightIn expression
# (sketches/template_8/phases/p02_03_loop.py), unit-tested here against the app's own exact formula at the same
# three boards every template is checked at.
def test_template_8_dip_seed_radius_tracks_both_dimensions_not_just_one():
    seeds = dict(_seeds("template_8"))
    names = ("seed_rad_top_shoulder_L", "seed_rad_top_dip", "seed_rad_top_shoulder_R")
    for w, h in ((7, 9), (12, 6), (5.51, 1.97)):
        hw, hh = w / 2 - 0.25, h / 2 - 0.25
        a, d = hw * 0.5, hh * 0.14
        expected = (a * a + d * d) / (4 * d)  # editor-shape-lattice-generator.js's own exact tangent-triple formula
        for name in names:
            got = _eval(seeds[name], w, h, 0.25)
            assert got == pytest.approx(expected, rel=1e-9), (w, h, name)
            assert got > 0, (w, h, name)  # sane: a flipped/degenerate seed would go non-positive


def test_apply_seed_from_copies_the_named_steps_points():
    sketch = {"Blocks": [{"BuildSequence": [
        {"ID": "top_edge", "Type": "Arc3Point", "Points": [["a", "b"], ["c", "d"], ["e", "f"]]},
        {"ID": "top_edge", "Type": "Arc3Point", "Rebuild": True, "SeedFrom": "top_edge"},
    ]}]}
    seed_basis.apply_seed_from(sketch)
    first, second = sketch["Blocks"][0]["BuildSequence"]
    assert second["Points"] == first["Points"]
    assert second["Points"] is not first["Points"]  # a copy, not an aliased list a later mutation could corrupt


def test_apply_seed_from_unknown_source_raises():
    sketch = {"Blocks": [{"BuildSequence": [
        {"ID": "rebuilt", "Type": "Arc3Point", "Rebuild": True, "SeedFrom": "nonexistent"},
    ]}]}
    with pytest.raises(ValueError, match="nonexistent"):
        seed_basis.apply_seed_from(sketch)


def test_template_10_arch_rebuild_declares_seedfrom_not_a_duplicate_literal():
    """H23 item 46: the rebuild step must get its Points via SeedFrom, not its own hand-typed
    literal -- confirms the declaration, independent of the byte-identical-output check below."""
    sk2 = resolve_template("template_10")[0]["Sketches"][1]
    rebuilds = [st for block in sk2["Blocks"] for st in block.get("BuildSequence", [])
                if st.get("ID") == "top_edge" and st.get("Rebuild")]
    assert len(rebuilds) == 1
    assert rebuilds[0].get("SeedFrom") == "top_edge"


def test_template_10_arch_rebuild_points_match_the_seeded_step_exactly():
    """Not just declared -- the rebuild's own resolved Points (after seed_sketch's board rewrite)
    are IDENTICAL to the original top_edge step's, so the default build is byte-identical to
    before this item's own refactor (SeedFrom replaces a literal that was hand-copied to match)."""
    sk2 = resolve_template("template_10")[0]["Sketches"][1]
    top_edges = [st for block in sk2["Blocks"] for st in block.get("BuildSequence", [])
                 if st.get("ID") == "top_edge" and st.get("Type") == "Arc3Point"]
    assert len(top_edges) == 2
    seeded, rebuilt = (s for s in top_edges if not s.get("Rebuild")), (s for s in top_edges if s.get("Rebuild"))
    assert next(rebuilt)["Points"] == next(seeded)["Points"]


@pytest.mark.parametrize("tid", ["template_1", "template_2", "template_3", "template_4", "template_5",
                                  "template_6", "template_7", "template_8", "template_9", "template_10",
                                  "template_11", "template_12", "template_13"])
def test_no_two_seed_steps_share_an_id_without_declaring_seedfrom(tid):
    """H23 item 46 (item 45's own live finding): template_10's pre-fix bug was exactly this -- two
    independent Line/Arc3Point steps sharing one ID, each with its own literal Points, where
    apply_seed_geometry's pop-on-first-match only ever reaches the first. A second step reusing an
    earlier one's ID must declare SeedFrom (an explicit, checked relationship) rather than silently
    shadow it with an unrelated duplicate."""
    sk2 = resolve_template(tid)[0]["Sketches"][1]
    seen = set()
    for block in sk2["Blocks"]:
        for step in block.get("BuildSequence", []):
            if step.get("Type") not in ("Line", "Arc3Point") or "ID" not in step:
                continue
            sid = step["ID"]
            if "SeedFrom" in step:
                continue
            assert sid not in seen, (
                f"{tid}: step {sid!r} is declared more than once as a plain (non-SeedFrom) seed -- "
                f"apply_seed_geometry would only ever patch the first; the later one(s) must declare "
                f"SeedFrom instead of an independent duplicate")
            seen.add(sid)


def test_template_8_dip_seed_radius_would_have_caught_the_heightin_only_bug():
    """MUTATION-CHECK-BY-CONSTRUCTION: a heightIn-only radius (Template 5's own, pre-amendment) tracks neither
    board correctly except the one it was tuned on -- demonstrating this test is not vacuous without touching
    the real phase file. At 7x9 a heightIn-only constant CAN be tuned to match; at 12x6 (same height ratio
    tuned for a different width) it must not, which is exactly the bug seat A found live."""
    hw7, hh7 = 7 / 2 - 0.25, 9 / 2 - 0.25
    a7, d7 = hw7 * 0.5, hh7 * 0.14
    tuned_const = ((a7 * a7 + d7 * d7) / (4 * d7)) / 9  # "heightIn * k" calibrated to match AT 7x9 only
    wrong_12x6 = tuned_const * 6  # heightIn-only formula's own value at 12x6
    hw12, hh12 = 12 / 2 - 0.25, 6 / 2 - 0.25
    a12, d12 = hw12 * 0.5, hh12 * 0.14
    correct_12x6 = (a12 * a12 + d12 * d12) / (4 * d12)
    assert wrong_12x6 != pytest.approx(correct_12x6, rel=1e-6)

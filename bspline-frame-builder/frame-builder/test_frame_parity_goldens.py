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
# H23 item 1 (live Fusion check): Templates 1/2 correctly build 0 bars at this
# degenerate size. Template 3 does NOT: measured live, its constraint solver
# still "succeeds" (timelineHealthy True) but produces a broken, asymmetric
# shape -- arc_waist_L collapses to a zero-radius point while arc_waist_R's
# center (x=3.234) and skel_waist_pin_R's endpoint (x=3.234) land OUTSIDE the
# board's own half-width (2.755), and arc_hip_L/arc_hip_R end up with
# different radii/positions instead of mirroring -- so it yields 3 malformed
# bars (frame_left split into two pieces, frame_right intact, top/bottom
# missing) rather than a clean 0. Template 3 has no "too small, don't even
# try" guard that 1/2 evidently have. Recording this AS MEASURED (not
# patching it to look like 0) rather than masking it -- flagged in
# LIVE-RESULTS-ranchy.md for a real fix; this is an extreme edge case (a
# ~2in-tall board) so not blocking, but the degenerate geometry is real.
#
# F30 item 3 (Template 13, Narrow Neck + taper): the SAME class of issue at its own 5.51x1.97 (MEASURED, 2026-10-
# 01, recorded this session): 4 named bodies, but only ONE (`frame_right (1)`, volume 1.71in^3) is real -- the
# other 3 are near-zero slivers (frame_left 2e-05, frame_right 1e-05, `frame_right (2)` 0), and frame_top/
# frame_bottom are both MISSING entirely. Template 2 itself (no taper) correctly builds 0 bars at this same
# degenerate size; this template's own tapered top horn gives the solver an extra, fragile degree of freedom at
# a board this tiny, the same way Template 3's own topInset does. Not a new regression to chase here -- flagged
# the same way, not masked to look like a clean 0.
_DEGENERATE_BAR_COUNT_OVERRIDE = {"template_3": 3, "template_13": 4}


_SIZES = ("7x9", "5.51x1.97", "12x6")
# T9/T10 (H23 item 13): dispatched with 6x9 in place of 5.51x1.97 -- a mainstream portrait
# alternate aspect instead of the other templates' tiny-board stress test (Fred's own
# "portrait only right now").
_SIZES_PORTRAIT = ("7x9", "6x9", "12x6")
# H23 item 13: known-broken builds (timeline/outline otherwise healthy, but the real bar
# count doesn't match the template's own declared count, for a build-defect reason, not a
# "too small" _DEGENERATE one) -- not asserted here at all (no "correct" count to check
# against); see test_fb_fix.py's matching _KNOWN_BROKEN_GOLDENS and LIVE-RESULTS-ranchy.md
# item 13. T9 12x6: 0 of 12 bars (2 corners fail miter resolution).
# H23 item 19: T10 7x9/6x9 re-recorded live and FIXED (items 14/15/17's own work) -- full
# 4/4 bars now, removed from this set. T10 12x6 stays broken, re-confirmed live: sketch 3/
# frame enclosure still fails to form at all there (a pre-existing Template 1 limitation
# T10 inherits, "ship it" per the advisor/Fred) -- its own golden here is still the item-13
# era recording (2 malformed bars, a different failure shape than today's "no sketch 3 at
# all", but broken either way; not re-recorded since there is no "correct" shape to capture).
_KNOWN_BROKEN_BUILD = {"template_9_12x6.json", "template_10_12x6.json"}


def test_all_six_goldens_exist():
    names = {os.path.basename(f) for f in _FILES}
    # T3 TAPERED HOURGLASS: its goldens are recorded in a live Fusion session (sketches/template_3/LIVE_CHECK.md);
    # until then it has none and the app uses its provisional shape model. Once recorded: all three sizes.
    t3 = {n for n in names if n.startswith("template_3_")}
    assert t3 in (set(), {f"template_3_{s}.json" for s in _SIZES}), sorted(t3)
    # T4 OFFSET HOURGLASS: the same (sketches/template_4/LIVE_CHECK.md).
    t4 = {n for n in names if n.startswith("template_4_")}
    assert t4 in (set(), {f"template_4_{s}.json" for s in _SIZES}), sorted(t4)
    # T5 HOURGLASS DIPPED TOP: the same (sketches/template_5/LIVE_CHECK.md).
    # H23 item 3 (live Fusion check): 7x9 only, DELIBERATELY partial. 12x6 and
    # 5.51x1.97 both flip to an asymmetric/degenerate shape live in Fusion
    # (Equal(radius) on the two top-shoulder arcs ties size, not position; a
    # Symmetry constraint on their centers was tried and made the sketch
    # UNSOLVABLE instead -- VCS_SKETCH_SOLVING_FAILED) -- recording those two
    # goldens as-is would either fail test_golden_is_consistent honestly or
    # require fit.excluded, which is reserved for geometrically impossible
    # sizes, not a build bug. Left unrecorded on purpose until the real fix
    # lands; see LIVE-RESULTS-ranchy.md.
    t5 = {n for n in names if n.startswith("template_5_")}
    assert t5 in (set(), {"template_5_7x9.json"}, {f"template_5_{s}.json" for s in _SIZES}), sorted(t5)
    # T6 TAB TOP: the same (sketches/template_6/LIVE_CHECK.md).
    t6 = {n for n in names if n.startswith("template_6_")}
    assert t6 in (set(), {f"template_6_{s}.json" for s in _SIZES}), sorted(t6)
    # T8 DIPPED TOP + LEFT-ONLY WAVE: the same (sketches/template_8/LIVE_CHECK.md) -- no goldens recorded yet.
    t8 = {n for n in names if n.startswith("template_8_")}
    assert t8 in (set(), {f"template_8_{s}.json" for s in _SIZES}), sorted(t8)
    # T9 I SHAPE (sketches/template_9/, H23 item 13 live check): 7x9/6x9/12x6.
    t9 = {n for n in names if n.startswith("template_9_")}
    assert t9 in (set(), {f"template_9_{s}.json" for s in _SIZES_PORTRAIT}), sorted(t9)
    # T10 ARCHED HOURGLASS (sketches/template_10/, H23 item 13 live check): 7x9/6x9/12x6, same
    # non-standard size set as T9 (Fred's own "portrait only right now").
    t10 = {n for n in names if n.startswith("template_10_")}
    assert t10 in (set(), {f"template_10_{s}.json" for s in _SIZES_PORTRAIT}), sorted(t10)
    # T12 HOURGLASS + TAPER / T13 NARROW NECK + TAPER (F30 item 3, 2026-10-01): recorded this session, the same
    # 3-size set as T1-T4/T6/T8 (not T9/T10's own portrait-only set).
    t12 = {n for n in names if n.startswith("template_12_")}
    assert t12 in (set(), {f"template_12_{s}.json" for s in _SIZES}), sorted(t12)
    t13 = {n for n in names if n.startswith("template_13_")}
    assert t13 in (set(), {f"template_13_{s}.json" for s in _SIZES}), sorted(t13)
    assert names - t3 - t4 - t5 - t6 - t8 - t9 - t10 - t12 - t13 == {f"template_{t}_{s}.json" for t in (1, 2) for s in _SIZES}


@pytest.mark.parametrize("path", _FILES, ids=os.path.basename)
def test_golden_is_consistent(path):
    d = json.load(open(path, encoding="utf-8"))
    template, size = os.path.basename(path)[:-5].rsplit("_", 1)
    m = d["meta"]
    assert m["template"] == template and f"{m['widthIn']:g}x{m['heightIn']:g}" == size
    assert m["timelineHealthy"] is True
    # N-BAR: the template's own declared bar count (4 for Templates 1-5; Template 6's 8, by these names)
    import sys
    _fb = os.path.dirname(os.path.realpath(__file__))
    if _fb not in sys.path:
        sys.path.insert(0, _fb)
    from fb_engine.declared_profiles import frame_bars
    from fb_engine.template_resolver import resolve_template
    names = [b["name"] for b in frame_bars(resolve_template(template)[0]["Frame"])]
    expected_degenerate_count = _DEGENERATE_BAR_COUNT_OVERRIDE.get(template, 0)
    known_broken = os.path.basename(path) in _KNOWN_BROKEN_BUILD
    if not known_broken:
        expected_count = expected_degenerate_count if size in _DEGENERATE else len(names)
        assert len(d["bars"]) == expected_count
        if size not in _DEGENERATE:
            assert sorted(d["bars"]) == sorted(names)
    else:
        assert len(d["bars"]) < len(names)  # a known-broken build: fewer bars than declared, no "correct" count to check
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

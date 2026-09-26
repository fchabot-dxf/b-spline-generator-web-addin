"""
FB-ORDER (Fred 2026-09-26): "move the frame before the inlay but still
after the initial comp creation" / "only Send to Fusion can create"
widthIn/heightIn.

timeline_order.reorder_frame_before_inlay is a pure algorithm (no adsk
import) — tested here with a plain fake timeline shim, exactly the
dispatch's own explicit test list: block moved as a unit in original
order; a refusal moves nothing and warns; no inlay is a no-op; a frame
already in order is a no-op.

Run with:
    cd bspline-frame-builder/frame-builder
    python3 -m pytest fb_engine/test_timeline_order.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

import pytest

from fb_engine.timeline_order import (
    reorder_frame_before_inlay,
    is_inlay_item_name,
    INLAY_NAME_PREFIXES,
)


class FakeItem:
    """Mirrors adsk.fusion.TimelineObject's own shape enough to drive the
    algorithm: `.name`, `.canReorder(beforeIndex)`, `.index` (kept live by
    the FakeTimeline that owns it, same as the real API), `.reorder(new_index)`.
    F3: canReorder is a METHOD on the real API (measured live); the old
    fake modelled it as a bool property, which is how the algorithm's
    refusal check could pass here and never fire on real Fusion."""

    def __init__(self, name, timeline, can_reorder=True):
        self.name = name
        self._timeline = timeline
        self._can_reorder = can_reorder
        self.checked_before = []

    def canReorder(self, before_index=-1):
        self.checked_before.append(before_index)
        return self._can_reorder

    @property
    def index(self):
        return self._timeline.items.index(self)

    def reorder(self, new_index):
        if not self._can_reorder:
            raise RuntimeError(f"'{self.name}' cannot be reordered")
        self._timeline.items.remove(self)
        self._timeline.items.insert(new_index, self)


class FakeTimeline:
    """`.count` + `.item(i)`, same shape reorder_frame_before_inlay reads —
    a plain ordered list of FakeItem underneath."""

    def __init__(self, names, refuses=()):
        self.items = [FakeItem(n, self, can_reorder=(n not in refuses)) for n in names]

    @property
    def count(self):
        return len(self.items)

    def item(self, i):
        return self.items[i]

    def names(self):
        return [it.name for it in self.items]


class RecordingLogger:
    def __init__(self):
        self.records = []

    def log(self, msg, level="INFO"):
        self.records.append((level, msg))


def _is_frame(item):
    return item.name.startswith("Frame_1")


def _is_inlay(item):
    return is_inlay_item_name(item.name)


class TestIsInlayItemName:
    def test_matches_both_declared_prefixes(self):
        assert is_inlay_item_name("Plane for L1")
        assert is_inlay_item_name("Source - L1 [constrained]")

    def test_does_not_match_unrelated_names(self):
        assert not is_inlay_item_name("Frame_1")
        assert not is_inlay_item_name("B-Spline Set")
        assert not is_inlay_item_name("")
        assert not is_inlay_item_name(None)

    def test_prefixes_are_exactly_the_two_declared(self):
        assert INLAY_NAME_PREFIXES == ("Plane for L", "Source - L")


class TestReorderFrameBeforeInlay:
    def test_moves_the_whole_frame_block_as_a_unit_in_original_order(self):
        # Original chronological order: comp/body, THEN the inlay, THEN
        # the frame (built after, per FB-ORDER's own root-cause report).
        tl = FakeTimeline([
            "B-Spline Set",
            "Plane for L1",
            "Source - L1",
            "Frame_1",
            "Frame_1_sketch_outline",
            "Frame_1_extrude",
        ])
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert result == {"moved": True, "reason": None}
        assert tl.names() == [
            "B-Spline Set",
            "Frame_1",
            "Frame_1_sketch_outline",
            "Frame_1_extrude",
            "Plane for L1",
            "Source - L1",
        ]

    def test_never_moves_before_the_initial_comp_body(self):
        tl = FakeTimeline([
            "B-Spline Set",
            "Plane for L1",
            "Source - L1",
            "Frame_1",
        ])
        reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert tl.names()[0] == "B-Spline Set"

    def test_a_refusal_moves_nothing_and_reports_which_item(self):
        tl = FakeTimeline(
            ["B-Spline Set", "Plane for L1", "Source - L1", "Frame_1", "Frame_1_extrude"],
            refuses=("Frame_1_extrude",),
        )
        original_order = tl.names()
        logger = RecordingLogger()
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay, logger=logger)
        assert result["moved"] is False
        assert "Frame_1_extrude" in result["reason"]
        assert tl.names() == original_order  # untouched — not even the OTHER frame item moved
        assert any(level == "WARNING" and "Frame_1_extrude" in msg for level, msg in logger.records)

    def test_no_inlay_present_is_a_noop(self):
        tl = FakeTimeline(["B-Spline Set", "Frame_1", "Frame_1_extrude"])
        original_order = tl.names()
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert result == {"moved": False, "reason": "no inlay present"}
        assert tl.names() == original_order

    def test_no_frame_items_present_is_a_noop(self):
        tl = FakeTimeline(["B-Spline Set", "Plane for L1", "Source - L1"])
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert result == {"moved": False, "reason": "no frame items present"}

    def test_a_frame_already_before_the_inlay_is_a_noop(self):
        tl = FakeTimeline(["B-Spline Set", "Frame_1", "Frame_1_extrude", "Plane for L1", "Source - L1"])
        original_order = tl.names()
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert result == {"moved": False, "reason": "already in order"}
        assert tl.names() == original_order

    def test_a_second_inlay_layer_does_not_confuse_the_earliest_index(self):
        # Two layers' worth of inlay items -- the frame moves before the
        # EARLIEST of all of them, not just the first-declared pair.
        tl = FakeTimeline([
            "B-Spline Set",
            "Plane for L1",
            "Source - L1",
            "Plane for L2",
            "Source - L2",
            "Frame_1",
            "Frame_1_extrude",
        ])
        reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert tl.names() == [
            "B-Spline Set",
            "Frame_1",
            "Frame_1_extrude",
            "Plane for L1",
            "Source - L1",
            "Plane for L2",
            "Source - L2",
        ]

    def test_a_frame_item_interleaved_with_the_inlay_still_lands_correctly(self):
        # Pathological but declared-safe: whatever the ORIGINAL relative
        # order among frame items was, that's the order they land in,
        # regardless of how they were interleaved with inlay items before.
        tl = FakeTimeline([
            "B-Spline Set",
            "Plane for L1",
            "Frame_1",
            "Source - L1",
            "Frame_1_extrude",
        ])
        reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert tl.names() == [
            "B-Spline Set",
            "Frame_1",
            "Frame_1_extrude",
            "Plane for L1",
            "Source - L1",
        ]

    def test_amend_1_a_frame_extrude_depending_on_clean_stays_after_it(self):
        # FB-ORDER AMEND 1 (Fred): the frame's extrude needs the "Clean"
        # body (a green timeline group) -- target order is [comp
        # creations] -> [Clean] -> [Frame_1 block] -> [inlay]. Clean is
        # neither a frame item (not in Frame_1's own component) nor an
        # inlay item (its name matches neither declared prefix), so
        # is_frame_item/is_inlay_item both say False for it -- the
        # algorithm never touches it at all, and it simply stays wherever
        # it already sits relative to whatever DOES move. Proves the
        # existing algorithm already satisfies AMEND 1 with no code
        # change: Clean is untouched, and it's never moved to AFTER the
        # frame block (which would break the extrude's own dependency).
        tl = FakeTimeline([
            "B-Spline Set",
            "Clean",
            "Plane for L1",
            "Source - L1",
            "Frame_1",
            "Frame_1_extrude",
        ])
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        assert result == {"moved": True, "reason": None}
        assert tl.names() == [
            "B-Spline Set",
            "Clean",
            "Frame_1",
            "Frame_1_extrude",
            "Plane for L1",
            "Source - L1",
        ]

    def test_amend_1_clean_present_does_not_defeat_the_any_refusal_safety_net(self):
        # Same Clean scenario, but the extrude itself refuses to reorder
        # (e.g. Fusion's own canReorder says the Clean dependency blocks
        # it) -- the "any refusal -> move nothing" rule must still hold
        # with Clean in the mix, not just in the simpler no-Clean tests
        # above.
        tl = FakeTimeline(
            ["B-Spline Set", "Clean", "Plane for L1", "Source - L1", "Frame_1", "Frame_1_extrude"],
            refuses=("Frame_1_extrude",),
        )
        original_order = tl.names()
        logger = RecordingLogger()
        result = reorder_frame_before_inlay(tl, _is_frame, _is_inlay, logger=logger)
        assert result["moved"] is False
        assert "Frame_1_extrude" in result["reason"]
        assert tl.names() == original_order  # Clean itself never touched either
        assert any(level == "WARNING" and "Frame_1_extrude" in msg for level, msg in logger.records)


# ---------------------------------------------------------------------
# F3: ensure_frame_before_inlay — the ONE call the sketch build AND the
# solid build both end with. Measured live in F2: the solid build's
# extrudes + TRIM_CUT land after the inlay unless the reorder runs again.
# ---------------------------------------------------------------------
from fb_engine.timeline_order import (
    ensure_frame_before_inlay, BENIGN_NOT_MOVED_REASONS, FRAME_MEMBER_ATTR, is_frame_timeline_item,
)


class _Comp:
    def __init__(self, name):
        self.name = name


class _Entity:
    """`.component` for the occurrence-creation item, `.parentComponent`
    for anything built inside the component — the two shapes the glue
    reads (verified live in F2 for occurrence + sketches + extrudes)."""

    def __init__(self, creates=None, parent=None):
        if creates:
            self.component = _Comp(creates)
        self.parentComponent = _Comp(parent or "(Root)")


class EntityTimeline(FakeTimeline):
    def __init__(self, spec, refuses=()):
        super().__init__([name for name, _ in spec], refuses=refuses)
        for it, (_, entity) in zip(self.items, spec):
            it.entity = entity

    def append(self, spec):
        for name, entity in spec:
            it = FakeItem(name, self)
            it.entity = entity
            self.items.append(it)


def _fr(name):
    return (name, _Entity(parent="Frame_1"))


class _Attrs:
    def __init__(self, table):
        self._t = table

    def itemByName(self, group, name):
        v = self._t.get((group, name))
        return types_ns(value=v) if v is not None else None


def _trim(name, tagged=True):
    # MEASURED live (F3): the TRIM_CUT's parentComponent is 'Clean' (the
    # body it cuts), not Frame_1 — only the declared attribute says it
    # belongs to the frame.
    e = _Entity(parent="Clean")
    e.attributes = _Attrs({FRAME_MEMBER_ATTR: "Frame_1"} if tagged else {})
    return (name, e)


def _root(name):
    return (name, _Entity(parent="(Root)"))


_SOLID_ITEMS = [_fr("t1_frame_right_Extrude"), _fr("t1_frame_bottom_Extrude"),
                _fr("t1_frame_top_Extrude"), _fr("t1_frame_left_Extrude"), _trim("t1_TRIM_CUT")]


class TestEnsureFrameBeforeInlay:
    def _after_sketch_build(self):
        # The exact order F2 measured live after the sketch build's reorder.
        tl = EntityTimeline([
            _root(" B-Spline Set:1"), _root(" Clean:1"), _root("Base Feature1"),
            (" Frame_1:1", _Entity(creates="Frame_1")),
            _fr("T1_1_bounding_box"), _fr("T1_2_shape_outline"), _fr("T1_3_frame_enclosure"),
            _root("Plane for L1 - vbit"), _root("Source - L1 - vbit"),
        ])
        return types_ns(timeline=tl), tl

    def test_solid_build_items_join_the_block_before_the_inlay(self):
        design, tl = self._after_sketch_build()
        tl.append(_SOLID_ITEMS)  # the solid build appends at the END (after the inlay)
        result = ensure_frame_before_inlay(design, "Frame_1")
        assert result == {"moved": True, "reason": None}
        assert tl.names() == [
            " B-Spline Set:1", " Clean:1", "Base Feature1",
            " Frame_1:1", "T1_1_bounding_box", "T1_2_shape_outline", "T1_3_frame_enclosure",
            "t1_frame_right_Extrude", "t1_frame_bottom_Extrude", "t1_frame_top_Extrude",
            "t1_frame_left_Extrude", "t1_TRIM_CUT",
            "Plane for L1 - vbit", "Source - L1 - vbit",
        ]

    def test_a_refused_solid_item_moves_nothing_and_warns(self):
        design, tl = self._after_sketch_build()
        tl.append(_SOLID_ITEMS)
        tl.items[-1]._can_reorder = False  # the trim cut refuses
        before = tl.names()
        log = RecordingLogger()
        result = ensure_frame_before_inlay(design, "Frame_1", log)
        assert result["moved"] is False and "t1_TRIM_CUT" in result["reason"]
        assert tl.names() == before
        assert any(level == "WARNING" and "NOT reordered" in msg for level, msg in log.records)

    def test_benign_outcomes_do_not_warn(self):
        design, tl = self._after_sketch_build()  # already in order
        log = RecordingLogger()
        result = ensure_frame_before_inlay(design, "Frame_1", log)
        assert result["reason"] in BENIGN_NOT_MOVED_REASONS
        assert not any(level == "WARNING" for level, _ in log.records)


def types_ns(**kw):
    import types
    return types.SimpleNamespace(**kw)


class TestFrameMembershipAndCanReorderShape:
    def test_trim_cut_owned_by_clean_counts_as_frame_via_declared_attr(self):
        tl = EntityTimeline([_trim("t1_TRIM_CUT")])
        assert is_frame_timeline_item(tl.items[0], "Frame_1")

    def test_untagged_clean_feature_is_not_frame(self):
        tl = EntityTimeline([_trim("some_clean_cut", tagged=False)])
        assert not is_frame_timeline_item(tl.items[0], "Frame_1")

    def test_can_reorder_is_asked_for_the_inlay_position(self):
        tl = FakeTimeline(["B-Spline Set", "Plane for L1", "Frame_1", "Frame_1_extrude"])
        reorder_frame_before_inlay(tl, _is_frame, _is_inlay)
        moved = [it for it in tl.items if it.name.startswith("Frame_1")]
        assert all(it.checked_before == [1] for it in moved)

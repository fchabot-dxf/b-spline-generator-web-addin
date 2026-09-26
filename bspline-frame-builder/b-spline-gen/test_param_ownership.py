"""
STALE-PARAMS R4 item 3: param_ownership.compute_stale_params, pure/testable against a fake
parameter collection — no adsk stub needed (the module never imports adsk).

Run with:
    cd bspline-frame-builder/b-spline-gen
    python3 -m pytest test_param_ownership.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
_FRAME_BUILDER = os.path.join(os.path.dirname(_HERE), "frame-builder")
if _FRAME_BUILDER not in sys.path:
    sys.path.insert(0, _FRAME_BUILDER)

import pytest

from param_ownership import compute_stale_params


class FakeAttributes:
    def __init__(self, stamped=False):
        self._store = {}
        if stamped:
            self._store[("Bspline", "owner")] = _Attr("1")

    def itemByName(self, group, name):
        return self._store.get((group, name))

    def add(self, group, name, value):
        self._store[(group, name)] = _Attr(value)


class _Attr:
    def __init__(self, value):
        self.value = value


class FakeDependents:
    def __init__(self, n):
        self.count = n


class FakeParam:
    def __init__(self, name, stamped=False, dependents=0, delete_ok=True, delete_raises=None):
        self.name = name
        self.attributes = FakeAttributes(stamped)
        self.dependentParameters = FakeDependents(dependents) if dependents is not None else None
        self._delete_ok = delete_ok
        self._delete_raises = delete_raises
        self.delete_called = False

    def deleteMe(self):
        self.delete_called = True
        if self._delete_raises:
            raise self._delete_raises
        return self._delete_ok


def _names(bucket):
    return bucket if bucket and isinstance(bucket[0], str) else [b["name"] for b in bucket]


class TestUnregisteredAndInPayloadNeverCandidates:
    def test_unregistered_name_is_never_listed_never_deleted_never_stamped(self):
        p = FakeParam("anything_fred_typed", stamped=False, dependents=0)
        result = compute_stale_params([p], payload_names=[])
        assert p.delete_called is False
        assert p.attributes.itemByName("Bspline", "owner") is None
        for bucket in result.values():
            assert p.name not in _names(bucket)

    def test_a_registered_name_IN_the_payload_is_never_a_candidate(self):
        p = FakeParam("rail_width", stamped=True, dependents=0)
        result = compute_stale_params([p], payload_names=["rail_width"])
        assert p.delete_called is False
        for bucket in result.values():
            assert "rail_width" not in _names(bucket)

    def test_widthIn_heightIn_are_board_registered_but_always_in_payload_so_never_candidates(self):
        # The actual guarantee that protects the board params in production: they are ALWAYS
        # in every Send's payload_names, so they can never reach this function as candidates —
        # this test just confirms the mechanism, not a special-case in the code.
        w = FakeParam("widthIn", stamped=True, dependents=0)
        h = FakeParam("heightIn", stamped=True, dependents=0)
        result = compute_stale_params([w, h], payload_names=["widthIn", "heightIn"])
        assert w.delete_called is False and h.delete_called is False
        assert result == {"deleted": [], "kept_referenced": [], "adopted": [], "failed": []}


class TestDeletion:
    def test_a_stale_stamped_registered_unreferenced_param_is_deleted(self):
        p = FakeParam("rail_width", stamped=True, dependents=0)
        result = compute_stale_params([p], payload_names=[])
        assert p.delete_called is True
        assert result["deleted"] == ["rail_width"]
        assert result["adopted"] == []  # already stamped -- nothing to adopt
        assert result["kept_referenced"] == [] and result["failed"] == []

    def test_a_stale_UNSTAMPED_registered_param_is_ADOPTED_and_deleted(self):
        """Ruling 5 ('take over existing params'): registered name = ours regardless of the
        stamp; a stale unstamped registered param is logged under BOTH adopted and deleted."""
        p = FakeParam("half_width", stamped=False, dependents=0)
        result = compute_stale_params([p], payload_names=[])
        assert p.delete_called is True
        assert result["deleted"] == ["half_width"]
        assert result["adopted"] == ["half_width"]
        assert result["kept_referenced"] == [] and result["failed"] == []

    def test_deleteMe_returning_False_is_reported_as_failed_not_deleted(self):
        p = FakeParam("rail_width", stamped=True, dependents=0, delete_ok=False)
        result = compute_stale_params([p], payload_names=[])
        assert p.delete_called is True
        assert result["deleted"] == []
        assert result["failed"] == [{"name": "rail_width", "error": "deleteMe() returned False"}]

    def test_deleteMe_raising_is_reported_as_failed_never_propagates(self):
        p = FakeParam("rail_width", stamped=True, dependents=0, delete_raises=RuntimeError("locked"))
        result = compute_stale_params([p], payload_names=[])  # must not raise
        assert p.delete_called is True
        assert result["deleted"] == []
        assert result["failed"] == [{"name": "rail_width", "error": "locked"}]


class TestReferenceGuard:
    def test_a_referenced_candidate_is_kept_never_deleted(self):
        p = FakeParam("contour_width", stamped=True, dependents=2)
        result = compute_stale_params([p], payload_names=[])
        assert p.delete_called is False
        assert result["deleted"] == []
        assert result["kept_referenced"] == [{"name": "contour_width", "reason": "referenced by 2 dependentParameters"}]

    def test_an_object_with_no_dependentParameters_at_all_is_kept_not_deleted(self):
        """Can't prove it's unreferenced -> never delete. Distinct message from the referenced
        case so a caller can tell 'definitely referenced' apart from 'could not check'."""
        p = FakeParam("tie_width", stamped=True, dependents=None)
        result = compute_stale_params([p], payload_names=[])
        assert p.delete_called is False
        assert result["deleted"] == []
        assert len(result["kept_referenced"]) == 1
        assert "unavailable" in result["kept_referenced"][0]["reason"]

    def test_a_referenced_UNSTAMPED_registered_param_is_still_adopted(self):
        p = FakeParam("node_diameter", stamped=False, dependents=1)
        result = compute_stale_params([p], payload_names=[])
        assert result["adopted"] == ["node_diameter"]
        assert result["deleted"] == []
        assert len(result["kept_referenced"]) == 1


class TestMixedBatch:
    def test_every_bucket_together_no_crosstalk(self):
        stale_del = FakeParam("stroke_width", stamped=True, dependents=0)
        stale_adopt = FakeParam("half_width", stamped=False, dependents=0)
        kept = FakeParam("contour_height", stamped=True, dependents=1)
        unregistered = FakeParam("Fred_own_param", stamped=False, dependents=0)
        in_payload = FakeParam("node_diameter", stamped=True, dependents=0)
        broken = FakeParam("rail_width", stamped=True, dependents=0, delete_raises=RuntimeError("x"))

        result = compute_stale_params(
            [stale_del, stale_adopt, kept, unregistered, in_payload, broken],
            payload_names=["node_diameter"])

        assert sorted(result["deleted"]) == ["half_width", "stroke_width"]  # adopted stale params delete too
        assert result["adopted"] == ["half_width"]
        assert [k["name"] for k in result["kept_referenced"]] == ["contour_height"]
        assert result["failed"] == [{"name": "rail_width", "error": "x"}]
        assert unregistered.delete_called is False
        assert in_payload.delete_called is False

    def test_no_candidates_returns_every_key_present_and_empty(self):
        result = compute_stale_params([], payload_names=["widthIn", "heightIn"])
        assert result == {"deleted": [], "kept_referenced": [], "adopted": [], "failed": []}

    def test_a_missing_name_never_crashes(self):
        p = FakeParam(None)
        result = compute_stale_params([p], payload_names=[])
        assert result == {"deleted": [], "kept_referenced": [], "adopted": [], "failed": []}

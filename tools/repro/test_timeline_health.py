"""H23 item 32: timeline_health.py's own predicate, tested with fakes -- no Fusion needed. Mirrors
the EXACT live-measured shape (a group whose own healthState is Unknown/5 while its children are
genuinely Healthy) that made three repro scripts report a false "unhealthy" on every real Send."""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from timeline_health import is_item_healthy, is_timeline_healthy, unhealthy_names

HEALTHY, UNKNOWN, ERROR = 0, 5, 2


class _Item:
    def __init__(self, name, health):
        self.name = name
        self.healthState = health
        self.isGroup = False


class _Group:
    """MEASURED: a TimelineGroup's own healthState is ALWAYS Unknown (5), independent of its
    children -- this fake always reports 5, matching live Fusion, so a correct predicate must
    never trust it directly."""
    def __init__(self, name, children):
        self.name = name
        self.healthState = UNKNOWN
        self.isGroup = True
        self._children = children

    @property
    def count(self):
        return len(self._children)

    def item(self, i):
        return self._children[i]


class _Timeline:
    def __init__(self, items):
        self._items = items

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]


class TestIsItemHealthy:
    def test_a_plain_healthy_feature_is_healthy(self):
        assert is_item_healthy(_Item("Sketch1", HEALTHY)) is True

    def test_a_plain_unhealthy_feature_is_not(self):
        assert is_item_healthy(_Item("Extrude1", ERROR)) is False

    def test_a_group_whose_own_healthstate_is_unknown_but_children_healthy_IS_healthy(self):
        """The exact live-measured shape: Group1 reports Unknown while both its children
        (' Clean:1', 'Base Feature1') report Healthy -- the real, correct answer is healthy."""
        grp = _Group("Group1", [_Item(" Clean:1", HEALTHY), _Item("Base Feature1", HEALTHY)])
        assert grp.healthState == UNKNOWN  # sanity: the fake really does mimic the live quirk
        assert is_item_healthy(grp) is True

    def test_a_group_with_a_genuinely_unhealthy_child_is_not_healthy(self):
        grp = _Group("Group1", [_Item(" Clean:1", HEALTHY), _Item("Base Feature1", ERROR)])
        assert is_item_healthy(grp) is False

    def test_nested_groups_recurse(self):
        inner = _Group("InnerGroup", [_Item("A", HEALTHY), _Item("B", ERROR)])
        outer = _Group("Group1", [_Item("X", HEALTHY), inner])
        assert is_item_healthy(outer) is False


class TestTimelineLevelChecks:
    def _real_send_shaped_timeline(self):
        """Mirrors the actual captured-payload replay: B-Spline Set, Group1 (Unknown, children
        healthy), Frame_1, every frame sketch/extrude/trim healthy."""
        return _Timeline([
            _Item(" B-Spline Set:1", HEALTHY),
            _Group("Group1", [_Item(" Clean:1", HEALTHY), _Item("Base Feature1", HEALTHY)]),
            _Item(" Frame_1:1", HEALTHY),
            _Item("T1_1_bounding_box", HEALTHY),
            _Item("T1_2_shape_outline", HEALTHY),
            _Item("T1_3_frame_enclosure", HEALTHY),
            _Item("t1_frame_bottom_Extrude", HEALTHY),
            _Item("t1_TRIM_CUT", HEALTHY),
        ])

    def test_the_old_naive_check_would_have_flagged_it(self):
        """Proves the bug this item fixes: the OLD predicate (`healthState == 0` on every
        top-level item, what all three repro scripts did) is false on this exact timeline, even
        though nothing is actually broken."""
        tl = self._real_send_shaped_timeline()
        naive = all(tl.item(i).healthState == HEALTHY for i in range(tl.count))
        assert naive is False  # the bug, reproduced

    def test_is_timeline_healthy_is_true_on_the_same_timeline(self):
        tl = self._real_send_shaped_timeline()
        assert is_timeline_healthy(tl) is True

    def test_unhealthy_names_is_empty_on_the_same_timeline(self):
        tl = self._real_send_shaped_timeline()
        assert unhealthy_names(tl) == []

    def test_unhealthy_names_reports_the_groups_own_name_for_a_real_failure_inside_it(self):
        tl = _Timeline([
            _Item(" B-Spline Set:1", HEALTHY),
            _Group("Group1", [_Item(" Clean:1", HEALTHY), _Item("Base Feature1", ERROR)]),
            _Item("t1_TRIM_CUT", HEALTHY),
        ])
        assert unhealthy_names(tl) == ["Group1"]

    def test_unhealthy_names_reports_a_plain_unhealthy_feature_by_its_own_name(self):
        tl = _Timeline([_Item(" B-Spline Set:1", HEALTHY), _Item("t1_TRIM_CUT", ERROR)])
        assert unhealthy_names(tl) == ["t1_TRIM_CUT"]

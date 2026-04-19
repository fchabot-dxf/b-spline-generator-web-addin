"""Unit tests for ``coincidence_clusters`` — the Track B core module.

Scope: the module's pure logic (clustering by coord, forced-picks
round-trip, emit formatting). We don't exercise the ownership gate
or the bridge round-trip here; those are covered by the end-to-end
``test_template_bridge`` / ``test_mixed_entities_and_rename`` pair.

Fake runtime is minimal — just enough to construct SketchPoint-shaped
objects. ``_derive_point_role_id`` is patched at the module level so
we can feed pre-resolved IDs without having to simulate the full
``connectedEntities`` walk; that walk has its own coverage in the
relation-hints tests.
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Minimal fake Fusion runtime so imports don't blow up on ``import adsk``.
adsk = types.ModuleType('adsk')
adsk.core = types.ModuleType('adsk.core')
adsk.fusion = types.ModuleType('adsk.fusion')
sys.modules.setdefault('adsk', adsk)
sys.modules.setdefault('adsk.core', adsk.core)
sys.modules.setdefault('adsk.fusion', adsk.fusion)


class FakePoint:
    """Stand-in for a Fusion SketchPoint.

    Coords live under ``geometry`` to match the real API shape — the
    module reads ``pt.geometry.x / .y / .z``. ``fb_id`` shortcuts the
    direct-attribute branch of ``_resolve_point_id``; callers that
    want to exercise the ``_derive_point_role_id`` fallback should
    leave ``fb_id`` empty and patch the module-level derivation hook.
    """

    def __init__(self, x, y, z=0.0, fb_id=''):
        self.objectType = 'adsk::fusion::SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y, z=z)
        # ``_get_native`` returns ``nativeObject`` if truthy; we want
        # the test object to be its own native, so leave this falsy.
        self.nativeObject = None
        # ``fb_attributes.get_fb_id`` reads through ``attributes`` —
        # keep a mini attribute store with the ID slot pre-populated
        # when the test wants the direct path.
        self._fb_id = fb_id
        self.attributes = _FakeAttrs({'ID': fb_id} if fb_id else {})


class _FakeAttrs:
    def __init__(self, values):
        self._values = values

    def itemByName(self, group, name):
        if name in self._values:
            return types.SimpleNamespace(value=self._values[name])
        return None


import coincidence_clusters as cc


def _patch_derive(mapping):
    """Swap in a deterministic ``_derive_point_role_id`` for the test.

    ``mapping`` is ``{id(fake_point): role_id_string}``; anything not
    in the mapping resolves to ``None`` so we can exercise the
    "untagged member drops cluster" path.
    """
    original = cc._derive_point_role_id
    cc._derive_point_role_id = lambda pt: mapping.get(id(pt))
    return original


def test_emit_coincident_hint_shape():
    # Parser side (``phase_parser._build_constraint_step``) expects
    # two quoted target IDs in a ``Constraints.<Type>(...)`` call.
    # Match that shape exactly; the parser round-trip in
    # test_template_generator.py catches most format drift but a
    # unit-level check keeps the error closer to the source.
    assert cc.emit_coincident_hint('horn_TL:E', 'horn_BR:S') == \
        'Constraints.CoincidentConstraint("horn_TL:E", "horn_BR:S")'


def test_clusters_group_by_rounded_coord():
    a = FakePoint(1.0, 2.0)
    b = FakePoint(1.0000001, 2.0)      # within 6-decimal rounding — same cluster
    c = FakePoint(5.0, 9.0)            # separate cluster

    clusters = cc.cluster_sketchpoints([a, b, c])
    keys = list(clusters.keys())
    # Order matters: first-encountered coord appears first. This is
    # the invariant that keeps coincidenceClusters ordered by pick
    # order in the emitted payload.
    assert keys[0] == (1.0, 2.0, 0.0)
    assert keys[1] == (5.0, 9.0, 0.0)
    assert len(clusters[(1.0, 2.0, 0.0)]) == 2
    assert len(clusters[(5.0, 9.0, 0.0)]) == 1


def test_clusters_skip_non_points():
    # A non-SketchPoint entity mixed into the selection must be
    # silently skipped — the caller runs the full entity list through
    # both the ownership gate and cluster detection, so we can't just
    # refuse non-points here.
    pt = FakePoint(0.0, 0.0, fb_id='solo')
    line = types.SimpleNamespace(
        objectType='adsk::fusion::SketchLine', nativeObject=None,
    )
    clusters = cc.cluster_sketchpoints([line, pt, line])
    assert len(clusters) == 1


def test_size_two_cluster_auto_pair_pick_order():
    a = FakePoint(1.0, 1.0)
    b = FakePoint(1.0, 1.0)
    original = _patch_derive({id(a): 'horn_TL:E', id(b): 'horn_BR:S'})
    try:
        # Pick order: b first, a second. Emitted pair must preserve that.
        auto, amb = cc.detect_coincidence_pairs([b, a])
        assert amb == []
        assert auto == [('horn_BR:S', 'horn_TL:E')]
    finally:
        cc._derive_point_role_id = original


def test_size_three_cluster_surfaces_as_ambiguous():
    a = FakePoint(2.0, 3.0)
    b = FakePoint(2.0, 3.0)
    c = FakePoint(2.0, 3.0)
    original = _patch_derive({
        id(a): 'horn_TL:E', id(b): 'horn_BR:S', id(c): 'horn_MID',
    })
    try:
        auto, clusters = cc.detect_coincidence_pairs([a, b, c])
        assert auto == []
        assert len(clusters) == 1
        cluster = clusters[0]
        assert cluster['size'] == 3
        # ``clusterId`` starts at ``cluster_0`` — the palette uses it
        # as the key for the per-cluster checked-indices state, so a
        # stable-within-one-push prefix is all we need.
        assert cluster['clusterId'] == 'cluster_0'
        # Size-3+ clusters always surface with a resolution flag; a
        # fresh (unpicked) cluster is ``resolved: False`` with empty
        # ``pickedIndices`` — the palette reads both to seed checkbox
        # state on a fresh render and to show the "n/2" status pill.
        assert cluster['resolved'] is False
        assert cluster['pickedIndices'] == []
        ids = [pt['id'] for pt in cluster['points']]
        assert ids == ['horn_TL:E', 'horn_BR:S', 'horn_MID']
    finally:
        cc._derive_point_role_id = original


def test_forced_picks_resolves_ambiguous_cluster():
    a = FakePoint(0.0, 0.0)
    b = FakePoint(0.0, 0.0)
    c = FakePoint(0.0, 0.0)
    d = FakePoint(0.0, 0.0)
    original = _patch_derive({
        id(a): 'P0', id(b): 'P1', id(c): 'P2', id(d): 'P3',
    })
    try:
        # Four-point cluster, user picked indices 1 and 3 (P1 and P3).
        forced = {'cluster_0': [1, 3]}
        auto, clusters = cc.detect_coincidence_pairs([a, b, c, d], forced_picks=forced)
        # Pair respects the forced-index order — palette's FIFO-bump
        # rule means forced[0] was checked before forced[1].
        assert auto == [('P1', 'P3')]
        # Resolved clusters STAY in the list (with ``resolved: True``
        # and ``pickedIndices`` echoing the forced pick) so the UI
        # can keep the checkbox section visible after 2/2 — the user
        # may want to un-pick or revise without losing the cluster.
        assert len(clusters) == 1
        assert clusters[0]['resolved'] is True
        assert clusters[0]['pickedIndices'] == [1, 3]
    finally:
        cc._derive_point_role_id = original


def test_forced_picks_bad_shape_falls_through():
    # Corrupt forced_picks must not crash — the cluster should
    # re-surface as unresolved so the user can re-pick.
    a = FakePoint(0.0, 0.0)
    b = FakePoint(0.0, 0.0)
    c = FakePoint(0.0, 0.0)
    original = _patch_derive({id(a): 'P0', id(b): 'P1', id(c): 'P2'})
    try:
        auto, clusters = cc.detect_coincidence_pairs(
            [a, b, c], forced_picks={'cluster_0': 'garbage'},
        )
        assert auto == []
        assert len(clusters) == 1
        assert clusters[0]['resolved'] is False
        assert clusters[0]['pickedIndices'] == []
    finally:
        cc._derive_point_role_id = original


def test_cluster_with_untagged_member_is_dropped():
    # One member of the cluster can't resolve to an FB ID — we can't
    # emit a partial cluster, so the whole thing is dropped with a
    # log line. The untagged point is still visible to the user via
    # the ownership-gate's ``unownedCount`` banner upstream.
    a = FakePoint(4.0, 4.0)
    b = FakePoint(4.0, 4.0)  # no ID, no derivation mapping
    original = _patch_derive({id(a): 'P0'})  # only ``a`` is mapped
    try:
        auto, amb = cc.detect_coincidence_pairs([a, b])
        assert auto == []
        assert amb == []
    finally:
        cc._derive_point_role_id = original


def test_singleton_cluster_ignored():
    # A lone point (no twin at same coord) has no coincidence to
    # express — must not appear in either auto or ambiguous output.
    a = FakePoint(9.0, 9.0)
    original = _patch_derive({id(a): 'solo'})
    try:
        auto, amb = cc.detect_coincidence_pairs([a])
        assert auto == []
        assert amb == []
    finally:
        cc._derive_point_role_id = original


def test_multi_cluster_preserves_order():
    # Two size-2 clusters; the emitted pair order must match the
    # order of first-encounter in the selection.
    a1 = FakePoint(1.0, 1.0)
    b1 = FakePoint(5.0, 5.0)
    a2 = FakePoint(1.0, 1.0)
    b2 = FakePoint(5.0, 5.0)
    original = _patch_derive({
        id(a1): 'A1', id(b1): 'B1', id(a2): 'A2', id(b2): 'B2',
    })
    try:
        # Pick order: a1 (cluster 1 opens), b1 (cluster 2 opens),
        #             a2 (cluster 1 closes), b2 (cluster 2 closes).
        # Cluster 1 was first-seen, so it emits first.
        auto, amb = cc.detect_coincidence_pairs([a1, b1, a2, b2])
        assert amb == []
        assert auto == [('A1', 'A2'), ('B1', 'B2')]
    finally:
        cc._derive_point_role_id = original


if __name__ == '__main__':
    test_emit_coincident_hint_shape()
    test_clusters_group_by_rounded_coord()
    test_clusters_skip_non_points()
    test_size_two_cluster_auto_pair_pick_order()
    test_size_three_cluster_surfaces_as_ambiguous()
    test_forced_picks_resolves_ambiguous_cluster()
    test_forced_picks_bad_shape_falls_through()
    test_cluster_with_untagged_member_is_dropped()
    test_singleton_cluster_ignored()
    test_multi_cluster_preserves_order()
    print('test_coincidence_clusters passed')

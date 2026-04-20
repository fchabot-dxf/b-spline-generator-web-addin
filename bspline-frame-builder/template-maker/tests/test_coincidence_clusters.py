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


class FakeLine:
    """Stand-in for a Fusion SketchLine.

    Start/end points expose the real API surface
    (``startSketchPoint.geometry.x/y/z``). ``fb_id`` populates the
    direct FB-ID path — the line's ``_resolve_curve_id`` first asks
    ``_origin_axis_token`` (patched to ``None`` in tests unless the
    test explicitly installs a token) and only then falls back to
    ``get_fb_id``.
    """

    def __init__(self, sx, sy, ex, ey, sz=0.0, ez=0.0, fb_id=''):
        self.objectType = 'adsk::fusion::SketchLine'
        self.startSketchPoint = types.SimpleNamespace(
            geometry=types.SimpleNamespace(x=sx, y=sy, z=sz))
        self.endSketchPoint = types.SimpleNamespace(
            geometry=types.SimpleNamespace(x=ex, y=ey, z=ez))
        self.nativeObject = None
        self.isReference = False
        self.referencedEntity = None
        self._fb_id = fb_id
        self.attributes = _FakeAttrs({'ID': fb_id} if fb_id else {})


class FakeAxis:
    """Stand-in for a root ``ConstructionAxis``.

    ``_point_on_curve_distance`` reads ``curve.geometry.origin`` and
    ``curve.geometry.direction`` (the InfiniteLine3D shape). We mirror
    that surface plus an ``objectType`` the ``ConstructionAxis``
    suffix matcher recognises.
    """

    def __init__(self, origin, direction):
        self.objectType = 'adsk::fusion::ConstructionAxis'
        self.geometry = types.SimpleNamespace(
            origin=types.SimpleNamespace(
                x=origin[0], y=origin[1], z=origin[2] if len(origin) > 2 else 0.0),
            direction=types.SimpleNamespace(
                x=direction[0], y=direction[1],
                z=direction[2] if len(direction) > 2 else 0.0),
        )
        self.nativeObject = None


def _patch_origin_token(mapping):
    """Make ``_origin_axis_token`` honour a fixed entity→token map.

    ``mapping`` is ``{id(fake_entity): 'Y_AXIS'}`` (or similar). The
    patch covers the two code paths that call the helper:
    ``_resolve_point_id`` (deferred import) and ``_resolve_curve_id``
    (also deferred). Both look it up off the ``relation_hints`` module
    at call time, so we patch the attribute there too.
    """
    import relation_hints
    original = relation_hints._origin_axis_token
    relation_hints._origin_axis_token = lambda ent: mapping.get(id(ent))
    return original


def _restore_origin_token(original):
    import relation_hints
    relation_hints._origin_axis_token = original


def test_point_on_axis_emits_single_pair():
    # One SketchPoint on Y-axis picked alongside the axis — expect a
    # single auto-pair ``(point_id, 'Y_AXIS')``. No ambiguous cluster
    # (cluster size < 2 at the point-point level).
    point = FakePoint(0.0, 5.0, fb_id='rail_top')
    axis = FakeAxis(origin=(0.0, 0.0, 0.0), direction=(0.0, 1.0, 0.0))
    orig_token = _patch_origin_token({id(axis): 'Y_AXIS'})
    try:
        auto, amb = cc.detect_coincidence_pairs([point, axis])
        assert amb == []
        assert auto == [('rail_top', 'Y_AXIS')]
    finally:
        _restore_origin_token(orig_token)


def test_point_on_line_emits_pair_with_fb_id():
    # SketchPoint on a non-origin SketchLine — the line's FB-ID is the
    # emission target (no origin-axis short-circuit since the token
    # patch returns ``None`` for this line).
    line = FakeLine(0.0, 0.0, 0.0, 10.0, fb_id='rail_1')
    pt = FakePoint(0.0, 4.0, fb_id='knot_a')
    orig_token = _patch_origin_token({})  # no tokens — force FB-ID path
    try:
        auto, amb = cc.detect_coincidence_pairs([pt, line])
        assert amb == []
        assert auto == [('knot_a', 'rail_1')]
    finally:
        _restore_origin_token(orig_token)


def test_junction_a_equals_b_on_axis_emits_mst_only():
    # {A, B, Y-axis} with A=B and both on Y. The point-point pass
    # emits (A, B); the curve pass emits exactly one of (A, Y) or
    # (B, Y) — the other is skipped by the MST rule because A and B
    # are already transitively bound (redundant constraint would
    # crash Fusion's solver).
    a = FakePoint(0.0, 3.0)
    b = FakePoint(0.0, 3.0)
    axis = FakeAxis(origin=(0.0, 0.0, 0.0), direction=(0.0, 1.0, 0.0))
    original = _patch_derive({id(a): 'A', id(b): 'B'})
    orig_token = _patch_origin_token({id(axis): 'Y_AXIS'})
    try:
        auto, amb = cc.detect_coincidence_pairs([a, b, axis])
        assert amb == []
        # Two edges total: the point-point pair first, then one
        # point-axis edge. Which endpoint ends up paired with the
        # axis depends on pick order — A comes first so (A, Y_AXIS).
        assert auto == [('A', 'B'), ('A', 'Y_AXIS')]
    finally:
        _restore_origin_token(orig_token)
        cc._derive_point_role_id = original


def test_two_distinct_points_on_axis_emits_both_edges():
    # {A, B, Y-axis} with A != B (both on Y but at different heights).
    # No point-point cluster; the curve pass emits both (A, Y) and
    # (B, Y) because A and B are independent endpoints in the UF.
    a = FakePoint(0.0, 2.0)
    b = FakePoint(0.0, 7.0)
    axis = FakeAxis(origin=(0.0, 0.0, 0.0), direction=(0.0, 1.0, 0.0))
    original = _patch_derive({id(a): 'A', id(b): 'B'})
    orig_token = _patch_origin_token({id(axis): 'Y_AXIS'})
    try:
        auto, amb = cc.detect_coincidence_pairs([a, b, axis])
        assert amb == []
        assert auto == [('A', 'Y_AXIS'), ('B', 'Y_AXIS')]
    finally:
        _restore_origin_token(orig_token)
        cc._derive_point_role_id = original


def test_point_off_axis_no_pair():
    # Point's perpendicular distance exceeds tolerance — no pair.
    pt = FakePoint(1.0, 5.0, fb_id='off')  # x=1 off the Y-axis at x=0
    axis = FakeAxis(origin=(0.0, 0.0, 0.0), direction=(0.0, 1.0, 0.0))
    orig_token = _patch_origin_token({id(axis): 'Y_AXIS'})
    try:
        auto, amb = cc.detect_coincidence_pairs([pt, axis])
        assert auto == []
        assert amb == []
    finally:
        _restore_origin_token(orig_token)


def test_origin_token_resolves_projected_origin_point():
    # A projected origin point (``isReference=True`` under the real
    # API) — ``_resolve_point_id`` falls through derivation and finds
    # the ORIGIN token via the deferred-import fallback. It should
    # then pair with a line that passes through (0,0).
    origin_pt = FakePoint(0.0, 0.0)
    line = FakeLine(-5.0, 0.0, 5.0, 0.0, fb_id='rail_h')
    original = _patch_derive({})  # no role ID — force token fallback
    orig_token = _patch_origin_token({id(origin_pt): 'ORIGIN'})
    try:
        auto, amb = cc.detect_coincidence_pairs([origin_pt, line])
        assert amb == []
        assert auto == [('ORIGIN', 'rail_h')]
    finally:
        _restore_origin_token(orig_token)
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
    test_point_on_axis_emits_single_pair()
    test_point_on_line_emits_pair_with_fb_id()
    test_junction_a_equals_b_on_axis_emits_mst_only()
    test_two_distinct_points_on_axis_emits_both_edges()
    test_point_off_axis_no_pair()
    test_origin_token_resolves_projected_origin_point()
    print('test_coincidence_clusters passed')

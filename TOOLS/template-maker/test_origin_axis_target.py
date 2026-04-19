"""Regression tests for origin-axis / origin-point Coincident targets.

Scope:
  * ``relation_hints._origin_axis_token`` — resolves a sketch-space or
    root-level construction entity to a bare token
    (``'X_AXIS'`` / ``'Y_AXIS'`` / ``'ORIGIN'``). Two paths: direct
    identity against a root entity, and reference-through for a
    sketch-side projected proxy (``isReference=True`` with
    ``referencedEntity`` pointing at the root).
  * ``relation_hints._format_target_reference`` — emits the token
    verbatim when the resolver returns one, short-circuiting ahead of
    the ``_POINT_TYPES`` branch that would otherwise produce a
    ``"SketchPoint"`` placeholder for a projected ORIGIN proxy.
  * ``ownership_gate.is_framebuilder_owned`` — whitelists origin-token
    entities so Coincident constraints whose only "untagged" target is
    an origin axis still pass the gate.

Runtime is stubbed. The axis/origin singletons are built as plain
``SimpleNamespace`` objects and Application.get() is swapped out so
``_get_origin_entity_map`` returns them. Python identity (``is``) does
all the work — no real Fusion ``==`` overload needed.
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Fake Fusion runtime so ``import adsk`` inside the real modules is a no-op.
adsk = types.ModuleType('adsk')
adsk.core = types.ModuleType('adsk.core')
adsk.fusion = types.ModuleType('adsk.fusion')


# --- Root construction singletons. Identity is the whole point here;
#     ``_origin_axis_token`` compares ``native is origin_ent`` as its
#     first test. Plain SimpleNamespace objects satisfy that contract
#     without dragging in any of the real API surface.
FAKE_X_AXIS = types.SimpleNamespace(_tag='root-x-axis')
FAKE_Z_AXIS = types.SimpleNamespace(_tag='root-z-axis')   # Y_AXIS in sketch space
FAKE_ORIGIN_PT = types.SimpleNamespace(_tag='root-origin-pt')

FAKE_ROOT = types.SimpleNamespace(
    xConstructionAxis=FAKE_X_AXIS,
    zConstructionAxis=FAKE_Z_AXIS,
    originConstructionPoint=FAKE_ORIGIN_PT,
)
FAKE_PRODUCT = types.SimpleNamespace(rootComponent=FAKE_ROOT)


class _FakeApp:
    @staticmethod
    def get():
        return types.SimpleNamespace(activeProduct=FAKE_PRODUCT)


adsk.core.Application = _FakeApp
# Use straight assignment rather than ``setdefault`` — another test module
# (``test_coincidence_clusters`` loads first under pytest's alphabetical
# collection) may already have stubbed ``adsk``/``adsk.core`` in
# ``sys.modules`` without an ``Application`` attribute. Setdefault would
# no-op here and our ``_FakeApp`` would never reach the real
# ``_get_origin_entity_map`` call, silently breaking every origin-token
# assertion in this file.
sys.modules['adsk'] = adsk
sys.modules['adsk.core'] = adsk.core
sys.modules['adsk.fusion'] = adsk.fusion


import relation_hints
import ownership_gate


class _FakeAttrs:
    """Minimal ``attributes`` shim — ``itemByName`` returns None for every
    group/name combo, which is what the ``FrameBuilder.ID`` reader gets
    for an entity that was never stamped. Origin entities can't carry FB
    IDs, so this is the correct shape for them.
    """
    def itemByName(self, group, name):
        return None


def _make_sketch_axis_proxy(referenced):
    """Fake a projected axis SketchLine: ``isReference=True`` +
    ``referencedEntity`` -> root construction axis.

    Frame Builder's runtime produces this shape via
    ``sketch.project(xConstructionAxis)``. The Template Maker has to
    recognise it without calling back into the real API.
    """
    return types.SimpleNamespace(
        objectType='adsk::fusion::SketchLine',
        isReference=True,
        referencedEntity=referenced,
        nativeObject=None,
        attributes=_FakeAttrs(),
    )


def _make_sketch_point_proxy(referenced):
    """Fake a projected-origin SketchPoint: ``isReference=True`` +
    ``referencedEntity`` -> root origin construction point.
    """
    return types.SimpleNamespace(
        objectType='adsk::fusion::SketchPoint',
        isReference=True,
        referencedEntity=referenced,
        nativeObject=None,
        attributes=_FakeAttrs(),
    )


# ---------------------------------------------------------------------------
# _origin_axis_token — direct identity + reference-through paths.
# ---------------------------------------------------------------------------


def test_origin_token_direct_identity_x_axis():
    # Path 1 — someone picked xConstructionAxis straight from the browser
    # tree. ``_origin_axis_token`` must match it to the ``'X_AXIS'``
    # token without any reference chase.
    assert relation_hints._origin_axis_token(FAKE_X_AXIS) == 'X_AXIS'


def test_origin_token_direct_identity_y_axis_is_z_axis():
    # Frame Builder's XZ-plane convention: sketch-space ``Y_AXIS`` maps
    # to the WORLD Z axis. This test pins that mapping — if someone
    # flips the convention by mistake to ``yConstructionAxis``, the
    # runtime's pre-seed and the Template Maker's emission drift apart
    # silently and this test catches the drift.
    assert relation_hints._origin_axis_token(FAKE_Z_AXIS) == 'Y_AXIS'


def test_origin_token_direct_identity_origin_point():
    assert relation_hints._origin_axis_token(FAKE_ORIGIN_PT) == 'ORIGIN'


def test_origin_token_reference_through_projected_axis():
    # Path 2 — the normal case. A projected axis appears in the sketch
    # as a SketchLine with isReference=True and referencedEntity
    # pointing at the root axis. Resolver must follow the reference.
    sketch_line = _make_sketch_axis_proxy(FAKE_X_AXIS)
    assert relation_hints._origin_axis_token(sketch_line) == 'X_AXIS'

    sketch_line_y = _make_sketch_axis_proxy(FAKE_Z_AXIS)
    assert relation_hints._origin_axis_token(sketch_line_y) == 'Y_AXIS'


def test_origin_token_reference_through_projected_origin():
    sketch_pt = _make_sketch_point_proxy(FAKE_ORIGIN_PT)
    assert relation_hints._origin_axis_token(sketch_pt) == 'ORIGIN'


def test_origin_token_returns_none_for_unrelated_entity():
    # A plain SketchLine that isn't a reference line must NOT be
    # mistaken for an origin axis. Falling through to ``None`` is what
    # lets the caller (``_format_target_reference``) run normal FB-ID
    # resolution for regular user geometry.
    unrelated = types.SimpleNamespace(
        objectType='adsk::fusion::SketchLine',
        isReference=False,
        referencedEntity=None,
        nativeObject=None,
        attributes=_FakeAttrs(),
    )
    assert relation_hints._origin_axis_token(unrelated) is None


def test_origin_token_tolerates_none_input():
    # ``_format_target_reference`` already handles None in its own
    # early-return, but the resolver is used independently in the gate
    # and must not explode on None or missing slots.
    assert relation_hints._origin_axis_token(None) is None


def test_origin_token_survives_faulting_getattr():
    # Simulate a settling proxy whose attribute accesses explode —
    # exactly the hazard the broad try/except in ``_origin_axis_token``
    # exists to absorb. Return must be None, not a native AV and not a
    # leaked exception.
    class Boom:
        def __getattr__(self, k):
            raise RuntimeError('proxy not settled')
    assert relation_hints._origin_axis_token(Boom()) is None


# ---------------------------------------------------------------------------
# _format_target_reference — origin short-circuit emission.
# ---------------------------------------------------------------------------


def test_format_target_emits_bare_origin_token_for_projected_axis():
    # End-to-end for the emission side: a projected axis target
    # formatted into the argument list of a Coincident constraint must
    # come out as ``"Y_AXIS"`` (with quotes, because
    # ``_format_target_reference`` wraps literals in double-quotes).
    sketch_line_y = _make_sketch_axis_proxy(FAKE_Z_AXIS)
    assert relation_hints._format_target_reference(sketch_line_y) == '"Y_AXIS"'


def test_format_target_emits_origin_for_projected_origin_point():
    # The ``ORIGIN`` case matters MORE than the axes: without the
    # origin short-circuit, a projected-origin SketchPoint would hit
    # the ``_POINT_TYPES`` branch, fail role-id derivation (no parent
    # curve), fail the FB-name lookup (origin has none), and fall
    # through to ``"SketchPoint"`` — a broken placeholder that
    # ``ctx.resolve_entity`` can't do anything with.
    sketch_pt = _make_sketch_point_proxy(FAKE_ORIGIN_PT)
    assert relation_hints._format_target_reference(sketch_pt) == '"ORIGIN"'


def test_format_target_preserves_non_origin_behavior():
    # Sanity: a plain SketchPoint without an FB name still goes through
    # the existing ``"SketchPoint"`` fallback. The origin short-circuit
    # must not capture non-origin picks.
    pt = types.SimpleNamespace(
        objectType='adsk::fusion::SketchPoint',
        isReference=False,
        referencedEntity=None,
        nativeObject=None,
        attributes=_FakeAttrs(),
        # Empty iterable — ``get_fb_name`` walks ``connectedEntities`` to
        # try to synthesise a ``"Vertex of ..."`` name. An empty walk lets
        # it fall through to the ``objectType`` basename, which is the
        # baseline fallback the origin short-circuit must NOT capture.
        connectedEntities=[],
    )
    assert relation_hints._format_target_reference(pt) == '"SketchPoint"'


# ---------------------------------------------------------------------------
# Ownership gate — origin-token whitelist.
# ---------------------------------------------------------------------------


def test_gate_allows_projected_axis_via_origin_whitelist():
    # The gate whitelist is the counterpart to the emitter's
    # short-circuit. Without it, a Coincident constraint picking
    # (body_TL, Y_AXIS) would fail the gate (axis has no FB attribute,
    # no role-id derivation) and the whole Coincident would be refused
    # as un-ownable. With the whitelist, the axis passes and the
    # Coincident inherits ownership from both its targets.
    sketch_line_y = _make_sketch_axis_proxy(FAKE_Z_AXIS)
    assert ownership_gate.is_framebuilder_owned(sketch_line_y) is True


def test_gate_allows_projected_origin_via_whitelist():
    sketch_pt = _make_sketch_point_proxy(FAKE_ORIGIN_PT)
    assert ownership_gate.is_framebuilder_owned(sketch_pt) is True


def test_gate_still_refuses_untagged_non_origin_geometry():
    # Regression: the whitelist must be narrow. A plain user-drawn
    # SketchPoint without any FB attribute and not connected to a
    # named curve MUST still fail the gate — otherwise the "N unowned"
    # safety net breaks and random untagged picks slip into emitted
    # phase files.
    pt = types.SimpleNamespace(
        objectType='adsk::fusion::SketchPoint',
        isReference=False,
        referencedEntity=None,
        nativeObject=None,
        attributes=_FakeAttrs(),
        # Empty iterable — ``get_fb_name`` walks ``connectedEntities`` to
        # try to synthesise a ``"Vertex of ..."`` name. An empty walk lets
        # it fall through to the ``objectType`` basename, which is the
        # baseline fallback the origin short-circuit must NOT capture.
        connectedEntities=[],
    )
    assert ownership_gate.is_framebuilder_owned(pt) is False


# ---------------------------------------------------------------------------
# Test runner.
# ---------------------------------------------------------------------------


if __name__ == '__main__':
    test_origin_token_direct_identity_x_axis()
    test_origin_token_direct_identity_y_axis_is_z_axis()
    test_origin_token_direct_identity_origin_point()
    test_origin_token_reference_through_projected_axis()
    test_origin_token_reference_through_projected_origin()
    test_origin_token_returns_none_for_unrelated_entity()
    test_origin_token_tolerates_none_input()
    test_origin_token_survives_faulting_getattr()
    test_format_target_emits_bare_origin_token_for_projected_axis()
    test_format_target_emits_origin_for_projected_origin_point()
    test_format_target_preserves_non_origin_behavior()
    test_gate_allows_projected_axis_via_origin_whitelist()
    test_gate_allows_projected_origin_via_whitelist()
    test_gate_still_refuses_untagged_non_origin_geometry()
    print('test_origin_axis_target passed')

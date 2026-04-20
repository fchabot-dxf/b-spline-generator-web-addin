"""Regression tests for OffsetConstraint support in the Template Maker.

Six scenarios, mirroring the grammar described in ``offset_hint.py``:

    (a) direct OC pick                     — produces Offset.From(...)
    (b) single child-curve pick            — resolves to owning OC
    (c) multi-child same-OC                — dedups to a single item
    (d) multi-child cross-OC               — expands to two distinct items
    (e) mixed parent + child picks         — dedups to a single item
    (f) OC with an untagged parent         — gate rejects, payload empty

A seventh round-trip test exercises ``phase_parser._build_offset_step`` on
the emitted ``Offset.From(...)`` statement so the full statement → dict
path is covered end-to-end.
"""

import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Stub adsk before any template-maker module imports land.
adsk = types.ModuleType('adsk')
adsk_core = types.ModuleType('adsk.core')
adsk_fusion = types.ModuleType('adsk.fusion')
adsk.core = adsk_core
adsk.fusion = adsk_fusion
sys.modules['adsk'] = adsk
sys.modules['adsk.core'] = adsk_core
sys.modules['adsk.fusion'] = adsk_fusion


class _FakeApplication:
    @staticmethod
    def get():
        return None


adsk_core.Application = _FakeApplication

import expression_coords
import template_generator
from phase_parser import parse_statement_to_phase_step, format_phase_step
from offset_hint import (
    build_offset_step,
    derive_target_names,
    find_owning_offset_constraint,
    is_offset_constraint,
    oc_identity_key,
)


def _params():
    return {
        'widthIn':     {'expression': '7 "', 'value': 7.0},
        'heightIn':    {'expression': '9 "', 'value': 9.0},
        'hornOffset':  {'expression': '0.125 "', 'value': 0.125},
        'braceOffset': {'expression': '0.250 "', 'value': 0.250},
    }


def _use_params(fn):
    template_generator.get_design_params = fn
    expression_coords.get_design_params = fn


# ---------------------------------------------------------------------------
# Fakes — minimal Fusion-ish shapes for the offset walk
# ---------------------------------------------------------------------------


class FakeAttrs:
    def __init__(self):
        self._store = {}

    def itemByName(self, group, name):
        return self._store.get((group, name))

    def add(self, group, name, value):
        attr = types.SimpleNamespace(value=value)
        self._store[(group, name)] = attr
        return attr


class FakeList:
    """Minimal ``count`` + ``item(i)`` iterable matching Fusion collections."""

    def __init__(self, items):
        self._items = list(items)

    @property
    def count(self):
        return len(self._items)

    def item(self, i):
        return self._items[i]


class FakePoint:
    def __init__(self, x, y, fb_name=None):
        self.objectType = 'adsk::fusion::SketchPoint'
        self.geometry = types.SimpleNamespace(x=x, y=y)
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)
        self.nativeObject = None


class FakeLine:
    def __init__(self, start, end, fb_name=None, sketch=None):
        self.objectType = 'adsk::fusion::SketchLine'
        self.startSketchPoint = start
        self.endSketchPoint = end
        self.attributes = FakeAttrs()
        if fb_name:
            self.attributes.add('FrameBuilder', 'name', fb_name)
            self.attributes.add('FrameBuilder', 'ID', fb_name)
        self.parentSketch = sketch
        self.nativeObject = None
        # entityToken for identity — ``_same_entity`` uses ``==`` which
        # defaults to identity on plain Python objects, so this is just
        # for realism; not actually consulted.
        self.entityToken = f'line_{id(self)}'


class FakeOffsetConstraint:
    """OC with parentCurves + childCurves + dimension.parameter.expression."""

    def __init__(self, parents, children, expression, token=None):
        self.objectType = 'adsk::fusion::OffsetConstraint'
        self.parentCurves = FakeList(parents)
        self.childCurves = FakeList(children)
        self.dimension = types.SimpleNamespace(
            parameter=types.SimpleNamespace(expression=expression, value=None)
        )
        self.attributes = FakeAttrs()  # OCs carry no FB attributes; checked via parents
        self.entityToken = token or f'oc_{id(self)}'
        self.nativeObject = None


class FakeSketch:
    def __init__(self, constraints):
        self.geometricConstraints = FakeList(constraints)


def _build_offset_pair(parent_names, expression, sketch_holder=None):
    """Build parents, children, and the owning OC in one step.

    Children inherit ``parentSketch`` once the sketch is built so
    ``find_owning_offset_constraint`` can walk back from them.
    """
    parents = [
        FakeLine(FakePoint(0.0, float(i)), FakePoint(1.0, float(i)), fb_name=n)
        for i, n in enumerate(parent_names)
    ]
    children = [
        FakeLine(FakePoint(0.5, float(i)), FakePoint(1.5, float(i)))
        for i, _ in enumerate(parent_names)
    ]
    oc = FakeOffsetConstraint(parents, children, expression)
    return parents, children, oc


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_a_direct_oc_pick_emits_offset_from_statement():
    """Pick the OC itself — produces a parseable ``Offset.From(...)`` hint
    and a phase step dict with the three required slots."""
    _use_params(_params)
    parents, children, oc = _build_offset_pair(['horn_TL', 'horn_L'], 'hornOffset')
    sketch = FakeSketch([oc])
    for p in parents + children:
        p.parentSketch = sketch

    payload = template_generator.build_template_payload([oc])
    assert payload['unownedCount'] == 0, payload['unownedDetails']

    preview = payload['codePreview']
    phase = payload['phaseBlockCode']

    # Phase step carries Type=Offset and all three required slots.
    assert "'Type': 'Offset'" in phase, phase
    assert "'SourceID': ['horn_TL', 'horn_L']" in phase, phase
    assert "'DistanceExpr': 'hornOffset'" in phase, phase
    assert "'TargetIDs': ['offset_horn_TL', 'offset_horn_L']" in phase, phase
    # And the preview carries the same step (both are rendered from the
    # same parsed dict).
    assert "'Type': 'Offset'" in preview, preview


def test_b_single_child_curve_resolves_to_owning_oc():
    """Pick one child curve — the pre-pass resolves it to its OC."""
    _use_params(_params)
    parents, children, oc = _build_offset_pair(['horn_TL', 'horn_L'], 'hornOffset')
    sketch = FakeSketch([oc])
    for p in parents + children:
        p.parentSketch = sketch

    payload = template_generator.build_template_payload([children[0]])
    assert payload['unownedCount'] == 0, payload['unownedDetails']

    phase = payload['phaseBlockCode']
    assert "'Type': 'Offset'" in phase, phase
    assert "'SourceID': ['horn_TL', 'horn_L']" in phase, phase
    # Exactly one offset row, not one per child.
    assert phase.count("'Type': 'Offset'") == 1, phase


def test_c_multi_child_same_oc_dedups_to_one_item():
    """Pick every child of one OC — dedup collapses them to a single step."""
    _use_params(_params)
    parents, children, oc = _build_offset_pair(['horn_TL', 'horn_L'], 'hornOffset')
    sketch = FakeSketch([oc])
    for p in parents + children:
        p.parentSketch = sketch

    payload = template_generator.build_template_payload(list(children))
    phase = payload['phaseBlockCode']

    assert phase.count("'Type': 'Offset'") == 1, phase
    assert "'SourceID': ['horn_TL', 'horn_L']" in phase


def test_d_multi_child_cross_oc_keeps_two_items():
    """Children of two different OCs collapse to two distinct steps."""
    _use_params(_params)
    p1, c1, oc1 = _build_offset_pair(['horn_TL', 'horn_L'], 'hornOffset')
    p2, c2, oc2 = _build_offset_pair(['brace_TL', 'brace_L'], 'braceOffset')
    sketch = FakeSketch([oc1, oc2])
    for ent in p1 + c1 + p2 + c2:
        ent.parentSketch = sketch

    payload = template_generator.build_template_payload([c1[0], c2[0]])
    phase = payload['phaseBlockCode']

    assert phase.count("'Type': 'Offset'") == 2, phase
    assert "'SourceID': ['horn_TL', 'horn_L']" in phase
    assert "'SourceID': ['brace_TL', 'brace_L']" in phase
    assert "'DistanceExpr': 'hornOffset'" in phase
    assert "'DistanceExpr': 'braceOffset'" in phase


def test_e_mixed_parent_and_child_picks_still_dedup():
    """Pick the OC and one of its children — only one step emitted.

    The OC pre-pass dedups by identity key regardless of which path
    (direct-OC vs child-lookup) added the entry.
    """
    _use_params(_params)
    parents, children, oc = _build_offset_pair(['horn_TL', 'horn_L'], 'hornOffset')
    sketch = FakeSketch([oc])
    for p in parents + children:
        p.parentSketch = sketch

    payload = template_generator.build_template_payload([oc, children[0]])
    phase = payload['phaseBlockCode']

    assert phase.count("'Type': 'Offset'") == 1, phase
    assert "'SourceID': ['horn_TL', 'horn_L']" in phase


def test_f_oc_with_untagged_parent_is_rejected_by_gate():
    """An OC whose parent has no FrameBuilder ID fails the ownership gate."""
    _use_params(_params)
    # Parent has no fb_name → ownership gate refuses.
    untagged = FakeLine(FakePoint(0.0, 0.0), FakePoint(1.0, 0.0))
    named = FakeLine(FakePoint(0.0, 1.0), FakePoint(1.0, 1.0), fb_name='horn_L')
    child = FakeLine(FakePoint(0.5, 0.0), FakePoint(1.5, 0.0))
    oc = FakeOffsetConstraint([untagged, named], [child], 'hornOffset')
    sketch = FakeSketch([oc])
    for ent in (untagged, named, child):
        ent.parentSketch = sketch

    payload = template_generator.build_template_payload([oc])
    # Gate must reject; OC lands in ``unowned`` rather than emitting a
    # half-empty offset step.
    assert payload['unownedCount'] >= 1, payload
    phase = payload['phaseBlockCode']
    assert "'Type': 'Offset'" not in phase, phase


def test_round_trip_offset_from_statement_parses_to_step_dict():
    """``Offset.From(...)`` parses into the exact shape the runtime expects."""
    parents, children, oc = _build_offset_pair(['BB_top', 'BB_right', 'BB_bottom', 'BB_left'],
                                               'boundingboxoffset')
    statement = build_offset_step(oc)
    step = parse_statement_to_phase_step(statement)
    assert step is not None, f'failed to parse: {statement}'

    rendered = format_phase_step(step)
    # Matches the hand-written template shape exactly.
    assert "'Type': 'Offset'" in rendered
    assert "'SourceID': ['BB_top', 'BB_right', 'BB_bottom', 'BB_left']" in rendered
    assert "'DistanceExpr': 'boundingboxoffset'" in rendered
    assert ("'TargetIDs': ['offset_BB_top', 'offset_BB_right',"
            " 'offset_BB_bottom', 'offset_BB_left']") in rendered


def test_derive_target_names_rules():
    """Spot-check the four naming rules so a future regression fails
    here before it reaches the end-to-end tests."""
    # 1:1 by index
    assert derive_target_names(['horn_TL', 'horn_L'], 2) == ['offset_horn_TL', 'offset_horn_L']
    # Single source
    assert derive_target_names(['horn_TL'], 1) == ['offset_horn_TL']
    # Mismatched counts
    assert derive_target_names(['horn_TL'], 3) == ['offset_horn_TL_01', 'offset_horn_TL_02', 'offset_horn_TL_03']
    # No sources
    assert derive_target_names([], 2) == ['offset_01', 'offset_02']
    # Zero children
    assert derive_target_names(['horn_TL'], 0) == []


def test_is_offset_constraint_and_identity_key():
    """Identity helpers used by the pre-pass dedup."""
    parents, children, oc = _build_offset_pair(['horn_TL'], 'hornOffset')
    assert is_offset_constraint(oc) is True
    assert is_offset_constraint(parents[0]) is False
    assert is_offset_constraint(None) is False
    k1 = oc_identity_key(oc)
    k2 = oc_identity_key(oc)
    assert k1 == k2
    # Different OC yields a different key.
    _, _, oc2 = _build_offset_pair(['horn_TL'], 'hornOffset')
    assert oc_identity_key(oc2) != k1


def test_find_owning_offset_constraint_walks_sketch():
    """Child → OC lookup through ``sketch.geometricConstraints``."""
    parents, children, oc = _build_offset_pair(['horn_TL', 'horn_L'], 'hornOffset')
    sketch = FakeSketch([oc])
    for p in parents + children:
        p.parentSketch = sketch

    assert find_owning_offset_constraint(children[0]) is oc
    assert find_owning_offset_constraint(children[1]) is oc
    # A parent curve is NOT a child — the walk returns None.
    assert find_owning_offset_constraint(parents[0]) is None
    # An entity whose sketch has no OC also returns None.
    unrelated = FakeLine(FakePoint(0, 0), FakePoint(1, 1), sketch=FakeSketch([]))
    assert find_owning_offset_constraint(unrelated) is None


if __name__ == '__main__':
    test_a_direct_oc_pick_emits_offset_from_statement()
    test_b_single_child_curve_resolves_to_owning_oc()
    test_c_multi_child_same_oc_dedups_to_one_item()
    test_d_multi_child_cross_oc_keeps_two_items()
    test_e_mixed_parent_and_child_picks_still_dedup()
    test_f_oc_with_untagged_parent_is_rejected_by_gate()
    test_round_trip_offset_from_statement_parses_to_step_dict()
    test_derive_target_names_rules()
    test_is_offset_constraint_and_identity_key()
    test_find_owning_offset_constraint_walks_sketch()
    print('OK')

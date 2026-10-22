"""The hole chain (hole_chain.py): BUILD stamps two 3D pockets on EVERY node-hole circle, a larger tool first with rest
machining OFF, a smaller tool second with rest ON from the previous operations (Fred's measured answer: every hole at
least 0.35 in past the far face; rest source 'bodies' stops at the panel body and fails).

Fakes follow the real shapes measured live on a copy of Fred's file (2026-10-20): ``setup.operations.createInput(strategy)``
-> an input with ``parameters.itemByName`` / ``tool`` / ``displayName``; ``operations.add(input)`` -> the operation; a
boundary is ``parameters.itemByName('machiningBoundarySel').value`` whose ``getCurveSelections()`` returns a COPY that
``applyCurveSelections`` writes back (``clear`` / ``createNewChainSelection`` / ``item`` / ``count``); a MM's sketches
live on its occurrences and are read through ``createForAssemblyContext``.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_hole_chain.py
"""
import hashlib
import json
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng, _Coll, _Attrs, _MM, _Cam  # noqa: E402,F401


class _Log:
    def __init__(self):
        self.lines = []

    def log(self, msg, level='INFO'):
        self.lines.append((level, msg))

    def has(self, level, text):
        return any(lv == level and text in m for lv, m in self.lines)


class _Sel:
    def __init__(self):
        self.inputGeometry = []


class _Sels:
    def __init__(self, items=()):
        self._i = list(items)

    @property
    def count(self):
        return len(self._i)

    def item(self, i):
        return self._i[i]

    def clear(self):
        self._i = []

    def createNewChainSelection(self):
        s = _Sel()
        self._i.append(s)
        return s


class _Boundary:
    def __init__(self):
        self.applied = _Sels()
        self.applies = 0

    def getCurveSelections(self):
        copy = []
        for s in self.applied._i:
            c = _Sel()
            c.inputGeometry = list(s.inputGeometry)
            copy.append(c)
        return _Sels(copy)

    def applyCurveSelections(self, cs):
        self.applied = _Sels(cs._i)
        self.applies += 1


class _Param:
    def __init__(self, name):
        self.name = name
        self.expression = ''
        self.value = _Boundary()


class _Params:
    def __init__(self):
        self._p = {}

    def itemByName(self, name):
        return self._p.setdefault(name, _Param(name))

    def expr(self, name):
        return self._p[name].expression if name in self._p else None


_N = [0]


def _token(prefix):
    _N[0] += 1
    return f'{prefix}-{_N[0]}'


class _Input:
    def __init__(self, strategy):
        self.strategy = strategy
        self.parameters = _Params()
        self.tool = None
        self.displayName = ''


class _ChainOp:
    def __init__(self, inp=None, name='op', strategy='pocket_clearing'):
        self.name = inp.displayName if inp is not None else name
        self.strategy = inp.strategy if inp is not None else strategy
        self.parameters = inp.parameters if inp is not None else _Params()
        self.tool = inp.tool if inp is not None else None
        self.entityToken = _token('op')


class _Ops(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]

    def createInput(self, strategy):
        return _Input(strategy)

    def add(self, inp):
        op = _ChainOp(inp)
        self.append(op)
        return op


class _ChainSetup:
    def __init__(self, name, ops=()):
        self.name = name
        self.isValid = True
        self.attributes = _Attrs()
        self.models = _Coll()
        self.operations = _Ops(ops)
        self.parameters = object()


class _Pt:
    def __init__(self, x, y, z):
        self.x, self.y, self.z = x, y, z


class _Circle:
    def __init__(self, tag, i=0, shift=0.0):
        self.entityToken = _token(f'circle-{tag}')
        self.radius = 0.4826
        self.centerSketchPoint = types.SimpleNamespace(worldGeometry=_Pt(i * 3.81 + shift, -7.62, 7.0179))


class _Sketch:
    def __init__(self, name, circles=0, arcs=0, lines=0, shift=0.0):
        self.name = name
        self.circles = [_Circle(name, i, shift) for i in range(circles)]
        self.sketchCurves = types.SimpleNamespace(sketchCircles=_Coll(self.circles), sketchArcs=_Coll([None] * arcs),
                                                  sketchLines=_Coll([None] * lines))

    def createForAssemblyContext(self, occ):
        return self


def _hole_mm(eng, *sketches):
    occ = types.SimpleNamespace(component=types.SimpleNamespace(sketches=_Coll(sketches)))
    mm = _MM(eng.mm._mm_display_name('bspline_set'), bodies=['bspline_set-body'])
    mm.occurrence.component.allOccurrences = _Coll([occ])
    mm.occurrence.component.sketches = _Coll()
    return mm


def _l4(n=20):
    return _Sketch('Source - L4 - ballnose (0.12") [constrained]', circles=n, arcs=3, lines=40)


@pytest.fixture
def hc(eng):
    eng.adsk.cam.Tool = types.SimpleNamespace(createFromJson=lambda js: json.loads(js))
    eng.adsk.fusion.Design = types.SimpleNamespace(cast=lambda x: x)
    return eng.sb.hole_chain


class _Design:
    def __init__(self):
        self.attributes = _Attrs()


def _run(hc, setup, mm, design=None, log=None):
    return hc.build_hole_chain(setup, mm, design or _Design(), 'node_holes', log)


def test_the_chain_is_two_ops_a_then_b_with_rest_off_then_rest_on_from_previous_operations(hc, eng):
    setup, design = _ChainSetup('B-spline Back'), _Design()
    out = _run(hc, setup, _hole_mm(eng, _l4()), design)
    assert out['created'] == ['Holes A 3-16 rough', 'Holes B 1-8 rest']
    a, b = list(setup.operations)
    assert (a.name, b.name) == ('Holes A 3-16 rough', 'Holes B 1-8 rest')
    assert a.parameters.expr('useRestMachining') == 'false'
    assert b.parameters.expr('useRestMachining') == 'true'
    assert b.parameters.expr('restMaterialSource') == "'previousOperations'"
    assert a.parameters.expr('restMaterialSource') is None          # rest off: no source written
    # Fred's settings, on both
    for op in (a, b):
        assert op.parameters.expr('verticalStockToLeave') == '-0.6 in'
        assert op.parameters.expr('bottomHeight_mode') == "'from stock bottom'"
        assert op.parameters.expr('bottomHeight_offset') == '0 in'
        assert op.parameters.expr('topHeight_mode') == "'from stock top'"
        assert op.parameters.expr('topHeight_offset') == '-0.3 in'
        assert op.parameters.expr('maximumStepdown') == '0.01 in'
        assert op.parameters.expr('rampType') == "'plunge'"
        assert op.parameters.expr('boundaryMode') == "'selection'"
        assert op.parameters.expr('boundaryContainment') == "'inside'"


def test_each_op_gets_its_own_tool_diameter_from_the_declared_data(hc, eng):
    setup = _ChainSetup('B-spline Back')
    _run(hc, setup, _hole_mm(eng, _l4()))
    a, b = list(setup.operations)
    assert a.tool['geometry']['DC'] == 0.1875 and a.tool['geometry']['SFDM'] == 0.1875
    assert b.tool['geometry']['DC'] == 0.125
    assert a.tool['type'] == 'flat end mill'


def test_the_boundary_is_every_whole_circle_twenty_of_twenty(hc, eng):
    sk = _l4(20)
    setup = _ChainSetup('B-spline Back')
    _run(hc, setup, _hole_mm(eng, sk))
    for op in setup.operations:
        cs = op.parameters.itemByName('machiningBoundarySel').value.applied
        assert cs.count == 20
        assert sorted(c.entityToken for s in cs._i for c in s.inputGeometry) == sorted(c.entityToken for c in sk.circles)
        assert all(len(s.inputGeometry) == 1 for s in cs._i)


def test_the_sketch_must_end_constrained_and_the_one_with_the_most_circles_wins_the_others_are_named(hc, eng):
    log = _Log()
    big = _Sketch('Source - L4 - ballnose (0.12") [constrained]', circles=20)
    small = _Sketch('Source - L1 - vbit (0.08") [constrained]', circles=3)
    plain = _Sketch('Source - L4 - ballnose (0.12")', circles=30)        # more circles, but not the constrained one
    setup = _ChainSetup('B-spline Back')
    _run(hc, setup, _hole_mm(eng, small, plain, big), log=log)
    cs = setup.operations[0].parameters.itemByName('machiningBoundarySel').value.applied
    assert cs.count == 20
    assert log.has('INFO', 'L1 - vbit') and not log.has('INFO', 'ballnose (0.12") (30)')


def test_no_matching_sketch_builds_nothing_and_warns(hc, eng):
    log = _Log()
    setup = _ChainSetup('B-spline Back')
    out = _run(hc, setup, _hole_mm(eng, _Sketch('Source - L4 - ballnose (0.12")', circles=20),
                                  _Sketch('Source - Lattice Boundary [constrained]', circles=0, lines=8)), log=log)
    assert setup.operations.count == 0 and out['created'] == []
    assert log.has('WARNING', 'no sketch ending')


def test_a_second_apply_adds_nothing_and_leaves_a_valid_boundary_untouched(hc, eng):
    setup, design, mm = _ChainSetup('B-spline Back'), _Design(), _hole_mm(eng, _l4())
    _run(hc, setup, mm, design)
    applies = [op.parameters.itemByName('machiningBoundarySel').value.applies for op in setup.operations]
    out = _run(hc, setup, mm, design)
    assert setup.operations.count == 2 and out['created'] == [] and out['rebound'] == []
    assert [op.parameters.itemByName('machiningBoundarySel').value.applies for op in setup.operations] == applies


def test_a_boundary_whose_holes_moved_after_a_send_is_rebound_on_the_existing_ops_without_new_ones(hc, eng):
    setup, design = _ChainSetup('B-spline Back'), _Design()
    _run(hc, setup, _hole_mm(eng, _l4()), design)
    moved = _Sketch('Source - L4 - ballnose (0.12") [constrained]', circles=20, shift=1.0)   # a Send moved every hole
    out = _run(hc, setup, _hole_mm(eng, moved), design)
    assert setup.operations.count == 2 and out['created'] == []
    assert sorted(out['rebound']) == ['Holes A 3-16 rough', 'Holes B 1-8 rest']
    for op in setup.operations:
        cs = op.parameters.itemByName('machiningBoundarySel').value.applied
        assert sorted(c.entityToken for s in cs._i for c in s.inputGeometry) == sorted(c.entityToken for c in moved.circles)


def test_the_same_holes_as_new_objects_are_not_rebound_so_a_generated_toolpath_stays_valid(hc, eng):
    setup, design = _ChainSetup('B-spline Back'), _Design()
    _run(hc, setup, _hole_mm(eng, _l4()), design)
    out = _run(hc, setup, _hole_mm(eng, _l4()), design)         # new circle objects (new tokens), same geometry
    assert out['rebound'] == [] and out['created'] == []
    assert all(op.parameters.itemByName('machiningBoundarySel').value.applies == 1 for op in setup.operations)


def test_an_unreadable_boundary_is_rebound(hc, eng):
    setup, design, mm = _ChainSetup('B-spline Back'), _Design(), _hole_mm(eng, _l4())
    _run(hc, setup, mm, design)
    first = setup.operations[0].parameters.itemByName('machiningBoundarySel').value
    real, calls = first.getCurveSelections, []

    def dead_once():
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError('dead reference')       # the read that decides "stale"; the re-bind then reads again
        return real()
    first.getCurveSelections = dead_once
    out = _run(hc, setup, mm, design)
    assert out['rebound'] == ['Holes A 3-16 rough']


def test_the_ledger_records_the_chain_and_a_hand_added_pocket_is_left_alone_and_named(hc, eng):
    log = _Log()
    fred = _ChainOp(name='3D Offset Roughing6', strategy='pocket_clearing')
    fred.parameters.itemByName('verticalStockToLeave').expression = '-0.6 in'
    setup, design = _ChainSetup('B-spline Back', ops=[fred]), _Design()
    _run(hc, setup, _hole_mm(eng, _l4()), design, log)
    mine = [o for o in setup.operations if o is not fred]
    assert [o.name for o in mine] == ['Holes A 3-16 rough', 'Holes B 1-8 rest']
    led = eng.sb.op_ledger
    assert led.ours_tokens(design, 'B-spline Back') == {o.entityToken for o in mine}
    assert fred.entityToken not in led.ours_tokens(design, 'B-spline Back')
    assert fred.parameters.expr('verticalStockToLeave') == '-0.6 in'          # untouched
    assert fred.parameters.itemByName('machiningBoundarySel').value.applies == 0
    assert log.has('INFO', '3D Offset Roughing6') and log.has('INFO', 'second time')


def test_rest_machining_never_uses_the_bodies_source(hc):
    chain = hc.HOLE_CHAINS['node_holes']
    for op in chain['ops']:
        assert op['rest_source'] != 'bodies'
        assert op_value(hc, chain, op, 'restMaterialSource') != "'bodies'"
    with pytest.raises(ValueError):
        hc.op_expressions(chain, {'name': 'x', 'dia_in': 0.1875, 'rest_source': 'bodies'})


def op_value(hc, chain, op, name):
    return hc.op_expressions(chain, op).get(name)


def test_apply_stamps_the_chain_only_in_b_spline_back_and_a_second_apply_adds_none(hc, eng, monkeypatch):
    design = _Design()
    names = {r: eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES}
    mms = [_hole_mm(eng, _l4()) if r == 'bspline_set' else _MM(names[r], bodies=[f'{r}-body']) for r in eng.mm.MM_RULES]
    setups = [_ChainSetup(s['name']) for s in eng.sb.SETUP_SPECS]
    cam = _Cam(mms, setups)
    cam.parentDocument = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: design))
    for spec in eng.sb.SETUP_SPECS:
        monkeypatch.setitem(spec, 'cloud_templates', [])
    eng.sb.apply_templates_to_existing_setups(cam)
    by = {s.name: s for s in setups}
    assert [o.name for o in by['B-spline Back'].operations] == ['Holes A 3-16 rough', 'Holes B 1-8 rest']
    assert all(by[n].operations.count == 0 for n in ('Stock', 'B-spline Top', 'Frame'))
    eng.sb.apply_templates_to_existing_setups(cam)
    assert by['B-spline Back'].operations.count == 2


def test_the_other_setup_specs_and_the_back_templates_are_unchanged(eng):
    """Pin (no MIGRATIONS needed: the chain is an addition): Stock / Top / Frame and Back's own keys read as before."""
    specs = {s['name']: s for s in eng.sb.SETUP_SPECS}
    back = {k: v for k, v in specs['B-spline Back'].items() if k != 'hole_chain'}
    assert specs['B-spline Back']['hole_chain'] == 'node_holes'
    assert all('hole_chain' not in specs[n] for n in ('Stock', 'B-spline Top', 'Frame'))
    blob = json.dumps([specs['Stock'], back, specs['B-spline Top'], specs['Frame']], sort_keys=True)
    assert hashlib.sha256(blob.encode()).hexdigest() == PIN


# Re-pinned 2026-10-21 for ONE declared change: 'wcs_point' ('back' / 'flipped') left Back and Top (the origin is Fusion's stock box
# point 'top 1', no helper sketch). Verified: re-adding just those two keys reproduces the old hash e3ab1e09aa39...
# Re-pinned 2026-10-21 (seatD-legacy) for ONE declared change: every setup spec gained 'role' and 'aliases' (bind_roles).
PIN = '5bdd3935cf9f5a0dcbcc176647c2c84a720c74d9e4c085fdf242a984cbb90ca9'

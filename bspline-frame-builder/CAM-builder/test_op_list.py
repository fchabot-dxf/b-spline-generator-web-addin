"""The Toolpaths list (Fred, 2026-10-20): each operation's state read from Fusion, and a generation queue that runs ONE op
at a time, never parallel, with a real Stop.

Fakes follow the shapes measured live on a copy of Fred's file: an op has hasToolpath / isToolpathValid / hasError / error /
hasWarning / warning / isSuppressed, ``generatingProgress`` reads '58.5%', ``parameters.itemByName('tool_diameter').value.value``
is in cm, ``cam.generateToolpath(op)`` returns a future with ``isGenerationCompleted``, and ``cam.clearToolpath(op)`` on an op
being generated cancels it.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_op_list.py
"""
import importlib
import json
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng, _Coll, _Attrs  # noqa: E402,F401


@pytest.fixture
def m(eng):
    return types.SimpleNamespace(st=importlib.import_module('cam_engine.op_states'),
                                 q=importlib.import_module('cam_engine.op_queue'),
                                 led=importlib.import_module('cam_engine.op_ledger'))


_N = [0]


class _P:
    def __init__(self, expression='', value=None):
        self.expression = expression
        self.value = types.SimpleNamespace(value=value)


class _Boundary:
    """parameters.itemByName('machiningBoundarySel'): value.getCurveSelections() -> selections whose inputGeometry are
    the picked curves (objectType 'adsk::fusion::SketchCircle' / 'SketchLine')."""
    def __init__(self, kind):
        geo = {'circles': ['adsk::fusion::SketchCircle'], 'lines': ['adsk::fusion::SketchLine'], 'none': []}.get(kind, [])
        sel = [types.SimpleNamespace(inputGeometry=[types.SimpleNamespace(objectType=t) for t in geo])] if geo else []
        self.value = types.SimpleNamespace(getCurveSelections=lambda: types.SimpleNamespace(
            count=len(sel), item=lambda i: sel[i]))


class _Op:
    def __init__(self, name, state='valid', strategy='pocket_clearing', dia_in=0.1875, kind='flat end mill', rest=False,
                 boundary='circles'):
        _N[0] += 1
        self.name = name
        self.entityToken = f'tok-{_N[0]}'
        self.strategy = strategy
        self.isSuppressed = state == 'suppressed'
        self.hasError = state == 'error'
        self.error = 'Out of memory.\nmore' if state == 'error' else ''
        self.hasWarning = state == 'warn'
        self.warning = 'Tool is too short.' if state == 'warn' else ''
        self.hasToolpath = state in ('valid', 'stale', 'warn')
        self.isToolpathValid = state in ('valid', 'warn')
        self.generatingProgress = '0.0%'
        self.parameters = types.SimpleNamespace(itemByName=lambda n, d=dia_in, k=kind, r=rest, b=boundary: {
            'tool_diameter': _P(value=d * 2.54), 'tool_type': _P(expression=f"'{k}'"),
            'useRestMachining': _P(expression='true' if r else 'false'),
            'machiningBoundarySel': _Boundary(b)}.get(n))


class _Ops(_Coll):
    pass


class _Setup:
    def __init__(self, name, ops=()):
        self.name = name
        self.operations = _Ops(ops)


class _Future:
    def __init__(self):
        self.isGenerationCompleted = False


class _Cam:
    def __init__(self, setups):
        self.setups = _Coll(setups)
        self.generated = []
        self.cleared = []
        self.futures = {}

    def generateToolpath(self, op):
        f = _Future()
        self.futures[op.entityToken] = f
        self.generated.append(op.name)
        return f

    def clearToolpath(self, op):
        self.cleared.append(op.name)
        self.futures[op.entityToken].isGenerationCompleted = True
        op.hasToolpath = False
        return True

    def finish(self, op, valid=True):
        op.hasToolpath = True
        op.isToolpathValid = valid
        self.futures[op.entityToken].isGenerationCompleted = True


class _Design:
    def __init__(self):
        self.attributes = _Attrs()


class _Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _world(*groups):
    return _Cam([_Setup(n, ops) for n, ops in groups])


# ---- the state of one operation -----------------------------------------------------------------------------------

@pytest.mark.parametrize('state,expect', [
    ('valid', ('valid', '')), ('stale', ('stale', '')), ('none', ('none', '')), ('suppressed', ('suppressed', '')),
    ('error', ('error', 'Out of memory.')), ('warn', ('warn', 'Tool is too short.'))])
def test_each_state_reads_from_the_flags_fusion_gives(m, state, expect):
    assert m.st.op_state(_Op('x', state)) == expect


def test_suppressed_beats_an_error_and_an_error_beats_a_missing_toolpath(m):
    op = _Op('x', 'error')
    op.isSuppressed = True
    assert m.st.op_state(op)[0] == 'suppressed'
    op.isSuppressed = False
    assert m.st.op_state(op)[0] == 'error'          # error with no toolpath is an error, not 'not generated'


def test_an_edit_in_fusion_flips_a_generated_op_to_out_of_date(m):
    op = _Op('x', 'valid')
    assert m.st.op_state(op)[0] == 'valid'
    op.isToolpathValid = False                      # Fusion invalidates it when the tool or a setting is edited
    assert m.st.op_state(op)[0] == 'stale'


def test_the_tool_reads_as_a_fraction_and_a_short_type(m):
    assert m.st.tool_label(_Op('a', dia_in=0.1875)) == '3/16 flat'
    assert m.st.tool_label(_Op('b', dia_in=0.125, kind='ball end mill')) == '1/8 ball'
    assert m.st.tool_label(_Op('c', dia_in=0.5)) == '1/2 flat'
    assert m.st.diameter_label(0.1234) == '0.123 in'


# ---- the list -----------------------------------------------------------------------------------------------------

def test_the_list_is_grouped_by_setup_in_order_with_hand_added_ops_tagged_from_the_ledger(m):
    design = _Design()
    a, b = _Op('Holes A 3-16 rough', 'none'), _Op('Holes B 1-8 rest', 'none', rest=True)
    fred = _Op('3D Offset Roughing6', 'valid')
    cam = _world(('Stock', []), ('B-spline Back', [fred, a, b]))
    m.led.record(design, 'B-spline Back', 'hole-chain:node_holes', [a, b])
    snap = m.st.snapshot(cam, design)
    assert [s['name'] for s in snap] == ['Stock', 'B-spline Back']
    rows = {r['name']: r for r in snap[1]['ops']}
    assert list(rows) == ['3D Offset Roughing6', 'Holes A 3-16 rough', 'Holes B 1-8 rest']
    assert rows['3D Offset Roughing6']['src'] == 'hand' and rows['Holes A 3-16 rough']['src'] == 'addin'
    assert rows['Holes B 1-8 rest']['rest'] is True and rows['Holes A 3-16 rough']['rest'] is False
    assert rows['Holes A 3-16 rough']['key'] == a.entityToken and rows['Holes A 3-16 rough']['tool'] == '3/16 flat'


def test_a_hand_added_pocket_beside_the_hole_chain_is_flagged_as_cutting_the_holes_twice(m):
    design = _Design()
    a = _Op('Holes A 3-16 rough', 'none')
    fred = _Op('3D Offset Roughing6', 'valid')
    slot = _Op('Slot1', 'valid', strategy='slot')
    back = _Op('Pocket back1', 'valid', boundary='lines')            # a pocket, but not on picked circles
    cam = _world(('B-spline Back', [slot, back, fred, a]))
    m.led.record(design, 'B-spline Back', 'hole-chain:node_holes', [a])
    rows = {r['name']: r for r in m.st.snapshot(cam, design)[0]['ops']}
    assert rows['3D Offset Roughing6']['dup'] is True
    assert rows['Slot1']['dup'] is False and rows['Pocket back1']['dup'] is False and rows['Holes A 3-16 rough']['dup'] is False
    fred.isSuppressed = True                        # suppressed in the file: nothing to warn about
    rows = {r['name']: r for r in m.st.snapshot(cam, design)[0]['ops']}
    assert rows['3D Offset Roughing6']['dup'] is False


def test_missing_means_not_valid_and_not_suppressed_in_setup_and_op_order(m):
    cam = _world(('Back', [_Op('a', 'valid'), _Op('b', 'stale'), _Op('c', 'suppressed'), _Op('d', 'warn')]),
                 ('Top', [_Op('e', 'none'), _Op('f', 'error')]))
    names = lambda ts: [m.st.find_op(cam, s, k).name for s, k in ts]            # noqa: E731
    assert names(m.st.missing_targets(cam)) == ['b', 'e', 'f']
    assert names(m.st.missing_targets(cam, 'Back')) == ['b']


# ---- the queue ----------------------------------------------------------------------------------------------------

def test_a_request_makes_no_fusion_call_the_tick_does_and_only_one_op_runs_at_a_time(m):
    a, b = _Op('a', 'none'), _Op('b', 'none')
    cam, q = _world(('Back', [a, b])), m.q.GenerationQueue(clock=_Clock())
    assert q.request_ops([('Back', a.entityToken), ('Back', b.entityToken)]) is True
    assert cam.generated == []                                  # the HTML handler must not touch Fusion
    assert q.tick(cam) == [('started', a.entityToken)] and cam.generated == ['a']
    assert q.tick(cam) == [] and cam.generated == ['a']         # a still running: b is NOT started
    cam.finish(a)
    ev = q.tick(cam)
    assert ev[0][0] == 'finished' and ev[1] == ('started', b.entityToken) and cam.generated == ['a', 'b']


def test_a_second_request_while_a_run_is_active_is_refused(m):
    a = _Op('a', 'none')
    cam, q = _world(('Back', [a])), m.q.GenerationQueue(clock=_Clock())
    assert q.request_missing() is True
    assert q.request_missing() is False and q.request_ops([('Back', a.entityToken)]) is False


def test_generate_all_missing_expands_at_the_tick_skips_suppressed_and_valid_and_ends_idle(m):
    ops = [_Op('ok', 'valid'), _Op('sup', 'suppressed'), _Op('todo', 'none')]
    cam, q = _world(('Back', ops)), m.q.GenerationQueue(clock=_Clock())
    q.request_missing('Back')
    assert q.tick(cam) == [('started', ops[2].entityToken)] and cam.generated == ['todo']
    cam.finish(ops[2])
    ev = q.tick(cam)
    assert ev[-1] == ('idle',) and q.active is False and q.snapshot()['message'] == 'Done.'


def test_nothing_to_generate_says_so(m):
    cam, q = _world(('Back', [_Op('ok', 'valid')])), m.q.GenerationQueue(clock=_Clock())
    q.request_missing()
    assert q.tick(cam) == [('idle',)] and q.snapshot()['message'] == 'Nothing to generate.'


def test_the_running_row_reports_elapsed_time_and_percent_and_the_finish_keeps_the_duration(m):
    a = _Op('a', 'none')
    clock = _Clock()
    cam, q = _world(('Back', [a])), m.q.GenerationQueue(clock=clock)
    q.request_ops([('Back', a.entityToken)])
    q.tick(cam)
    clock.t += 102.0
    a.generatingProgress = '58.5%'
    snap = q.snapshot()
    assert snap['on'] and snap['name'] == 'a' and snap['elapsed'] == 102.0 and snap['percent'] == 58.5
    cam.finish(a)
    assert q.tick(cam)[0] == ('finished', a.entityToken, 102.0, 'valid')
    assert q.snapshot()['durations'] == {a.entityToken: 102.0}


def test_stop_cancels_the_running_op_with_clearToolpath_and_drops_the_queue(m):
    a, b = _Op('a', 'none'), _Op('b', 'none')
    cam, q = _world(('Back', [a, b])), m.q.GenerationQueue(clock=_Clock())
    q.request_ops([('Back', a.entityToken), ('Back', b.entityToken)])
    q.tick(cam)
    q.stop()
    assert cam.cleared == []                                    # stop is only recorded until the tick (main loop)
    ev = q.tick(cam)
    assert cam.cleared == ['a'] and ev == [('stopped', a.entityToken), ('idle',)]
    assert cam.generated == ['a'] and q.active is False         # b never started
    assert q.snapshot()['message'] == 'Stopped.'


def test_a_future_that_never_completes_is_cancelled_and_the_queue_stops_there(m):
    a, b = _Op('a', 'none'), _Op('b', 'none')
    clock = _Clock()
    cam, q = _world(('Back', [a, b])), m.q.GenerationQueue(clock=clock, timeout_s=60.0)
    q.request_ops([('Back', a.entityToken), ('Back', b.entityToken)])
    q.tick(cam)
    clock.t += 61.0
    ev = q.tick(cam)
    assert ('timeout', a.entityToken) in ev and cam.cleared == ['a']
    assert cam.generated == ['a'] and q.snapshot()['failed'] == {a.entityToken: 'Fusion did not finish'}
    assert q.tick(cam)[-1] == ('idle',) and cam.generated == ['a']        # b is not started after a hang


def test_an_op_the_first_generation_left_empty_without_an_error_is_queued_once_more(m):
    a = _Op('a', 'none')
    cam, q = _world(('Back', [a])), m.q.GenerationQueue(clock=_Clock())
    q.request_missing()
    q.tick(cam)
    cam.futures[a.entityToken].isGenerationCompleted = True        # done, but still no toolpath and no error (item 95)
    ev = q.tick(cam)
    assert ev[0][0] == 'finished' and ev[1] == ('started', a.entityToken) and cam.generated == ['a', 'a']
    cam.futures[a.entityToken].isGenerationCompleted = True
    ev = q.tick(cam)
    assert ev[-1] == ('idle',) and cam.generated == ['a', 'a']      # only ONE retry pass


def test_an_op_that_ends_in_an_error_is_not_retried(m):
    a = _Op('a', 'none')
    cam, q = _world(('Back', [a])), m.q.GenerationQueue(clock=_Clock())
    q.request_missing()
    q.tick(cam)
    a.hasError, a.error = True, 'Out of memory.'
    cam.futures[a.entityToken].isGenerationCompleted = True
    ev = q.tick(cam)
    assert ev[0] == ('finished', a.entityToken, 0.0, 'error') and ev[-1] == ('idle',) and cam.generated == ['a']


def test_a_suppressed_or_deleted_op_in_a_request_is_skipped(m):
    a, s = _Op('a', 'none'), _Op('s', 'suppressed')
    cam, q = _world(('Back', [s, a])), m.q.GenerationQueue(clock=_Clock())
    q.request_ops([('Back', s.entityToken), ('Back', 'gone'), ('Back', a.entityToken)])
    assert q.tick(cam) == [('started', a.entityToken)] and cam.generated == ['a']


def test_the_names_the_addin_stamps_are_the_templates_and_the_hole_chain_ops(m, eng):
    names = m.st.addin_op_names()
    assert {'Pocket back', 'Morphed Spiral', 'Holes A 3-16 rough', 'Holes B 1-8 rest'} <= names
    assert '3D Offset Roughing6' not in names
    design = _Design()
    cam = _world(('B-spline Back', [_Op('Pocket back1'), _Op('Pocket back'), _Op('Holes A 3-16 rough', 'none')]))
    rows = {r['name']: r['src'] for r in m.st.snapshot(cam, design, names)[0]['ops']}      # no ledger record: by name
    assert rows == {'Pocket back1': 'hand', 'Pocket back': 'addin', 'Holes A 3-16 rough': 'addin'}


def test_operations_inside_folders_are_listed_and_found_too(m):
    """Fred's slots live in a folder: setup.operations holds only the top level, setup.allOperations every operation."""
    inside, top = _Op('Slot1', 'none', strategy='slot'), _Op('Pocket back', 'none')
    setup = _Setup('Back', [top])
    setup.allOperations = [top, inside]
    cam = _Cam([setup])
    rows = m.st.snapshot(cam, _Design())[0]['ops']
    assert [r['name'] for r in rows] == ['Pocket back', 'Slot1']
    assert m.st.find_op(cam, 'Back', inside.entityToken) is not None
    assert [k for _, k in m.st.missing_targets(cam)] == [top.entityToken, inside.entityToken]


def test_a_hand_added_op_inside_a_folder_is_tagged_hand_added_not_the_addins(m):
    design = _Design()
    ours, inside = _Op('Holes A 3-16 rough', 'none'), _Op('Slot1', 'none', strategy='slot')
    setup = _Setup('Back', [ours])
    setup.allOperations = [ours, inside]
    cam = _Cam([setup])
    m.led.record(design, 'Back', 'hole-chain:node_holes', [ours])
    rows = {r['name']: r['src'] for r in m.st.snapshot(cam, design)[0]['ops']}
    assert rows == {'Holes A 3-16 rough': 'addin', 'Slot1': 'hand'}


def test_the_next_op_waits_until_fusion_stops_calling_the_finished_one_generating(m):
    a, b = _Op('a', 'none'), _Op('b', 'none')
    cam, q = _world(('Back', [a, b])), m.q.GenerationQueue(clock=_Clock())
    a.isGenerating = True
    q.request_ops([('Back', a.entityToken), ('Back', b.entityToken)])
    q.tick(cam)
    cam.finish(a)                                   # the future completed, the flag has not dropped yet (measured)
    assert q.tick(cam) == [] and cam.generated == ['a']
    a.isGenerating = False
    ev = q.tick(cam)
    assert ev[0][0] == 'finished' and ev[1] == ('started', b.entityToken) and cam.generated == ['a', 'b']

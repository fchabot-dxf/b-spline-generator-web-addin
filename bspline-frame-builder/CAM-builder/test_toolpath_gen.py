"""
H23 item 95: the doc's first toolpath generation after BUILD left 3-4 of 7 ops without a toolpath (live, two boards,
main as deployed). cam_engine/toolpath_gen.generate_setups: pass 1 setup by setup (as before); later passes op by
op, in order, every op with no valid toolpath when reached, up to MAX_GENERATION_PASSES.
The fake CAM behaves like the live runs: an op's FIRST generation comes back empty; an op generated while its
upstream (the op before it in the setup) was not valid at the START of the call comes back empty when it is
a REgeneration (a first generation does not need it: the Frame's chain); generating
anything stales the ops of later setups that read the previous setup's stock.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_toolpath_gen.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from cam_engine import toolpath_gen as tg  # noqa: E402  (pure: no adsk import)


class _List(list):
    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


class _Op:
    def __init__(self, name, fails_first=False):
        self.name, self.fails_first = name, fails_first
        self.hasToolpath = self.isToolpathValid = False
        self.generations = 0
        self.never = False


class _Setup:
    def __init__(self, name, ops, reads_previous_stock=False):
        self.name, self.operations, self.reads_previous_stock = name, _List(ops), reads_previous_stock
        for op in ops:
            op.parentSetup = self


class _Future:
    isGenerationCompleted = True


class _Cam:
    def __init__(self, setups):
        self.setups = _List(setups)
        self.calls = []

    def _gen_op(self, op, upstream_ok):
        op.generations += 1
        # measured: a first generation does not need its upstream ready (Frame's chain, pass 1); a REgeneration
        # started while its upstream was empty failed again (Back's Morphed Spiral, setup regenerated in pass 2)
        ok = not op.never and not (op.fails_first and op.generations == 1) and (op.generations == 1 or upstream_ok)
        op.hasToolpath = op.hasToolpath or ok
        op.isToolpathValid = ok

    def _stale_after(self, setup):
        idx = list(self.setups).index(setup)
        for later in list(self.setups)[idx + 1:]:
            if later.reads_previous_stock:
                for op in later.operations:
                    op.isToolpathValid = False

    def generateToolpath(self, target):
        if isinstance(target, _Setup):
            self.calls.append(target.name)
            at_start = [o.hasToolpath and o.isToolpathValid for o in target.operations]
            for k, op in enumerate(target.operations):
                self._gen_op(op, upstream_ok=(k == 0 or at_start[k - 1]))
            self._stale_after(target)
        else:
            setup = target.parentSetup
            self.calls.append(f"{setup.name}/{target.name}")
            k = list(setup.operations).index(target)
            prev = setup.operations[k - 1] if k else None
            self._gen_op(target, upstream_ok=(prev is None or (prev.hasToolpath and prev.isToolpathValid)))
            self._stale_after(setup)
        return _Future()


def _board(back_fail=(), top_fail=()):
    back = _Setup('B-spline Back', [_Op('Pocket back1', 'Pocket back1' in back_fail),
                                    _Op('Morphed Spiral1', 'Morphed Spiral1' in back_fail)])
    top = _Setup('B-spline Top', [_Op('Pocket front FRED', 'Pocket front FRED' in top_fail),
                                  _Op('Morphed Spiral1', 'Morphed Spiral1' in top_fail),
                                  _Op('Pocket front deloge FRED1')], reads_previous_stock=True)
    frame = _Setup('Frame', [_Op('cadre Pocket 4'), _Op('cadre Morphed Spiral 31')])
    return _Cam([_Setup('Stock', []), back, top, frame])


def _run(cam, **kw):
    lines = []
    out = tg.generate_setups(cam, wait=lambda f, t: True, log=lambda m, level='INFO': lines.append(m), **kw)
    return out, lines


def _all_valid(cam):
    return all(not tg.missing_ops(cam.setups.item(i)) for i in range(cam.setups.count))


def test_the_live_first_pass_failure_ends_with_every_toolpath_valid():
    # the cam-bricks runs: Back's 2 ops and Top's first 2 come back empty from the doc's first generation
    cam = _board(back_fail=('Pocket back1', 'Morphed Spiral1'), top_fail=('Pocket front FRED', 'Morphed Spiral1'))
    _run(cam)
    assert _all_valid(cam)


def test_a_whole_setup_regeneration_alone_would_leave_the_chained_op_empty():
    # the live ok=6 missing=1: regenerating Back as a SETUP brought its Pocket back but not the Morphed Spiral
    # started while the Pocket was empty -- the reason later passes go op by op
    cam = _board(back_fail=('Pocket back1', 'Morphed Spiral1'))
    cam.generateToolpath(cam.setups.item(1))
    cam.generateToolpath(cam.setups.item(1))
    assert tg.missing_ops(cam.setups.item(1)) == ['Morphed Spiral1']


def test_later_passes_go_op_by_op_in_order_and_redo_what_went_stale():
    cam = _board(back_fail=('Morphed Spiral1',))
    _run(cam)
    # pass 1: the setups; pass 2: Back's empty op, then Top's ops (stale: they read Back's stock), in order
    assert cam.calls == ['B-spline Back', 'B-spline Top', 'Frame', 'B-spline Back/Morphed Spiral1',
                         'B-spline Top/Pocket front FRED', 'B-spline Top/Morphed Spiral1',
                         'B-spline Top/Pocket front deloge FRED1']
    assert _all_valid(cam)


def test_a_complete_first_pass_generates_each_setup_once():
    cam = _board()
    out, lines = _run(cam)
    assert cam.calls == ['B-spline Back', 'B-spline Top', 'Frame']
    assert not any('pass 2' in m for m in lines)


def test_passes_are_bounded_by_the_declaration():
    cam = _board()
    cam.setups.item(2).operations.item(1).never = True   # Top's Morphed Spiral1 never gets a toolpath
    _run(cam)
    assert cam.calls.count('B-spline Top/Morphed Spiral1') == tg.MAX_GENERATION_PASSES - 1


def test_the_declaration_keeps_a_spare_pass_beyond_the_measured_three():
    # item 96 run 3 needed pass 3 (both Morphed Spirals came back empty again in pass 2); keep one spare
    assert tg.MAX_GENERATION_PASSES >= 4


# H23 item 98: an op left without a toolpath says WHY in the TPGen audit. Seat A, 2026-10-06: after a long session
# (Fusion at 65 GB private bytes) the empty ops' own op.error read 'Out of memory.' while the audit only logged
# 'MISSING toolpath', so hours went into a timing hypothesis.

class _ErrOp:
    def __init__(self, error='', warning=''):
        self.error, self.warning = error, warning


class _RaisingOp:
    @property
    def error(self):
        raise RuntimeError('not available')

    warning = ''


def test_why_empty_reports_fusions_own_error_first_line():
    assert tg.why_empty(_ErrOp(error='Out of memory.\n\n')) == 'error: Out of memory.'


def test_why_empty_reports_the_warning_too_and_nothing_when_fusion_says_nothing():
    assert tg.why_empty(_ErrOp(error='Out of memory.', warning='Stock is empty.\nmore')) == \
        'error: Out of memory.; warning: Stock is empty.'
    assert tg.why_empty(_ErrOp()) == ''


def test_why_empty_never_raises():
    assert tg.why_empty(_RaisingOp()) == ''


def test_the_tpgen_audit_logs_the_reason_for_each_missing_op():
    src = open(os.path.join(_HERE, 'cam-builder.py'), encoding='utf-8').read()
    audit = src[src.index('MISSING toolpath') - 400: src.index('MISSING toolpath') + 200]
    assert 'why_empty(' in audit


def test_each_later_pass_is_announced_as_it_starts_and_a_clean_first_pass_announces_none():
    # Fred (2026-10-07): the loading card lists each later pass as it starts (on_pass -> cam-builder.py)
    seen = []
    cam = _board(back_fail=('Morphed Spiral1',))
    _run(cam, on_pass=seen.append)
    assert seen == [2]
    seen.clear()
    _run(_board(), on_pass=seen.append)
    assert seen == []
    cam = _board()
    cam.setups.item(2).operations.item(1).never = True
    _run(cam, on_pass=seen.append)
    assert seen == list(range(2, tg.MAX_GENERATION_PASSES + 1))


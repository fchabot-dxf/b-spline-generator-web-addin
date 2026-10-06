"""
H23 item 95: the doc's first toolpath generation after BUILD left 3-4 of 7 ops without a toolpath (live, two boards,
main as deployed); every second generation made them. cam_engine/toolpath_gen.generate_setups generates each setup
once, then again any setup still holding an op without a valid toolpath, in setup order (checked when reached, so
a setup made stale by an earlier regeneration is redone and a complete one is not), up to MAX_GENERATION_PASSES.
Driven with fakes that behave like the live run: an op's FIRST generation fails, and generating a setup again
leaves every later setup that reads its stock out of date.

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


class _Ops(list):
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


class _Setup:
    def __init__(self, name, ops, reads_previous_stock=False):
        self.name, self.operations, self.reads_previous_stock = name, _Ops(ops), reads_previous_stock


class _Future:
    isGenerationCompleted = True


class _Cam:
    """generateToolpath(setup): each op generates (a failing-first op stays empty on its first generation), and every
    LATER setup that reads the previous setup's stock goes out of date."""

    def __init__(self, setups):
        self.setups = _Ops(setups)
        self.calls = []

    def generateToolpath(self, setup):
        self.calls.append(setup.name)
        for op in setup.operations:
            op.generations += 1
            ok = not (op.fails_first and op.generations == 1)
            op.hasToolpath = op.hasToolpath or ok
            op.isToolpathValid = ok
        idx = list(self.setups).index(setup)
        for later in list(self.setups)[idx + 1:]:
            if later.reads_previous_stock:
                for op in later.operations:
                    op.isToolpathValid = False
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
    # E-run on the cam-bricks board: Back's 2 ops and Top's first 2 empty after the first generation
    cam = _board(back_fail=('Pocket back1', 'Morphed Spiral1'), top_fail=('Pocket front FRED', 'Morphed Spiral1'))
    _run(cam)
    assert _all_valid(cam)


def test_pass_two_regenerates_in_setup_order_and_redoes_a_setup_made_stale():
    cam = _board(back_fail=('Morphed Spiral1',))
    _run(cam)
    # pass 1: Back, Top, Frame (Stock has no ops); pass 2: Back (empty op), then Top (stale: reads Back's stock)
    assert cam.calls == ['B-spline Back', 'B-spline Top', 'Frame', 'B-spline Back', 'B-spline Top']
    assert _all_valid(cam)


def test_a_complete_first_pass_generates_each_setup_once():
    cam = _board()
    out, lines = _run(cam)
    assert cam.calls == ['B-spline Back', 'B-spline Top', 'Frame']
    assert not any('pass 2' in m for m in lines)


def test_passes_are_bounded_by_the_declaration():
    cam = _board()
    never = cam.setups.item(2).operations.item(1)   # Top's Morphed Spiral1: never gets a toolpath
    gen = cam.generateToolpath

    def generate(setup):
        future = gen(setup)
        never.hasToolpath = never.isToolpathValid = False
        return future
    cam.generateToolpath = generate
    _run(cam)
    assert cam.calls.count('B-spline Top') == tg.MAX_GENERATION_PASSES


def test_the_declaration_allows_a_second_pass():
    assert tg.MAX_GENERATION_PASSES >= 2

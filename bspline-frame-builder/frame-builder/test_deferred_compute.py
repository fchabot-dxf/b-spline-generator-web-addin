"""FB1 — regression guard for `deferred_compute` (fb_engine/parametric_engine.py).

Before FB1, `_build_blocks` toggled `sketch.isComputeDeferred` inline with no
try/finally — a step raising while deferred left the sketch permanently
stuck in deferred-compute mode for the rest of the session (silent-wrong-
geometry, A2-3). `deferred_compute` is now a context manager that ALWAYS
resets the flag on exit, including on an exception.
"""

import os
import sys
import types


def _install_adsk_stubs():
    if 'adsk' in sys.modules:
        return
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')
    sys.modules['adsk'] = adsk
    sys.modules['adsk.core'] = adsk.core
    sys.modules['adsk.fusion'] = adsk.fusion


_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_install_adsk_stubs()

from fb_engine.parametric_engine import deferred_compute


class _FakeSketch:
    def __init__(self):
        self.isComputeDeferred = False


def test_flag_is_true_inside_the_block():
    sketch = _FakeSketch()
    with deferred_compute(sketch):
        assert sketch.isComputeDeferred is True


def test_flag_resets_to_false_after_a_normal_exit():
    sketch = _FakeSketch()
    with deferred_compute(sketch):
        pass
    assert sketch.isComputeDeferred is False


def test_flag_resets_to_false_after_an_exception_and_the_exception_propagates():
    sketch = _FakeSketch()
    raised = False
    try:
        with deferred_compute(sketch):
            assert sketch.isComputeDeferred is True
            raise ValueError('boom — mid-block crash')
    except ValueError as e:
        raised = True
        assert str(e) == 'boom — mid-block crash'

    assert raised, 'the exception must propagate out of the context manager'
    assert sketch.isComputeDeferred is False

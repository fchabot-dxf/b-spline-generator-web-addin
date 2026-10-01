"""Cross-checks sketches/template_11/phases/p02_02_loop.py's own Fusion EXPRESSION STRINGS against
fb_engine.t11_geometry.t11_outline's own independently-computed board-coordinate values -- pure
Python, no Fusion needed (Fusion's own expression evaluator is checked separately, live, for the
specific min()/max()-unsupported substitution this file's own point formulas rely on; see
p02_02_loop.py's own module docstring for that live finding).

This is the ONE place that proves the phase file's closed-form algebra (re-derived independently when
porting t11_outline's math into Fusion-expression-string form) actually matches the already-tested
Python geometry, rather than trusting a hand re-derivation on faith.
"""
import math
import os
import sys
import importlib.util

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.t11_geometry import t11_outline  # noqa: E402

_PHASE_PATH = os.path.join(_ROOT, 'sketches', 'template_11', 'phases', 'p02_02_loop.py')


def _load_phase_module():
    spec = importlib.util.spec_from_file_location("p02_02_loop_crosscheck", _PHASE_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BOARDS = [(7, 9, 0.25), (9, 12, 0.25), (8, 10, 0.25), (6, 9, 0.25)]


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_phase_file_points_match_t11_outline(width_in_full, height_in_full, bbo):
    mod = _load_phase_module()
    block = mod.get_block()
    by_id = {item['ID']: item['Points'] for item in block['BuildSequence'] if 'ID' in item}

    env = {'widthIn': width_in_full, 'heightIn': height_in_full, 'boundingboxoffset': bbo,
           'min': min, 'max': max, 'sqrt': math.sqrt, 'abs': abs}

    def ev(expr):
        return eval(expr, {"__builtins__": {}}, env)  # noqa: S307 -- controlled expression strings, test-only

    HW = width_in_full / 2 - bbo
    HH = height_in_full / 2 - bbo
    o = t11_outline(2 * HW, 2 * HH, 0.75)

    def to_fusion(pt):
        return (pt[0] - HW, pt[1] - HH)

    checks = [
        ('peak', 'roof_R', 0, to_fusion(o['peak'])),
        ('E', 'roof_R', 1, to_fusion(o['E'])),
        ('shoulder_horn', 'eave_straight_R', 1, to_fusion(o['shoulder_horn'])),
        ('shoulder_waist_jct', 'arc_shoulder_R', 2, to_fusion(o['shoulder_waist_jct'])),
        ('waist_hip_jct', 'arc_waist_R', 2, to_fusion(o['waist_hip_jct'])),
        ('hip_horn', 'arc_hip_R', 2, to_fusion(o['hip_horn'])),
        ('base', 'side_straight_R', 1, to_fusion(o['base'])),
    ]
    for label, pid, idx, (ex, ey) in checks:
        xe, ye = by_id[pid][idx]
        gx, gy = ev(xe), ev(ye)
        assert gx == pytest.approx(ex, abs=1e-6), f"{width_in_full}x{height_in_full} {label} x"
        assert gy == pytest.approx(ey, abs=1e-6), f"{width_in_full}x{height_in_full} {label} y"

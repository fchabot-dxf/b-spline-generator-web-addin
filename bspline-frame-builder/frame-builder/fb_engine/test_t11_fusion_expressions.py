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


def _loop(width_in_full, height_in_full, bbo):
    """p02_02's declared pieces, every point evaluated: {id: [(x, y), ...]} in centred sketch inches."""
    mod = _load_phase_module()
    env = {'widthIn': width_in_full, 'heightIn': height_in_full, 'boundingboxoffset': bbo,
           'sqrt': math.sqrt, 'abs': abs}
    ev = lambda e: eval(e, {"__builtins__": {}}, env)  # noqa: S307, E731 -- controlled strings, test-only
    seq = mod.get_block()['BuildSequence']
    assert not [s for s in seq if s.get('Type') == 'Radius'], "no seed Radius dimension (p02_02 docstring, item 2)"
    return {s['ID']: [(ev(x), ev(y)) for x, y in s['Points']] for s in seq if 'ID' in s}, [s['ID'] for s in seq if 'ID' in s]


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_every_arc_is_seeded_with_its_true_midpoint(width_in_full, height_in_full, bbo):
    # The seed IS the answer (p02_02 docstring, item 1; measured: Tangent locks, it does not solve).
    pts, _ = _loop(width_in_full, height_in_full, bbo)
    HW, HH = width_in_full / 2 - bbo, height_in_full / 2 - bbo
    o = t11_outline(2 * HW, 2 * HH, 0.75)
    circles = {'arc_shoulder_R': (o['C_shoulder'], o['r_shoulder']), 'arc_waist_R': (o['C_waist'], o['r_waist']),
               'arc_hip_R': (o['C_hip'], o['r_hip'])}
    for arc, (c, r) in circles.items():
        cx, cy = c[0] - HW, c[1] - HH
        for side, sign in (('R', 1), ('L', -1)):
            p0, via, p1 = pts[arc.replace('_R', '_' + side)]
            if side == 'L':  # the left arc is declared backwards (loop direction); mirror its points
                p0, via, p1 = (-p1[0], p1[1]), (-via[0], via[1]), (-p0[0], p0[1])
            assert math.hypot(via[0] - cx, via[1] - cy) == pytest.approx(r, abs=1e-6), f"{arc}{side} via on its circle"
            u0 = ((p0[0] - cx) / r, (p0[1] - cy) / r)
            u1 = ((p1[0] - cx) / r, (p1[1] - cy) / r)
            bis = (u0[0] + u1[0], u0[1] + u1[1]); n = math.hypot(*bis)
            assert n > 1e-6, "a half-turn arc has no minor-arc midpoint"
            assert via[0] - cx == pytest.approx(r * bis[0] / n, abs=1e-6), f"{arc}{side} via at the angular midpoint x"
            assert via[1] - cy == pytest.approx(r * bis[1] / n, abs=1e-6), f"{arc}{side} via at the angular midpoint y"


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_the_loop_closes_exactly_and_the_welds_join_physically_coincident_ends(width_in_full, height_in_full, bbo):
    # No nudges (p02_02 docstring, item 2): every declared end IS the next declared start.
    pts, order = _loop(width_in_full, height_in_full, bbo)
    for a, b in zip(order, order[1:] + order[:1]):
        assert pts[a][-1] == pytest.approx(pts[b][0], abs=1e-9), f"{a} -> {b} meet exactly"

    # Fusion's rule (fusion360-quirks skill, measured): a SketchArc's :S/:E run counter-clockwise, so a
    # clockwise-declared triplet is tagged with :S at its LAST declared point. Resolve each tag to the
    # physical point that rule gives, then every weld in p02_03 must join two coincident points.
    HW, HH = width_in_full / 2 - bbo, height_in_full / 2 - bbo
    phys = {'proj_off_corner_BR': (HW, -HH), 'proj_off_corner_BL': (-HW, -HH)}
    for pid, p in pts.items():
        if len(p) == 3:
            (x0, y0), (x1, y1), (x2, y2) = p
            ccw = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0
            phys[pid + ':S'], phys[pid + ':E'] = (p[0], p[2]) if ccw else (p[2], p[0])
        else:
            phys[pid + ':S'], phys[pid + ':E'] = p[0], p[1]
    welds_path = os.path.join(os.path.dirname(_PHASE_PATH), 'p02_03_welds.py')
    spec = importlib.util.spec_from_file_location("p02_03_welds_crosscheck", welds_path)
    wm = importlib.util.module_from_spec(spec); spec.loader.exec_module(wm)
    welds = [s for s in wm.get_block()['BuildSequence'] if s['Type'] == 'Coincident']
    assert len(welds) == 15
    for w in welds:
        a, b = w['Targets']
        assert phys[a] == pytest.approx(phys[b], abs=1e-9), f"weld {w.get('Name', a + '~' + b)} joins {a}={phys[a]} to {b}={phys[b]}"

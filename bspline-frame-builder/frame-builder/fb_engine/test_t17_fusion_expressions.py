"""Cross-checks sketches/template_17/phases/p02_02_loop.py's own Fusion EXPRESSION STRINGS
(resolved through its own SKETCH_2_PARAMETERS named-parameter chain, template_data.py) against
fb_engine.t16_geometry.outline()'s own independently-computed board-coordinate values -- pure
Python, no Fusion needed. Mirrors test_t16_fusion_expressions.py's own pattern exactly (Template 17
shares Template 16's own lower half verbatim and adds its own upper-arc chain); the one real
difference is the CW/CCW table, since the two upper sides are now ARCS (concave, counter-
clockwise) instead of Template 16's plain lines."""
import math
import os
import sys
import importlib.util

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.t16_geometry import outline, T17_UPPER_CURVE_FRAC_DEFAULT  # noqa: E402

_TPL_DIR = os.path.join(_ROOT, 'sketches', 'template_17')
_PHASE_PATH = os.path.join(_TPL_DIR, 'phases', 'p02_02_loop.py')
_WELDS_PATH = os.path.join(_TPL_DIR, 'phases', 'p02_03_welds.py')


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _sketch_2_parameters():
    spec = importlib.util.spec_from_file_location("t17_template_data_crosscheck",
                                                    os.path.join(_TPL_DIR, 'template_data.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.SKETCH_2_PARAMETERS


BOARDS = [(7, 9, 0.25), (9, 12, 0.25), (6, 9, 0.25)]


def _env(width_in_full, height_in_full, bbo):
    env = {'widthIn': width_in_full, 'heightIn': height_in_full, 'boundingboxoffset': bbo,
           'sqrt': math.sqrt, 'abs': abs}
    ev = lambda e: eval(e, {"__builtins__": {}}, env)  # noqa: S307, E731 -- controlled strings, test-only
    for p in _sketch_2_parameters():
        env[p['Name']] = ev(p['Val']) if isinstance(p['Val'], str) else p['Val']
    return env, ev


def _outline_for(width_in_full, height_in_full, bbo):
    HW = width_in_full / 2 - bbo
    HH = height_in_full / 2 - bbo
    return outline(2 * HW, 2 * HH, 0.75, upper_curve_frac=T17_UPPER_CURVE_FRAC_DEFAULT)


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_phase_file_points_match_t16_outline(width_in_full, height_in_full, bbo):
    mod = _load_module(_PHASE_PATH, "t17_p02_02_loop_crosscheck")
    block = mod.get_block()
    by_id = {item['ID']: item['Points'] for item in block['BuildSequence'] if 'ID' in item}

    env, ev = _env(width_in_full, height_in_full, bbo)
    o = _outline_for(width_in_full, height_in_full, bbo)

    checks = [
        ('topR',    'upper_R', 0, o['top_r']),
        ('waistR',  'upper_R', 2, o['waist_r']),
        ('ur_via',  'upper_R', 1, o['upper_r_via']),
        ('BR',      'base',    0, o['BR']),
        ('BL',      'base',    1, o['BL']),
        ('lr_via',  'lower_R', 1, o['lower_r_via']),
        ('ll_via',  'lower_L', 1, o['lower_l_via']),
        ('ul_via',  'upper_L', 1, o['upper_l_via']),
        ('apex',    'arch',    1, o['apex']),
    ]
    for label, pid, idx, (ex, ey) in checks:
        xe, ye = by_id[pid][idx]
        gx, gy = ev(xe), ev(ye)
        assert gx == pytest.approx(ex, abs=1e-6), f"{width_in_full}x{height_in_full} {label} x"
        assert gy == pytest.approx(ey, abs=1e-6), f"{width_in_full}x{height_in_full} {label} y"


def _loop(width_in_full, height_in_full, bbo):
    mod = _load_module(_PHASE_PATH, "t17_p02_02_loop_crosscheck2")
    env, ev = _env(width_in_full, height_in_full, bbo)
    seq = mod.get_block()['BuildSequence']
    assert not [s for s in seq if s.get('Type') == 'Radius'], "no seed Radius dimension"
    return {s['ID']: [(ev(x), ev(y)) for x, y in s['Points']] for s in seq if 'ID' in s}, [s['ID'] for s in seq if 'ID' in s]


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_every_arc_is_seeded_with_its_true_via_point(width_in_full, height_in_full, bbo):
    pts, _ = _loop(width_in_full, height_in_full, bbo)
    o = _outline_for(width_in_full, height_in_full, bbo)
    arcs = {'arch': (o['arch_centre'], o['arch_radius']),
            'upper_R': (o['upper_r_centre'], o['upper_r_radius']),
            'lower_R': (o['lower_r_centre'], o['lower_r_radius']),
            'lower_L': (o['lower_l_centre'], o['lower_l_radius']),
            'upper_L': (o['upper_l_centre'], o['upper_l_radius'])}
    for arc, (c, r) in arcs.items():
        p0, via, p1 = pts[arc]
        assert math.hypot(via[0] - c[0], via[1] - c[1]) == pytest.approx(r, abs=1e-6), f"{arc} via on its circle"
        for p in (p0, p1):
            assert math.hypot(p[0] - c[0], p[1] - c[1]) == pytest.approx(r, abs=1e-6), f"{arc} endpoint on its circle"
        u0 = ((p0[0] - c[0]) / r, (p0[1] - c[1]) / r)
        u1 = ((p1[0] - c[0]) / r, (p1[1] - c[1]) / r)
        bis = (u0[0] + u1[0], u0[1] + u1[1]); n = math.hypot(*bis)
        assert n > 1e-6, f"{arc}: a half-turn arc has no minor-arc midpoint"
        assert via[0] - c[0] == pytest.approx(r * bis[0] / n, abs=1e-6), f"{arc} via at the angular midpoint x"
        assert via[1] - c[1] == pytest.approx(r * bis[1] / n, abs=1e-6), f"{arc} via at the angular midpoint y"


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_the_loop_closes_exactly_and_the_welds_join_physically_coincident_ends(width_in_full, height_in_full, bbo):
    pts, order = _loop(width_in_full, height_in_full, bbo)
    for a, b in zip(order, order[1:] + order[:1]):
        assert pts[a][-1] == pytest.approx(pts[b][0], abs=1e-9), f"{a} -> {b} meet exactly"

    HW, HH = width_in_full / 2 - bbo, height_in_full / 2 - bbo
    phys = {'proj_off_corner_BR': (HW, -HH), 'proj_off_corner_BL': (-HW, -HH)}
    for pid, p in pts.items():
        if len(p) == 3:
            (x0, y0), (x1, y1), (x2, y2) = p
            ccw = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0
            phys[pid + ':S'], phys[pid + ':E'] = (p[0], p[2]) if ccw else (p[2], p[0])
        else:
            phys[pid + ':S'], phys[pid + ':E'] = p[0], p[1]
    wm = _load_module(_WELDS_PATH, "t17_p02_03_welds_crosscheck")
    welds = [s for s in wm.get_block()['BuildSequence'] if s['Type'] == 'Coincident']
    assert len(welds) == 8
    for w in welds:
        a, b = w['Targets']
        assert phys[a] == pytest.approx(phys[b], abs=1e-9), f"weld {w.get('Name', a + '~' + b)} joins {a}={phys[a]} to {b}={phys[b]}"


def test_convex_arcs_turn_clockwise_and_concave_arcs_turn_counter_clockwise():
    """Non-vacuous check on the CW/CCW-swap claim itself (p02_02_loop.py's own docstring): the 3
    CONVEX arcs (arch, lower_R, lower_L) must turn clockwise in declared order (swapped :S/:E);
    the 2 CONCAVE arcs (upper_R, upper_L, Template 17's own addition over Template 16) must turn
    counter-clockwise (NOT swapped) -- if a future edit ever flipped either, the hardcoded :S/:E
    table in p02_03_welds.py / p03_03 / p03_04 / template_data.py's own FRAME_REGIONS["miters"]
    would silently start joining the wrong ends."""
    pts, _ = _loop(7, 9, 0.25)
    for arc in ('arch', 'lower_R', 'lower_L'):
        (x0, y0), (x1, y1), (x2, y2) = pts[arc]
        turn = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        assert turn < 0, f"{arc} must turn clockwise in declared order (turn={turn})"
    for arc in ('upper_R', 'upper_L'):
        (x0, y0), (x1, y1), (x2, y2) = pts[arc]
        turn = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        assert turn > 0, f"{arc} must turn counter-clockwise in declared order (turn={turn})"

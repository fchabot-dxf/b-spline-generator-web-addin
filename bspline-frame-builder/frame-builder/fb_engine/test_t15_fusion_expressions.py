"""Cross-checks sketches/template_15/phases/p02_02_loop.py's own Fusion EXPRESSION STRINGS
(resolved through its own SKETCH_2_PARAMETERS named-parameter chain, fb_engine/t15_flask_geometry.py)
against fb_engine.t15_flask_geometry.outline()'s own independently-computed board-coordinate
values -- pure Python, no Fusion needed. Mirrors test_t14_fusion_expressions.py's own pattern."""
import math
import os
import sys
import importlib.util

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from fb_engine.t15_flask_geometry import outline, SKETCH_2_PARAMETERS  # noqa: E402

_TPL_DIR = os.path.join(_ROOT, 'sketches', 'template_15')
_PHASE_PATH = os.path.join(_TPL_DIR, 'phases', 'p02_02_loop.py')
_WELDS_PATH = os.path.join(_TPL_DIR, 'phases', 'p02_03_welds.py')


def _load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


BOARDS = [(7, 9, 0.25), (9, 12, 0.25), (6, 9, 0.25)]


def _env(width_in_full, height_in_full, bbo):
    """widthIn/heightIn/boundingboxoffset, plus every named t15_* parameter resolved IN DECLARATION
    ORDER (each one's own expression may reference only prior names, exactly as Fusion itself
    resolves a user-parameter chain)."""
    env = {'widthIn': width_in_full, 'heightIn': height_in_full, 'boundingboxoffset': bbo,
           'sqrt': math.sqrt, 'abs': abs}
    ev = lambda e: eval(e, {"__builtins__": {}}, env)  # noqa: S307, E731 -- controlled strings, test-only
    for p in SKETCH_2_PARAMETERS:
        env[p['Name']] = ev(p['Val']) if isinstance(p['Val'], str) else p['Val']
    return env, ev


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_phase_file_points_match_t15_outline(width_in_full, height_in_full, bbo):
    mod = _load_module(_PHASE_PATH, "p02_02_loop_crosscheck")
    block = mod.get_block()
    by_id = {item['ID']: item['Points'] for item in block['BuildSequence'] if 'ID' in item}

    env, ev = _env(width_in_full, height_in_full, bbo)

    HW = width_in_full / 2 - bbo
    HH = height_in_full / 2 - bbo
    o = outline(2 * HW, 2 * HH, 0.75)

    checks = [
        ('topR',            'neck_R', 0, o['top_r']),
        ('neckBottomR',     'neck_R', 1, o['neck_bottom_r']),
        ('neckBottomR(arc)', 'dome_R', 0, o['neck_bottom_r']),
        ('BR',              'base',   0, o['BR']),
        ('BL',              'base',   1, o['BL']),
        ('BL(arc)',         'dome_L', 0, o['BL']),
        ('neckBottomL',     'dome_L', 2, o['neck_bottom_l']),
        ('neckBottomL(line)', 'neck_L', 0, o['neck_bottom_l']),
        ('topL',            'neck_L', 1, o['top_l']),
        ('topL(top)',       'top',    0, o['top_l']),
        ('topR(top)',       'top',    1, o['top_r']),
        ('dr_via',          'dome_R', 1, o['dome_r_via']),
    ]
    for label, pid, idx, (ex, ey) in checks:
        xe, ye = by_id[pid][idx]
        gx, gy = ev(xe), ev(ye)
        assert gx == pytest.approx(ex, abs=1e-6), f"{width_in_full}x{height_in_full} {label} x"
        assert gy == pytest.approx(ey, abs=1e-6), f"{width_in_full}x{height_in_full} {label} y"

    # dome_L's own via is the EXACT x-mirror of dome_R's (same y) -- confirmed here, not assumed.
    dlx, dly = by_id['dome_L'][1]
    dl_vx, dl_vy = ev(dlx), ev(dly)
    assert dl_vx == pytest.approx(-o['dome_r_via'][0], abs=1e-6), f"{width_in_full}x{height_in_full} dl_via x mirrors dr_via"
    assert dl_vy == pytest.approx(o['dome_r_via'][1], abs=1e-6), f"{width_in_full}x{height_in_full} dl_via y matches dr_via"


def _loop(width_in_full, height_in_full, bbo):
    """p02_02's declared pieces, every point evaluated: {id: [(x, y), ...]} in centred sketch inches."""
    mod = _load_module(_PHASE_PATH, "p02_02_loop_crosscheck2")
    env, ev = _env(width_in_full, height_in_full, bbo)
    seq = mod.get_block()['BuildSequence']
    assert not [s for s in seq if s.get('Type') == 'Radius'], "no seed Radius dimension"
    return {s['ID']: [(ev(x), ev(y)) for x, y in s['Points']] for s in seq if 'ID' in s}, [s['ID'] for s in seq if 'ID' in s]


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_the_dome_is_seeded_with_its_true_via_point(width_in_full, height_in_full, bbo):
    # The seed IS the answer (H23 item 27's own recipe) -- here there is no Tangent step at all
    # (every joint is a miter), but the dome's own via must still be its TRUE angular midpoint, on
    # its own real circle, matching outline()'s own independently-computed centre/radius. dome_L is
    # the mirror, checked via its own negated-centre circle.
    pts, _ = _loop(width_in_full, height_in_full, bbo)
    HW, HH = width_in_full / 2 - bbo, height_in_full / 2 - bbo
    o = outline(2 * HW, 2 * HH, 0.75)
    cR, r = o['dome_r_centre'], o['dome_r_radius']
    arcs = {'dome_R': (cR, r), 'dome_L': ((-cR[0], cR[1]), r)}
    for arc, (c, radius) in arcs.items():
        p0, via, p1 = pts[arc]
        assert math.hypot(via[0] - c[0], via[1] - c[1]) == pytest.approx(radius, abs=1e-6), f"{arc} via on its circle"
        for p in (p0, p1):
            assert math.hypot(p[0] - c[0], p[1] - c[1]) == pytest.approx(radius, abs=1e-6), f"{arc} endpoint on its circle"
        u0 = ((p0[0] - c[0]) / radius, (p0[1] - c[1]) / radius)
        u1 = ((p1[0] - c[0]) / radius, (p1[1] - c[1]) / radius)
        bis = (u0[0] + u1[0], u0[1] + u1[1]); n = math.hypot(*bis)
        assert n > 1e-6, f"{arc}: a half-turn arc has no minor-arc midpoint"
        assert via[0] - c[0] == pytest.approx(radius * bis[0] / n, abs=1e-6), f"{arc} via at the angular midpoint x"
        assert via[1] - c[1] == pytest.approx(radius * bis[1] / n, abs=1e-6), f"{arc} via at the angular midpoint y"


@pytest.mark.parametrize("width_in_full,height_in_full,bbo", BOARDS)
def test_the_loop_closes_exactly_and_the_welds_join_physically_coincident_ends(width_in_full, height_in_full, bbo):
    pts, order = _loop(width_in_full, height_in_full, bbo)
    for a, b in zip(order, order[1:] + order[:1]):
        assert pts[a][-1] == pytest.approx(pts[b][0], abs=1e-9), f"{a} -> {b} meet exactly"

    # Fusion's rule (fusion360-quirks skill, measured): a SketchArc's :S/:E run counter-clockwise,
    # so a clockwise-declared triplet is tagged with :S at its LAST declared point. Resolve each
    # tag to the physical point that rule gives (derived from the declared points' own turn sign,
    # not assumed), then every weld in p02_03 must join two physically coincident points.
    HW, HH = width_in_full / 2 - bbo, height_in_full / 2 - bbo
    phys = {'proj_off_corner_BR': (HW, -HH), 'proj_off_corner_BL': (-HW, -HH)}
    for pid, p in pts.items():
        if len(p) == 3:
            (x0, y0), (x1, y1), (x2, y2) = p
            ccw = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0) > 0
            phys[pid + ':S'], phys[pid + ':E'] = (p[0], p[2]) if ccw else (p[2], p[0])
        else:
            phys[pid + ':S'], phys[pid + ':E'] = p[0], p[1]
    wm = _load_module(_WELDS_PATH, "p02_03_welds_crosscheck")
    welds = [s for s in wm.get_block()['BuildSequence'] if s['Type'] == 'Coincident']
    assert len(welds) == 8
    for w in welds:
        a, b = w['Targets']
        assert phys[a] == pytest.approx(phys[b], abs=1e-9), f"weld {w.get('Name', a + '~' + b)} joins {a}={phys[a]} to {b}={phys[b]}"


def test_both_dome_arcs_turn_clockwise_confirming_the_docstrings_own_swap_table():
    """Non-vacuous check on the CCW-swap claim itself (p02_02_loop.py's own docstring): BOTH
    dome_R and dome_L must turn CLOCKWISE in declared order -- if a future edit to the default
    proportions ever flipped one, the hardcoded :S/:E table in p02_03_welds.py / p03_03 / p03_04 /
    template_data.py's own FRAME_REGIONS["miters"] would silently start joining the wrong ends. A
    naive "mirroring flips the turn sign" assumption was checked here and found WRONG (both measure
    clockwise, not opposite) -- this test pins the actual measured result, not the naive guess."""
    pts, _ = _loop(7, 9, 0.25)
    for arc in ('dome_R', 'dome_L'):
        (x0, y0), (x1, y1), (x2, y2) = pts[arc]
        turn = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)
        assert turn < 0, f"{arc} must turn clockwise in declared order (turn={turn})"

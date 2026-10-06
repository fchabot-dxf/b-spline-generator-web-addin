"""H23 item 82 -- one stock + one WCS for the two B-spline setups of the panel (CAM_POSITION).

Measured live first (WORK-LOG item 82 probe, parts 1-2): per-setup stocks put two setups of one part
0.25 in apart; one fixed box (X/Y centred, Z from the bottom) + one declared WCS point read back
identically on setups in two MMs, also under flipY; PreviousSetupStock across two MMs warns, so Back and
Top stay on ONE MM (the panel to make: Stamped when it exists, else Clean -- the stamp raises material, so
no Clean->Carved rest chain; advisor ruling). These tests pin the declaration and the builder's writes
against fakes (no Fusion).

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_cam_position.py
"""
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

IN = 2.54


# ---------------------------------------------------------------------------
# fake adsk
# ---------------------------------------------------------------------------

class _Coll(list):
    def add(self, x):
        self.append(x)
        return True

    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


def _fake_adsk():
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')
    adsk.cam = types.ModuleType('adsk.cam')
    adsk.cam.SetupStockModes = type('SetupStockModes', (), {
        n: i for i, n in enumerate(('FixedBoxStock', 'PreviousSetupStock', 'RelativeBoxStock', 'SolidStock'))})
    adsk.core.ObjectCollection = type('ObjectCollection', (), {'create': staticmethod(_Coll)})
    return adsk


@pytest.fixture
def eng(monkeypatch):
    adsk = _fake_adsk()
    for name, mod in (('adsk', adsk), ('adsk.core', adsk.core),
                      ('adsk.fusion', adsk.fusion), ('adsk.cam', adsk.cam)):
        monkeypatch.setitem(sys.modules, name, mod)
    for name in [m for m in sys.modules if m == 'cam_engine' or m.startswith('cam_engine.')
                 or m == 'cam_utils' or m.startswith('cam_utils.')]:
        monkeypatch.delitem(sys.modules, name)
    from cam_engine import setup_builder, mm_builder, cam_position, cam_coordinator
    return types.SimpleNamespace(sb=setup_builder, mm=mm_builder, pos=cam_position, co=cam_coordinator,
                                 adsk=adsk)


class _Val:
    def __init__(self, v=None):
        self.value = v


class _Param:
    def __init__(self, name):
        self.name = name
        self.expression = None
        self.value = _Val(_Coll())


class _Params:
    def __init__(self):
        self._p = {}

    def itemByName(self, n):
        return self._p.setdefault(n, _Param(n))

    def written(self):
        return {n: p.expression for n, p in self._p.items() if p.expression is not None}


class _Op:
    def __init__(self, strategy):
        self.strategy = strategy
        self.name = strategy
        self.parameters = _Params()


class _Vec:
    def __init__(self, z):
        self.z = z


class _Frame:
    """workCoordinateSystem stand-in: only the resolved Z axis direction matters here."""
    def __init__(self, z_up):
        self._z = _Vec(1.0 if z_up else -1.0)

    def getAsCoordinateSystem(self):
        return (None, None, None, self._z)


class _Setup:
    def __init__(self, ops=(), z_up=True):
        self.name = 'S'
        self.stockMode = None
        self.stockSolids = None
        self.parameters = _Params()
        self.operations = _Coll(ops)
        self.workCoordinateSystem = _Frame(z_up)


class _SketchPoint:
    def __init__(self, xyz, owner):
        self.xyz = xyz
        self.owner = owner

    def createForAssemblyContext(self, occ):
        return ('proxy', self.owner, self.xyz, occ.tag)


class _Sketch:
    def __init__(self, name, pts, owner):
        self.name = name
        self.originPoint = _SketchPoint((0, 0, 0), owner)
        self.sketchPoints = _Coll([self.originPoint] + [_SketchPoint(p, owner) for p in pts])


class _Sketches(_Coll):
    def itemByName(self, n):
        return next((s for s in self if s.name == n), None)


class _Comp:
    def __init__(self, name, sketches=(), bodies=()):
        self.name = name
        self.sketches = _Sketches(sketches)
        self.bRepBodies = _Coll(bodies)


class _Occ:
    def __init__(self, comp, tag):
        self.component = comp
        self.tag = tag
        self.assemblyContext = None


class _MM:
    """An MM whose root wrapper occurrence holds the design's WCS sketches (as measured: every MM
    carries its own copy inside the '(Unsaved)' wrapper)."""

    def __init__(self, tag, sides=('back', 'flipped'), bodies=()):
        sk = [_Sketch(f"__cam_wcs_{s}", [(1.0, 2.0, 3.0)], tag) for s in sides]
        wrapper = _Occ(_Comp('(Unsaved)', sk), tag + ':wrapper')
        panel = _Occ(_Comp('Clean', (), bodies), tag + ':panel')
        self.occurrence = types.SimpleNamespace(component=types.SimpleNamespace(
            name=tag, sketches=_Sketches(), bRepBodies=_Coll(), allOccurrences=_Coll([wrapper, panel])))
        self.name = tag


# ---------------------------------------------------------------------------
# pure math
# ---------------------------------------------------------------------------

def test_stock_box_and_points_around_the_real_7x9_clean_panel(eng):
    p = eng.pos
    # the real T7 7x9 Clean panel measured in Fusion: x -3.5..3.5, y -4.5..4.5, z 0.032..1.044 in
    box = p.stock_box_cm((-3.5 * IN, -4.5 * IN, 0.032 * IN), (3.5 * IN, 4.5 * IN, 1.044 * IN))
    assert [round(v / IN, 4) for v in box['x']] == [-4.0, 4.0]
    assert [round(v / IN, 4) for v in box['y']] == [-5.0, 5.0]
    assert [round(v / IN, 4) for v in box['z']] == [0.032, 2.032]
    assert [round(v / IN, 4) for v in p.stock_dims_cm(box)] == [8.0, 10.0, 2.0]
    # = where today's stock box point 'top 1' lands on each side once the stock sits on the panel bottom
    # (measured live, real 7x9 Send: Back (x min, y min, its frame top = world bottom -- Back's WCS Z
    # points DOWN), Top (x max, y min, world top)).
    assert [round(v / IN, 4) for v in p.wcs_point_cm(box, 'back')] == [-4.0, -5.0, 0.032]
    assert [round(v / IN, 4) for v in p.wcs_point_cm(box, 'flipped')] == [4.0, -5.0, 2.032]


# ---------------------------------------------------------------------------
# the declaration
# ---------------------------------------------------------------------------

def _spec(sb, name):
    return next(s for s in sb.SETUP_SPECS if s['name'] == name)


def test_back_and_top_share_the_declared_position(eng):
    sb = eng.sb
    names = [s['name'] for s in sb.SETUP_SPECS]
    assert 'B-spline Carved' not in names                  # ruled out: the stamp raises material
    back, top = (_spec(sb, n) for n in ('B-spline Back', 'B-spline Top'))
    assert back['mm_rule'] == top['mm_rule'] == 'bspline_set'
    assert top['stock_intent'] == 'from_prev_setup' and top['continue_machining'] is True
    assert back['stock_box'] == 'stock'
    assert (back['wcs_point'], top['wcs_point']) == ('back', 'flipped')
    for s in (back, top):
        assert s['wcs_point'] in eng.pos.CAM_POSITION['wcs_points']
        assert s['op_heights'] is True


def test_no_previous_setup_stock_across_mms(eng):
    """Measured: PreviousSetupStock across two MMs warns 'Cannot verify that the stock is transferred'.
    A from_prev_setup spec must follow a spec on the SAME MM."""
    specs = eng.sb.SETUP_SPECS
    for i, s in enumerate(specs):
        if s['stock_intent'] == 'from_prev_setup':
            assert i > 0 and specs[i - 1]['mm_rule'] == s['mm_rule'], s['name']


def test_every_spec_mm_rule_is_built(eng):
    for s in eng.sb.SETUP_SPECS:
        assert s['mm_rule'] in eng.mm.MM_RULES


def test_cleanup_names_are_derived_from_the_declarations(eng):
    co, sb, mm = eng.co, eng.sb, eng.mm
    assert co._ADDIN_SETUP_NAMES == frozenset(s['name'] for s in sb.SETUP_SPECS)
    assert co._ADDIN_MM_NAMES == frozenset(mm._mm_display_name(r) for r in mm.MM_RULES)


def test_placeholder_reads_the_declared_stock(eng):
    st = eng.pos.CAM_POSITION['stock']
    assert eng.mm._placeholder_exprs() == (f"widthIn + {st['margin_xy_in']} in",
                                           f"heightIn + {st['margin_xy_in']} in",
                                           f"{st['z_in']} in")


# ---------------------------------------------------------------------------
# the writes
# ---------------------------------------------------------------------------

def test_op_heights_only_on_3d_strategies(eng):
    s = _Setup([_Op('adaptive'), _Op('pocket2d'), _Op('morphed_spiral'), _Op('contour2d')])
    n = eng.sb._apply_op_heights(s, 'S', None)
    assert n == 2
    oh = eng.pos.CAM_POSITION['op_heights']
    for op in s.operations:
        w = op.parameters.written()
        if op.strategy in ('adaptive', 'morphed_spiral'):
            assert w == {'topHeight_mode': oh['top'], 'bottomHeight_mode': oh['bottom'],
                         'bottomHeight_offset': oh['bottom_offset']}
        else:
            assert w == {}, op.strategy                # 2D: template depth untouched


@pytest.mark.parametrize('z_up, z_mode', [(True, "'bottom'"), (False, "'top'")])
def test_stock_box_sits_on_the_world_bottom_in_either_frame(eng, z_up, z_mode):
    """job_stockFixedZMode is read in the SETUP's frame. Measured: B-spline Back's WCS Z points down, and
    'bottom' there put the box on the panel's world TOP (stock world z 1.088 .. -0.912). The writer maps the
    declared world bottom through the resolved Z axis."""
    s = _Setup(z_up=z_up)
    eng.sb._apply_stock_box(s, 'S', None)
    st = eng.pos.CAM_POSITION['stock']
    assert s.stockMode == eng.adsk.cam.SetupStockModes.FixedBoxStock
    w = s.parameters.written()
    assert w['job_stockFixedX'] == f"(surfaceXHigh - surfaceXLow) + {st['margin_xy_in']} in"
    assert w['job_stockFixedY'] == f"(surfaceYHigh - surfaceYLow) + {st['margin_xy_in']} in"
    assert w['job_stockFixedZ'] == f"{st['z_in']} in"
    assert (w['job_stockFixedXMode'], w['job_stockFixedYMode'], w['job_stockFixedZMode']) == \
        ("'center'", "'center'", z_mode)
    assert w['job_stockFixedXOffset'] == w['job_stockFixedYOffset'] == w['job_stockFixedZOffset'] == '0 in'


def test_wcs_binds_this_mms_own_copy_of_the_declared_point(eng):
    s = _Setup()
    assert eng.sb._bind_wcs_point(s, _MM('mmA'), 'flipped', 'S', None)
    assert s.parameters.itemByName('wcs_origin_mode').expression == "'point'"
    bound = s.parameters.itemByName('wcs_origin_point').value.value
    assert bound == [('proxy', 'mmA', (1.0, 2.0, 3.0), 'mmA:wrapper')]


def test_wcs_point_missing_is_reported_not_faked(eng):
    s = _Setup()
    assert not eng.sb._bind_wcs_point(s, _MM('mmA', sides=('back',)), 'flipped', 'S', None)
    assert s.parameters.itemByName('wcs_origin_mode').expression is None


def test_every_fixed_box_setup_writes_a_declared_box(eng):
    """H23 item 82b: a FixedBoxStock whose dims are never written defaults to 13 x 10 in X/Y (measured on a real
    build: the Frame setup's stock was 13 x 10 around a 10 x 8 model). Every fixed_box setup names a declared box."""
    for spec in eng.sb.SETUP_SPECS:
        if spec['stock_intent'] in ('fixed_box', 'fixed_size'):
            assert spec.get('stock_box') in eng.pos.CAM_POSITION, spec['name']


def test_frame_box_is_the_frame_model_plus_the_shared_margin(eng):
    s = _Setup(z_up=True)
    eng.sb._apply_stock_box(s, 'Frame', None, 'frame_stock')
    m = eng.pos.CAM_POSITION['stock']['margin_xy_in']
    assert eng.pos.CAM_POSITION['frame_stock']['margin_xy_in'] == m       # one margin for both boxes
    w = s.parameters.written()
    assert w['job_stockFixedX'] == f"(surfaceXHigh - surfaceXLow) + {m} in"
    assert w['job_stockFixedY'] == f"(surfaceYHigh - surfaceYLow) + {m} in"
    assert w['job_stockFixedZ'] == "(surfaceZHigh - surfaceZLow)"          # the frame bars' own thickness
    assert w['job_stockFixedZMode'] == "'bottom'"

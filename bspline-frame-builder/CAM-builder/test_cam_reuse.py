"""H23 item 86 -- a re-BUILD reuses the existing CAM build in place (P2, advisor-approved after item 85's numbers).

MEASURED live (item 85): a re-BUILD on an unchanged board cost ~47 s (three MM snapshots + Fusion's first setup on
the dense panel, all redone); re-applying stock / WCS on the existing setups took ~1.3 s; setups SURVIVE and accept
`setup.models = ObjectCollection(...)`; after a model change the orientation axes + declared box must be re-applied
(stock X read 7.5 instead of 9.5). Setups carry attributes, ManufacturingModels do NOT (measured) -> setups are
found by SETUP_ATTR, MMs by their declared display names.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_cam_reuse.py
"""
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)


class _Coll(list):
    def add(self, x):
        self.append(x)
        return True

    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


@pytest.fixture
def eng(monkeypatch):
    adsk = types.ModuleType('adsk')
    adsk.core = types.ModuleType('adsk.core')
    adsk.fusion = types.ModuleType('adsk.fusion')
    adsk.cam = types.ModuleType('adsk.cam')
    adsk.cam.SetupStockModes = type('SetupStockModes', (), {
        n: i for i, n in enumerate(('FixedBoxStock', 'PreviousSetupStock', 'RelativeBoxStock', 'SolidStock'))})
    adsk.core.ObjectCollection = type('ObjectCollection', (), {'create': staticmethod(_Coll)})
    for name, mod in (('adsk', adsk), ('adsk.core', adsk.core), ('adsk.fusion', adsk.fusion), ('adsk.cam', adsk.cam)):
        monkeypatch.setitem(sys.modules, name, mod)
    for name in [m for m in sys.modules if m == 'cam_engine' or m.startswith('cam_engine.')
                 or m == 'cam_utils' or m.startswith('cam_utils.')]:
        monkeypatch.delitem(sys.modules, name)
    from cam_engine import setup_builder, mm_builder, cam_coordinator
    return types.SimpleNamespace(sb=setup_builder, mm=mm_builder, co=cam_coordinator, adsk=adsk)


class _Attr:
    def __init__(self, value):
        self.value = value


class _Attrs:
    def __init__(self, tag=None):
        self._a = {} if tag is None else {('CAMBuilder', 'setup'): _Attr(tag)}

    def itemByName(self, g, n):
        return self._a.get((g, n))

    def add(self, g, n, v):
        self._a[(g, n)] = _Attr(v)


class _Op:
    def __init__(self, strategy):
        self.strategy = strategy
        self.name = strategy


class _Setup:
    def __init__(self, name, tag=True, valid=True, ops=()):
        self.name = name
        self.isValid = valid
        self.attributes = _Attrs(name if tag else None)
        self.models = _Coll()
        self.operations = _Coll(ops)
        self.parameters = object()   # every parameter write is recorded through the patched leaves


class _MM:
    def __init__(self, name, bodies=(), valid=True):
        self.name = name
        self.isValid = valid
        self.occurrence = types.SimpleNamespace(component=types.SimpleNamespace(
            bRepBodies=_Coll(bodies), allOccurrences=_Coll()))


class _Cam:
    def __init__(self, mms, setups):
        self.manufacturingModels = _Coll(mms)
        self.setups = _Coll(setups)


def _full_build(eng, **over):
    names = {r: eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES}
    mms = [_MM(names[r], bodies=[f'{r}-body']) for r in eng.mm.MM_RULES]
    setups = [_Setup(s['name']) for s in eng.sb.SETUP_SPECS]
    for k, v in over.items():
        v(mms, setups)
    return _Cam(mms, setups), names


# ---- detection ----

def test_a_complete_valid_build_is_reused(eng):
    cam, names = _full_build(eng)
    r = eng.sb.find_reusable_build(cam, names)
    assert set(r['mms']) == set(eng.mm.MM_RULES)
    assert list(r['setups']) == [s['name'] for s in eng.sb.SETUP_SPECS]


@pytest.mark.parametrize('case', ['mm_missing', 'mm_invalid', 'setup_missing', 'setup_invalid', 'setup_untagged'])
def test_anything_missing_or_invalid_means_full_recreate(eng, case):
    def mut(mms, setups):
        if case == 'mm_missing': mms.pop(1)
        if case == 'mm_invalid': mms[1].isValid = False
        if case == 'setup_missing': setups.pop(1)
        if case == 'setup_invalid': setups[1].isValid = False
        if case == 'setup_untagged': setups[1].attributes = _Attrs(None)   # an older build: named, not tagged
    cam, names = _full_build(eng, m=mut)
    assert eng.sb.find_reusable_build(cam, names) is None


def test_build_setup_tags_new_setups(eng):
    s = _Setup('B-spline Back', tag=False)
    eng.sb._tag_setup(s, 'B-spline Back')
    assert s.attributes.itemByName(*eng.sb.SETUP_ATTR).value == 'B-spline Back'


# ---- the in-place update ----

def test_update_in_place_rebinds_models_and_reapplies_the_declared_config(eng, monkeypatch):
    sb = eng.sb
    cam, names = _full_build(eng)
    back = next(s for s in cam.setups if s.name == 'B-spline Back')
    back.operations = _Coll([_Op('adaptive'), _Op('pocket2d')])
    reuse = sb.find_reusable_build(cam, names)
    calls = []
    # the real _configure_setup runs; only its adsk-touching leaves are recorded
    monkeypatch.setattr(sb.pi, 'set_choice', lambda *a, **k: None)
    monkeypatch.setattr(sb, '_get_origin_axes', lambda logger: ('X', 'Y'))
    monkeypatch.setattr(sb, '_set_entity_param', lambda params, n, e, s, l: calls.append(('axis', s, n)))
    monkeypatch.setattr(sb, '_set_bool_param', lambda *a, **k: None)
    monkeypatch.setattr(sb, '_set_expr_param', lambda *a, **k: True)
    monkeypatch.setattr(sb, '_log_wcs_readback', lambda *a, **k: None)
    monkeypatch.setattr(sb, '_set_stock_mode', lambda setup, intent, name, logger: calls.append(('stock', name, intent)))
    monkeypatch.setattr(sb, '_bind_wcs_point', lambda setup, mm, side, name, logger: calls.append(('wcs', name, side, mm.name)) or True)
    monkeypatch.setattr(sb, '_apply_stock_box', lambda setup, name, logger, key='stock': calls.append(('box', name, key)))
    monkeypatch.setattr(sb, '_apply_op_heights', lambda setup, name, logger: calls.append(('heights', name)))
    monkeypatch.setattr(sb, '_propagate_part_position_pass', lambda setups, logger, cam=None: calls.append(('pass2', len(setups))))
    out = sb.update_setups_in_place(cam, reuse)
    assert [s.name for s in out] == [s['name'] for s in sb.SETUP_SPECS]
    for spec in sb.SETUP_SPECS:                       # models re-bound to the MM's CURRENT body, as an ObjectCollection
        s = reuse['setups'][spec['name']]
        assert isinstance(s.models, _Coll) and list(s.models) == [f"{spec['mm_rule']}-body"]
    # the declared box is RE-APPLIED on every box setup, the WCS point on every point setup, the axes on all
    assert ('box', 'B-spline Back', 'stock') in calls and ('box', 'Frame', 'frame_stock') in calls
    assert ('wcs', 'B-spline Back', 'back', names['bspline_set']) in calls
    assert ('wcs', 'B-spline Top', 'flipped', names['bspline_set']) in calls
    assert sum(1 for c in calls if c[0] == 'axis') == 2 * len(sb.SETUP_SPECS)
    assert ('heights', 'B-spline Back') in calls     # setups with ops + op_heights declared
    assert ('heights', 'B-spline Top') not in calls  # no ops on this one in the fake
    assert calls[-1] == ('pass2', len(sb.SETUP_SPECS))


# ---- the coordinator chooses ----

def _run_coordinator(eng, monkeypatch, reuse):
    co, sb, mm = eng.co, eng.sb, eng.mm
    seen = []
    fake_cam = object()
    monkeypatch.setattr(co.cam_workspace, 'acquire_cam', lambda app=None, logger=None: fake_cam)
    des = object()
    doc = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: des))
    eng.adsk.fusion.Design = type('Design', (), {'cast': staticmethod(lambda x: x)})
    app = types.SimpleNamespace(activeDocument=doc)
    monkeypatch.setattr(sb, 'ensure_wcs_sketches', lambda d, l=None: seen.append('wcs'))
    monkeypatch.setattr(sb, 'find_reusable_build', lambda cam, names, logger=None: reuse)
    monkeypatch.setattr(co, '_cleanup_previous_build', lambda cam, logger: seen.append('cleanup'))
    monkeypatch.setattr(mm, 'build_all_mms', lambda cam, d, c, l: seen.append('build_mms') or {r: object() for r in mm.MM_RULES})
    fake_setups = [types.SimpleNamespace(name=s['name']) for s in sb.SETUP_SPECS]
    monkeypatch.setattr(sb, 'build_all_setups', lambda cam, mms, l, **k: seen.append('build_setups') or fake_setups)
    monkeypatch.setattr(sb, 'update_setups_in_place', lambda cam, r, l=None: seen.append('in_place') or fake_setups)
    rep = co.run(classifier=None, app=app, logger=None, mode='bspline', skip_templates=True, skip_machine=True)
    return rep, seen


def test_coordinator_reuses_in_place(eng, monkeypatch):
    reuse = {'mms': {r: object() for r in eng.mm.MM_RULES}, 'setups': {}}
    rep, seen = _run_coordinator(eng, monkeypatch, reuse)
    assert seen == ['wcs', 'in_place'] and rep['reused'] is True and rep['ok'] is True


def test_coordinator_falls_back_to_the_full_recreate(eng, monkeypatch):
    rep, seen = _run_coordinator(eng, monkeypatch, None)
    assert seen == ['wcs', 'cleanup', 'build_mms', 'build_setups'] and rep['reused'] is False and rep['ok'] is True

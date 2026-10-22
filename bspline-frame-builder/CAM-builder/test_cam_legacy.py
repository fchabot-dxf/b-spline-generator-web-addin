"""BUILD on a document that already has hand-built setups (Fred 2026-10-21): it must not create duplicates ('B-spline Back1',
'Frame1') and must not break the old ones (their Manufacturing Models, models, stock, origin and operations).

The tree below has the shapes MEASURED on his file (6x9-12oct-experiment.f3d, read-only probe 2026-10-21): the three
Manufacturing Models carry the add-in's declared names; 'B-spline Back' and the flipped setup 'B-spline to pp )' are bound to
the WHOLE MM occurrence ('MM - B-spline set:3', an Occurrence, path 'Manufacturing Models:1+MM - B-spline set:3'); 'Stock' and
'Frame' hold body PROXIES whose tokens differ from the MM's own bodies'; none has an op_ledger record; 'Setup7' is his own.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_cam_legacy.py
"""
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng, _Coll, _Attrs                      # noqa: E402,F401
from test_stock_card import _HandParams, HAND, ORIGINS, _Frame     # noqa: E402


class _Occ:
    """An MM occurrence used as a setup's model (objectType Occurrence)."""
    objectType = 'adsk::fusion::Occurrence'

    def __init__(self, path):
        self.fullPathName = path
        self.entityToken = 'occ-' + path


class _ProxyBody:
    """A body as a setup holds it: a proxy under the MM, with a token of its own."""
    objectType = 'adsk::fusion::BRepBody'

    def __init__(self, name, ctx_path):
        self.name = name
        self.entityToken = f'proxy-{name}'
        self.assemblyContext = types.SimpleNamespace(fullPathName=ctx_path)


class _Op:
    def __init__(self, name, strategy='pocket_clearing'):
        self.name = name
        self.strategy = strategy
        self.entityToken = 'tok-' + name
        self.parameters = _HandParams({'topHeight_mode': "'from model top'"})


class _LegacySetup:
    def __init__(self, name, models=(), ops=(), mode=0):
        self.name = name
        self.isValid = True
        self.attributes = _Attrs()
        self.models = _Coll(models)
        self.operations = _Coll(ops)
        self.stockMode = mode
        self.parameters = _HandParams(HAND)
        self.workCoordinateSystem = _Frame(ORIGINS.get(name))
        self.deleted = False

    def deleteMe(self):
        self.deleted = True
        return True


class _LegacyMM:
    def __init__(self, name, n, bodies):
        self.name = name
        self.isValid = True
        self.deleted = False
        self.occurrence = types.SimpleNamespace(
            fullPathName=f'Manufacturing Models:1+{name}:{n}',
            component=types.SimpleNamespace(bRepBodies=_Coll(bodies), allOccurrences=_Coll()))

    def deleteMe(self):
        self.deleted = True
        return True


class _Cam:
    def __init__(self, mms, setups):
        self.manufacturingModels = _Coll(mms)
        self.setups = _Coll(setups)
        for x in list(setups):
            x.deleteMe = (lambda x=x: self.setups.remove(x) or True)
        for m in list(mms):
            m.deleteMe = (lambda m=m: self.manufacturingModels.remove(m) or True)


def _freds_file(eng, flipped='B-spline to pp )'):
    nm = {r: eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES}
    mm_stock = _LegacyMM(nm['stock'], 2, [types.SimpleNamespace(name='Stock', entityToken='mm-stock-body')])
    mm_bs = _LegacyMM(nm['bspline_set'], 3, [types.SimpleNamespace(name='panel', entityToken='mm-panel-body')])
    mm_fr = _LegacyMM(nm['frame'], 4, [types.SimpleNamespace(name='frame_left', entityToken='mm-frame-left')])
    occ = _Occ(mm_bs.occurrence.fullPathName)
    setups = [
        _LegacySetup('Stock', [_ProxyBody('Stock', mm_stock.occurrence.fullPathName)]),
        _LegacySetup('B-spline Back', [occ], [_Op('Pocket back1'), _Op('Morphed Spiral1'), _Op('3D Offset Roughing6')]),
        _LegacySetup(flipped, [occ], [_Op('Pocket back1 (2)'), _Op('Morphed Spiral1 (2)')], mode=7),
        _LegacySetup('Frame', [_ProxyBody('frame_left', mm_fr.occurrence.fullPathName + '+6x9 12oct (1):1+Frame_1:1')],
                     [_Op('cadre Morphed Spiral 31')]),
        _LegacySetup('Setup7'),
    ]
    cam = _Cam([mm_stock, mm_bs, mm_fr], setups)
    des = types.SimpleNamespace(attributes=_Attrs())
    cam.parentDocument = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: des))
    eng.adsk.fusion.Design = type('Design', (), {'cast': staticmethod(lambda x: x)})
    return cam, setups, (mm_stock, mm_bs, mm_fr)


def _snapshot(setups):
    return {s.name: ([m for m in s.models if isinstance(m, _Occ)], [o.name for o in s.operations], s.stockMode,
                     s.parameters.writes(), s.deleted) for s in setups}


def _build(eng, monkeypatch, cam, log=None):
    """The coordinator's real B-spline branch on `cam`; only the Fusion-touching builders are recorded."""
    co, sb, mm = eng.co, eng.sb, eng.mm
    seen = []
    monkeypatch.setattr(co.cam_workspace, 'acquire_cam', lambda app=None, logger=None: cam)
    app = types.SimpleNamespace(activeDocument=types.SimpleNamespace(
        products=types.SimpleNamespace(itemByProductType=lambda t: object())))
    monkeypatch.setattr(sb, '_propagate_part_position_pass', lambda setups, logger, cam=None: None)
    eng.adsk.core.Application = types.SimpleNamespace(get=lambda: types.SimpleNamespace(activeDocument=None))
    monkeypatch.setattr(mm, 'get_design', lambda app, logger=None: None)
    monkeypatch.setattr(mm, '_ensure_cam_builder_user_parameters', lambda d, l: None)
    monkeypatch.setattr(mm, 'build_mm', lambda cam_, d, rule, c, l=None: seen.append(('mm', rule)) or _LegacyMM(mm._mm_display_name(rule), 9, []))
    monkeypatch.setattr(sb, 'build_setup', lambda cam_, mms, spec, l=None, **k: seen.append(('setup', spec['name'])) or _LegacySetup(spec['name']))

    class _Log:
        def __init__(self):
            self.lines = []

        def log(self, msg, level='INFO'):
            self.lines.append((level, msg))
    lg = log if log is not None else _Log()
    rep = co.run(classifier=None, app=app, logger=lg, mode='bspline', skip_templates=True, skip_machine=True)
    return rep, seen, lg


# ---------------------------------------------------------------------------
# roles: exact name, then a declared alias, nothing else
# ---------------------------------------------------------------------------

def test_every_role_declares_its_aliases_and_the_flipped_one_names_freds_setup(eng):
    specs = {s['name']: s for s in eng.sb.SETUP_SPECS}
    assert [s['role'] for s in eng.sb.SETUP_SPECS] == ['stock', 'back', 'top', 'frame']
    assert specs['B-spline Top']['aliases'] == ['B-spline to pp )']
    assert all(specs[n]['aliases'] == [] for n in ('Stock', 'B-spline Back', 'Frame'))


def test_a_role_is_found_by_exact_name_then_by_alias(eng):
    cam, setups, _ = _freds_file(eng)
    roles = eng.sb.bind_roles(cam)
    assert [s.name for s in roles['B-spline Top']] == ['B-spline to pp )']
    assert [s.name for s in roles['B-spline Back']] == ['B-spline Back']
    assert all('Setup7' != s.name for v in roles.values() for s in v)         # a setup that matches no role is not bound


def test_the_exact_name_wins_over_an_alias(eng):
    cam, setups, _ = _freds_file(eng)
    cam.setups.append(_LegacySetup('B-spline Top', mode=7))
    assert [s.name for s in eng.sb.bind_roles(cam)['B-spline Top']] == ['B-spline Top']


def test_no_structural_guess_a_previous_setup_stock_setup_with_another_name_is_not_the_top(eng):
    cam, setups, _ = _freds_file(eng, flipped='Flip side')                      # mode 7, follows Back, but no declared name
    assert eng.sb.bind_roles(cam)['B-spline Top'] == []


# ---------------------------------------------------------------------------
# the MM-in-use check (both model kinds)
# ---------------------------------------------------------------------------

def test_an_mm_is_in_use_by_a_setup_bound_to_its_whole_occurrence(eng):
    cam, setups, (mm_stock, mm_bs, mm_fr) = _freds_file(eng)
    assert eng.sb.mm_in_use(mm_bs, [setups[1]]) is True
    assert eng.sb.mm_in_use(mm_fr, [setups[1]]) is False


def test_an_mm_is_in_use_by_a_setup_holding_body_proxies_whose_tokens_differ(eng):
    cam, setups, (mm_stock, mm_bs, mm_fr) = _freds_file(eng)
    assert eng.sb.mm_in_use(mm_stock, [setups[0]]) is True                      # path == the MM's
    assert eng.sb.mm_in_use(mm_fr, [setups[3]]) is True                        # path continues the MM's with '+'
    assert eng.sb.mm_in_use(mm_stock, [setups[3]]) is False
    assert eng.sb.mm_in_use(mm_bs, [setups[4]]) is False                       # a setup with no models


def test_the_path_prefix_is_not_a_name_prefix(eng):
    cam, setups, (mm_stock, mm_bs, mm_fr) = _freds_file(eng)
    other = _LegacySetup('x', [_Occ(mm_bs.occurrence.fullPathName + '9')])      # ...:39 is another occurrence, not ...:3
    assert eng.sb.mm_in_use(mm_bs, [other]) is False


def test_the_cleanup_keeps_every_mm_a_kept_setup_is_bound_to(eng):
    cam, setups, mms = _freds_file(eng)
    removed = eng.co.clear_addin_build(cam, None)
    mm_stock, mm_bs, mm_fr = mms
    # the MMs under the setups that stay (Back / flipped / Frame hold ops the add-in did not make) are kept; the empty 'Stock'
    # setup is the add-in's by name and goes as before, and its own MM with it
    assert (mm_bs.deleted, mm_fr.deleted) == (False, False) and removed['mms'] == [mm_stock.name]
    assert all(s in cam.setups for s in setups[1:4])


# ---------------------------------------------------------------------------
# BUILD on his file
# ---------------------------------------------------------------------------

def test_a_build_on_freds_file_changes_nothing_and_makes_no_duplicates(eng, monkeypatch):
    cam, setups, mms = _freds_file(eng)
    before = _snapshot(setups)
    rep, seen, lg = _build(eng, monkeypatch, cam)
    assert rep['reused'] is True and rep['ok'] is True
    assert seen == []                                                          # no MM and no setup built
    assert [s.name for s in cam.setups] == ['Stock', 'B-spline Back', 'B-spline to pp )', 'Frame', 'Setup7']
    assert [m.deleted for m in mms] == [False] * 3 and len(cam.manufacturingModels) == 3
    assert _snapshot(setups) == before                                          # models, ops, stock mode, no parameter written
    assert not [l for l in lg.lines if l[0] == 'WARNING' and l[1].startswith('ROLES')]


def test_the_occurrence_bound_models_are_not_re_bound(eng, monkeypatch):
    cam, setups, (_, mm_bs, _) = _freds_file(eng)
    held = list(setups[1].models)
    _build(eng, monkeypatch, cam)
    assert list(setups[1].models) == held and isinstance(setups[1].models[0], _Occ)


def test_a_missing_role_creates_only_that_one_and_warns_naming_the_unadopted_setups(eng, monkeypatch):
    cam, setups, mms = _freds_file(eng, flipped='Flip side')
    before = _snapshot(setups)
    rep, seen, lg = _build(eng, monkeypatch, cam)
    # Back / Frame (they hold ops the add-in did not make) are ADOPTED: never built again, never deleted. The empty 'Stock'
    # setup is the add-in's by name and is rebuilt as before (with its own MM); Top is the missing role.
    assert ('setup', 'B-spline Back') not in seen and ('setup', 'Frame') not in seen and ('setup', 'B-spline Top') in seen
    assert not [x for x in seen if x[0] == 'mm' and x[1] != 'stock']           # the two MMs under the kept setups are reused
    assert [m.deleted for m in mms[1:]] == [False, False]
    kept = {k: v for k, v in _snapshot(setups).items() if k != 'Stock'}
    assert kept == {k: v for k, v in before.items() if k != 'Stock'}
    warn = [m for lvl, m in lg.lines if lvl == 'WARNING' and m.startswith('ROLES')]
    assert len(warn) == 2                                                       # Stock (rebuilt) and Top (missing): one line per created role
    top = next(w for w in warn if w.startswith('ROLES: Top'))
    assert "'Flip side'" in top and "'Setup7'" in top and 'not touched' in top


# ---------------------------------------------------------------------------
# a project built wholly by the add-in behaves as before
# ---------------------------------------------------------------------------

def test_a_whole_addin_built_tree_is_reused_in_place_exactly_as_before(eng, monkeypatch):
    nm = {r: eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES}
    mms = [_LegacyMM(nm[r], i + 2, [types.SimpleNamespace(name=r, entityToken=f'b-{r}')]) for i, r in enumerate(eng.mm.MM_RULES)]
    setups = [_LegacySetup(s['name'], [mms[list(eng.mm.MM_RULES).index(s['mm_rule'])].occurrence.component.bRepBodies[0]])
              for s in eng.sb.SETUP_SPECS]
    cam = _Cam(mms, setups)
    cam.parentDocument = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: types.SimpleNamespace(attributes=_Attrs())))
    eng.adsk.fusion.Design = type('Design', (), {'cast': staticmethod(lambda x: x)})
    rep, seen, lg = _build(eng, monkeypatch, cam)
    assert rep['reused'] is True and seen == []
    assert all(len(s.models) == 1 for s in setups)                              # body-bound: re-bound to the MM's body as before


# ---------------------------------------------------------------------------
# APPLY adds nothing to a setup built by hand (Fred 2026-10-21)
# ---------------------------------------------------------------------------

from test_cam_keep import _wire_cloud, _Operation as _KeepOp   # noqa: E402


class _Stamper(_LegacySetup):
    """A legacy setup whose createFromCAMTemplate ADDS the template's operations (like Fusion's)."""
    stamps = 0

    def createFromCAMTemplate(self, tpl):
        made = [_KeepOp(f'raw-{i}') for i in range(tpl.n_ops)]
        for o in made:
            self.operations.append(o)
        type(self).stamps += 1
        return made


def _apply_world(eng, monkeypatch):
    cam, setups, mms = _freds_file(eng)
    for i, s in enumerate(setups):
        setups[i].__class__ = _Stamper
    leaves = {'Pocket back.f3dhsm-template': 2}
    for spec in eng.sb.SETUP_SPECS:
        monkeypatch.setitem(spec, 'cloud_templates', list(leaves) if spec['name'] in ('B-spline Back', 'Frame') else [])
    _wire_cloud(eng, monkeypatch, leaves)
    chain = []
    monkeypatch.setattr(eng.sb, '_apply_hole_chain', lambda cam_, setup, spec, design, mm, logger: chain.append(setup.name))
    _Stamper.stamps = 0
    return cam, setups, chain


def test_apply_adds_nothing_to_his_hand_built_back_and_frame_and_logs_why(eng, monkeypatch):
    cam, setups, chain = _apply_world(eng, monkeypatch)
    before = {s.name: [o.name for o in s.operations] for s in setups}
    lines = []
    lg = types.SimpleNamespace(log=lambda m, lvl='INFO': lines.append((lvl, m)))
    eng.sb.apply_templates_to_existing_setups(cam, lg)
    assert _Stamper.stamps == 0 and 'B-spline Back' not in chain and 'Frame' not in chain   # no template ops, no Holes A/B chain
    assert {s.name: [o.name for o in s.operations] for s in setups} == before
    skipped = [m for lvl, m in lines if lvl == 'INFO' and 'skipped' in m and 'built by hand' in m]
    assert len(skipped) == 2 and any("'B-spline Back'" in m or '(B-spline Back)' in m for m in skipped)
    assert any('(Frame)' in m for m in skipped)


def test_apply_still_stamps_a_setup_with_an_addin_record_and_an_empty_one(eng, monkeypatch):
    cam, setups, chain = _apply_world(eng, monkeypatch)
    back = setups[1]
    des = cam.parentDocument.products.itemByProductType('DesignProductType')
    eng.led = __import__('cam_engine.op_ledger', fromlist=['x'])
    eng.led.record(des, 'B-spline Back', 'Pocket back.f3dhsm-template', [back.operations[0]])   # the add-in recorded this setup
    setups[3].operations.clear()                                                  # an empty Frame
    eng.sb.apply_templates_to_existing_setups(cam)
    assert _Stamper.stamps == 1 and setups[3].operations.count == 2               # the empty Frame is stamped
    assert 'B-spline Back' in chain                                               # and the recorded Back still gets its chain step


def test_the_hand_built_predicate_is_one_place(eng):
    cam, setups, _ = _freds_file(eng)
    des = cam.parentDocument.products.itemByProductType('DesignProductType')
    led = __import__('cam_engine.op_ledger', fromlist=['x'])
    known = eng.sb._declared_template_bases()
    assert led.hand_built(des, setups[1], 'B-spline Back', known) is True         # no record + ops it did not make
    assert led.hand_built(des, setups[4], 'Setup7', known) is False               # empty
    led.record(des, 'B-spline Back', 'x', [setups[1].operations[0]])
    assert led.hand_built(des, setups[1], 'B-spline Back', known) is False        # it has a record

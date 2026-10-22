"""Send stops wiping CAM (Fred's pick): what the add-in made is told apart from what Fred added, and his work survives.

Fakes follow the real shapes (test_cam_reuse.py / test_cam_clear.py): a setup holds `operations`, and
`createFromCAMTemplate(tpl)` ADDS the template's operations to it and returns them (nothing de-duplicates).

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_cam_keep.py
"""
import importlib
import os
import sys
import types

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng, _Coll, _Attrs, _MM, _Cam  # noqa: E402,F401


class _Operation:
    _n = 0

    def __init__(self, name):
        _Operation._n += 1
        self.name = name
        self.entityToken = f'op-token-{_Operation._n}'


class _KeepSetup:
    """A setup that, like Fusion's, stamps a template's operations INTO its operations on createFromCAMTemplate."""

    def __init__(self, name, ops=(), models=()):
        self.name = name
        self.isValid = True
        self.attributes = _Attrs()
        self.models = _Coll(models)
        self.operations = _Coll(ops)
        self.stamped = 0

    def createFromCAMTemplate(self, tpl):
        made = [_Operation(f'{tpl}-raw-{i}') for i in range(tpl.n_ops)]
        for o in made:
            self.operations.append(o)
        self.stamped += 1
        return made


class _Tpl:
    def __init__(self, n_ops):
        self.n_ops = n_ops


class _Url:
    def __init__(self, leaf):
        self.leafName = leaf


def _wire_cloud(eng, monkeypatch, templates):
    """adsk.cam as the build sees it: a cloud library of `templates` ({leaf: n_ops}); Operation is the op class."""
    cam = eng.adsk.cam
    urls = {leaf: _Url(leaf) for leaf in templates}
    lib = types.SimpleNamespace(
        urlByLocation=lambda loc: 'cloud://',
        childAssetURLs=lambda root: list(urls.values()),
        templateAtURL=lambda url: _Tpl(templates[url.leafName]))
    cam.CAMManager = types.SimpleNamespace(get=lambda: types.SimpleNamespace(
        libraryManager=types.SimpleNamespace(templateLibrary=lib)))
    cam.LibraryLocations = types.SimpleNamespace(CloudLibraryLocation=1)
    cam.Operation = _Operation
    eng.adsk.fusion.Design = types.SimpleNamespace(cast=lambda x: x)
    monkeypatch.setattr(eng.sb, '_apply_op_heights', lambda *a, **k: None)


class _Design:
    def __init__(self):
        self.attributes = _Attrs()


def _world(eng, monkeypatch, back_templates=None):
    """A reusable declared build in a document with a design; the first spec's templates are stubbed to `back_templates`."""
    design = _Design()
    names = {r: eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES}
    mms = [_MM(names[r], bodies=[f'{r}-body']) for r in eng.mm.MM_RULES]
    setups = [_KeepSetup(s['name']) for s in eng.sb.SETUP_SPECS]
    cam = _Cam(mms, setups)
    cam.parentDocument = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: design))
    spec0 = eng.sb.SETUP_SPECS[0]
    leaves = {f'{k}.f3dhsm-template': n for k, n in (back_templates or {'Pocket back': 2}).items()}
    monkeypatch.setitem(spec0, 'cloud_templates', list(leaves))
    for spec in eng.sb.SETUP_SPECS[1:]:
        monkeypatch.setitem(spec, 'cloud_templates', [])
    _wire_cloud(eng, monkeypatch, leaves)
    eng.led = importlib.import_module('cam_engine.op_ledger')
    return cam, design, setups[0], leaves


def _count(setup):
    return setup.operations.count


def test_a_second_apply_adds_no_operations_to_a_setup_that_already_has_them(eng, monkeypatch):
    cam, _, back, _ = _world(eng, monkeypatch)
    eng.sb.apply_templates_to_existing_setups(cam)
    first = _count(back)
    assert first == 2
    eng.sb.apply_templates_to_existing_setups(cam)       # the auto-APPLY after a re-BUILD, or a second APPLY click
    assert _count(back) == first


def test_apply_after_fred_deleted_nothing_and_added_an_op_keeps_his_op_and_adds_none(eng, monkeypatch):
    cam, _, back, _ = _world(eng, monkeypatch)
    eng.sb.apply_templates_to_existing_setups(cam)
    fred = _Operation('3D Offset Roughing')
    back.operations.append(fred)
    eng.sb.apply_templates_to_existing_setups(cam)
    assert back.operations.count == 3 and fred in back.operations


def test_the_ledger_records_only_what_was_stamped_not_freds_ops(eng, monkeypatch):
    cam, design, back, _ = _world(eng, monkeypatch)
    eng.sb.apply_templates_to_existing_setups(cam)       # the add-in stamps first (an empty setup)
    fred = _Operation('Fred dup')
    back.operations.append(fred)
    eng.sb.apply_templates_to_existing_setups(cam)
    ours = [o for o in back.operations if o is not fred]
    assert len(ours) == 2
    assert eng.led.ours_tokens(design, back.name) == {o.entityToken for o in ours}
    assert fred.entityToken not in eng.led.ours_tokens(design, back.name)


def test_a_template_whose_ops_fred_deleted_is_stamped_again(eng, monkeypatch):
    cam, _, back, _ = _world(eng, monkeypatch)
    eng.sb.apply_templates_to_existing_setups(cam)
    back.operations.clear()                              # Fred removed the template's ops on purpose
    eng.sb.apply_templates_to_existing_setups(cam)
    assert _count(back) == 2


# ---- clear_addin_build keeps what is not provably ours ---------------------------------------------------

def _clearable(eng, monkeypatch):
    cam, design, back, leaves = _world(eng, monkeypatch)
    for s in cam.setups:
        s.deleteMe = (lambda s=s: cam.setups.remove(s) or True)
    for m in cam.manufacturingModels:
        m.deleteMe = (lambda m=m: cam.manufacturingModels.remove(m) or True)
    return cam, design, back


def test_clear_keeps_a_setup_that_holds_an_op_fred_added(eng, monkeypatch):
    cam, design, back = _clearable(eng, monkeypatch)
    eng.sb.apply_templates_to_existing_setups(cam)
    fred = _Operation('3D Offset Roughing')
    back.operations.append(fred)
    removed = eng.co.clear_addin_build(cam, None)
    assert back in cam.setups and fred in back.operations
    assert back.name not in removed['setups']
    # the other three held nothing of Fred's: they go as before
    assert len(cam.setups) == 1


def test_clear_deletes_a_setup_holding_only_what_the_addin_stamped(eng, monkeypatch):
    cam, design, back = _clearable(eng, monkeypatch)
    eng.sb.apply_templates_to_existing_setups(cam)
    removed = eng.co.clear_addin_build(cam, None)
    assert back.name in removed['setups'] and back not in cam.setups


def test_clear_keeps_an_mm_that_a_setup_it_kept_still_references(eng, monkeypatch):
    cam, design, back = _clearable(eng, monkeypatch)
    spec = eng.sb.SETUP_SPECS[0]
    mm = next(m for m in cam.manufacturingModels if m.name == eng.mm._mm_display_name(spec['mm_rule']))
    back.models = _Coll([mm.occurrence.component.bRepBodies[0]])      # the setup uses the MM's body
    back.operations.append(_Operation('3D Offset Roughing'))
    removed = eng.co.clear_addin_build(cam, None)
    assert mm in cam.manufacturingModels and mm.name not in removed['mms']


def test_clear_keeps_a_fred_setup_that_references_an_addin_mm(eng, monkeypatch):
    cam, design, back = _clearable(eng, monkeypatch)
    mm = cam.manufacturingModels[0]
    mine = _KeepSetup('Fred 3D', ops=[_Operation('Rest')], models=[mm.occurrence.component.bRepBodies[0]])
    mine.deleteMe = lambda: cam.setups.remove(mine) or True
    cam.setups.append(mine)
    removed = eng.co.clear_addin_build(cam, None)
    assert mine in cam.setups and mm in cam.manufacturingModels
    assert 'Fred 3D' not in removed['setups'] and mm.name not in removed['mms']


# ---- Send: a reusable build is left alone ----------------------------------------------------------------

def test_a_reusable_build_is_not_cleared_by_a_send(eng, monkeypatch):
    cam, _, _, _ = _world(eng, monkeypatch)
    assert eng.sb.find_reusable_build(
        cam, {r: eng.mm._mm_display_name(r) for r in eng.mm.MM_RULES}) is not None
    seen = []
    monkeypatch.setattr(eng.co, 'clear_addin_build', lambda c, l=None: seen.append(c) or {'setups': [], 'mms': []})
    assert eng.co.clear_for_send(cam, None) is None
    assert seen == []


def test_a_partial_build_is_cleared_by_a_send_through_the_safe_clear(eng, monkeypatch):
    cam, _, _, _ = _world(eng, monkeypatch)
    cam.setups.pop()                                     # a setup is missing: not reusable
    seen = []
    monkeypatch.setattr(eng.co, 'clear_addin_build', lambda c, l=None: seen.append(c) or {'setups': [], 'mms': []})
    eng.co.clear_for_send(cam, None)
    assert seen == [cam]

"""
H23 item 99 (Fred, CAM option (b)): a Send clears the CAM our BUILD made -- its setups AND its Manufacturing Models, by
the names CAM-builder declares (SETUP_SPECS / MM_RULES) -- as its own declared step ('fusionClearCam'), and logs what
went. Anything else in the CAM workspace stays; BUILD + APPLY afterwards is the full recreate.
"""
import os
import re
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (same adsk stubs + loader)


class _Item:
    def __init__(self, coll, name):
        self.coll, self.name = coll, name

    def deleteMe(self):
        self.coll.items.remove(self)
        return True


class _Coll:
    def __init__(self, names):
        self.items = [_Item(self, n) for n in names]

    @property
    def count(self):
        return len(self.items)

    def item(self, i):
        return self.items[i]

    def names(self):
        return [x.name for x in self.items]


# The declared names, read from CAM-builder's own declaration files (not imported: the CAM engine needs adsk.cam)
def _declared_names():
    src = open(os.path.join(bsg.CAM_BUILDER_DIR, 'cam_engine', 'setup_builder.py'), encoding='utf-8').read()
    return re.findall(r"'name':\s*'(B-spline [^']+)'", src)


class _FakeCoordinator:
    """clear_addin_build's contract, with the real name sets passed in by the test."""
    def __init__(self, setup_names, mm_names):
        self.setup_names, self.mm_names = set(setup_names), set(mm_names)

    def clear_addin_build(self, cam, logger=None):
        removed = {'setups': [], 'mms': []}
        for coll, key, names in ((cam.setups, 'setups', self.setup_names), (cam.manufacturingModels, 'mms', self.mm_names)):
            for i in range(coll.count - 1, -1, -1):
                it = coll.item(i)
                if it.name in names:
                    removed[key].append(it.name)
                    it.deleteMe()
        logger and logger.log(f"CLEANUP: deleted {len(removed['setups'])} setup(s)", 'INFO')
        return removed


def _doc_with_cam(cam):
    products = types.SimpleNamespace(itemByProductType=lambda t: cam if t == 'CAMProductType' else None)
    return types.SimpleNamespace(parentDocument=types.SimpleNamespace(products=products))


def _patch(monkeypatch, coordinator):
    logged = []
    monkeypatch.setattr(bsg, '_log', lambda msg: logged.append(msg))
    monkeypatch.setattr(bsg, '_cam_coordinator', lambda: coordinator)
    monkeypatch.setattr(bsg.adsk, 'cam', types.SimpleNamespace(CAM=types.SimpleNamespace(cast=lambda p: p)), raising=False)
    return logged


def test_our_setups_and_mms_go_a_user_setup_and_mm_stay(monkeypatch):
    cam = types.SimpleNamespace(setups=_Coll(['B-spline Back', 'My setup', 'B-spline Top']),
                                manufacturingModels=_Coll(['Clean', 'My MM', 'Stamped']))
    logged = _patch(monkeypatch, _FakeCoordinator({'B-spline Back', 'B-spline Top'}, {'Clean', 'Stamped'}))
    removed = bsg._clear_cam_build(_doc_with_cam(cam))
    assert cam.setups.names() == ['My setup']
    assert cam.manufacturingModels.names() == ['My MM']
    assert sorted(removed['setups']) == ['B-spline Back', 'B-spline Top']
    assert sorted(removed['mms']) == ['Clean', 'Stamped']
    summary = [m for m in logged if m.startswith('[CAM CLEAR] removed')]
    assert len(summary) == 1 and 'B-spline Back' in summary[0] and 'Stamped' in summary[0]
    assert any('[CAM CLEAR] INFO: CLEANUP' in m for m in logged)  # the engine's own log lines reach the Send log


def test_a_document_without_cam_is_left_alone(monkeypatch):
    logged = _patch(monkeypatch, _FakeCoordinator(set(), set()))
    assert bsg._clear_cam_build(_doc_with_cam(None)) is None
    assert any('nothing to clear' in m for m in logged)


def test_a_document_that_never_had_cam_raises_and_is_left_alone(monkeypatch):
    # live: itemByProductType('CAMProductType') raised '3 : failed to find product' on a fresh document
    def _raise(t):
        raise RuntimeError('3 : failed to find product')
    doc = types.SimpleNamespace(parentDocument=types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=_raise)))
    logged = _patch(monkeypatch, _FakeCoordinator(set(), set()))
    assert bsg._clear_cam_build(doc) is None
    assert any('nothing to clear (3 : failed to find product)' in m for m in logged)


def test_a_failing_clear_is_logged_and_the_send_goes_on(monkeypatch):
    class _Boom:
        def clear_addin_build(self, cam, logger=None):
            raise RuntimeError('engine missing')
    logged = _patch(monkeypatch, _Boom())
    assert bsg._clear_cam_build(_doc_with_cam(types.SimpleNamespace())) is None
    assert any('[CAM CLEAR] failed: RuntimeError: engine missing' in m for m in logged)


def test_the_send_clears_cam_as_its_own_declared_step_before_removing_the_old_import():
    src = open(os.path.join(_HERE, 'b-spline-gen.py'), encoding='utf-8').read()
    body = src[src.index('    def _handle_generate('):]
    i_stage = body.index("_send_stage('fusionClearCam')")
    i_clear = body.index('_clear_cam_build(des)')
    i_frames = body.index('_delete_frames(des)')
    assert i_stage < i_clear < i_frames
    # inside the non-preview, non-append branch only
    guard = body.rindex('if not is_preview and not is_append:', 0, i_clear)
    assert body.index('_delete_frames(des)', guard) == i_frames
    ids = bsg._fusion_send_stage_ids()
    assert ids.index('fusionClearCam') == ids.index('fusionPrepare') + 1


def test_the_clear_uses_cam_builders_own_declaration():
    # one source of the names: the CAM-builder engine next to this add-in, with the public clear
    path = os.path.join(bsg.CAM_BUILDER_DIR, 'cam_engine', 'cam_coordinator.py')
    src = open(path, encoding='utf-8').read()
    assert 'def clear_addin_build(cam, logger=None):' in src
    assert len(_declared_names()) >= 2

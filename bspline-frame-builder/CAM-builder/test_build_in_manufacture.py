"""H23 item 100 -- BUILD always runs in the Manufacture workspace.

MEASURED live (seat A, 2026-10-06, fresh Fusion, T1 7x9 cam-bricks board): after a re-Send (which leaves the user in
the Design workspace once the doc has CAM), a BUILD started from Design made MMs whose occurrence filter Fusion undid
when APPLY switched to Manufacture -- the B-spline MM held the whole design again, every setup lost its models, APPLY
0/7 "Model has one or more missing selections" (3/3). The same re-Send + BUILD started from Manufacture: 7/7,
toolpaths identical to the first build. acquire_cam succeeds in either workspace once the doc has CAM, so the old
"switch only when acquire fails" never switched in that case.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_build_in_manufacture.py
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_cam_reuse import eng  # noqa: E402,F401  (same adsk stubs + fresh engine import)


def _run(eng, monkeypatch, acquire_ok):
    co, sb, mm = eng.co, eng.sb, eng.mm
    seen = []
    fake_cam = object()
    monkeypatch.setattr(co.cam_workspace, 'activate_manufacture_workspace',
                        lambda app=None, logger=None: seen.append('manufacture') or True)
    monkeypatch.setattr(co.cam_workspace, 'acquire_cam',
                        lambda app=None, logger=None: seen.append('acquire') or (fake_cam if acquire_ok or 'manufacture' in seen else None))
    des = object()
    doc = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: des))
    eng.adsk.fusion.Design = type('Design', (), {'cast': staticmethod(lambda x: x)})
    app = types.SimpleNamespace(activeDocument=doc)
    monkeypatch.setattr(sb, 'ensure_wcs_sketches', lambda d, l=None: seen.append('wcs'))
    monkeypatch.setattr(sb, 'find_reusable_build', lambda cam, names, logger=None: None)
    monkeypatch.setattr(co, '_cleanup_previous_build', lambda cam, logger: seen.append('cleanup'))
    monkeypatch.setattr(mm, 'build_all_mms', lambda cam, d, c, l: seen.append('build_mms') or {r: object() for r in mm.MM_RULES})
    fake_setups = [types.SimpleNamespace(name=s['name']) for s in sb.SETUP_SPECS]
    monkeypatch.setattr(sb, 'build_all_setups', lambda cam, mms, l, **k: seen.append('build_setups') or fake_setups)
    rep = co.run(classifier=None, app=app, logger=None, mode='bspline', skip_templates=True, skip_machine=True)
    return rep, seen


def test_switches_to_manufacture_before_building_even_when_cam_is_already_there(eng, monkeypatch):
    # the re-Send case: the doc has CAM, so acquire would succeed from the Design workspace
    rep, seen = _run(eng, monkeypatch, acquire_ok=True)
    assert rep['ok']
    assert 'manufacture' in seen
    assert seen.index('manufacture') < seen.index('acquire') < seen.index('build_mms')


def test_a_fresh_doc_still_gets_its_cam_product(eng, monkeypatch):
    rep, seen = _run(eng, monkeypatch, acquire_ok=False)
    assert rep['ok'] and rep['cam_acquired']
    assert seen.index('manufacture') < seen.index('build_mms')

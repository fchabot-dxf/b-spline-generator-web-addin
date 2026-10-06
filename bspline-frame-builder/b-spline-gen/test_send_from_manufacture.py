"""
H23 item 99b: a Send from the Manufacture workspace (where the user is after BUILD + APPLY) used to fail at once with
"No active Fusion design" -- every b-spline-gen read of the design was Design.cast(app.activeProduct), and there the
active product is the CAM product (measured live, seat A, 2026-10-06). The design now comes from the active DOCUMENT
(_active_design), and a Send first switches to the Design workspace (the frame-builder engines it runs read
app.activeProduct themselves).
"""
import os
import re
import sys
import types

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_import_failed_no_modal import bsg, _adsk, _SpyPalette, _SpyUI  # noqa: E402  (same fake adsk + loader)


class _Design:
    productType = 'DesignProductType'


class _CamProduct:
    productType = 'CAMProductType'


class _ManufactureApp:
    """Fusion in the Manufacture workspace: the active product is CAM; the document still holds its Design."""
    def __init__(self, palette, design):
        self.activeProduct = _CamProduct()
        self.design = design
        self.switched = []
        products = types.SimpleNamespace(itemByProductType=lambda t: design if t == 'DesignProductType' else None)
        self.activeDocument = types.SimpleNamespace(products=products)

        def _activate():
            self.switched.append('FusionSolidEnvironment')
            self.activeProduct = design
        ws = types.SimpleNamespace(activate=_activate)
        self.userInterface = types.SimpleNamespace(
            palettes=types.SimpleNamespace(itemById=lambda _id: palette),
            workspaces=types.SimpleNamespace(itemById=lambda wid: ws if wid == 'FusionSolidEnvironment' else None))


def _design_cast(obj):
    return obj if isinstance(obj, _Design) else None


class _Stop(Exception):
    pass


def test_a_send_from_manufacture_finds_the_design_and_switches_to_design(monkeypatch):
    palette, design = _SpyPalette(), _Design()
    fake = _ManufactureApp(palette, design)
    monkeypatch.setattr(bsg, 'app', fake)
    monkeypatch.setattr(bsg, 'ui', _SpyUI())
    monkeypatch.setattr(_adsk.fusion, 'Design', types.SimpleNamespace(cast=staticmethod(_design_cast)), raising=False)
    seen = {}

    def _sync(des, params):  # the first thing the Send does with the design: record it, stop there
        seen['des'] = des
        seen['active_product_then'] = fake.activeProduct
        raise _Stop()
    monkeypatch.setattr(bsg, '_sync_user_parameters', _sync)

    bsg.PaletteHTMLEventHandler()._handle_generate({'stepVariants': [], 'frame': None, 'isPreview': False})

    assert seen.get('des') is design
    assert fake.switched == ['FusionSolidEnvironment']
    assert seen['active_product_then'] is design  # switched BEFORE the Send works on the design
    assert not [x for a, x in palette.sent if a == 'import_failed' and 'No active Fusion design' in x]


def test_a_send_already_in_design_does_not_switch(monkeypatch):
    palette, design = _SpyPalette(), _Design()
    fake = _ManufactureApp(palette, design)
    fake.activeProduct = design
    monkeypatch.setattr(bsg, 'app', fake)
    monkeypatch.setattr(_adsk.fusion, 'Design', types.SimpleNamespace(cast=staticmethod(_design_cast)), raising=False)
    assert bsg._ensure_design_workspace() is False
    assert fake.switched == []
    assert bsg._active_design() is design


def test_the_design_comes_from_the_document_even_in_manufacture(monkeypatch):
    design = _Design()
    monkeypatch.setattr(bsg, 'app', _ManufactureApp(_SpyPalette(), design))
    monkeypatch.setattr(_adsk.fusion, 'Design', types.SimpleNamespace(cast=staticmethod(_design_cast)), raising=False)
    assert bsg._active_design() is design


def test_no_read_of_the_active_product_as_the_design_is_left():
    src = open(os.path.join(_HERE, 'b-spline-gen.py'), encoding='utf-8').read()
    reads = [m.start() for m in re.finditer(r'Design\.cast\((?:self\.)?app\.activeProduct\)', src)]
    # only the helpers ask the active product (the helper's fast path, the workspace check)
    a, b = src.index('def _active_design'), src.index('def _ensure_design_workspace')
    end = src.index(chr(10) * 3, b)
    assert len(reads) == 2 and all(a < r < end for r in reads)

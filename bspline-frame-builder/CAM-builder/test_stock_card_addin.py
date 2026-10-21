"""The add-in's side of the Stock card (cam-builder.py), Fred 2026-10-20: the palette's get / set / preview actions. set_stock saves
the three sizes on the Design (Clear removes them); preview_stock_bspline draws a translucent box in custom graphics whose REAL
size (read back from the drawn corners) equals the typed numbers, centred on the panel with its bottom on the model's world bottom.

Run with:
    cd bspline-frame-builder/CAM-builder
    python -m pytest test_stock_card_addin.py
"""
import json
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)

from test_cam_stages import TestTheDeferredBuild as _Harness  # noqa: E402  (the add-in harness: fake adsk, recorded sends)
from test_cam_reuse import _Attrs  # noqa: E402

IN = 2.54


class _Attrs2(_Attrs):
    def add(self, g, n, v):
        super().add(g, n, v)
        self._a[(g, n)].deleteMe = lambda k=(g, n): self._a.pop(k)


class _Group:
    def __init__(self, parent=None):
        self.meshes, self.lines, self.deleted, self.parent = [], [], False, parent

    def addMesh(self, coords, tris, a, b):
        self.meshes.append(coords.flat)
        return types.SimpleNamespace(color=None)

    def addLines(self, coords, idx, closed):
        self.lines.append(coords.flat)
        return types.SimpleNamespace(color=None, weight=None)

    def deleteMe(self):
        self.deleted = True
        if self.parent is not None and self in self.parent:
            self.parent.remove(self)


class _Groups(list):
    def add(self):
        g = _Group(self)
        self.append(g)
        return g

    @property
    def count(self):
        return len(self)

    def item(self, i):
        return self[i]


def _addin(monkeypatch, stock=None, panel=((-4 * IN, -5 * IN, 0.0), (4 * IN, 5 * IN, 0.0))):
    cb, fired, events = _Harness()._module(monkeypatch)
    design = types.SimpleNamespace(attributes=_Attrs2(), rootComponent=types.SimpleNamespace(customGraphicsGroups=_Groups()))
    if stock is not None:
        design.attributes.add('CAMBuilder', 'stock::B-spline', json.dumps(stock))
    doc = types.SimpleNamespace(products=types.SimpleNamespace(itemByProductType=lambda t: design))
    app = cb.adsk.core.Application.get()
    app.activeDocument = doc
    app.activeViewport = None
    cb.adsk.fusion.Design = types.SimpleNamespace(cast=lambda x: x)
    cb.adsk.fusion.CustomGraphicsCoordinates = types.SimpleNamespace(create=lambda flat: types.SimpleNamespace(flat=list(flat)))
    cb.adsk.fusion.CustomGraphicsSolidColorEffect = types.SimpleNamespace(create=lambda c: c)
    cb.adsk.core.Color = types.SimpleNamespace(create=lambda *a: a)
    sent = []
    monkeypatch.setattr(cb, '_send_to_html', lambda action, payload: sent.append((action, payload)))
    sd = cb._engine_module('stock_dims')
    # the panel box (cm): the real design read is the engine's own; here the panel is a 8 x 10 in slab of zero thickness at z 0.081 cm
    mn, mx = list(panel[0]), list(panel[1])
    monkeypatch.setattr(sd, 'panel_bbox_cm', lambda d: (tuple(mn), tuple(mx)))
    return cb, design, sent, sd


def test_set_stock_saves_the_three_sizes_on_the_design_and_reports_the_card(monkeypatch):
    cb, design, sent, sd = _addin(monkeypatch)
    cb._dispatch_palette_action('set_stock', {'dims': [7.5, 9.5, 1.5]})
    assert sd.load(design) == (7.5, 9.5, 1.5)
    assert sent[-1][0] == 'stock_info' and sent[-1][1]['dims'] == [7.5, 9.5, 1.5]


def test_clear_removes_the_saved_stock_so_the_default_applies(monkeypatch):
    cb, design, sent, sd = _addin(monkeypatch, stock=[7.5, 9.5, 1.5])
    cb._dispatch_palette_action('set_stock', {'dims': None})
    assert sd.load(design) is None and sent[-1][1]['dims'] is None


def test_get_stock_reports_the_saved_box_the_default_and_what_the_part_needs(monkeypatch):
    cb, design, sent, sd = _addin(monkeypatch, stock=[7.5, 9.5, 1.5])
    monkeypatch.setattr(sd, 'part_extent_in', lambda d: {'x': 8.1, 'y': 10.1, 'z': 0.5})
    cb._dispatch_palette_action('get_stock', {})
    action, p = sent[-1]
    assert action == 'stock_info' and p['dims'] == [7.5, 9.5, 1.5] and p['needs'] == {'x': 8.1, 'y': 10.1, 'z': 0.5}
    assert p['default'] == [9.0, 11.0, 2.0]                       # the panel (8 x 10 in) + 1 in, 2 in tall


def test_the_preview_draws_a_box_whose_real_size_is_the_typed_numbers(monkeypatch):
    cb, design, sent, sd = _addin(monkeypatch)
    cb._dispatch_palette_action('preview_stock_bspline', {'dims': [7.5, 9.5, 1.5]})
    (grp,) = design.rootComponent.customGraphicsGroups
    pts = [grp.meshes[0][i:i + 3] for i in range(0, len(grp.meshes[0]), 3)]
    size = [(max(p[k] for p in pts) - min(p[k] for p in pts)) / IN for k in range(3)]
    assert [round(v, 4) for v in size] == [7.5, 9.5, 1.5]          # measured from the drawn corners, not from the request
    assert [round(min(p[2] for p in pts), 6), round((min(p[0] for p in pts) + max(p[0] for p in pts)) / 2, 6)] == [0.0, 0.0]   # bottom on the model bottom, centred
    assert len(grp.lines) == 12                                    # the 12 crisp edges
    assert sent[-1][0] == 'stock_preview' and sent[-1][1]['drawn_in'] == [7.5, 9.5, 1.5]


def test_an_empty_card_draws_nothing_unless_preview_asks_for_the_default(monkeypatch):
    cb, design, sent, sd = _addin(monkeypatch)
    cb._dispatch_palette_action('preview_stock_bspline', {'dims': None})
    assert len(design.rootComponent.customGraphicsGroups) == 0
    cb._dispatch_palette_action('preview_stock_bspline', {'dims': None, 'showDefault': True})
    assert sent[-1][1]['drawn_in'] == [9.0, 11.0, 2.0]


def test_a_new_preview_replaces_the_old_one_and_clear_removes_it(monkeypatch):
    cb, design, sent, sd = _addin(monkeypatch)
    cb._dispatch_palette_action('preview_stock_bspline', {'dims': [7.5, 9.5, 1.5]})
    cb._dispatch_palette_action('preview_stock_bspline', {'dims': [8, 10, 2]})
    assert len(design.rootComponent.customGraphicsGroups) == 1
    cb._dispatch_palette_action('preview_clear', {})
    assert len(design.rootComponent.customGraphicsGroups) == 0

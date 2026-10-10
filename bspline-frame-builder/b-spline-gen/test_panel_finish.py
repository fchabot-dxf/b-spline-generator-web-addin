"""
2026-10-10 (Fred): the B-spline panel keeps its per-component colour (Stamped green, Clean red) but MATTE and a shade
darker, so the stone relief reads (panel_finish.py). Pinned with fakes: the declared table, one matte copy per
component per design (reused on the next Send), the colour set on it, the bodies given it with their face overrides
cleared, any other component untouched, and a missing base appearance / colour property never failing the Send.

Run with:
    cd bspline-frame-builder/b-spline-gen
    python -m pytest test_panel_finish.py
"""
import os
import sys

_HERE = os.path.dirname(os.path.realpath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import panel_finish as pf  # noqa: E402


class Prop:
    def __init__(self):
        self.value = None


class Props:
    def __init__(self, ids):
        self._p = {i: Prop() for i in ids}

    def itemById(self, i):
        return self._p.get(i)


class Appearance:
    def __init__(self, name, prop_ids=('opaque_albedo',)):
        self.name = name
        self.appearanceProperties = Props(prop_ids)


class Appearances:
    def __init__(self, items=()):
        self.items = {a.name: a for a in items}
        self.copies = []

    def itemByName(self, n):
        return self.items.get(n)

    def addByCopy(self, base, name):
        a = Appearance(name, tuple(base.appearanceProperties._p))
        self.items[name] = a
        self.copies.append((base.name, name))
        return a


class Face:
    def __init__(self, body, override=None):
        self._body, self._override = body, override

    @property
    def appearance(self):  # Fusion reads back the EFFECTIVE appearance: the override, else the body's
        return self._override or self._body.appearance

    @appearance.setter
    def appearance(self, v):
        self._override = v


class Body:
    def __init__(self, name, step_colour, n_override_faces=2, n_plain=4):
        self.name, self.appearance = name, step_colour
        self.faces = [Face(self, step_colour) for _ in range(n_override_faces)] + [Face(self) for _ in range(n_plain)]


class Comp:
    def __init__(self, name, bodies):
        self.name, self.bRepBodies = name, bodies


class Occ:
    def __init__(self, comp):
        self.component = comp


GREEN = Appearance('Opaque(51,204,51)')
RED = Appearance('Opaque(204,51,51)')


def _setup(base_props=('opaque_albedo',)):
    lib = type('Lib', (), {})()
    lib.appearances = Appearances([Appearance(pf.PANEL_FINISH_BASE, base_props)])
    des = type('Des', (), {})()
    des.appearances = Appearances()
    occs = [Occ(Comp('Clean', [Body('panel', RED), Body('surface', RED, 1, 0)])),
            Occ(Comp('Stamped', [Body('panel', GREEN), Body('surface', GREEN, 1, 0)])),
            Occ(Comp('Frame_1', [Body('frame_top', Appearance('Ash'))]))]
    return lib, des, occs


def test_the_declared_finish():
    assert pf.PANEL_FINISH_BASE == 'Plastic - Matte (Gray)'
    assert pf.PANEL_FINISH == {'Stamped': (40, 165, 40), 'Clean': (165, 40, 40)}
    for rgb, step in ((pf.PANEL_FINISH['Stamped'], (51, 204, 51)), (pf.PANEL_FINISH['Clean'], (204, 51, 51))):
        assert sum(rgb) < sum(step) and max(rgb) == rgb[step.index(max(step))]  # darker, same hue channel


def test_each_component_gets_its_matte_copy_coloured_and_overrides_cleared():
    lib, des, occs = _setup()
    done = pf.apply_panel_finish(occs, des, lib, lambda r, g, b: (r, g, b))
    assert des.appearances.copies == [('Plastic - Matte (Gray)', 'B-Spline Clean (matte)'), ('Plastic - Matte (Gray)', 'B-Spline Stamped (matte)')]
    st = des.appearances.items['B-Spline Stamped (matte)']
    assert st.appearanceProperties.itemById('opaque_albedo').value == (40, 165, 40)
    assert des.appearances.items['B-Spline Clean (matte)'].appearanceProperties.itemById('opaque_albedo').value == (165, 40, 40)
    stamped = occs[1].component.bRepBodies
    assert all(b.appearance is st for b in stamped) and all(f.appearance is st for b in stamped for f in b.faces)
    assert done == [('Clean', 'panel', 2), ('Clean', 'surface', 1), ('Stamped', 'panel', 2), ('Stamped', 'surface', 1)]
    assert occs[2].component.bRepBodies[0].appearance.name == 'Ash'  # the frame: untouched


def test_the_copy_is_made_once_per_design_and_reused_on_the_next_send():
    lib, des, occs = _setup()
    pf.apply_panel_finish(occs, des, lib, lambda *c: c)
    _, _, occs2 = _setup()
    pf.apply_panel_finish(occs2, des, lib, lambda *c: c)
    assert len(des.appearances.copies) == 2
    assert occs2[1].component.bRepBodies[0].appearance is des.appearances.items['B-Spline Stamped (matte)']


def test_a_missing_base_or_colour_property_never_fails_the_send():
    lib, des, occs = _setup()
    lib.appearances.items.clear()
    logs = []
    assert pf.apply_panel_finish(occs, des, lib, lambda *c: c, logs.append) == []
    assert occs[1].component.bRepBodies[0].appearance is GREEN and any('not found' in l for l in logs)
    lib, des, occs = _setup(base_props=('something_else',))
    logs = []
    pf.apply_panel_finish(occs, des, lib, lambda *c: c, logs.append)
    assert any('no colour property' in l for l in logs)

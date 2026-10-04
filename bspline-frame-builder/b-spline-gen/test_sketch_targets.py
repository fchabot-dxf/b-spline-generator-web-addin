"""
turn 193 (Fred's live Send 16:21): F35 item 12 sent EVERY art-layer sketch to the Stamped (Carved)
component and skipped them all when the Send had none -- a Send with only non-carving layers lost all
its art. The rule now: a CARVING layer's sketch -> the Carved component; every other exported layer's
sketch -> root (the Send's own top, as before item 12). No Carved component skips ONLY the carving
sketches. Same for the Bricks sketch (item 11). The decision is declared on each import-plan step
(`target`, _assign_sketch_targets), so it is tested here without Fusion.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from test_colour_decal_handler import bsg, _FakeOcc, _import_group, _stamped_occ, _FakeBody  # noqa: E402
from test_bricks_sketch_handler import _FakeSketches  # noqa: E402

import pytest  # noqa: E402


def _layer(idx, carve=None, depth=0.1, manifest=None, svg='<svg/>'):
    cfg = {'profile': 'flat', 'depth': depth}
    if carve is not None:
        cfg['carve'] = carve
    out = {'index': idx, 'config': cfg, 'svg': svg}
    if manifest:
        out['sketchManifest'] = manifest
    return out


def _targets(layers):
    return [step['target'] for step in bsg._ordered_svg_layer_import_plan(layers, True)]


class TestPlanTargets:
    def test_carving_layer_goes_carved_non_carving_goes_root(self):
        assert _targets([_layer(1, carve=True), _layer(2, carve=False)]) == ['carved', 'root']

    def test_no_carve_key_falls_back_to_depth(self):
        assert _targets([_layer(1, depth=0.25), _layer(2, depth=0)]) == ['carved', 'root']

    def test_a_pattern_stays_together_carved_if_any_kind_carves(self):
        m = lambda kind, order: {'patternId': 'P1', 'kind': kind, 'buildOrder': order}  # noqa: E731
        layers = [_layer(1, carve=False, manifest=m('contour', 0), svg=''),
                  _layer(2, carve=True, manifest=m('rails', 1), svg=''),
                  _layer(3, carve=False, manifest={'patternId': 'P1', 'kind': 'boundary', 'buildOrder': 2}, svg='')]
        assert _targets(layers) == ['carved', 'carved', 'carved']

    def test_a_pattern_with_no_carving_kind_goes_root(self):
        m = lambda kind, order: {'patternId': 'P2', 'kind': kind, 'buildOrder': order}  # noqa: E731
        assert _targets([_layer(1, carve=False, manifest=m('contour', 0)), _layer(2, carve=False, manifest=m('rails', 1))]) == ['root', 'root']


class _Recorder:
    """A fake handler `self`: records which component each sketch import lands in."""
    def __init__(self):
        self.imports = []

    def _compute_artwork_plane(self, target, name, top_face, orientation='z-up'):
        return ('plane', target, name)

    def _import_single_layer_svg(self, target, svg, plane, name, params, full_name=None):
        self.imports.append((target, name))

    def _build_constrained_sketch_for_layer(self, target, design, manifest, name, plane, ctx=None, kind_to_sketch=None):
        self.imports.append((target, name))
        return ctx


_BODYLESS = types.SimpleNamespace(bRepBodies=types.SimpleNamespace(count=0))


class TestImportAllSvgLayers:
    def test_no_stamped_variant_one_non_carving_layer_gives_one_root_sketch(self, monkeypatch):
        logs = []
        monkeypatch.setattr(bsg, '_log', logs.append)
        root = object()
        rec = _Recorder()
        stamp = {'layers': [_layer(1, carve=False)]}
        bsg.PaletteHTMLEventHandler._import_all_svg_layers(rec, {'carved': None, 'root': root}, _BODYLESS, stamp, 'z-up', {}, None)
        assert rec.imports == [(root, 'L1 - flat (0.1")')]
        assert not any('skipped' in m for m in logs)

    def test_no_stamped_variant_skips_only_the_carving_sketch(self, monkeypatch):
        logs = []
        monkeypatch.setattr(bsg, '_log', logs.append)
        root = object()
        rec = _Recorder()
        stamp = {'layers': [_layer(1, carve=True), _layer(2, carve=False)]}
        bsg.PaletteHTMLEventHandler._import_all_svg_layers(rec, {'carved': None, 'root': root}, _BODYLESS, stamp, 'z-up', {}, None)
        assert [t for t, _ in rec.imports] == [root]
        assert any('skipped carving sketches only' in m and 'L1' in m for m in logs)

    def test_with_a_stamped_variant_each_layer_lands_in_its_own_home(self):
        carved, root = object(), object()
        rec = _Recorder()
        stamp = {'layers': [_layer(1, carve=True), _layer(2, carve=False)]}
        bsg.PaletteHTMLEventHandler._import_all_svg_layers(rec, {'carved': carved, 'root': root}, _BODYLESS, stamp, 'z-up', {}, None)
        assert [t for t, _ in rec.imports] == [carved, root]


def _with_sketches(comp):
    comp.sketches = _FakeSketches()
    return comp


class TestBricksSketchTarget:
    def _group(self, stamped=True):
        children = [_stamped_occ(_FakeBody('panel'))] if stamped else []
        group = _import_group(children)
        _with_sketches(group.component)
        for occ in children:
            _with_sketches(occ.component)
        return group

    def test_non_carving_bricks_with_no_stamped_variant_land_on_root(self):
        rec = _Recorder()
        group = self._group(stamped=False)
        bsg.PaletteHTMLEventHandler._apply_bricks_sketch(rec, group, {'bricks': {'enabled': True, 'carve': False, 'svg': '<svg/>'}}, {})
        assert rec.imports == [(group.component, 'Bricks')]

    def test_carving_bricks_go_to_the_stamped_component(self):
        rec = _Recorder()
        group = self._group(stamped=True)
        stamped = group.childOccurrences._items[0].component if hasattr(group.childOccurrences, '_items') else None
        bsg.PaletteHTMLEventHandler._apply_bricks_sketch(rec, group, {'bricks': {'enabled': True, 'carve': True, 'svg': '<svg/>'}}, {})
        assert len(rec.imports) == 1 and rec.imports[0][0] is not group.component
        if stamped is not None:
            assert rec.imports[0][0] is stamped

    def test_no_carve_key_keeps_item_11_behaviour_skip_without_stamped(self):
        rec = _Recorder()
        bsg.PaletteHTMLEventHandler._apply_bricks_sketch(rec, self._group(stamped=False), {'bricks': {'enabled': True, 'svg': '<svg/>'}}, {})
        assert rec.imports == []

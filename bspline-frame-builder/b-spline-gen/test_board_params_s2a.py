"""
Send targets S2a (seat A 2026-10-14; advisor 45, Fred): a tagged board's own user parameters are named through ONE
declared BoardNamer (fb_engine.board_scope) -- "<boardId>_widthIn", a lattice layer's "<boardId>_L<layer>_rail_width".
Fred's rules, pinned here:
  1. stable names: the prefix is the board's assigned id, so a re-send at another size updates the SAME names;
  2. Fred's own params (any name outside the board's declared set) are never renamed, rewritten or deleted;
  3. the legacy root board is the identity -- a legacy Send names everything exactly as before.
"""
import os
import sys
import types

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, _HERE)
_FB = os.path.join(os.path.dirname(_HERE), 'frame-builder')
if _FB not in sys.path:
    sys.path.insert(0, _FB)

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (same adsk stubs + loader)
from fb_engine.board_scope import BoardNamer, board_param_prefix, lattice_layer_prefix  # noqa: E402
from param_ownership import compute_stale_params  # noqa: E402

import pytest  # noqa: E402

BOARD = BoardNamer(board_param_prefix('ka1b2c3d'))
LEGACY = BoardNamer('', [board_param_prefix('ka1b2c3d')])


def test_the_namer_rewrites_only_the_declared_names():
    m = {**BOARD.mapping(['widthIn']), **BOARD.child(lattice_layer_prefix('3')).mapping(['stroke_width'])}
    assert m == {'widthIn': 'ka1b2c3d_widthIn', 'stroke_width': 'ka1b2c3d_L3_stroke_width'}
    expr = 'widthIn/2 - stroke_width + sqrt(widthIn) - 0.1 in + fred_offset + widthInX'
    assert BoardNamer.rename(expr, m) == ('ka1b2c3d_widthIn/2 - ka1b2c3d_L3_stroke_width + sqrt(ka1b2c3d_widthIn)'
                                          ' - 0.1 in + fred_offset + widthInX')  # functions / units / Fred's: kept
    assert BOARD.base('ka1b2c3d_widthIn') == 'widthIn' and BOARD.name('ka1b2c3d_widthIn') == 'ka1b2c3d_widthIn'


def test_the_legacy_namer_is_the_identity_and_owns_no_boards_names():
    assert LEGACY.is_identity and LEGACY.name('widthIn') == 'widthIn'
    assert BoardNamer.rename('widthIn/2', LEGACY.mapping(['widthIn'])) == 'widthIn/2'
    assert LEGACY.owns('widthIn') and LEGACY.owns('fred_offset') and not LEGACY.owns('ka1b2c3d_widthIn')
    assert BOARD.owns('ka1b2c3d_L3_rail_width') and not BOARD.owns('widthIn')


# ---- the board's params through Fusion's userParameters (fakes in the real shape) -------------------------------
class Param:
    def __init__(self, coll, name, expression):
        self.coll, self.name, self.expression = coll, name, expression
        self.attributes = types.SimpleNamespace(add=lambda *a: None, itemByName=lambda *a: None)
        self.dependentParameters = types.SimpleNamespace(count=0)

    @property
    def value(self):
        return float(str(self.expression).split()[0]) * 2.54

    def deleteMe(self):
        self.coll.items.remove(self)
        self.coll.deleted.append(self.name)


class Params:
    def __init__(self, *items):
        self.items, self.deleted = [], []
        for n, e in items:
            self.items.append(Param(self, n, e))

    def itemByName(self, name):
        return next((p for p in self.items if p.name == name), None)

    def add(self, name, value_input, unit, comment):
        p = Param(self, name, getattr(value_input, 'text', str(value_input)))
        self.items.append(p)
        return p

    def __iter__(self):
        return iter(list(self.items))

    def names(self):
        return sorted(p.name for p in self.items)


@pytest.fixture
def adsk_vi(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg.adsk.core, 'ValueInput', types.SimpleNamespace(createByString=lambda t: types.SimpleNamespace(text=t)), raising=False)
    monkeypatch.setattr(bsg, '_ensure_bspline_param_tag', lambda p, n: None)


def test_a_board_resent_at_another_size_updates_the_same_names(adsk_vi):
    d = types.SimpleNamespace(userParameters=Params(('widthIn', '7')))  # the legacy board's, untouched
    bsg._sync_user_parameters(d, {'widthIn': 9, 'heightIn': 12}, BOARD)
    assert d.userParameters.names() == ['ka1b2c3d_heightIn', 'ka1b2c3d_widthIn', 'widthIn']
    bsg._sync_user_parameters(d, {'widthIn': 10, 'heightIn': 14}, BOARD)  # the re-send, another size
    assert d.userParameters.names() == ['ka1b2c3d_heightIn', 'ka1b2c3d_widthIn', 'widthIn']  # no "widthIn2", no duplicate
    assert d.userParameters.itemByName('ka1b2c3d_widthIn').expression == '10'
    assert d.userParameters.itemByName('widthIn').expression == '7'


def test_the_legacy_board_syncs_exactly_the_old_names(adsk_vi):
    d = types.SimpleNamespace(userParameters=Params())
    bsg._sync_user_parameters(d, {'widthIn': 7, 'heightIn': 9}, BoardNamer())
    assert d.userParameters.names() == ['heightIn', 'widthIn']


def test_a_lattice_manifest_is_named_for_its_board_and_layer():
    manifest = {'layerId': '3', 'parameters': [{'name': 'stroke_width', 'value': 0.07, 'unit': 'in'},
                                              {'name': 'lattice_spacing', 'value': 0.25, 'unit': 'in'}],
                'dimensions': [{'type': 'SlotWidth', 'target': 'rail0', 'expression': 'stroke_width'},
                               {'type': 'Distance', 'target': 'c', 'expression': 'contour_height - stroke_width + widthIn/2'},
                               {'type': 'Radius', 'target': 'n', 'expression': 'fred_radius'}]}
    out = bsg._scoped_manifest(manifest, BOARD)
    assert [p['name'] for p in out['parameters']] == ['ka1b2c3d_L3_stroke_width', 'ka1b2c3d_L3_lattice_spacing']
    assert [d['expression'] for d in out['dimensions']] == [
        'ka1b2c3d_L3_stroke_width',
        'contour_height - ka1b2c3d_L3_stroke_width + ka1b2c3d_widthIn/2',  # contour_height: not this manifest's
        'fred_radius']
    assert manifest['parameters'][0]['name'] == 'stroke_width'  # the payload's own copy is not mutated
    assert bsg._scoped_manifest(manifest, BoardNamer()) is manifest  # legacy: identity


# ---- the stale pass, scoped ---------------------------------------------------------------------------------------
def _stale(params, payload, namer):
    return compute_stale_params(params, payload, owns=namer.owns, base=lambda n: bsg._registry_base(namer, n))


def test_a_boards_stale_pass_deletes_only_its_own_declared_leftovers():
    ps = Params(('ka1b2c3d_L3_tie_width', '0.1'), ('ka1b2c3d_L3_stroke_width', '0.1'),
                ('kz9_L1_tie_width', '0.1'), ('tie_width', '0.1'), ('fred_offset', '1'), ('ka1b2c3d_fred', '1'))
    res = _stale(ps, {'ka1b2c3d_L3_stroke_width', 'ka1b2c3d_widthIn'}, BOARD)
    assert res['deleted'] == ['ka1b2c3d_L3_tie_width']  # this board's stale lattice param only
    assert ps.names() == ['fred_offset', 'ka1b2c3d_L3_stroke_width', 'ka1b2c3d_fred', 'kz9_L1_tie_width', 'tie_width']


def test_the_legacy_stale_pass_never_touches_a_boards_params():
    ps = Params(('ka1b2c3d_L3_tie_width', '0.1'), ('tie_width', '0.1'), ('fred_offset', '1'))
    res = _stale(ps, {'widthIn'}, LEGACY)
    assert res['deleted'] == ['tie_width']
    assert ps.names() == ['fred_offset', 'ka1b2c3d_L3_tie_width']


def test_a_fred_dim_naming_a_board_param_keeps_it():
    """Fred's own dimension expression "ka1b2c3d_widthIn / 3" makes it a dependent: never deleted (and it is in the
    payload anyway on a re-send)."""
    ps = Params(('ka1b2c3d_L3_node_diameter', '0.2'))
    ps.items[0].dependentParameters = types.SimpleNamespace(count=1)
    assert _stale(ps, set(), BOARD)['deleted'] == []

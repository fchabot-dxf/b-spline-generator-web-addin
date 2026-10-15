"""
Send targets S1 (seat A 2026-10-14; advisor 45, Fred): one Send menu -- replace / newComponent / newDocument -- and a
Send that builds into ONE board and clears only that board (send_targets.py + fb_engine.board_scope). The legacy
root board (no tagged board in the design) is today's Send, unchanged.
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
import send_targets as st  # noqa: E402
from fb_engine.board_scope import BoardScope, BOARD_ATTR  # noqa: E402

import pytest  # noqa: E402


# ---- declared targets ---------------------------------------------------------------------------------------------
def test_the_three_targets_are_declared_once_and_an_unknown_one_is_refused():
    assert list(st.SEND_TARGET_PLAN) == ['replace', 'newComponent', 'newDocument']
    assert st.send_target_of({}) == 'replace'  # today's Send
    assert st.send_target_of({'target': 'newDocument'}) == 'newDocument'
    with pytest.raises(ValueError):
        st.send_target_of({'target': 'nowhere'})


def test_the_board_and_the_locked_items_read_from_the_payload():
    assert st.board_of({}) == {'id': '', 'name': 'Board'}
    assert st.board_of({'board': {'id': 'k3x', 'name': ' Rose 9x12 '}}) == {'id': 'k3x', 'name': 'Rose 9x12'}
    assert st.locked_of({'locked': ['Bricks', '', None, 'B-Spline Set']}) == {'Bricks', 'B-Spline Set'}
    assert st.is_locked('Bricks', {'Bricks'}) and not st.is_locked('Bricks', set())


def test_a_new_board_sits_past_the_right_most_content():
    assert st.new_board_offset_in(None, 7) == 0.0  # an empty design: at the origin
    assert st.new_board_offset_in(3.5, 9) == 3.5 + st.BOARD_SPACING_IN + 4.5  # centred on its own origin


# ---- fakes ----------------------------------------------------------------------------------------------------------
class Attrs:
    def __init__(self, **tags):
        self.tags = tags

    def itemByName(self, group, name):
        v = self.tags.get(f'{group}.{name}')
        return types.SimpleNamespace(value=v) if v is not None else None


class Comp:
    def __init__(self, name, **tags):
        self.name, self.attributes, self.children = name, Attrs(**tags), []

    @property
    def occurrences(self):
        return [Occ(c) for c in self.children]

    @property
    def allOccurrences(self):
        return [o for c in self.children for o in [Occ(c)] + c.allOccurrences]


class Occ:
    deleted = []
    isValid = True  # as a live occurrence reads

    def __init__(self, comp, ctx=None):
        self.component, self.assemblyContext = comp, ctx

    def __eq__(self, other):
        return isinstance(other, Occ) and other.component is self.component

    def deleteMe(self):
        Occ.deleted.append(self.component.name)


class Design:
    def __init__(self):
        self.rootComponent = Comp('(Root)')
        self.attrs = []

    def findAttributes(self, group, name):
        return [a for a in self.attrs if (a.groupName, a.name) == (group, name)]

    def board(self, name, bid):
        b = Comp(name, **{'Bspline.board': bid})
        self.rootComponent.children.append(b)
        self.attrs.append(types.SimpleNamespace(groupName=BOARD_ATTR[0], name=BOARD_ATTR[1], value=bid, parent=b))
        return b


@pytest.fixture
def design(monkeypatch):
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    Occ.deleted = []
    d = Design()
    d.legacy_set = Comp('B-Spline Set', **{'Bspline.set': '1'})
    d.rootComponent.children.append(d.legacy_set)
    d.a = d.board('Rose', 'bRose')
    d.a_set = Comp('B-Spline Set', **{'Bspline.set': '1'})
    d.a.children.append(d.a_set)
    return d


# ---- scoped clears ----------------------------------------------------------------------------------------------------
def test_a_boards_replace_finds_only_its_own_set_and_the_legacy_one_never_a_boards(design):
    a = BoardScope(design, design.a)
    assert [o.component for o in bsg._bspline_set_occurrences(design, a)] == [design.a_set]
    legacy = BoardScope(design)
    assert [o.component for o in bsg._bspline_set_occurrences(design, legacy)] == [design.legacy_set]


def test_a_locked_set_is_kept(design):
    assert bsg._delete_bspline_sets(design, BoardScope(design, design.a), {'B-Spline Set'}) == 0
    assert Occ.deleted == []
    assert bsg._delete_bspline_sets(design, BoardScope(design, design.a), set()) == 1
    assert Occ.deleted == ['B-Spline Set']


def test_replace_resolves_the_projects_tagged_board_else_the_legacy_board(design):
    s = bsg._resolve_send_scope(design, 'replace', {'id': 'bRose', 'name': 'Rose'}, {})
    assert s.is_board and s.host is design.a
    s = bsg._resolve_send_scope(design, 'replace', {'id': 'bOther', 'name': 'X'}, {})
    assert not s.is_board and s.host is design.rootComponent
    s = bsg._resolve_send_scope(design, 'replace', {'id': '', 'name': 'Board'}, {})
    assert not s.is_board


def test_a_new_component_creates_its_tagged_board(design, monkeypatch):
    made = []

    def fake_create(des, board, width_in):
        made.append((board, width_in))
        return design.board(board['name'], board['id'])
    monkeypatch.setattr(bsg, '_create_board', fake_create)
    s = bsg._resolve_send_scope(design, 'newComponent', {'id': 'bNew', 'name': 'Oak'}, {'widthIn': 7})
    assert made == [({'id': 'bNew', 'name': 'Oak'}, 7.0)]
    assert s.is_board and s.host.name == 'Oak'


def test_a_boards_core_body_is_found_under_that_board_in_root_context(design):
    panel = types.SimpleNamespace(name=bsg.PANEL_BODY_NAME, isSolid=True)
    clean = Occ(Comp(bsg.CLEAN_COMPONENT_NAME + ' (1)'))  # MEASURED live: a second board's names get " (N)"
    clean.bRepBodies = [panel]
    design.a_set.name = 'B-Spline Set (1)'
    a_set_occ = Occ(design.a_set, ctx=Occ(design.a))
    a_set_occ.childOccurrences = [clean]
    other = Occ(Comp(bsg.BSPLINE_SET_NAME), ctx=Occ(Comp('Another board')))
    other.childOccurrences = []
    root = types.SimpleNamespace(allOccurrences=[other, a_set_occ], occurrences=[])
    des = types.SimpleNamespace(rootComponent=root)
    scope = types.SimpleNamespace(is_board=True, host=design.a)
    assert bsg._find_bspline_core_body(des, scope) is panel


# ---- the Send's order of things (source-level, as test_send_clears_cam.py) -------------------------------------
_SRC = open(os.path.join(_HERE, 'b-spline-gen.py'), encoding='utf-8').read()
_GEN = _SRC[_SRC.index('    def _handle_generate('):_SRC.index('    def _import_all_svg_layers(')]


def test_a_new_document_is_made_before_the_design_is_read():
    assert _GEN.index('_new_send_document()') < _GEN.index('des = _active_design()')


def test_only_replace_clears_and_only_the_legacy_board_clears_cam():
    i_scope = _GEN.index("scope = _resolve_send_scope(des, target, board, data.get('params', {}))")
    i_replace = _GEN.index("if target == 'replace':", i_scope)
    i_cam = _GEN.index('_clear_cam_build(des)')
    assert i_scope < i_replace < _GEN.index('if not scope.is_board:', i_replace) < i_cam
    assert _GEN.index('_delete_bspline_sets(des, scope, locked)') > i_replace


def test_the_set_is_built_inside_the_boards_host_and_the_frame_gets_the_scope():
    assert 'current_import_group = _set_occurrence_in_root_context(' in _GEN
    assert 'scope, scope.host.occurrences.addNewComponent(' in _GEN
    assert 'self._handle_send_frame(frame_payload, scope)' in _GEN


def test_a_boards_set_occurrence_is_used_in_root_context():
    """MEASURED live (S1 check): the native occurrence inside a board failed _in_active_design, so the STEP import
    fell back to the root and the board stayed empty."""
    native = types.SimpleNamespace(createForAssemblyContext=lambda occ: ('proxy through', occ))
    board = types.SimpleNamespace(is_board=True, host='board-comp', root_occurrence_of=lambda c: f'root occ of {c}')
    assert bsg._set_occurrence_in_root_context(board, native) == ('proxy through', 'root occ of board-comp')
    legacy = types.SimpleNamespace(is_board=False)
    assert bsg._set_occurrence_in_root_context(legacy, native) is native  # the legacy root board: unchanged


def test_fusions_duplicate_suffix_is_not_part_of_the_declared_name():
    assert bsg._base_component_name('B-Spline Set (1)') == 'B-Spline Set'
    assert bsg._base_component_name('Clean (12)') == 'Clean'
    assert bsg._base_component_name('Clean') == 'Clean'
    assert bsg._base_component_name('Frame (A)') == 'Frame (A)'

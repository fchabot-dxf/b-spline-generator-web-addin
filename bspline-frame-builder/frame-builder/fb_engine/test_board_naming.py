"""Send targets S2b (seat A 2026-10-14; advisor 45, Fred): a board's FRAME params carry the board's names at the
Fusion boundary. The frame builder keeps its plain names inside (units by en_/ck_, board-owned checks, the UI's
active_vars); fusion_name / fusion_expr / board_params apply the board's namer only inside the naming context
send_frame opens for one build, and only to the names that build declares -- Fred's own names never. Outside it,
and for the legacy board, they are the identity (legacy builds byte-identical).
"""
import os
import sys
import types

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if "adsk" not in sys.modules:  # dimensions imports adsk at module level (same minimal stub as test_board_scope)
    _adsk = types.ModuleType("adsk")
    _adsk.core, _adsk.fusion = types.ModuleType("adsk.core"), types.ModuleType("adsk.fusion")
    sys.modules.update({"adsk": _adsk, "adsk.core": _adsk.core, "adsk.fusion": _adsk.fusion})
if "adsk.cam" not in sys.modules:
    sys.modules["adsk.cam"] = sys.modules["adsk"].cam = types.ModuleType("adsk.cam")
from fb_engine import dimensions  # noqa: E402,F401  (at collection, like every other test importing fb_engine)
from fb_engine.test_send_frame import World, send_bspline, Body, Log, payload, Comp  # noqa: E402  (shared fakes)
from fb_engine import send_frame as sf  # noqa: E402
from fb_engine.template_resolver import resolve_template  # noqa: E402
from fb_engine.board_scope import (BoardNamer, naming, fusion_name, fusion_expr, ScopedUserParams,  # noqa: E402
                                   board_param_prefix, FRAME_SEND_PARAMS)

KB = BoardNamer(board_param_prefix('kb000001'))


def test_outside_a_boards_build_every_helper_is_the_identity():
    assert fusion_name('frame_thickness') == 'frame_thickness'
    assert fusion_expr('widthIn/2 - frame_thickness') == 'widthIn/2 - frame_thickness'
    with naming(BoardNamer(), {'frame_thickness'}):  # the legacy board's namer
        assert fusion_name('frame_thickness') == 'frame_thickness'


def test_inside_a_boards_build_only_the_declared_names_are_renamed_and_the_context_restores():
    with naming(KB, {'frame_thickness', 'widthIn'}):
        assert fusion_name('frame_thickness') == 'kb000001_frame_thickness'
        assert fusion_name('fred_param') == 'fred_param'  # not declared by this build: Fred's own
        assert fusion_expr('widthIn/2 - frame_thickness + fred_param * 2 in') == \
            'kb000001_widthIn/2 - kb000001_frame_thickness + fred_param * 2 in'
        with naming(BoardNamer(), {'frame_thickness'}):
            assert fusion_name('frame_thickness') == 'frame_thickness'
        assert fusion_name('frame_thickness') == 'kb000001_frame_thickness'
    assert fusion_name('frame_thickness') == 'frame_thickness'


def test_the_scoped_user_params_take_plain_names():
    seen = []
    real = types.SimpleNamespace(itemByName=lambda n: seen.append(('get', n)), add=lambda n, *a: seen.append(('add', n)),
                                 count=3)
    ups = ScopedUserParams(real)
    with naming(KB, {'panel_lip'}):
        ups.itemByName('panel_lip')
        ups.add('panel_lip', 'vi', 'in', 'c')
    ups.itemByName('panel_lip')
    assert seen == [('get', 'kb000001_panel_lip'), ('add', 'kb000001_panel_lip'), ('get', 'panel_lip')]
    assert ups.count == 3


class BoardScopeStub:
    """A tagged board's scope over the shared World fakes (it owns every fake component)."""
    is_board = True
    namer = KB

    def owns(self, comp):
        return True

    def has_boards(self):
        return True


def test_send_frame_names_the_build_for_its_board_and_closes_the_context():
    w = World()
    send_bspline(w)
    seen = {}

    def sketch(style_id, external_logger, data):
        seen['sketch'] = (fusion_name('frame_thickness'), fusion_name('widthIn'), fusion_name('ck_arc_shoulder_weld'),
                          fusion_expr('heightIn/14 - boundingboxoffset'), fusion_name('fred_param'))
        comp = Comp(w, 'Frame_2')
        w.components.append(comp)
        comp.attributes.add('FrameBuilder', 'ComponentType', 'Frame')
        w.add_item(' Frame_2:1', w.root, creates=comp)
        return {'ok': True}

    def solid(to_face, start_offset_expr, appearance_name, external_logger, **kw):
        seen['solid'] = (fusion_name('frame_height_offset'), fusion_name('panel_lip'), sorted(kw))

    lip_seen = []
    w.userParameters.add = (lambda real: (lambda n, *a: lip_seen.append(n) or real(n, *a)))(w.userParameters.add)
    r = sf.send_frame(w, payload(panelLip=0.1), lambda: Body(), Log(), resolve_template=resolve_template,
                      build_sketch=sketch, build_solid=solid, value_input=lambda e: e, scope=BoardScopeStub())
    assert r['ok'], r
    assert seen['sketch'] == ('kb000001_frame_thickness', 'kb000001_widthIn', 'kb000001_ck_arc_shoulder_weld',
                              'kb000001_heightIn/14 - kb000001_boundingboxoffset', 'fred_param')
    assert seen['solid'] == ('kb000001_frame_height_offset', 'kb000001_panel_lip', ['frame_comp', 'scope'])
    assert lip_seen == ['kb000001_panel_lip']  # the panel lip param is the board's too (synced before the builds)
    assert fusion_name('frame_thickness') == 'frame_thickness'  # closed after the build
    assert set(FRAME_SEND_PARAMS) == {'frame_height_offset', 'panel_lip'}


# ---- S2c: dimension (model parameter) names ------------------------------------------------------------------------
from fb_engine.board_scope import fusion_dim_name  # noqa: E402


def test_a_boards_dimension_names_are_its_own_and_a_legacy_build_unchanged():
    assert fusion_dim_name('seed_rad_hip') == 'seed_rad_hip'
    with naming(KB, ()):  # no user params declared: every dimension name is still the board's
        assert fusion_dim_name('seed_rad_hip') == 'kb000001_seed_rad_hip'
        assert fusion_dim_name('?') == '?'
    with naming(BoardNamer(), ()):
        assert fusion_dim_name('seed_rad_hip') == 'seed_rad_hip'


class _Dim:
    def __init__(self, name):
        self.parameter = types.SimpleNamespace(name=name, expression=None)
        self.deleted = False

    def deleteMe(self):
        self.deleted = True


def test_a_boards_dimension_is_named_driven_and_found_again_by_its_board_name():
    """Model params share one design-wide namespace: a second board naming its seed dim "seed_rad_hip" got no name
    (Fusion refused the duplicate) -- in a board's build it is "<id>_seed_rad_hip", driven by the board's params."""
    log = types.SimpleNamespace(log=lambda *a, **k: None)
    ctx = types.SimpleNamespace(logger=log, entity_map={})
    d = _Dim('d12')
    with naming(KB, {'frame_thickness'}):
        dimensions._apply_expression(ctx, None, d, 'seed_rad_hip', 'arc', 'frame_thickness * 2', None, False)
        assert (d.parameter.name, d.parameter.expression) == ('kb000001_seed_rad_hip', 'kb000001_frame_thickness * 2')
        sketch = types.SimpleNamespace(name='s', sketchDimensions=[_Dim('seed_rad_hip'), d])  # another board's first
        dimensions.delete_dimension_by_name(ctx, sketch, 'seed_rad_hip')
        assert d.deleted and not sketch.sketchDimensions[0].deleted

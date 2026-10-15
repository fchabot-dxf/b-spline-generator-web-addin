"""Send targets S1 (seat A 2026-10-14): a design holding several BOARDS -- fb_engine.board_scope.BoardScope and the
frame build's scoped lookups. A tagged board owns its own subtree; the legacy root board owns everything outside
the tagged boards (= everything, when there are none: a legacy design reads as before).

Fakes only (no Fusion): components with occurrences / attributes, a design with findAttributes and a timeline.
The Fusion behaviours behind the cut / axis rules were MEASURED live (probe 2) -- see board_scope.py.
"""
import os
import sys
import types

import pytest

_ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

if "adsk" not in sys.modules:
    adsk = types.ModuleType("adsk")
    adsk.core = types.ModuleType("adsk.core")
    adsk.fusion = types.ModuleType("adsk.fusion")
    sys.modules.update({"adsk": adsk, "adsk.core": adsk.core, "adsk.fusion": adsk.fusion})
if "adsk.cam" not in sys.modules:  # frame_engine imports adsk.cam too
    sys.modules["adsk.cam"] = sys.modules["adsk"].cam = types.ModuleType("adsk.cam")

from fb_engine import board_scope, send_frame, timeline_order  # noqa: E402
# at COLLECTION, like every other test importing them: frame_engine reloads parameter_schema & co at import, and a
# reload while the tests run gives test_fb_fix a second ResolveError class (measured: 5 of its asserts failed)
from fb_engine import frame_engine, extrusion_engine, parametric_engine  # noqa: E402
from fb_engine.board_scope import BoardScope, BOARD_ATTR  # noqa: E402


class Attr:
    def __init__(self, group, name, value, parent):
        self.groupName, self.name, self.value, self.parent = group, name, value, parent


class Occ:
    def __init__(self, comp, ctx=None):
        self.component, self.assemblyContext = comp, ctx


class Comp:
    def __init__(self, design, name):
        self.design, self.name, self.children = design, name, []
        self.features = types.SimpleNamespace(extrudeFeatures=f"extrudes of {name}")

    def add(self, child):
        self.children.append(child)
        return child

    @property
    def occurrences(self):
        return [Occ(c) for c in self.children]

    @property
    def allOccurrences(self):
        out = []
        for c in self.children:
            out.append(Occ(c))
            out.extend(c.allOccurrences)
        return out

    def tag(self, group, name, value):
        self.design.attributes.append(Attr(group, name, value, self))
        return self


class Design:
    def __init__(self):
        self.attributes = []
        self.rootComponent = Comp(self, "(Root)")
        self.rootComponent.allOccurrencesByComponent = lambda comp: [Occ(comp, ctx="root-context")]

    def findAttributes(self, group, name):
        return [a for a in self.attributes if (a.groupName, a.name) == (group, name)]


def frame(design, parent, name):
    return parent.add(Comp(design, name)).tag("FrameBuilder", "ComponentType", "Frame")


@pytest.fixture
def two_boards():
    """root: a legacy Set + Frame_1, and two tagged boards each with its own Set + frame."""
    d = Design()
    root = d.rootComponent
    w = types.SimpleNamespace(design=d, root=root)
    w.legacy_set = root.add(Comp(d, "B-Spline Set"))
    w.legacy_frame = frame(d, root, "Frame_1")
    for key, bid, fname in (("a", "bA", "Frame_2"), ("b", "bB", "Frame_3")):
        board = root.add(Comp(d, f"Board {key}")).tag(*BOARD_ATTR, bid)
        s = board.add(Comp(d, "B-Spline Set"))
        clean = s.add(Comp(d, "Clean"))
        setattr(w, f"board_{key}", board)
        setattr(w, f"set_{key}", s)
        setattr(w, f"clean_{key}", clean)
        setattr(w, f"frame_{key}", frame(d, board, fname))
    return w


def test_a_design_without_boards_is_one_legacy_board_that_owns_everything():
    d = Design()
    s = d.rootComponent.add(Comp(d, "B-Spline Set"))
    scope = BoardScope(d)
    assert not scope.is_board and not scope.has_boards()
    assert scope.owns(s) and scope.owns(d.rootComponent)


def test_a_tagged_board_owns_its_own_subtree_only(two_boards):
    w = two_boards
    a = BoardScope(w.design, w.board_a)
    assert a.is_board
    assert a.owns(w.board_a) and a.owns(w.set_a) and a.owns(w.clean_a) and a.owns(w.frame_a)
    assert not a.owns(w.set_b) and not a.owns(w.frame_b) and not a.owns(w.legacy_set) and not a.owns(w.legacy_frame)


def test_the_legacy_board_owns_nothing_inside_a_tagged_board(two_boards):
    w = two_boards
    legacy = BoardScope(w.design)
    assert legacy.has_boards()
    assert legacy.owns(w.legacy_set) and legacy.owns(w.legacy_frame)
    assert not any(legacy.owns(c) for c in (w.board_a, w.set_a, w.clean_a, w.frame_a, w.frame_b))


def test_frames_are_found_and_deleted_per_board(two_boards):
    w = two_boards
    assert send_frame.find_frames(w.design) == [w.legacy_frame, w.frame_a, w.frame_b]  # unscoped: as before
    assert send_frame.find_frames(w.design, BoardScope(w.design, w.board_b)) == [w.frame_b]
    assert send_frame.find_frames(w.design, BoardScope(w.design)) == [w.legacy_frame]


class Item:
    def __init__(self, name, entity, index):
        self.name, self.entity, self.index = name, entity, index


class Timeline:
    def __init__(self, items):
        self.items, self.markerPosition = items, len(items)

    @property
    def count(self):
        return len(self.items)

    def item(self, i):
        return self.items[i]


def test_the_frame_goes_before_ITS_board_inlay_not_another_boards(two_boards):
    w = two_boards
    ent = lambda comp: types.SimpleNamespace(parentComponent=comp)
    w.design.timeline = Timeline([
        Item("Plane for L1", ent(w.set_a), 0),      # board A's inlay (earlier in the timeline)
        Item("B-Spline Set", ent(w.board_b), 1),
        Item("Plane for L1", ent(w.set_b), 2),      # board B's own inlay
    ])
    state = timeline_order.mark_before_inlay(w.design, None, BoardScope(w.design, w.board_b))
    assert w.design.timeline.markerPosition == 2  # before B's inlay, never A's
    assert state["prior"] == 3
    w.design.timeline.markerPosition = 3
    timeline_order.mark_before_inlay(w.design)  # unscoped: the design's earliest inlay, as before
    assert w.design.timeline.markerPosition == 0


def test_the_trim_cut_context_is_the_roots_for_a_board_and_none_for_the_legacy_board(two_boards):
    w = two_boards
    assert BoardScope(w.design).cut_context(w.legacy_frame) is None
    feats, occ = BoardScope(w.design, w.board_a).cut_context(w.frame_a)
    assert feats == "extrudes of (Root)"  # MEASURED (probe 2): only the root's features cut a board's panel
    assert occ.component is w.frame_a and occ.assemblyContext == "root-context"


def test_a_boards_trim_cut_is_built_from_the_root_with_a_root_context_profile(monkeypatch):
    calls = []

    class Extrudes:
        def __init__(self, name):
            self.name = name

        def createInput(self, prof, op):
            calls.append((self.name, prof))
            raise RuntimeError("stop here")  # the per-profile guard logs it and returns no bodies

    monkeypatch.setattr(extrusion_engine.adsk.fusion, "FeatureOperations",
                        types.SimpleNamespace(CutFeatureOperation="cut", NewBodyFeatureOperation="new"), raising=False)
    prof = types.SimpleNamespace(area=1.0, createForAssemblyContext=lambda occ: ("proxy of profile in", occ))
    eng = extrusion_engine.ExtrusionEngine.__new__(extrusion_engine.ExtrusionEngine)
    eng.log = types.SimpleNamespace(log=lambda *a, **k: None)
    plan = {"kind": "SURROUND", "name": None, "start": "0 in", "extent": ("throughAllBothSides",), "taper": "0 deg"}
    eng._extrude_one_profile(Extrudes("frame"), prof, plan, 4, "t1", None, "Frame_2", cut_context=(Extrudes("root"), "frame-occ"))
    assert calls == [("root", ("proxy of profile in", "frame-occ"))]
    calls.clear()
    eng._extrude_one_profile(Extrudes("frame"), prof, plan, 4, "t1", None, "Frame_1")  # the legacy board: unchanged
    assert calls == [("frame", prof)]
    bar = dict(plan, kind="BAR")
    eng._extrude_one_profile(Extrudes("frame"), prof, bar, 0, "t1", None, "Frame_2", cut_context=(Extrudes("root"), "frame-occ"))
    assert calls[-1] == ("frame", prof)  # a bar stays in the frame component


def test_the_outline_projects_its_own_components_axes():
    builder = parametric_engine.ParametricSketchBuilder.__new__(parametric_engine.ParametricSketchBuilder)
    root_axes = types.SimpleNamespace(xConstructionAxis="ROOT X", yConstructionAxis="ROOT Y")
    builder.ctx = types.SimpleNamespace(entity_map={"s": {}}, logger=types.SimpleNamespace(log=lambda *a, **k: None),
                                        design=types.SimpleNamespace(rootComponent=root_axes))
    projected = []
    sketch = types.SimpleNamespace(parentComponent=types.SimpleNamespace(xConstructionAxis="OWN X", yConstructionAxis="OWN Y"),
                                   project=lambda e: projected.append(e) or types.SimpleNamespace(count=1, item=lambda i: f"proj {e}"))
    builder._project_y_axis(sketch, "s")
    builder._project_x_axis(sketch, "s")
    assert projected == ["OWN Y", "OWN X"]  # MEASURED (probe 2): the root's lie outside an offset board
    assert builder.ctx.entity_map["s"] == {"Y_AXIS": "proj OWN Y", "X_AXIS": "proj OWN X"}


def test_a_boards_frame_component_goes_under_the_board_with_a_design_unique_name(two_boards, monkeypatch):
    w = two_boards
    added = []

    class Occs(list):
        def addNewComponent(self, m):
            c = Comp(w.design, "Component")
            c.attributes = types.SimpleNamespace(add=lambda *a: w.design.attributes.append(Attr(*a, c)))
            added.append(c)
            return types.SimpleNamespace(component=c)

    board_c = types.SimpleNamespace(occurrences=Occs())
    monkeypatch.setattr(frame_engine.adsk.core, "Matrix3D", types.SimpleNamespace(create=lambda: "I"), raising=False)
    fb = frame_engine.FrameBuilder.__new__(frame_engine.FrameBuilder)
    fb.root, fb.logger = w.root, types.SimpleNamespace(log=lambda *a, **k: None)
    fb.design = types.SimpleNamespace(allComponents=[w.legacy_frame, w.frame_a, w.frame_b])
    fb.scope = types.SimpleNamespace(host=board_c, is_board=True, has_boards=lambda: True)
    comp = fb._create_incremental_component("template_1")
    assert added == [comp] and comp.name == "Frame_4"  # Frame_1..3 exist somewhere in the design
